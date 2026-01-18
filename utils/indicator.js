import GObject from "gi://GObject";
import St from "gi://St";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { MprisManager } from "./mpris.js";
import { MediaControls } from "./ui.js";

export const MediaIndicator = GObject.registerClass(
  class MediaIndicator extends PanelMenu.Button {
    _init(settings) {
      super._init(0.0, "Media Controls", false);

      this._settings = settings;
      this._currentPlayer = null;
      this._scrollTimeout = null;
      this._scrollPosition = 0;
      this._fullText = "";
      this._settingsChangedId = 0;
      this._sessionModeId = 0;
      this._updateThrottle = null;
      this._capturedEventId = null;
      this._windowFocusId = null;
      this._overviewShowingId = null;
      this._overviewHidingId = null;
      this._lastUpdateTime = 0;
      this._isDestroyed = false;
      this._isInitializing = true;
      this._pendingOperations = new Set();
      this._sessionChanging = false;
      this._managerInitialized = false;
      this._initTimeout = null;
      this._safetyLock = false;
      this._errorCount = 0;
      this._maxErrors = 10;
      this._lastErrorTime = 0;
      this._preventLogout = false; // NEW: Prevent logout flag

      // Create horizontal layout
      this._box = new St.BoxLayout({
        style_class: "panel-status-menu-box panel-button-box",
        style: "spacing: 6px;",
      });
      this.add_child(this._box);

      // Panel app icon
      this._icon = new St.Icon({
        icon_size: 18,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._icon.set_fallback_gicon(null);
      this._box.add_child(this._icon);

      // Panel control buttons
      this._panelControlsBox = new St.BoxLayout({
        style_class: "panel-controls-box",
        style: "spacing: 2px;",
      });
      this._box.add_child(this._panelControlsBox);

      this._panelPrevBtn = this._createPanelButton("media-skip-backward-symbolic");
      this._panelPrevBtn.connect("button-press-event", (actor, event) => {
        if (event.get_button() === 1) {
          this._onPrevious();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
      this._panelControlsBox.add_child(this._panelPrevBtn);

      this._panelPlayBtn = this._createPanelButton("media-playback-start-symbolic");
      this._panelPlayBtn.connect("button-press-event", (actor, event) => {
        if (event.get_button() === 1) {
          this._onPlayPause();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
      this._panelControlsBox.add_child(this._panelPlayBtn);

      this._panelNextBtn = this._createPanelButton("media-skip-forward-symbolic");
      this._panelNextBtn.connect("button-press-event", (actor, event) => {
        if (event.get_button() === 1) {
          this._onNext();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
      this._panelControlsBox.add_child(this._panelNextBtn);

      // Scrolling label
      this._label = new St.Label({
        text: "",
        y_align: Clutter.ActorAlign.CENTER,
        style: "margin-left: 4px;",
      });
      this._label.clutter_text.ellipsize = 0;
      this._box.add_child(this._label);
      this._label.hide();

      // Media controls UI
      this._controls = new MediaControls();
      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      item.add_child(this._controls);
      this.menu.addMenuItem(item);

      // Connect control signals with extra safety
      this._connectControlSignals();

      // Menu open/close handling
      this.menu.connect("open-state-changed", (menu, open) => {
        this._safeExecute(() => {
          if (open) {
            this._controls.startPositionUpdate();
            this._setupWindowMonitoring();
          } else {
            this._controls.stopPositionUpdate();
            this._removeWindowMonitoring();
          }
        });
      });

      // Settings bindings
      this._settingsChangedId = this._settings.connect("changed", (_, key) => {
        this._safeExecute(() => {
          if (key === "panel-position" || key === "panel-index") {
            this._scheduleOperation(() => this._repositionIndicator());
          } else {
            this._updateLabel();
            this._updateVisibility();
          }
        });
      });

      // FIXED: Session mode monitoring with proper cleanup
      this._sessionModeId = Main.sessionMode.connect("updated", () => {
        if (this._isDestroyed) return;
        
        this._preventLogout = true; // Prevent logout during transition
        this._sessionChanging = true;
        
        // Safely close menu without throwing errors
        if (this.menu && this.menu.isOpen) {
          try {
            this.menu.close(false);
          } catch (e) {
            // Silently ignore
          }
        }
        
        // Stop all UI updates during session changes
        this._stopScrolling();
        
        // FIXED: Proper cleanup sequence with delays
        this._scheduleOperation(() => {
          if (!this._isDestroyed) {
            try {
              // Temporarily disable all D-Bus operations
              if (this._manager) {
                this._manager.pauseOperations();
              }
            } catch (e) {
              // Silently handle errors
            }
          }
        }, 100);
        
        // FIXED: Resume operations after session stabilizes
        this._scheduleOperation(() => {
          if (!this._isDestroyed && this._managerInitialized && !this._isInitializing) {
            try {
              if (this._manager) {
                this._manager.resumeOperations();
              }
              this._updateVisibility();
            } catch (e) {
              // Silently handle errors
            }
          }
          this._sessionChanging = false;
          this._preventLogout = false;
        }, 1000); // Increased delay for stability
      });

      this.hide();

      // Initialize MPRIS with delay for stability
      this._scheduleOperation(() => this._initManager(), 200);
    }

    _connectControlSignals() {
      try {
        this._controls.connect("play-pause", () => this._safeExecute(() => this._onPlayPause()));
        this._controls.connect("next", () => this._safeExecute(() => this._onNext()));
        this._controls.connect("previous", () => this._safeExecute(() => this._onPrevious()));
        this._controls.connect("shuffle", () => this._safeExecute(() => this._onShuffle()));
        this._controls.connect("repeat", () => this._safeExecute(() => this._onRepeat()));
        this._controls.connect("seek", (_, position) => this._safeExecute(() => this._onSeek(position)));
        this._controls.connect("player-changed", (_, name) => {
          this._safeExecute(() => {
            this._currentPlayer = name;
            this._updateUI();
          });
        });
      } catch (e) {
        logError(e, "Error connecting control signals");
      }
    }

    _safeExecute(fn) {
      // FIXED: Additional safety check for logout prevention
      if (this._isDestroyed || this._sessionChanging || this._safetyLock || this._preventLogout) return;
      
      // Error rate limiting
      const now = Date.now();
      if (now - this._lastErrorTime < 1000 && this._errorCount >= this._maxErrors) {
        return;
      }
      
      try {
        fn();
        this._errorCount = 0;
      } catch (e) {
        this._errorCount++;
        this._lastErrorTime = now;
        
        if (this._errorCount < this._maxErrors) {
          logError(e, "Safe execute error");
        }
        
        GLib.timeout_add(GLib.PRIORITY_LOW, 5000, () => {
          this._errorCount = Math.max(0, this._errorCount - 1);
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    _scheduleOperation(fn, delay = 0) {
      if (this._isDestroyed) return;
      
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, delay, () => {
        this._pendingOperations.delete(id);
        if (!this._isDestroyed && !this._sessionChanging && !this._preventLogout) {
          this._safeExecute(fn);
        }
        return GLib.SOURCE_REMOVE;
      });
      
      this._pendingOperations.add(id);
      return id;
    }

    _setupWindowMonitoring() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      this._removeWindowMonitoring();

      try {
        this._capturedEventId = global.stage.connect("button-press-event", (actor, event) => {
          if (this._isDestroyed || !this.menu.isOpen || this._sessionChanging) return Clutter.EVENT_PROPAGATE;

          const [x, y] = event.get_coords();
          const clickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);

          if (this.menu.actor.contains(clickedActor) || this.contains(clickedActor)) {
            return Clutter.EVENT_PROPAGATE;
          }

          this.menu.close();
          return Clutter.EVENT_STOP;
        });

        this._windowFocusId = global.display.connect("notify::focus-window", () => {
          if (this._isDestroyed || !this.menu.isOpen || this._sessionChanging) return;

          const focusedWindow = global.display.focus_window;
          if (focusedWindow) {
            this.menu.close();
          }
        });

        this._overviewShowingId = Main.overview.connect("showing", () => {
          if (this._isDestroyed || !this.menu.isOpen || this._sessionChanging) return;
          this.menu.close();
        });

        const layoutManager = Main.layoutManager;
        if (layoutManager && layoutManager.modalCount !== undefined) {
          this._modalId = layoutManager.connect("modals-changed", () => {
            if (this._isDestroyed || !this.menu.isOpen || this._sessionChanging) return;
            if (layoutManager.modalCount > 0) {
              this.menu.close();
            }
          });
        }
      } catch (e) {
        logError(e, "Error setting up window monitoring");
      }
    }

    _removeWindowMonitoring() {
      const signals = [
        { obj: global.stage, id: '_capturedEventId' },
        { obj: global.display, id: '_windowFocusId' },
        { obj: Main.overview, id: '_overviewShowingId' },
        { obj: Main.layoutManager, id: '_modalId' }
      ];

      for (const signal of signals) {
        if (this[signal.id]) {
          try {
            signal.obj.disconnect(this[signal.id]);
          } catch (e) {
            // Silently ignore
          }
          this[signal.id] = null;
        }
      }
    }

    _createPanelButton(iconName) {
      const button = new St.Button({
        style_class: "panel-media-button",
        can_focus: true,
        track_hover: true,
        reactive: true,
      });

      const icon = new St.Icon({
        icon_name: iconName,
        icon_size: 14,
      });

      button.set_child(icon);
      return button;
    }

    _repositionIndicator() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      const position = this._settings.get_string("panel-position");
      const index = this._settings.get_int("panel-index");
      
      const wasVisible = this.visible;
      const manager = this._manager;
      const player = this._currentPlayer;
      
      try {
        if (this.container && this.container.get_parent()) {
          this.container.get_parent().remove_child(this.container);
        }
        
        let targetBox;
        switch (position) {
          case "left":
            targetBox = Main.panel._leftBox;
            break;
          case "center":
            targetBox = Main.panel._centerBox;
            break;
          case "right":
          default:
            targetBox = Main.panel._rightBox;
            break;
        }
        
        const actualIndex = index === -1 ? 0 : Math.min(index, targetBox.get_n_children());
        targetBox.insert_child_at_index(this.container, actualIndex);
        
        this._manager = manager;
        this._currentPlayer = player;
        
        if (wasVisible && !this._isDestroyed && !this._sessionChanging) {
          this.show();
        }
      } catch (e) {
        logError(e, "Failed to reposition");
      }
    }

    async _initManager() {
      if (this._isDestroyed) return;
      
      try {
        this._manager = new MprisManager();
        
        await this._manager.init({
          added: (name) => this._safeExecute(() => this._onPlayerAdded(name)),
          removed: (name) => this._safeExecute(() => this._onPlayerRemoved(name)),
          changed: (name) => this._safeExecute(() => this._onPlayerChanged(name)),
          seeked: (name, position) => this._safeExecute(() => this._onSeeked(name, position)),
        });

        if (this._isDestroyed) return;

        this._managerInitialized = true;

        const players = this._manager.getPlayers();
        if (players.length > 0) {
          for (const name of players) {
            const info = this._manager.getPlayerInfo(name);
            if (info && info.status === "Playing") {
              this._currentPlayer = name;
              break;
            }
          }
          
          if (!this._currentPlayer) {
            this._currentPlayer = players[0];
          }
          
          this._updateUI();
          this._updateVisibility();
        }
        
        this._isInitializing = false;
      } catch (e) {
        logError(e, "Failed to initialize MPRIS");
        this._isInitializing = false;
        this._managerInitialized = false;
      }
    }

    _updateVisibility() {
      if (this._isDestroyed || this._isInitializing || this._sessionChanging || !this._managerInitialized) return;
      
      try {
        const isLocked = Main.sessionMode.isLocked || false;
        const isUnlockDialog = Main.sessionMode.currentMode === 'unlock-dialog';
        
        const hasPlayers = this._manager && this._manager.getPlayers().length > 0;

        if (!hasPlayers) {
          this.hide();
          return;
        }

        const info = this._currentPlayer ? this._manager.getPlayerInfo(this._currentPlayer) : null;
        const hasMedia = info && (info.status === "Playing" || info.status === "Paused");

        if (isLocked || isUnlockDialog) {
          this.hide();
        } else {
          if (hasMedia) {
            this.show();
          } else {
            this.hide();
          }
        }
      } catch (e) {
        // Silently handle visibility errors
      }
    }

    _onPlayerAdded(name) {
      if (this._isDestroyed || this._isInitializing || this._sessionChanging) return;
      
      try {
        const info = this._manager.getPlayerInfo(name);

        if (info && info.status === "Playing") {
          this._currentPlayer = name;
          this._updateUI();
          this._updateVisibility();
        } else if (!this._currentPlayer) {
          this._currentPlayer = name;
          this._updateUI();
          this._updateVisibility();
        }

        this._updateTabs();
      } catch (e) {
        logError(e, "Error in _onPlayerAdded");
      }
    }

    _onPlayerRemoved(name) {
      if (this._isDestroyed || this._sessionChanging) return;
      
      try {
        if (this._currentPlayer === name) {
          this._selectNextPlayer();
        }
        this._updateTabs();
        this._updateVisibility();
      } catch (e) {
        logError(e, "Error in _onPlayerRemoved");
      }
    }

    _onPlayerChanged(name) {
      if (this._isDestroyed || this._isInitializing || this._sessionChanging) return;
      
      const now = GLib.get_monotonic_time();
      
      if (now - this._lastUpdateTime < 50000) {
        if (this._updateThrottle) {
          GLib.source_remove(this._updateThrottle);
        }
        
        this._updateThrottle = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
          if (!this._isDestroyed && !this._sessionChanging) {
            this._performUpdate(name);
          }
          this._updateThrottle = null;
          return GLib.SOURCE_REMOVE;
        });
        return;
      }
      
      this._performUpdate(name);
    }

    _performUpdate(name) {
      if (this._isDestroyed || this._isInitializing || this._sessionChanging) return;
      
      try {
        this._lastUpdateTime = GLib.get_monotonic_time();
        const info = this._manager.getPlayerInfo(name);

        if (this._currentPlayer === name) {
          this._updateUI();
          this._updateVisibility();
          
          if (this.menu.isOpen && this._controls) {
            this._controls.update(info, name, this._manager);
          }
        } else if (info && info.status === "Playing") {
          this._currentPlayer = name;
          this._updateUI();
          this._updateTabs();
          this._updateVisibility();
        }
      } catch (e) {
        logError(e, "Error in _performUpdate");
      }
    }

    _onSeeked(name, position) {
      if (this._isDestroyed || this._currentPlayer !== name || this._sessionChanging) return;
      
      try {
        this._controls.onSeeked(position);
      } catch (e) {
        logError(e, "Error in _onSeeked");
      }
    }

    _selectNextPlayer() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      try {
        const players = this._manager.getPlayers();

        for (const name of players) {
          const info = this._manager.getPlayerInfo(name);
          if (info && info.status === "Playing") {
            this._currentPlayer = name;
            this._updateUI();
            this._updateTabs();
            this._updateVisibility();
            return;
          }
        }

        if (players.length > 0) {
          this._currentPlayer = players[0];
          this._updateUI();
          this._updateTabs();
          this._updateVisibility();
        } else {
          this._currentPlayer = null;
          this._stopScrolling();
          this._label.hide();
          this.hide();
        }
      } catch (e) {
        logError(e, "Error in _selectNextPlayer");
      }
    }

    _updateUI() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      try {
        if (!this._currentPlayer) {
          this._stopScrolling();
          this._label.hide();
          this.hide();
          return;
        }

        const info = this._manager.getPlayerInfo(this._currentPlayer);
        if (!info) {
          this._stopScrolling();
          this._label.hide();
          this.hide();
          return;
        }

        this._controls.update(info, this._currentPlayer, this._manager);
        this._updateAppIcon();

        const playIcon = info.status === "Playing" 
          ? "media-playback-pause-symbolic" 
          : "media-playback-start-symbolic";
        this._panelPlayBtn.child.icon_name = playIcon;

        this._updateLabel();
        this._updateTabs();
      } catch (e) {
        logError(e, "Error in _updateUI");
      }
    }

    _updateAppIcon() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      try {
        if (!this._currentPlayer) {
          this._icon.set_gicon(Gio.icon_new_for_string("audio-x-generic-symbolic"));
          return;
        }

        const appInfo = this._manager.getAppInfo(this._currentPlayer);
        if (appInfo && appInfo.get_icon()) {
          this._icon.set_gicon(appInfo.get_icon());
        } else {
          this._icon.set_gicon(Gio.icon_new_for_string("audio-x-generic-symbolic"));
        }
      } catch (e) {
        this._icon.set_gicon(Gio.icon_new_for_string("audio-x-generic-symbolic"));
      }
    }

    _updateLabel() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      try {
        const showTrackName = this._settings.get_boolean("show-track-name");
        
        if (!this._currentPlayer) {
          this._stopScrolling();
          this._label.hide();
          return;
        }

        const info = this._manager.getPlayerInfo(this._currentPlayer);
        if (!showTrackName || !info || (info.status !== "Playing" && info.status !== "Paused")) {
          this._stopScrolling();
          this._label.hide();
          return;
        }

        const showArtist = this._settings.get_boolean("show-artist");
        const separator = this._settings.get_string("separator-text");

        let text = info.title || "Unknown";

        if (showArtist && info.artists && info.artists.length > 0) {
          text += separator + info.artists.join(", ");
        }

        const maxLength = this._settings.get_int("max-title-length");

        if (text.length > maxLength) {
          this._fullText = text;
          this._startScrolling();
        } else {
          this._stopScrolling();
          this._label.text = text;
        }

        this._label.show();
      } catch (e) {
        logError(e, "Error in _updateLabel");
      }
    }

    _startScrolling() {
      if (this._isDestroyed || this._sessionChanging) return;
      
      this._stopScrolling();

      try {
        const maxLength = this._settings.get_int("max-title-length");
        const scrollSpeed = this._settings.get_int("scroll-speed");
        
        const paddedText = this._fullText + "   •   ";
        const interval = Math.max(50, 300 - scrollSpeed * 25);

        this._scrollTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
          if (this._isDestroyed || this._sessionChanging) {
            return GLib.SOURCE_REMOVE;
          }
          
          this._scrollPosition++;

          if (this._scrollPosition >= paddedText.length) {
            this._scrollPosition = 0;
          }

          const displayText =
            paddedText.substring(this._scrollPosition) +
            paddedText.substring(0, this._scrollPosition);

          this._label.text = displayText.substring(0, maxLength);

          return GLib.SOURCE_CONTINUE;
        });
      } catch (e) {
        logError(e, "Error in _startScrolling");
      }
    }

    _stopScrolling() {
      if (this._scrollTimeout) {
        try {
          GLib.source_remove(this._scrollTimeout);
        } catch (e) {
          // Silently ignore
        }
        this._scrollTimeout = null;
      }
      this._scrollPosition = 0;
    }

    _updateTabs() {
      if (this._isDestroyed || !this._controls || this._sessionChanging) return;
      
      try {
        const players = this._manager.getPlayers();
        this._controls.updateTabs(players, this._currentPlayer, this._manager);
      } catch (e) {
        logError(e, "Error in _updateTabs");
      }
    }

    _onPlayPause() {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;
      
      this._manager.playPause(this._currentPlayer).catch((e) => {
        if (!this._isDestroyed) {
          logError(e, "Failed to toggle play/pause");
        }
      });
    }

    _onNext() {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;
      
      this._manager.next(this._currentPlayer).catch((e) => {
        if (!this._isDestroyed) {
          logError(e, "Failed to skip next");
        }
      });
    }

    _onPrevious() {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;
      
      this._manager.previous(this._currentPlayer).catch((e) => {
        if (!this._isDestroyed) {
          logError(e, "Failed to skip previous");
        }
      });
    }

    _onShuffle() {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;
      
      this._manager.toggleShuffle(this._currentPlayer).catch((e) => {
        if (!this._isDestroyed) {
          logError(e, "Failed to toggle shuffle");
        }
      });
    }

    _onRepeat() {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;
      
      this._manager.cycleLoopStatus(this._currentPlayer).catch((e) => {
        if (!this._isDestroyed) {
          logError(e, "Failed to cycle repeat");
        }
      });
    }

    _onSeek(position) {
      if (this._isDestroyed || !this._currentPlayer || this._sessionChanging) return;

      try {
        const proxy = this._manager._proxies.get(this._currentPlayer);
        if (!proxy) return;

        const metadata = proxy.get_cached_property("Metadata");
        if (!metadata) return;

        const meta = metadata.deep_unpack();
        const trackId = meta["mpris:trackid"]?.unpack() || "/";

        this._manager.setPosition(this._currentPlayer, trackId, position).catch((e) => {
          if (!this._isDestroyed) {
            logError(e, "Failed to seek");
          }
        });
      } catch (e) {
        logError(e, "Error during seek");
      }
    }

    destroy() {
      if (this._isDestroyed) return;
      this._isDestroyed = true;
      this._sessionChanging = true;
      this._safetyLock = true;
      this._preventLogout = true; // FIXED: Set logout prevention
      
      // Cancel all pending operations
      for (const id of this._pendingOperations) {
        try {
          GLib.source_remove(id);
        } catch (e) {
          // Silently ignore
        }
      }
      this._pendingOperations.clear();
      
      this._stopScrolling();
      this._removeWindowMonitoring();
      
      if (this._updateThrottle) {
        try {
          GLib.source_remove(this._updateThrottle);
        } catch (e) {
          // Silently ignore
        }
        this._updateThrottle = null;
      }
      
      if (this._settingsChangedId) {
        try {
          this._settings.disconnect(this._settingsChangedId);
        } catch (e) {
          // Silently ignore
        }
        this._settingsChangedId = 0;
      }

      if (this._sessionModeId) {
        try {
          Main.sessionMode.disconnect(this._sessionModeId);
        } catch (e) {
          // Silently ignore
        }
        this._sessionModeId = 0;
      }

      if (this._controls) {
        try {
          this._controls.destroy();
        } catch (e) {
          // Silently ignore
        }
        this._controls = null;
      }

      // FIXED: Proper manager cleanup with delay
      if (this._manager) {
        GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
          try {
            if (this._manager) {
              this._manager.destroy();
              this._manager = null;
            }
          } catch (e) {
            // Silently ignore
          }
          return GLib.SOURCE_REMOVE;
        });
      }

      try {
        super.destroy();
      } catch (e) {
        // Silently ignore
      }
    }
  }
);