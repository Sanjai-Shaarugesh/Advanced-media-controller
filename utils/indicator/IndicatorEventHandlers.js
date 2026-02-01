import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class IndicatorEventHandlers {
  constructor(indicator) {
    this._indicator = indicator;
    this._signalIds = new Map();
    this._pauseOperationsTimeout = null;
    this._resumeOperationsTimeout = null;
    this._outsideClickId = null;
  }

  connectControlSignals() {
    const playPauseId = this._indicator._controls.connect("play-pause", () =>
      this._indicator._state.safeExecute(() => this._onPlayPause()),
    );
    this._signalIds.set("controls-play-pause", {
      obj: this._indicator._controls,
      id: playPauseId,
    });

    const nextId = this._indicator._controls.connect("next", () =>
      this._indicator._state.safeExecute(() => this._onNext()),
    );
    this._signalIds.set("controls-next", {
      obj: this._indicator._controls,
      id: nextId,
    });

    const previousId = this._indicator._controls.connect("previous", () =>
      this._indicator._state.safeExecute(() => this._onPrevious()),
    );
    this._signalIds.set("controls-previous", {
      obj: this._indicator._controls,
      id: previousId,
    });

    const shuffleId = this._indicator._controls.connect("shuffle", () =>
      this._indicator._state.safeExecute(() => this._onShuffle()),
    );
    this._signalIds.set("controls-shuffle", {
      obj: this._indicator._controls,
      id: shuffleId,
    });

    const repeatId = this._indicator._controls.connect("repeat", () =>
      this._indicator._state.safeExecute(() => this._onRepeat()),
    );
    this._signalIds.set("controls-repeat", {
      obj: this._indicator._controls,
      id: repeatId,
    });

    const seekId = this._indicator._controls.connect("seek", (_, position) =>
      this._indicator._state.safeExecute(() => this._onSeek(position)),
    );
    this._signalIds.set("controls-seek", {
      obj: this._indicator._controls,
      id: seekId,
    });

    const playerChangedId = this._indicator._controls.connect(
      "player-changed",
      (_, name) => {
        this._indicator._state.safeExecute(() => {
          this._indicator._state._currentPlayer = name;
          this._indicator._state._manuallySelected = true;
          this._indicator._uiUpdater.updateUI();
        });
      },
    );
    this._signalIds.set("controls-player-changed", {
      obj: this._indicator._controls,
      id: playerChangedId,
    });

    const panelPrevId = this._indicator._panelUI.panelPrevBtn.connect(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onPrevious();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
    );
    this._signalIds.set("panel-prev", {
      obj: this._indicator._panelUI.panelPrevBtn,
      id: panelPrevId,
    });

    const panelPlayId = this._indicator._panelUI.panelPlayBtn.connect(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onPlayPause();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
    );
    this._signalIds.set("panel-play", {
      obj: this._indicator._panelUI.panelPlayBtn,
      id: panelPlayId,
    });

    const panelNextId = this._indicator._panelUI.panelNextBtn.connect(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onNext();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
    );
    this._signalIds.set("panel-next", {
      obj: this._indicator._panelUI.panelNextBtn,
      id: panelNextId,
    });
  }

  setupSessionMonitoring() {
    this._indicator._state._sessionModeId = Main.sessionMode.connect(
      "updated",
      () => {
        this._indicator._state._preventLogout = true;
        this._indicator._state._sessionChanging = true;

        if (this._indicator.menu && this._indicator.menu.isOpen) {
          this._indicator.menu.close(false);
        }

        this._indicator._panelUI.stopScrolling();

        if (this._pauseOperationsTimeout) {
          GLib.source_remove(this._pauseOperationsTimeout);
          this._pauseOperationsTimeout = null;
        }

        this._pauseOperationsTimeout = this._indicator._state.scheduleOperation(
          () => {
            if (this._indicator._manager) {
              this._indicator._manager.pauseOperations();
            }
            this._pauseOperationsTimeout = null;
          },
          100,
        );

        if (this._resumeOperationsTimeout) {
          GLib.source_remove(this._resumeOperationsTimeout);
          this._resumeOperationsTimeout = null;
        }

        this._resumeOperationsTimeout =
          this._indicator._state.scheduleOperation(() => {
            if (
              !this._indicator._state._managerInitialized ||
              this._indicator._state._isInitializing
            ) {
              this._resumeOperationsTimeout = null;
              return;
            }

            if (this._indicator._manager) {
              this._indicator._manager.resumeOperations();
            }
            this._indicator._uiUpdater.updateVisibility();

            this._indicator._state._sessionChanging = false;
            this._indicator._state._preventLogout = false;
            this._resumeOperationsTimeout = null;
          }, 1000);
      },
    );
  }

  setupWindowMonitoring() {
    if (this._indicator._state._sessionChanging) return;

    this.removeWindowMonitoring();

    this._outsideClickId = global.stage.connect(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
          return Clutter.EVENT_PROPAGATE;
        }

        if (!this._indicator.menu || !this._indicator.menu.isOpen) {
          return Clutter.EVENT_PROPAGATE;
        }

        if (this._indicator._state._sessionChanging) {
          this._indicator.menu.close(true);
          return Clutter.EVENT_PROPAGATE;
        }

        const [stageX, stageY] = event.get_coords();

        // Check if click is within the menu actor
        const menuActor = this._indicator.menu.actor;
        if (menuActor && menuActor.get_stage() && menuActor.visible) {
          const [menuX, menuY] = menuActor.get_transformed_position();
          const [menuWidth, menuHeight] = menuActor.get_size();

          if (
            stageX >= menuX &&
            stageX <= menuX + menuWidth &&
            stageY >= menuY &&
            stageY <= menuY + menuHeight
          ) {
            return Clutter.EVENT_PROPAGATE;
          }
        }

        // Check if click is within the indicator button
        const indicatorActor = this._indicator.container || this._indicator;
        if (
          indicatorActor &&
          indicatorActor.get_stage() &&
          indicatorActor.visible
        ) {
          const [indX, indY] = indicatorActor.get_transformed_position();
          const [indWidth, indHeight] = indicatorActor.get_size();

          if (
            stageX >= indX &&
            stageX <= indX + indWidth &&
            stageY >= indY &&
            stageY <= indY + indHeight
          ) {
            return Clutter.EVENT_PROPAGATE;
          }
        }

        // Click is outside both menu and indicator - close the menu
        this._indicator.menu.close(true);
        return Clutter.EVENT_PROPAGATE;
      },
    );

    // monitor focus changes
    this._indicator._state._windowFocusId = global.display.connect(
      "notify::focus-window",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging
        )
          return;

        const focusedWindow = global.display.focus_window;
        if (focusedWindow) {
          this._indicator.menu.close(true);
        }
      },
    );

    // Monitor overview
    this._indicator._state._overviewShowingId = Main.overview.connect(
      "showing",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging
        )
          return;
        this._indicator.menu.close(true);
      },
    );

    // Monitor modal dialogs
    const layoutManager = Main.layoutManager;
    if (layoutManager && layoutManager.modalCount !== undefined) {
      this._indicator._state._modalId = layoutManager.connect(
        "modals-changed",
        () => {
          if (
            !this._indicator.menu.isOpen ||
            this._indicator._state._sessionChanging
          )
            return;
          if (layoutManager.modalCount > 0) {
            this._indicator.menu.close(true);
          }
        },
      );
    }
  }

  removeWindowMonitoring() {
    // Remove the outside click handler
    if (this._outsideClickId) {
      global.stage.disconnect(this._outsideClickId);
      this._outsideClickId = null;
    }

    const signals = [
      { obj: global.display, id: "_windowFocusId" },
      { obj: Main.overview, id: "_overviewShowingId" },
      { obj: Main.layoutManager, id: "_modalId" },
    ];

    for (const signal of signals) {
      if (this._indicator._state[signal.id]) {
        signal.obj.disconnect(this._indicator._state[signal.id]);
        this._indicator._state[signal.id] = null;
      }
    }
  }

  _onPlayPause() {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._manager
      .playPause(this._indicator._state._currentPlayer)
      .catch((e) => {
        console.error("Failed to toggle play/pause:", e);
      });
  }

  _onNext() {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._manager
      .next(this._indicator._state._currentPlayer)
      .catch((e) => {
        console.error("Failed to skip next:", e);
      });
  }

  _onPrevious() {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._manager
      .previous(this._indicator._state._currentPlayer)
      .catch((e) => {
        console.error("Failed to skip previous:", e);
      });
  }

  _onShuffle() {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._manager
      .toggleShuffle(this._indicator._state._currentPlayer)
      .catch((e) => {
        console.error("Failed to toggle shuffle:", e);
      });
  }

  _onRepeat() {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._manager
      .cycleLoopStatus(this._indicator._state._currentPlayer)
      .catch((e) => {
        console.error("Failed to cycle repeat:", e);
      });
  }

  _onSeek(position) {
    if (
      !this._indicator._state._currentPlayer ||
      this._indicator._state._sessionChanging
    )
      return;

    const proxy = this._indicator._manager._proxies.get(
      this._indicator._state._currentPlayer,
    );
    if (!proxy) return;

    const metadata = proxy.get_cached_property("Metadata");
    if (!metadata) return;

    const meta = {};
    const len = metadata.n_children();

    for (let i = 0; i < len; i++) {
      const item = metadata.get_child_value(i);
      const key = item.get_child_value(0).get_string()[0];
      const valueVariant = item.get_child_value(1).get_variant();

      if (key === "mpris:trackid") {
        meta[key] = valueVariant.recursiveUnpack();
        break;
      }
    }

    const trackId = meta["mpris:trackid"] || "/";

    this._indicator._manager
      .setPosition(this._indicator._state._currentPlayer, trackId, position)
      .catch((e) => {
        console.error("Failed to seek:", e);
      });
  }

  destroy() {
    for (const [key, signal] of this._signalIds) {
      if (signal.obj && signal.id) {
        signal.obj.disconnect(signal.id);
      }
    }
    this._signalIds.clear();

    this.removeWindowMonitoring();

    if (this._indicator._state._sessionModeId) {
      Main.sessionMode.disconnect(this._indicator._state._sessionModeId);
      this._indicator._state._sessionModeId = 0;
    }

    if (this._pauseOperationsTimeout) {
      GLib.source_remove(this._pauseOperationsTimeout);
      this._pauseOperationsTimeout = null;
    }

    if (this._resumeOperationsTimeout) {
      GLib.source_remove(this._resumeOperationsTimeout);
      this._resumeOperationsTimeout = null;
    }
  }
}
