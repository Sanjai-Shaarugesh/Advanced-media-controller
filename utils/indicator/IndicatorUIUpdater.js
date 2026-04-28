import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class IndicatorUIUpdater {
  constructor(indicator) {
    this._indicator = indicator;
  }

  updateVisibility() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._isInitializing ||
      this._indicator._state._sessionChanging ||
      !this._indicator._state._managerInitialized
    )
      return;

    try {
      const isLocked = Main.sessionMode.isLocked || false;
      const isUnlockDialog = Main.sessionMode.currentMode === "unlock-dialog";

      if (isLocked || isUnlockDialog) {
        this._indicator.hide();
        return;
      }

      const manager = this._indicator._manager;
      if (!manager) {
        this._indicator.hide();
        return;
      }

      const players = manager.getPlayers();
      if (players.length === 0) {
        this._indicator.hide();
        return;
      }

      // Re-evaluate multi-playing state before visibility decision
      this._indicator._state.refreshMultiPlayingState(manager);

      const currentPlayer = this._indicator._state._currentPlayer;
      const info = currentPlayer ? manager.getPlayerInfo(currentPlayer) : null;

      // Show for Playing or Paused. Also show for Stopped if the player is
      // still registered
      // briefly between tracks or when the remote stream is paused
      const currentHasMedia =
        info && (info.status === "Playing" || info.status === "Paused");
      const currentIsStopped = info && info.status === "Stopped";

      if (currentHasMedia) {
        this._indicator.show();
        return;
      }

      // Current player is Stopped or unknown — try to switch to a better one,
      // but keep the indicator visible as long as any player is registered
      if (!this._indicator._state.autoSwitchBlocked) {
        for (const name of players) {
          const pInfo = manager.getPlayerInfo(name);
          if (
            pInfo &&
            (pInfo.status === "Playing" || pInfo.status === "Paused")
          ) {
            // Auto-switch — no user intent, so do NOT set manuallySelected
            this._indicator._state._currentPlayer = name;
            this.updateUI();
            this._indicator.show();
            return;
          }
        }
      } else {
        for (const name of players) {
          const pInfo = manager.getPlayerInfo(name);
          if (
            pInfo &&
            (pInfo.status === "Playing" || pInfo.status === "Paused")
          ) {
            this._indicator.show();
            return;
          }
        }
      }

      // No Playing/Paused player found, but players ARE registered

      // that briefly reports Stopped while paused doesn't vanish from the panel
      if (players.length > 0 && (currentIsStopped || currentPlayer)) {
        this._indicator.show();
        return;
      }

      this._indicator.hide();
    } catch (e) {
      console.error("Error in updateVisibility:", e);
    }
  }

  updateUI() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      if (!this._indicator._state._currentPlayer) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        this._indicator.hide();
        return;
      }

      const info = this._indicator._manager.getPlayerInfo(
        this._indicator._state._currentPlayer,
      );
      if (!info) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        this._indicator.hide();
        return;
      }

      this._indicator._controls.update(
        info,
        this._indicator._state._currentPlayer,
        this._indicator._manager,
      );
      this._indicator._panelUI.updateAppIcon(
        this._indicator._manager,
        this._indicator._state._currentPlayer,
      );

      const playIcon =
        info.status === "Playing"
          ? "media-playback-pause-symbolic"
          : "media-playback-start-symbolic";
      this._indicator._panelUI.panelPlayBtn.child.icon_name = playIcon;

      this.updateLabel();
      this.updateTabs();
    } catch (e) {
      console.error("Error in updateUI:", e);
    }
  }

  updateLabel() {
    if (
      this._indicator._state._isDestroyed ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      const showTrackName =
        this._indicator._settings.get_boolean("show-track-name");

      if (!this._indicator._state._currentPlayer) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        return;
      }

      const info = this._indicator._manager.getPlayerInfo(
        this._indicator._state._currentPlayer,
      );

      // Hide if show-track-name is off, or if info is missing and we have
      // no cached text to fall back to
      if (!showTrackName) {
        this._indicator._panelUI.stopScrolling();
        this._indicator._panelUI.label.hide();
        return;
      }

      // If the player is actively Playing or Paused, build and cache the text
      if (info && (info.status === "Playing" || info.status === "Paused")) {
        const showArtist = this._indicator._settings.get_boolean("show-artist");
        const separator =
          this._indicator._settings.get_string("separator-text");

        let text = info.title || "Unknown";
        if (showArtist && info.artists && info.artists.length > 0)
          text += separator + info.artists.join(", ");

        // Cache so we can re-display it if the player briefly reports Stopped
        this._lastLabelText = text;

        this._indicator._panelUI.startScrolling(
          text,
          this._indicator._settings,
          info.status,
        );
        this._indicator._panelUI.label.show();
        return;
      }

      // Player is Stopped or info unavailable
      // Show the last known track text as a static label so the panel doesn't
      // go blank the moment the stream is paused remotely
      if (this._lastLabelText) {
        this._indicator._panelUI.startScrolling(
          this._lastLabelText,
          this._indicator._settings,
          "Paused", // treat as Paused → static label, no scrolling
        );
        this._indicator._panelUI.label.show();
        return;
      }

      // Nothing to show.
      this._indicator._panelUI.stopScrolling();
      this._indicator._panelUI.label.hide();
    } catch (e) {
      console.error("Error in updateLabel:", e);
    }
  }

  updateTabs() {
    if (
      this._indicator._state._isDestroyed ||
      !this._indicator._controls ||
      this._indicator._state._sessionChanging
    )
      return;

    try {
      const players = this._indicator._manager.getPlayers();
      this._indicator._controls.updateTabs(
        players,
        this._indicator._state._currentPlayer,
        this._indicator._manager,
      );
    } catch (e) {
      console.error("Error in updateTabs:", e);
    }
  }
}
