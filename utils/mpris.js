import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Shell from "gi://Shell";

const MPRIS_PREFIX = "org.mpris.MediaPlayer2";
const MPRIS_PATH = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER_IFACE = "org.mpris.MediaPlayer2.Player";
const MPRIS_IFACE = "org.mpris.MediaPlayer2";
const DBUS_TIMEOUT = 10000; // Increased for Flatpak stability

// Helper functions for safe variant extraction
function getString(variant) {
  if (!variant) return null;
  try {
    const str = variant.get_string ? variant.get_string()[0] : null;
    return str || null;
  } catch (e) {
    return null;
  }
}

function getInt64(variant) {
  if (!variant) return null;
  try {
    return variant.get_int64();
  } catch (e) {
    return null;
  }
}

function getInt32(variant) {
  if (!variant) return null;
  try {
    return variant.get_int32();
  } catch (e) {
    return null;
  }
}

export class MprisManager {
  constructor() {
    this._bus = null;
    this._proxies = new Map();
    this._identities = new Map();
    this._desktopEntries = new Map();
    this._instanceMetadata = new Map();
    this._playerPositions = new Map(); // NEW: Track slider positions per player
    this._subscriptions = [];
    this._onPlayerAdded = null;
    this._onPlayerRemoved = null;
    this._onPlayerChanged = null;
    this._onSeeked = null;
    this._isDestroyed = false;
    this._proxySignals = new Map();
    this._pendingProxies = new Set();
    this._errorCounts = new Map();
    this._maxErrorsPerPlayer = 10; // Increased tolerance
    this._operationsPaused = false;
    this._cleanupTimers = new Map();
    this._proxyCleanupQueue = [];
    this._cleanupInProgress = false;
  }

  pauseOperations() {
    this._operationsPaused = true;
  }

  resumeOperations() {
    GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
      this._operationsPaused = false;
      return GLib.SOURCE_REMOVE;
    });
  }

  async init(callbacks) {
    if (this._isDestroyed) return;
    
    this._bus = Gio.DBus.session;
    this._onPlayerAdded = callbacks.added || null;
    this._onPlayerRemoved = callbacks.removed || null;
    this._onPlayerChanged = callbacks.changed || null;
    this._onSeeked = callbacks.seeked || null;

    try {
      const watchId = this._bus.signal_subscribe(
        "org.freedesktop.DBus",
        "org.freedesktop.DBus",
        "NameOwnerChanged",
        "/org/freedesktop/DBus",
        null,
        Gio.DBusSignalFlags.NONE,
        this._onNameOwnerChanged.bind(this)
      );
      this._subscriptions.push(watchId);
    } catch (e) {
      logError(e, "Failed to subscribe to NameOwnerChanged");
    }

    await this._scanExistingPlayers();
  }

  async _scanExistingPlayers() {
    if (this._isDestroyed) return;
    
    return new Promise((resolve) => {
      this._bus.call(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "ListNames",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT,
        null,
        async (conn, result) => {
          try {
            if (this._isDestroyed) {
              resolve();
              return;
            }
            
            const reply = conn.call_finish(result);
            const [names] = reply.deep_unpack();
            const players = names.filter(name => name.startsWith(`${MPRIS_PREFIX}.`));

            for (const name of players) {
              if (this._isDestroyed) break;
              await this._addPlayer(name);
            }
            resolve();
          } catch (e) {
            logError(e, "Failed to scan existing players");
            resolve();
          }
        }
      );
    });
  }

  async _onNameOwnerChanged(conn, sender, path, iface, signal, params) {
    if (this._isDestroyed || this._operationsPaused) return;
    
    try {
      const [name, oldOwner, newOwner] = params.deep_unpack();
      if (!name.startsWith(`${MPRIS_PREFIX}.`)) return;

      if (!oldOwner && newOwner) {
        // CRITICAL FIX: Longer delay for Flatpak apps
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 800, () => {
          if (!this._isDestroyed && !this._operationsPaused) {
            this._addPlayer(name);
          }
          return GLib.SOURCE_REMOVE;
        });
      } else if (oldOwner && !newOwner) {
        this._schedulePlayerRemoval(name);
      }
    } catch (e) {
      logError(e, "Error in _onNameOwnerChanged");
    }
  }

  _schedulePlayerRemoval(name) {
    if (this._cleanupTimers.has(name)) {
      GLib.source_remove(this._cleanupTimers.get(name));
    }

    // CRITICAL FIX: Queue cleanup instead of immediate removal
    const timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
      if (!this._isDestroyed && !this._operationsPaused) {
        this._queueProxyCleanup(name);
      }
      this._cleanupTimers.delete(name);
      return GLib.SOURCE_REMOVE;
    });

    this._cleanupTimers.set(name, timerId);
  }

  // CRITICAL FIX: Queue-based proxy cleanup to prevent logout
  _queueProxyCleanup(name) {
    if (!this._proxies.has(name)) return;
    
    this._proxyCleanupQueue.push(name);
    
    if (!this._cleanupInProgress) {
      this._processCleanupQueue();
    }
  }

  _processCleanupQueue() {
    if (this._proxyCleanupQueue.length === 0 || this._isDestroyed) {
      this._cleanupInProgress = false;
      return;
    }

    this._cleanupInProgress = true;
    const name = this._proxyCleanupQueue.shift();

    GLib.timeout_add(GLib.PRIORITY_LOW, 150, () => {
      if (!this._isDestroyed && !this._operationsPaused) {
        this._removePlayerSafe(name);
      }
      
      GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
        this._processCleanupQueue();
        return GLib.SOURCE_REMOVE;
      });
      
      return GLib.SOURCE_REMOVE;
    });
  }

  async _addPlayer(name) {
    if (this._proxies.has(name) || this._pendingProxies.has(name) || this._isDestroyed || this._operationsPaused) return;

    this._pendingProxies.add(name);

    try {
      const proxy = await this._createProxy(name);
      if (this._isDestroyed || this._operationsPaused) {
        this._safeDisposeProxy(proxy);
        this._pendingProxies.delete(name);
        return;
      }
      
      this._proxies.set(name, proxy);
      this._errorCounts.set(name, 0);
      
      const signals = new Map();
      this._proxySignals.set(name, signals);

      await this._fetchIdentity(name);
      await this._fetchDesktopEntry(name);

      if (this._isDestroyed || this._operationsPaused) {
        this._queueProxyCleanup(name);
        this._pendingProxies.delete(name);
        return;
      }

      // CRITICAL FIX: Wrap signal connections in try-catch
      try {
        const propSignalId = proxy.connect("g-properties-changed", (p, changed) => {
          if (this._isDestroyed || this._operationsPaused) return;
          
          try {
            const props = changed.deep_unpack();
            if (
              "Metadata" in props ||
              "PlaybackStatus" in props ||
              "Shuffle" in props ||
              "LoopStatus" in props ||
              "Position" in props
            ) {
              this._updateInstanceMetadata(name);
              
              // Save position for this player
              if ("Position" in props) {
                const pos = getInt64(props["Position"]);
                if (pos !== null) {
                  this._playerPositions.set(name, pos);
                }
              }
              
              if (!this._operationsPaused) {
                this._onPlayerChanged?.(name);
              }
              
              this._errorCounts.set(name, 0);
            }
          } catch (e) {
            this._handlePlayerError(name, e, "property change");
          }
        });
        signals.set('properties', propSignalId);
      } catch (e) {
        logError(e, `Failed to connect property signals for ${name}`);
      }

      try {
        const seekSignalId = proxy.connectSignal("Seeked", (proxy, sender, [position]) => {
          if (this._isDestroyed || this._operationsPaused) return;
          
          try {
            this._playerPositions.set(name, position);
            if (!this._operationsPaused) {
              this._onSeeked?.(name, position);
            }
          } catch (e) {
            this._handlePlayerError(name, e, "seek");
          }
        });
        signals.set('seeked', seekSignalId);
      } catch (e) {
        logError(e, `Failed to connect seek signal for ${name}`);
      }

      this._updateInstanceMetadata(name);
      this._pendingProxies.delete(name);
      
      if (!this._isDestroyed && !this._operationsPaused) {
        this._onPlayerAdded?.(name);
      }
    } catch (e) {
      logError(e, `Failed to add player ${name}`);
      this._proxies.delete(name);
      this._proxySignals.delete(name);
      this._pendingProxies.delete(name);
    }
  }

  // NEW: Get saved position for player
  getPlayerPosition(name) {
    return this._playerPositions.get(name) || 0;
  }

  _handlePlayerError(name, error, context) {
    if (this._isDestroyed || this._operationsPaused) return;
    
    const errorCount = (this._errorCounts.get(name) || 0) + 1;
    this._errorCounts.set(name, errorCount);
    
    if (errorCount < 3) {
      logError(error, `Player ${name} error in ${context} (${errorCount}/${this._maxErrorsPerPlayer})`);
    }
    
    if (errorCount >= this._maxErrorsPerPlayer && !this._operationsPaused) {
      this._schedulePlayerRemoval(name);
    }
  }

  _updateInstanceMetadata(name) {
    if (this._isDestroyed || this._operationsPaused) return;
    
    try {
      const info = this.getPlayerInfo(name);
      if (info && info.title) {
        this._instanceMetadata.set(name, {
          title: info.title,
          artists: info.artists,
          trackId: info.trackId,
          status: info.status,
          artUrl: info.artUrl, // NEW: Save art URL
        });
      }
    } catch (e) {
      // Silently handle
    }
  }

  async _fetchIdentity(name) {
    if (this._isDestroyed || this._operationsPaused) return;
    
    return new Promise((resolve) => {
      this._bus.call(
        name,
        MPRIS_PATH,
        "org.freedesktop.DBus.Properties",
        "Get",
        new GLib.Variant("(ss)", [MPRIS_IFACE, "Identity"]),
        null,
        Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT,
        null,
        (conn, result) => {
          if (this._isDestroyed || this._operationsPaused) {
            resolve();
            return;
          }
          
          try {
            const reply = conn.call_finish(result);
            const identity = reply.deep_unpack()[0].unpack();
            this._identities.set(name, identity);
          } catch (e) {
            const shortName = name.replace(`${MPRIS_PREFIX}.`, "");
            this._identities.set(name, shortName);
          }
          resolve();
        }
      );
    });
  }

  async _fetchDesktopEntry(name) {
    if (this._isDestroyed || this._operationsPaused) return;
    
    return new Promise((resolve) => {
      this._bus.call(
        name,
        MPRIS_PATH,
        "org.freedesktop.DBus.Properties",
        "Get",
        new GLib.Variant("(ss)", [MPRIS_IFACE, "DesktopEntry"]),
        null,
        Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT,
        null,
        (conn, result) => {
          if (this._isDestroyed || this._operationsPaused) {
            resolve();
            return;
          }
          
          try {
            const reply = conn.call_finish(result);
            const desktopEntry = reply.deep_unpack()[0].unpack();
            this._desktopEntries.set(name, desktopEntry);
          } catch (e) {
            // Desktop entry is optional
          }
          resolve();
        }
      );
    });
  }

  // CRITICAL FIX: Safe proxy disposal
  _safeDisposeProxy(proxy) {
    if (!proxy) return;
    
    GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
      try {
        proxy.run_dispose();
      } catch (e) {
        // Silently ignore
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  // CRITICAL FIX: Safe player removal
  _removePlayerSafe(name) {
    if (!this._proxies.has(name)) return;
    
    const signals = this._proxySignals.get(name);
    const proxy = this._proxies.get(name);
    
    // Disconnect signals first
    if (signals && proxy) {
      for (const [signalType, signalId] of signals) {
        try {
          proxy.disconnect(signalId);
        } catch (e) {
          // Silently ignore
        }
      }
      this._proxySignals.delete(name);
    }
    
    // Remove from maps
    this._proxies.delete(name);
    this._identities.delete(name);
    this._desktopEntries.delete(name);
    this._instanceMetadata.delete(name);
    this._errorCounts.delete(name);
    // Keep position for potential re-add
    
    // Dispose proxy later
    if (proxy) {
      this._safeDisposeProxy(proxy);
    }
    
    if (!this._isDestroyed && !this._operationsPaused) {
      this._onPlayerRemoved?.(name);
    }
  }

  // Legacy method for compatibility
  _removePlayer(name) {
    this._queueProxyCleanup(name);
  }

  async _createProxy(name) {
    return new Promise((resolve, reject) => {
      Gio.DBusProxy.new(
        this._bus,
        Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        null,
        name,
        MPRIS_PATH,
        MPRIS_PLAYER_IFACE,
        null,
        (source, result) => {
          if (this._isDestroyed || this._operationsPaused) {
            reject(new Error("Manager destroyed or paused"));
            return;
          }
          
          try {
            const proxy = Gio.DBusProxy.new_finish(result);
            resolve(proxy);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  getPlayerInfo(name) {
    if (this._isDestroyed || this._operationsPaused) return null;
    
    const proxy = this._proxies.get(name);
    if (!proxy) return null;

    try {
      const statusV = proxy.get_cached_property("PlaybackStatus");
      const status = statusV ? statusV.deep_unpack() : "Stopped";

      if (status !== "Playing" && status !== "Paused" && status !== "Stopped") {
        return null;
      }

      const metaV = proxy.get_cached_property("Metadata");
      if (!metaV) return null;

      const meta = {};
      const len = metaV.n_children();
      
      if (!len) return null;

      for (let i = 0; i < len; i++) {
        try {
          const item = metaV.get_child_value(i);
          const key = getString(item.get_child_value(0));
          const valueVariant = item.get_child_value(1).get_variant();
          
          if (!key) continue;
          meta[key] = valueVariant;
        } catch (e) {
          continue;
        }
      }

      const positionV = proxy.get_cached_property("Position");
      const shuffleV = proxy.get_cached_property("Shuffle");
      const loopStatusV = proxy.get_cached_property("LoopStatus");

      const lengthMicroseconds = getInt64(meta["mpris:length"]);
      const artUrl = getString(meta["mpris:artUrl"]);
      const trackId = getString(meta["mpris:trackid"]) || "/";
      
      // Use saved position if available
      const savedPosition = this._playerPositions.get(name);
      const currentPosition = positionV ? positionV.unpack() : (savedPosition || 0);
      
      return {
        title: getString(meta["xesam:title"]),
        artists: meta["xesam:artist"]?.deep_unpack() ?? null,
        album: getString(meta["xesam:album"]),
        artUrl: artUrl,
        trackId: trackId,
        trackNumber: getInt32(meta["xesam:trackNumber"]),
        discNumber: getInt32(meta["xesam:discNumber"]),
        genres: meta["xesam:genre"]?.deep_unpack() ?? null,
        contentCreated: getString(meta["xesam:contentCreated"]),
        status: status,
        position: currentPosition,
        length: lengthMicroseconds || 0,
        shuffle: shuffleV ? shuffleV.unpack() : false,
        loopStatus: loopStatusV ? loopStatusV.unpack() : "None",
      };
    } catch (e) {
      this._handlePlayerError(name, e, "getPlayerInfo");
      return null;
    }
  }

  getPlayerDisplayLabel(name) {
    const baseApp = this._getBaseAppName(name);
    const instances = this._getInstancesOfApp(baseApp);
    
    if (instances.length <= 1) {
      return this.getPlayerIdentity(name);
    }
    
    const metadata = this._instanceMetadata.get(name);
    if (metadata && metadata.title) {
      const shortTitle = metadata.title.length > 25 
        ? metadata.title.substring(0, 25) + "..." 
        : metadata.title;
      return `${this.getPlayerIdentity(name)}: ${shortTitle}`;
    }
    
    return this.getPlayerIdentity(name);
  }

  _getBaseAppName(name) {
    return name.replace(/\.instance_\d+_\d+$/, "");
  }

  _getInstancesOfApp(baseAppName) {
    const instances = [];
    for (const name of this._proxies.keys()) {
      if (this._getBaseAppName(name) === baseAppName) {
        instances.push(name);
      }
    }
    return instances;
  }

  getGroupedPlayers() {
    const groups = new Map();
    
    for (const name of this._proxies.keys()) {
      const baseApp = this._getBaseAppName(name);
      if (!groups.has(baseApp)) {
        groups.set(baseApp, []);
      }
      groups.get(baseApp).push(name);
    }
    
    return groups;
  }

  getPlayerIdentity(name) {
    return this._identities.get(name) || name.replace(`${MPRIS_PREFIX}.`, "");
  }

  getAppInfo(name) {
    if (this._isDestroyed || this._operationsPaused) return null;
    
    try {
      const desktopEntry = this._desktopEntries.get(name);
      if (desktopEntry) {
        let appInfo = Gio.DesktopAppInfo.new(`${desktopEntry}.desktop`);
        if (appInfo) return appInfo;
        
        appInfo = Gio.DesktopAppInfo.new(desktopEntry);
        if (appInfo) return appInfo;
      }

      let cleanName = name.replace(`${MPRIS_PREFIX}.`, "").toLowerCase();
      cleanName = cleanName.replace(/\.instance_\d+_\d+$/, "");
      
      const appSystem = Shell.AppSystem.get_default();
      const app = appSystem.lookup_app(`${cleanName}.desktop`);
      
      if (app) {
        return app.get_app_info();
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  getAppIcon(name) {
    if (this._isDestroyed || this._operationsPaused) return "audio-x-generic-symbolic";
    
    try {
      const iconTheme = Gtk.IconTheme.get_for_display(
        require('gi://Gdk').Display.get_default()
      );
      
      const desktopEntry = this._desktopEntries.get(name);
      if (desktopEntry) {
        const iconNames = [
          desktopEntry,
          desktopEntry.toLowerCase(),
          `${desktopEntry}-symbolic`,
          `${desktopEntry.toLowerCase()}-symbolic`,
        ];
        
        for (const iconName of iconNames) {
          if (iconTheme.has_icon(iconName)) {
            return iconName;
          }
        }
      }

      let cleanName = name.replace(`${MPRIS_PREFIX}.`, "").toLowerCase();
      cleanName = cleanName.replace(/\.instance_\d+_\d+$/, "");
      
      const appMappings = {
        'spotify': 'spotify',
        'vlc': 'vlc',
        'firefox': 'firefox',
        'chromium': 'chromium',
        'chrome': 'google-chrome',
        'rhythmbox': 'rhythmbox',
        'totem': 'totem',
        'mpv': 'mpv',
        'smplayer': 'smplayer',
        'audacious': 'audacious',
        'clementine': 'clementine',
        'strawberry': 'strawberry',
        'elisa': 'elisa',
        'lollypop': 'lollypop',
        'celluloid': 'celluloid',
        'brave': 'brave-browser',
        'gnome-music': 'org.gnome.Music',
        'amberol': 'io.bassi.Amberol',
      };

      const mappedName = appMappings[cleanName] || cleanName;
      
      const iconNames = [
        mappedName,
        `${mappedName}-symbolic`,
        cleanName,
        `${cleanName}-symbolic`,
        "audio-x-generic-symbolic"
      ];

      for (const iconName of iconNames) {
        if (iconTheme.has_icon(iconName)) {
          return iconName;
        }
      }
      
      return "audio-x-generic-symbolic";
    } catch (e) {
      return "audio-x-generic-symbolic";
    }
  }

  async callMethod(name, method, params = null) {
    if (this._isDestroyed || this._operationsPaused) throw new Error("Manager not available");
    
    const proxy = this._proxies.get(name);
    if (!proxy) throw new Error(`No proxy for ${name}`);

    return new Promise((resolve, reject) => {
      proxy.call(
        method,
        params,
        Gio.DBusCallFlags.NO_AUTO_START,
        DBUS_TIMEOUT,
        null,
        (p, result) => {
          if (!p || this._isDestroyed || this._operationsPaused) {
            reject(new Error("Call failed or manager unavailable"));
            return;
          }
          
          try {
            p.call_finish(result);
            this._errorCounts.set(name, 0);
            resolve();
          } catch (e) {
            this._handlePlayerError(name, e, `method ${method}`);
            reject(e);
          }
        }
      );
    });
  }

  async setProperty(name, property, value) {
    if (this._isDestroyed || this._operationsPaused || !this._bus) throw new Error("Manager not available");

    return new Promise((resolve, reject) => {
      this._bus.call(
        name,
        MPRIS_PATH,
        "org.freedesktop.DBus.Properties",
        "Set",
        new GLib.Variant("(ssv)", [MPRIS_PLAYER_IFACE, property, value]),
        null,
        Gio.DBusCallFlags.NO_AUTO_START,
        DBUS_TIMEOUT,
        null,
        (conn, result) => {
          if (this._isDestroyed || this._operationsPaused) {
            reject(new Error("Manager unavailable"));
            return;
          }
          
          try {
            conn.call_finish(result);
            this._errorCounts.set(name, 0);
            resolve();
          } catch (e) {
            this._handlePlayerError(name, e, `set property ${property}`);
            reject(e);
          }
        }
      );
    });
  }

  playPause(name) {
    return this.callMethod(name, "PlayPause");
  }

  next(name) {
    return this.callMethod(name, "Next");
  }

  previous(name) {
    return this.callMethod(name, "Previous");
  }

  setPosition(name, trackId, position) {
    const positionUs = Math.floor(position * 1000000);
    this._playerPositions.set(name, positionUs);
    return this.callMethod(
      name,
      "SetPosition",
      new GLib.Variant("(ox)", [trackId, positionUs])
    );
  }

  toggleShuffle(name) {
    const info = this.getPlayerInfo(name);
    if (info) {
      return this.setProperty(name, "Shuffle", new GLib.Variant("b", !info.shuffle));
    }
    return Promise.reject(new Error("No player info available"));
  }

  cycleLoopStatus(name) {
    const info = this.getPlayerInfo(name);
    if (info) {
      const statuses = ["None", "Track", "Playlist"];
      const current = statuses.indexOf(info.loopStatus);
      const next = statuses[(current + 1) % statuses.length];
      return this.setProperty(name, "LoopStatus", new GLib.Variant("s", next));
    }
    return Promise.reject(new Error("No player info available"));
  }

  getPlayers() {
    return Array.from(this._proxies.keys());
  }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this._operationsPaused = true;
    
    // Clear all timers
    for (const timerId of this._cleanupTimers.values()) {
      try {
        GLib.source_remove(timerId);
      } catch (e) {}
    }
    this._cleanupTimers.clear();
    
    // Unsubscribe from D-Bus
    if (this._bus) {
      for (const id of this._subscriptions) {
        try {
          this._bus.signal_unsubscribe(id);
        } catch (e) {}
      }
    }

    // CRITICAL FIX: Gradual proxy cleanup
    const proxyNames = Array.from(this._proxies.keys());
    let cleanupIndex = 0;
    
    const cleanupNext = () => {
      if (cleanupIndex >= proxyNames.length) {
        this._finalCleanup();
        return;
      }
      
      const name = proxyNames[cleanupIndex++];
      this._removePlayerSafe(name);
      
      GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
        cleanupNext();
        return GLib.SOURCE_REMOVE;
      });
    };
    
    cleanupNext();
  }

  _finalCleanup() {
    this._subscriptions = [];
    this._proxies.clear();
    this._identities.clear();
    this._desktopEntries.clear();
    this._instanceMetadata.clear();
    this._proxySignals.clear();
    this._errorCounts.clear();
    this._pendingProxies.clear();
    this._playerPositions.clear();
    this._proxyCleanupQueue = [];
    this._bus = null;
    this._onPlayerAdded = null;
    this._onPlayerRemoved = null;
    this._onPlayerChanged = null;
    this._onSeeked = null;
  }
}