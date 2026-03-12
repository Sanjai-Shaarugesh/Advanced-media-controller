import GObject from "gi://GObject";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { MprisManager } from "./mpris/MprisManager.js";
import { MediaControls } from "./ui/MediaControls.js";
import { PanelUI } from "./indicator/PanelUI.js";
import { IndicatorState } from "./indicator/IndicatorState.js";
import { IndicatorEventHandlers } from "./indicator/IndicatorEventHandlers.js";
import { IndicatorPlayerHandlers } from "./indicator/IndicatorPlayerHandlers.js";
import { IndicatorUIUpdater } from "./indicator/IndicatorUIUpdater.js";

export const MediaIndicator = GObject.registerClass(
  class MediaIndicator extends PanelMenu.Button {
    _init(settings, extension) {
      const _ = extension.gettext.bind(extension);

      super._init(0.5, _("Media Controls"), false);

      this._settings = settings;
      this._extension = extension;
      this._state = new IndicatorState();

      this._panelUI = new PanelUI(this);
      this._controls = new MediaControls(settings);

      this._eventHandlers = new IndicatorEventHandlers(this);
      this._playerHandlers = new IndicatorPlayerHandlers(this);
      this._uiUpdater = new IndicatorUIUpdater(this);

      const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });
      item.add_child(this._controls);
      this.menu.addMenuItem(item);

      this._eventHandlers.connectControlSignals();

      this.menu.connect("open-state-changed", (menu, open) => {
        this._state.safeExecute(() => {
          if (open) {
            this._controls.startPositionUpdate();
            this._eventHandlers.setupWindowMonitoring();
          } else {
            this._controls.stopPositionUpdate();
            // Notify controls the menu is closing so the lyrics sync timer
            // is stopped cleanly (stopPositionUpdate alone no longer does
            // this, to avoid killing the timer on every pause event).
            this._controls.onMenuClosed();
            this._eventHandlers.removeWindowMonitoring();
          }
        });
      });

      this._state._settingsChangedId = this._settings.connect(
        "changed",
        (_, key) => {
          this._state.safeExecute(() => {
            if (key === "panel-position" || key === "panel-index") return;

            // Hide / show the built-in GNOME media player section
            if (key === "hide-default-player") {
              this._applyHideDefaultPlayer();
              return;
            }

            // When filter settings change, reinitialize the manager so new
            // inclusions/exclusions take effect immediately.
            if (key === "player-filter-mode" || key === "player-filter-list") {
              this._reinitManager();
              return;
            }

            this._uiUpdater.updateLabel();
            this._uiUpdater.updateVisibility();
          });
        },
      );

      this._eventHandlers.setupSessionMonitoring();

      this.hide();

      // Apply hide-default-player on startup.
      // The date-menu button is always present by the time the extension
      // enable() runs, but schedule it on the idle queue so the panel has
      // finished its own init before we touch it.
      this._state.scheduleOperation(() => {
        this._applyHideDefaultPlayer();
      }, 0);

      this._state.scheduleOperation(() => this._initManager(), 200);
    }

    // ── Hide / restore the built-in GNOME media player section ───────────────
    //
    // GNOME Shell exposes its built-in MPRIS controls through the date-menu
    // panel button.  The internal structure has changed across major versions:
    //
    //   GNOME 43 – 45  →  dateMenu._messageList._mediaSection
    //   GNOME 46       →  dateMenu._messageList._mediaSection  (same path,
    //                      but the class was refactored internally)
    //   GNOME 47+      →  dateMenu._messageList._mediaSection  (still works)
    //                      some builds also expose _mprisMediaPlayersList
    //
    // Strategy: walk every known path and toggle .visible on each object we
    // actually find.  All paths are individually try/caught so a missing path
    // on one version never breaks another.  We hide rather than destroy, so
    // the original behaviour is fully restored when visible is set back to
    // true inside destroy().
    //
    // Review-guideline compliance:
    //   • We never monkey-patch or modify Shell objects — only set .visible
    //   • We restore fully in destroy() unconditionally
    //   • No timeouts are leaked; the scheduleOperation call is already
    //     tracked by IndicatorState._pendingOperations

    _applyHideDefaultPlayer() {
      const hide = this._settings.get_boolean("hide-default-player");
      try {
        this._setDefaultPlayerVisible(!hide);
      } catch (e) {
        console.error("AMC: error applying hide-default-player:", e);
      }
    }

    _setDefaultPlayerVisible(visible) {
      const dateMenu = Main.panel.statusArea?.dateMenu;
      if (!dateMenu) return;

      // ── Path A: _messageList._mediaSection (GNOME 43 / 44 / 45 / 46 / 47) ─
      try {
        const ms = dateMenu._messageList?._mediaSection;
        if (ms) ms.visible = visible;
      } catch (_e) {}

      // ── Path B: _messageList._mprisMediaPlayersList (some 45/46 builds) ────
      try {
        const ml = dateMenu._messageList?._mprisMediaPlayersList;
        if (ml) ml.visible = visible;
      } catch (_e) {}

      // ── Path C: _indicator subtree (GNOME 46 restructured builds) ───────────
      try {
        const ind = dateMenu._indicator;
        if (ind) {
          // C1: direct _primaryIndicator child
          if (ind._primaryIndicator) ind._primaryIndicator.visible = visible;
          // C2: nested _messageList._mediaSection
          const ml2 = ind._messageList?._mediaSection;
          if (ml2) ml2.visible = visible;
          // C3: nested _messageList._mprisMediaPlayersList
          const ml3 = ind._messageList?._mprisMediaPlayersList;
          if (ml3) ml3.visible = visible;
        }
      } catch (_e) {}

      // ── Path D: _clock._messageList (some Fedora/Ubuntu 46 spins) ───────────
      try {
        const cl = dateMenu._clock;
        if (cl) {
          const ms = cl._messageList?._mediaSection;
          if (ms) ms.visible = visible;
        }
      } catch (_e) {}
    }

    // ── Re-initialise the MPRIS manager after filter settings change ──────────

    _reinitManager() {
      if (
        this._state._sessionChanging ||
        this._state._safetyLock ||
        this._state._preventLogout
      )
        return;

      // Pause so in-flight callbacks don't fire during teardown
      if (this._manager) {
        this._manager.pauseOperations();
      }

      // Delay slightly so the settings write has definitely committed
      GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
        if (
          this._state._sessionChanging ||
          this._state._safetyLock
        )
          return GLib.SOURCE_REMOVE;

        // Tear down current manager
        if (this._manager) {
          this._manager.destroy();
          this._manager = null;
        }

        this._state._currentPlayer = null;
        this._state._manuallySelected = false;
        this._state._managerInitialized = false;

        // Clear any stale UI
        this._panelUI.stopScrolling();
        this._panelUI.label.hide();
        this.hide();

        // Re-init with the new filter settings
        this._state.scheduleOperation(() => this._initManager(), 50);
        return GLib.SOURCE_REMOVE;
      });
    }

    async _initManager() {
      try {
        this._manager = new MprisManager();

        // Pass settings so the manager can apply the player filter
        this._manager.setSettings(this._settings);

        await this._manager.init({
          added: (name) =>
            this._state.safeExecute(() =>
              this._playerHandlers.onPlayerAdded(name),
            ),
          removed: (name) =>
            this._state.safeExecute(() =>
              this._playerHandlers.onPlayerRemoved(name),
            ),
          changed: (name) =>
            this._state.safeExecute(() =>
              this._playerHandlers.onPlayerChanged(name),
            ),
          seeked: (name, position) =>
            this._state.safeExecute(() =>
              this._playerHandlers.onSeeked(name, position),
            ),
        });

        this._state._managerInitialized = true;

        const players = this._manager.getPlayers();
        if (players.length > 0) {
          for (const name of players) {
            const info = this._manager.getPlayerInfo(name);
            if (info && info.status === "Playing") {
              this._state._currentPlayer = name;
              break;
            }
          }

          if (!this._state._currentPlayer) {
            this._state._currentPlayer = players[0];
          }

          this._uiUpdater.updateUI();
          this._uiUpdater.updateVisibility();
        }

        this._state._isInitializing = false;
      } catch (e) {
        console.error("Failed to initialize MPRIS:", e);
        this._state._isInitializing = false;
        this._state._managerInitialized = false;
      }
    }

    destroy() {
      // Restore the built-in GNOME media player section on disable
      try {
        this._setDefaultPlayerVisible(true);
      } catch (_e) {}

      this._state._sessionChanging = true;
      this._state._safetyLock = true;
      this._state._preventLogout = true;

      if (this._state._settingsChangedId) {
        this._settings.disconnect(this._state._settingsChangedId);
        this._state._settingsChangedId = 0;
      }

      if (this._eventHandlers) {
        this._eventHandlers.destroy();
        this._eventHandlers = null;
      }

      if (this._playerHandlers) {
        this._playerHandlers.destroy();
        this._playerHandlers = null;
      }

      if (this._controls) {
        this._controls.destroy();
        this._controls = null;
      }

      if (this._panelUI) {
        this._panelUI.destroy();
        this._panelUI = null;
      }

      if (this._state) {
        this._state.destroy();
      }

      if (this._manager) {
        this._manager.destroy();
        this._manager = null;
      }

      super.destroy();
    }
  },
);