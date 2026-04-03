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

      this._menuStateChangedId = this.menu.connect(
        "open-state-changed",
        (menu, open) => {
          this._state.safeExecute(() => {
            if (open) {
              this._controls.startPositionUpdate();
              this._eventHandlers.setupWindowMonitoring();
            } else {
              this._controls.stopPositionUpdate();
              this._controls.onMenuClosed();
              this._eventHandlers.removeWindowMonitoring();
            }

            // Keep IndicatorState  menuOpen in sync and handle the
            // "popup just closed" auto-switch re-evaluation
            this._eventHandlers.onMenuOpenStateChanged(open);
          });
        },
      );

      this._state._settingsChangedId = this._settings.connect(
        "changed",
        (_, key) => {
          this._state.safeExecute(() => {
            if (key === "panel-position" || key === "panel-index") return;

            if (key === "hide-default-player") {
              this._applyHideDefaultPlayer();
              return;
            }

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

      this._applyHideSourceId = GLib.idle_add(
        GLib.PRIORITY_DEFAULT_IDLE,
        () => {
          this._applyHideSourceId = null;
          this._applyHideDefaultPlayer();
          return GLib.SOURCE_REMOVE;
        },
      );

      this._initSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        this._initSourceId = null;
        this._state.safeExecute(() => this._initManager());
        return GLib.SOURCE_REMOVE;
      });
    }

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

      try {
        const ms = dateMenu._messageList?._mediaSection;
        if (ms) ms.visible = visible;
      } catch (_e) {}

      try {
        const ml = dateMenu._messageList?._mprisMediaPlayersList;
        if (ml) ml.visible = visible;
      } catch (_e) {}

      try {
        const ind = dateMenu._indicator;
        if (ind) {
          if (ind._primaryIndicator) ind._primaryIndicator.visible = visible;

          const ml2 = ind._messageList?._mediaSection;
          if (ml2) ml2.visible = visible;

          const ml3 = ind._messageList?._mprisMediaPlayersList;
          if (ml3) ml3.visible = visible;
        }
      } catch (_e) {}

      try {
        const cl = dateMenu._clock;
        if (cl) {
          const ms = cl._messageList?._mediaSection;
          if (ms) ms.visible = visible;
        }
      } catch (_e) {}
    }

    _reinitManager() {
      if (
        this._state._sessionChanging ||
        this._state._safetyLock ||
        this._state._preventLogout
      )
        return;

      if (this._manager) {
        this._manager.pauseOperations();
      }

      this._reinitSourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT_IDLE,
        100,
        () => {
          this._reinitSourceId = null;

          if (this._state._sessionChanging || this._state._safetyLock)
            return GLib.SOURCE_REMOVE;

          if (this._manager) {
            this._manager.destroy();
            this._manager = null;
          }

          this._state._currentPlayer = null;
          this._state._manuallySelected = false;
          this._state._managerInitialized = false;

          this._panelUI.stopScrolling();
          this._panelUI.label.hide();
          this.hide();

          this._reinitDelaySourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            50,
            () => {
              this._reinitDelaySourceId = null;
              this._state.safeExecute(() => this._initManager());
              return GLib.SOURCE_REMOVE;
            },
          );

          return GLib.SOURCE_REMOVE;
        },
      );
    }

    async _initManager() {
      try {
        this._manager = new MprisManager();
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
        console.error("AMC: failed to initialize MPRIS:", e);
        this._state._isInitializing = false;
        this._state._managerInitialized = false;
      }
    }

    destroy() {
      try {
        this._setDefaultPlayerVisible(true);
      } catch (_e) {}

      this._state._sessionChanging = true;
      this._state._safetyLock = true;
      this._state._preventLogout = true;

      if (this._applyHideSourceId) {
        GLib.Source.remove(this._applyHideSourceId);
        this._applyHideSourceId = null;
      }

      if (this._initSourceId) {
        GLib.Source.remove(this._initSourceId);
        this._initSourceId = null;
      }

      if (this._reinitSourceId) {
        GLib.Source.remove(this._reinitSourceId);
        this._reinitSourceId = null;
      }

      if (this._reinitDelaySourceId) {
        GLib.Source.remove(this._reinitDelaySourceId);
        this._reinitDelaySourceId = null;
      }

      if (this._menuStateChangedId) {
        this.menu.disconnect(this._menuStateChangedId);
        this._menuStateChangedId = null;
      }

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
