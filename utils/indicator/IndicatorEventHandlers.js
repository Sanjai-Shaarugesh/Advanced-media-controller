import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class IndicatorEventHandlers {
  constructor(indicator) {
    this._indicator = indicator;
    this._pauseOperationsTimeout = null;
    this._resumeOperationsTimeout = null;
    this._outsideClickId = null;
    this._menuJustOpened = false;
    this._menuOpenTimeout = null;
    this._closeMenuTimeout = null;
    this._delayedCloseTimeout1 = null;
    this._delayedCloseTimeout2 = null;
  }

  connectControlSignals() {
    this._indicator._controls.connectObject(
      "play-pause",
      () => this._indicator._state.safeExecute(() => this._onPlayPause()),
      "next",
      () => this._indicator._state.safeExecute(() => this._onNext()),
      "previous",
      () => this._indicator._state.safeExecute(() => this._onPrevious()),
      "shuffle",
      () => this._indicator._state.safeExecute(() => this._onShuffle()),
      "repeat",
      () => this._indicator._state.safeExecute(() => this._onRepeat()),
      "seek",
      (_, position) =>
        this._indicator._state.safeExecute(() => this._onSeek(position)),
      "player-changed",
      (_, name) => {
        this._indicator._state.safeExecute(() => {
          this._indicator._state._currentPlayer = name;
          this._indicator._state._manuallySelected = true;
          this._indicator._uiUpdater.updateUI();
        });
      },
      this,
    );

    this._indicator._panelUI.panelPrevBtn.connectObject(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onPrevious();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
      this,
    );

    this._indicator._panelUI.panelPlayBtn.connectObject(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onPlayPause();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
      this,
    );

    this._indicator._panelUI.panelNextBtn.connectObject(
      "button-press-event",
      (actor, event) => {
        if (event.get_button() === 1) {
          this._onNext();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      },
      this,
    );
  }

  setupSessionMonitoring() {
    Main.sessionMode.connectObject(
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
      this,
    );
  }

  setupWindowMonitoring() {
    if (this._indicator._state._sessionChanging) return;

    this.removeWindowMonitoring();

    // Set flag to prevent immediate closing when menu opens
    this._menuJustOpened = true;
    
    // Remove existing timeout before creating new one
    if (this._menuOpenTimeout) {
      GLib.source_remove(this._menuOpenTimeout);
      this._menuOpenTimeout = null;
    }
    
    this._menuOpenTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._menuJustOpened = false;
      this._menuOpenTimeout = null;
      return GLib.SOURCE_REMOVE;
    });

    // Monitor clicks outside the popup - use capture phase for better detection
    this._outsideClickId = global.stage.connect(
      "captured-event",
      (actor, event) => {
        // Only handle button press events
        if (event.type() !== Clutter.EventType.BUTTON_PRESS) {
          return Clutter.EVENT_PROPAGATE;
        }

        if (!this._indicator.menu || !this._indicator.menu.isOpen) {
          return Clutter.EVENT_PROPAGATE;
        }

        if (this._indicator._state._sessionChanging || this._menuJustOpened) {
          return Clutter.EVENT_PROPAGATE;
        }

        const [stageX, stageY] = event.get_coords();

        // Check if click is within the panel button
        const panelButton = this._indicator.container;
        if (panelButton && panelButton.get_stage() && panelButton.visible) {
          const [buttonX, buttonY] = panelButton.get_transformed_position();
          const [buttonWidth, buttonHeight] = panelButton.get_size();

          if (
            stageX >= buttonX &&
            stageX <= buttonX + buttonWidth &&
            stageY >= buttonY &&
            stageY <= buttonY + buttonHeight
          ) {
            // Click is on the panel button itself, let it handle toggle
            return Clutter.EVENT_PROPAGATE;
          }
        }

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
            // Click is inside the menu
            return Clutter.EVENT_PROPAGATE;
          }
        }

        // Click is outside both the button and menu - close the menu
        // Remove existing timeout before creating new one
        if (this._closeMenuTimeout) {
          GLib.source_remove(this._closeMenuTimeout);
          this._closeMenuTimeout = null;
        }
        
        this._closeMenuTimeout = GLib.timeout_add(GLib.PRIORITY_HIGH, 1, () => {
          if (this._indicator.menu && this._indicator.menu.isOpen) {
            this._indicator.menu.close(true);
          }
          this._closeMenuTimeout = null;
          return GLib.SOURCE_REMOVE;
        });

        return Clutter.EVENT_PROPAGATE;
      },
    );

    // Monitor window focus changes
    global.display.connectObject(
      "notify::focus-window",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        // Remove existing timeout before creating new one
        if (this._delayedCloseTimeout1) {
          GLib.source_remove(this._delayedCloseTimeout1);
          this._delayedCloseTimeout1 = null;
        }
        
        this._delayedCloseTimeout1 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
          if (
            this._indicator.menu &&
            this._indicator.menu.isOpen &&
            !this._indicator._state._sessionChanging
          ) {
            this._indicator.menu.close(false);
          }
          this._delayedCloseTimeout1 = null;
          return GLib.SOURCE_REMOVE;
        });
      },
      this,
    );

    // Monitor new windows being created
    global.display.connectObject(
      "window-created",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        // Remove existing timeout before creating new one
        if (this._delayedCloseTimeout2) {
          GLib.source_remove(this._delayedCloseTimeout2);
          this._delayedCloseTimeout2 = null;
        }
        
        this._delayedCloseTimeout2 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          if (
            this._indicator.menu &&
            this._indicator.menu.isOpen &&
            !this._indicator._state._sessionChanging
          ) {
            this._indicator.menu.close(false);
          }
          this._delayedCloseTimeout2 = null;
          return GLib.SOURCE_REMOVE;
        });
      },
      this,
    );

    // Monitor stage key focus changes
    global.stage.connectObject(
      "notify::key-focus",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        this._indicator.menu.close(false);
      },
      this,
    );

    // Monitor window state changes
    global.window_manager.connectObject(
      "size-change",
      (wm, actor) => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        // Close popup when windows change size (maximize, unmaximize, etc.)
        this._indicator.menu.close(false);
      },
      "minimize",
      (wm, actor) => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        this._indicator.menu.close(false);
      },
      "unminimize",
      (wm, actor) => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        this._indicator.menu.close(false);
      },
      "map",
      (wm, actor) => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging ||
          this._menuJustOpened
        )
          return;

        this._indicator.menu.close(false);
      },
      this,
    );

    // Monitor overview showing
    Main.overview.connectObject(
      "showing",
      () => {
        if (
          !this._indicator.menu.isOpen ||
          this._indicator._state._sessionChanging
        )
          return;
        this._indicator.menu.close(false);
      },
      this,
    );

    // Monitor modal dialogs
    const layoutManager = Main.layoutManager;
    if (layoutManager && layoutManager.modalCount !== undefined) {
      layoutManager.connectObject(
        "modals-changed",
        () => {
          if (
            !this._indicator.menu.isOpen ||
            this._indicator._state._sessionChanging
          )
            return;
          if (layoutManager.modalCount > 0) {
            this._indicator.menu.close(false);
          }
        },
        this,
      );
    }

    // Monitor workspace switches
    const workspaceManager = global.workspace_manager;
    if (workspaceManager) {
      workspaceManager.connectObject(
        "workspace-switched",
        () => {
          if (
            !this._indicator.menu.isOpen ||
            this._indicator._state._sessionChanging
          )
            return;
          this._indicator.menu.close(false);
        },
        this,
      );
    }
  }

  removeWindowMonitoring() {
    // Remove the outside click handler
    if (this._outsideClickId) {
      global.stage.disconnect(this._outsideClickId);
      this._outsideClickId = null;
    }

    // Remove timeout handlers
    if (this._menuOpenTimeout) {
      GLib.source_remove(this._menuOpenTimeout);
      this._menuOpenTimeout = null;
    }

    if (this._closeMenuTimeout) {
      GLib.source_remove(this._closeMenuTimeout);
      this._closeMenuTimeout = null;
    }

    if (this._delayedCloseTimeout1) {
      GLib.source_remove(this._delayedCloseTimeout1);
      this._delayedCloseTimeout1 = null;
    }

    if (this._delayedCloseTimeout2) {
      GLib.source_remove(this._delayedCloseTimeout2);
      this._delayedCloseTimeout2 = null;
    }

    // Disconnect all objects using disconnectObject
    global.display.disconnectObject(this);
    global.stage.disconnectObject(this);
    global.window_manager.disconnectObject(this);
    Main.overview.disconnectObject(this);
    
    const layoutManager = Main.layoutManager;
    if (layoutManager) {
      layoutManager.disconnectObject(this);
    }

    const workspaceManager = global.workspace_manager;
    if (workspaceManager) {
      workspaceManager.disconnectObject(this);
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
    // Disconnect all signal connections
    this._indicator._controls?.disconnectObject(this);
    this._indicator._panelUI?.panelPrevBtn?.disconnectObject(this);
    this._indicator._panelUI?.panelPlayBtn?.disconnectObject(this);
    this._indicator._panelUI?.panelNextBtn?.disconnectObject(this);
    Main.sessionMode?.disconnectObject(this);

    this.removeWindowMonitoring();

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