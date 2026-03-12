import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { MprisPlayer } from "./MprisPlayer.js";
import { MprisUtils } from "./MprisUtils.js";
import { MprisConstants } from "./MprisConstants.js";

export class MprisManager {
  constructor() {
    this._bus = null;
    this._proxies = new Map();
    this._identities = new Map();
    this._desktopEntries = new Map();
    this._instanceMetadata = new Map();
    this._playerPositions = new Map();
    this._subscriptions = [];
    this._onPlayerAdded = null;
    this._onPlayerRemoved = null;
    this._onPlayerChanged = null;
    this._onSeeked = null;
    this._proxySignals = new Map();
    this._pendingProxies = new Set();
    this._errorCounts = new Map();
    this._maxErrorsPerPlayer = 10;
    this._operationsPaused = false;
    this._cleanupTimers = new Map();
    this._proxyCleanupQueue = [];
    this._cleanupInProgress = false;
    this._pollingPlayers = new Set();
    this._positionPollingInterval = null;

    // Settings reference for player filtering (set via setSettings)
    this._settings = null;

    this._player = new MprisPlayer(this);
  }

  /**
   * Provide a GSettings instance so the manager can apply the player filter.
   * Call this before init().
   * @param {Gio.Settings} settings
   */
  setSettings(settings) {
    this._settings = settings;
  }

  // ── Player filter ──────────────────────────────────────────────────────────

  /**
   * Returns true when the given MPRIS bus name should be tracked.
   *
   * Filter modes (player-filter-mode):
   *   0 – Off  : all players are allowed
   *   1 – Blacklist : players whose short name appears in the list are excluded
   *   2 – Whitelist : only players whose short name appears in the list are allowed
   *
   * "Short name" = the part after "org.mpris.MediaPlayer2.", with any
   * ".instanceN" / numeric-suffix removed, lowercased.
   *
   * @param {string} busName  full MPRIS bus name
   * @returns {boolean}
   */
  _shouldIncludePlayer(busName) {
    if (!this._settings) return true;

    let mode;
    try {
      mode = this._settings.get_int("player-filter-mode");
    } catch (_e) {
      return true; // key missing – fail open
    }

    if (mode === 0) return true; // Off – allow everything

    let listStr;
    try {
      listStr = this._settings.get_string("player-filter-list") || "";
    } catch (_e) {
      return true;
    }

    // Parse entries — skip any prefixed with "~" (those are saved but
    // disabled by the user via the toggle in prefs).
    const listed = listStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith("~"))   // "~name" = saved but inactive
      .map((s) => s.toLowerCase());

    if (listed.length === 0) return true; // empty / all-disabled – allow everything

    // Derive the "short" name (same normalisation as prefs and the UI)
    const short = busName
      .replace(`${MprisConstants.MPRIS_PREFIX}.`, "")
      .replace(/\.instance[_\d]+$/i, "")
      .replace(/\.\d+$/, "")
      .toLowerCase();

    const inList = listed.includes(short);

    if (mode === 1) return !inList;  // Blacklist – exclude if found in active list
    if (mode === 2) return inList;   // Whitelist – allow only if found in active list

    return true;
  }

  // ── Position polling ───────────────────────────────────────────────────────

  startPositionPolling(name) {
    if (!name || this._pollingPlayers.has(name)) return;

    this._pollingPlayers.add(name);

    if (!this._positionPollingInterval) {
      this._positionPollingInterval = GLib.timeout_add(
        GLib.PRIORITY_LOW,
        1000,
        () => {
          for (const playerName of this._pollingPlayers) {
            this._pollPlayerPosition(playerName);
          }

          return GLib.SOURCE_CONTINUE;
        },
      );
    }
  }

  stopPositionPolling(name) {
    this._pollingPlayers.delete(name);

    if (this._pollingPlayers.size === 0 && this._positionPollingInterval) {
      GLib.source_remove(this._positionPollingInterval);
      this._positionPollingInterval = null;
    }
  }

  _pollPlayerPosition(name) {
    if (this._operationsPaused) return;

    const proxy = this._proxies.get(name);
    if (!proxy) return;

    const statusV = proxy.get_cached_property("PlaybackStatus");
    const status = statusV ? statusV.deep_unpack() : "Stopped";

    if (status !== "Playing") return;

    this._bus.call(
      name,
      MprisConstants.MPRIS_PATH,
      "org.freedesktop.DBus.Properties",
      "Get",
      new GLib.Variant("(ss)", [MprisConstants.MPRIS_PLAYER_IFACE, "Position"]),
      null,
      Gio.DBusCallFlags.NONE,
      1000,
      null,
      (conn, result) => {
        if (this._operationsPaused) return;

        try {
          const reply = conn.call_finish(result);
          const position = reply.deep_unpack()[0].unpack();
          const oldPosition = this._playerPositions.get(name) || 0;

          if (Math.abs(position - oldPosition) > 500000) {
            this._playerPositions.set(name, position);
            this._onPlayerChanged?.(name);
          }
        } catch (e) {
          this.stopPositionPolling(name);
        }
      },
    );
  }

  pauseOperations() {
    this._operationsPaused = true;
  }

  resumeOperations() {
    // Remove existing timeout before creating new one
    if (this._resumeTimeout) {
      GLib.source_remove(this._resumeTimeout);
      this._resumeTimeout = null;
    }

    this._resumeTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
      this._operationsPaused = false;
      this._resumeTimeout = null;
      return GLib.SOURCE_REMOVE;
    });
  }

  async init(callbacks) {
    this._bus = Gio.DBus.session;
    this._onPlayerAdded = callbacks.added || null;
    this._onPlayerRemoved = callbacks.removed || null;
    this._onPlayerChanged = callbacks.changed || null;
    this._onSeeked = callbacks.seeked || null;

    const watchId = this._bus.signal_subscribe(
      "org.freedesktop.DBus",
      "org.freedesktop.DBus",
      "NameOwnerChanged",
      "/org/freedesktop/DBus",
      null,
      Gio.DBusSignalFlags.NONE,
      this._onNameOwnerChanged.bind(this),
    );
    this._subscriptions.push(watchId);

    await this._scanExistingPlayers();
  }

  async _scanExistingPlayers() {
    return new Promise((resolve) => {
      this._bus.call(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "ListNames",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        MprisConstants.DBUS_TIMEOUT,
        null,
        async (conn, result) => {
          try {
            const reply = conn.call_finish(result);
            const [names] = reply.deep_unpack();
            const players = names.filter(
              (name) =>
                name.startsWith(`${MprisConstants.MPRIS_PREFIX}.`) &&
                this._shouldIncludePlayer(name),
            );

            for (const name of players) {
              await this._player.addPlayer(name);
            }
            resolve();
          } catch (e) {
            console.error("Failed to scan existing players:", e);
            resolve();
          }
        },
      );
    });
  }

  async _onNameOwnerChanged(conn, sender, path, iface, signal, params) {
    if (this._operationsPaused) return;

    const [name, oldOwner, newOwner] = params.deep_unpack();
    if (!name.startsWith(`${MprisConstants.MPRIS_PREFIX}.`)) return;

    // Respect the player filter for newly-appearing players
    if (!oldOwner && newOwner) {
      if (!this._shouldIncludePlayer(name)) return;

      // Remove existing timeout before creating new one
      if (this._addPlayerTimeout) {
        GLib.source_remove(this._addPlayerTimeout);
        this._addPlayerTimeout = null;
      }

      this._addPlayerTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT_IDLE,
        800,
        () => {
          if (!this._operationsPaused) {
            this._player.addPlayer(name);
          }
          this._addPlayerTimeout = null;
          return GLib.SOURCE_REMOVE;
        },
      );
    } else if (oldOwner && !newOwner) {
      this._player.schedulePlayerRemoval(name);
    }
  }

  getPlayerInfo(name) {
    return this._player.getPlayerInfo(name);
  }

  getPlayerPosition(name) {
    return this._playerPositions.get(name) || 0;
  }

  getPlayerDisplayLabel(name) {
    return this._player.getPlayerDisplayLabel(name);
  }

  getGroupedPlayers() {
    return this._player.getGroupedPlayers();
  }

  getPlayerIdentity(name) {
    return (
      this._identities.get(name) ||
      name.replace(`${MprisConstants.MPRIS_PREFIX}.`, "")
    );
  }

  getAppInfo(name) {
    return MprisUtils.getAppInfo(name, this._desktopEntries);
  }

  getAppIcon(name) {
    return MprisUtils.getAppIcon(name, this._desktopEntries);
  }

  async callMethod(name, method, params = null) {
    if (this._operationsPaused) throw new Error("Manager not available");

    const proxy = this._proxies.get(name);
    if (!proxy) throw new Error(`No proxy for ${name}`);

    return new Promise((resolve, reject) => {
      proxy.call(
        method,
        params,
        Gio.DBusCallFlags.NO_AUTO_START,
        MprisConstants.DBUS_TIMEOUT,
        null,
        (p, result) => {
          if (!p || this._operationsPaused) {
            reject(new Error("Call failed or manager unavailable"));
            return;
          }

          try {
            p.call_finish(result);
            this._errorCounts.set(name, 0);
            resolve();
          } catch (e) {
            this._player.handlePlayerError(name, e, `method ${method}`);
            reject(e);
          }
        },
      );
    });
  }

  async setProperty(name, property, value) {
    if (this._operationsPaused || !this._bus)
      throw new Error("Manager not available");

    return new Promise((resolve, reject) => {
      this._bus.call(
        name,
        MprisConstants.MPRIS_PATH,
        "org.freedesktop.DBus.Properties",
        "Set",
        new GLib.Variant("(ssv)", [
          MprisConstants.MPRIS_PLAYER_IFACE,
          property,
          value,
        ]),
        null,
        Gio.DBusCallFlags.NO_AUTO_START,
        MprisConstants.DBUS_TIMEOUT,
        null,
        (conn, result) => {
          if (this._operationsPaused) {
            reject(new Error("Manager unavailable"));
            return;
          }

          try {
            conn.call_finish(result);
            this._errorCounts.set(name, 0);
            resolve();
          } catch (e) {
            this._player.handlePlayerError(name, e, `set property ${property}`);
            reject(e);
          }
        },
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
    const trackIdStr = trackId.toString();

    return new Promise((resolve, reject) => {
      try {
        this._bus.call_sync(
          name,
          "/org/mpris/MediaPlayer2",
          "org.mpris.MediaPlayer2.Player",
          "SetPosition",
          new GLib.Variant("(ox)", [trackIdStr, positionUs]),
          null,
          Gio.DBusCallFlags.NONE,
          50,
          null,
        );
        this._errorCounts.set(name, 0);
        resolve();
      } catch (e) {
        this._player.handlePlayerError(name, e, "setPosition");
        reject(e);
      }
    });
  }

  toggleShuffle(name) {
    const info = this.getPlayerInfo(name);
    if (info) {
      return this.setProperty(
        name,
        "Shuffle",
        new GLib.Variant("b", !info.shuffle),
      );
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
    this._operationsPaused = true;

    // Remove position polling
    if (this._positionPollingInterval) {
      GLib.source_remove(this._positionPollingInterval);
      this._positionPollingInterval = null;
    }
    this._pollingPlayers.clear();

    // Remove all cleanup timers
    for (const timerId of this._cleanupTimers.values()) {
      GLib.source_remove(timerId);
    }
    this._cleanupTimers.clear();

    // Remove other timeouts
    if (this._resumeTimeout) {
      GLib.source_remove(this._resumeTimeout);
      this._resumeTimeout = null;
    }

    if (this._addPlayerTimeout) {
      GLib.source_remove(this._addPlayerTimeout);
      this._addPlayerTimeout = null;
    }

    // Unsubscribe from signals
    if (this._bus) {
      for (const id of this._subscriptions) {
        this._bus.signal_unsubscribe(id);
      }
    }

    // Clean up players
    const proxyNames = Array.from(this._proxies.keys());
    for (const name of proxyNames) {
      this._player.removePlayerSafe(name);
    }

    // Destroy the player helper
    if (this._player) {
      this._player.destroy();
      this._player = null;
    }

    this._finalCleanup();
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
    this._settings = null;
    this._bus = null;
    this._onPlayerAdded = null;
    this._onPlayerRemoved = null;
    this._onPlayerChanged = null;
    this._onSeeked = null;
  }
}