import GLib from "gi://GLib";

export class IndicatorPlayerHandlers {
  constructor(indicator) {
    this._indicator = indicator;
    this._updateThrottle = null;
  }

  onPlayerAdded(name) {
    if (
      this._indicator._state._isInitializing ||
      this._indicator._state._sessionChanging
    )
      return;

    const info = this._indicator._manager.getPlayerInfo(name);

    this._indicator._manager.startPositionPolling(name);

    // Refresh multi-playing state before making auto-switch decisions
    this._indicator._state.refreshMultiPlayingState(this._indicator._manager);

    // Only auto-promote the new player when auto-switch is not blocked
    if (!this._indicator._state.autoSwitchBlocked) {
      if (info && info.status === "Playing") {
        if (!this._indicator._state._currentPlayer) {
          this._indicator._state._currentPlayer = name;
          this._indicator._uiUpdater.updateUI();
          this._indicator._uiUpdater.updateVisibility();
        }
      } else if (!this._indicator._state._currentPlayer) {
        this._indicator._state._currentPlayer = name;
        this._indicator._uiUpdater.updateUI();
        this._indicator._uiUpdater.updateVisibility();
      }
    } else if (!this._indicator._state._currentPlayer) {
      // No current player at all — always set one so the UI is not blank
      this._indicator._state._currentPlayer = name;
      this._indicator._uiUpdater.updateUI();
      this._indicator._uiUpdater.updateVisibility();
    }

    this._indicator._uiUpdater.updateTabs();
  }

  onPlayerRemoved(name) {
    if (this._indicator._state._sessionChanging) return;

    this._indicator._manager.stopPositionPolling(name);

    if (this._indicator._state._currentPlayer === name) {
      this._indicator._state._manuallySelected = false;

      if (this._indicator._state._tabPinned) {
        this._indicator._state._tabPinned = false;
        // Sync the pin button visual state in the PlayerTabs widget
        try {
          this._indicator._controls._playerTabs?.setPinned(false);
        } catch (_) {}
      }
      this._selectNextPlayer();
    }

    // Refresh multi-playing state after a player disappears
    this._indicator._state.refreshMultiPlayingState(this._indicator._manager);

    this._indicator._uiUpdater.updateTabs();
    this._indicator._uiUpdater.updateVisibility();
  }

  onPlayerChanged(name) {
    if (
      this._indicator._state._isInitializing ||
      this._indicator._state._sessionChanging
    )
      return;

    const now = GLib.get_monotonic_time();

    if (now - this._indicator._state._lastUpdateTime < 50000) {
      if (this._updateThrottle) {
        GLib.source_remove(this._updateThrottle);
        this._updateThrottle = null;
      }

      this._updateThrottle = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
        if (!this._indicator._state._sessionChanging) this._performUpdate(name);
        this._updateThrottle = null;
        return GLib.SOURCE_REMOVE;
      });
      return;
    }

    this._performUpdate(name);
  }

  _performUpdate(name) {
    if (
      this._indicator._state._isInitializing ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._state._lastUpdateTime = GLib.get_monotonic_time();
    const info = this._indicator._manager.getPlayerInfo(name);

    // Always refresh multi-playing state on every status change
    this._indicator._state.refreshMultiPlayingState(this._indicator._manager);

    if (this._indicator._state._currentPlayer === name) {
      if (
        this._indicator._state._manuallySelected &&
        info &&
        info.status === "Stopped"
      ) {
        this._indicator._state._manuallySelected = false;
      }

      this._indicator._uiUpdater.updateUI();
      this._indicator._uiUpdater.updateVisibility();

      if (this._indicator.menu.isOpen && this._indicator._controls) {
        this._indicator._controls.update(info, name, this._indicator._manager);
      }
    } else if (info && info.status === "Playing") {
      // A different player started Playing
      // Switch to it only when auto-switch is not blocked
      if (!this._indicator._state.autoSwitchBlocked) {
        this._indicator._state._currentPlayer = name;
        this._indicator._uiUpdater.updateUI();
        this._indicator._uiUpdater.updateTabs();
        this._indicator._uiUpdater.updateVisibility();
      }
    } else if (info && info.status !== "Playing") {
      this._indicator._uiUpdater.updateVisibility();
    }
  }

  onSeeked(name, position) {
    if (
      this._indicator._state._currentPlayer !== name ||
      this._indicator._state._sessionChanging
    )
      return;

    this._indicator._controls.onSeeked(position);
  }

  _selectNextPlayer() {
    if (this._indicator._state._sessionChanging) return;

    const players = this._indicator._manager.getPlayers();
    let paused = null;

    for (const name of players) {
      const info = this._indicator._manager.getPlayerInfo(name);
      if (info && info.status === "Playing") {
        this._indicator._state._currentPlayer = name;
        this._indicator._uiUpdater.updateUI();
        this._indicator._uiUpdater.updateTabs();
        this._indicator._uiUpdater.updateVisibility();
        return;
      }
      if (info && info.status === "Paused" && !paused) paused = name;
    }

    if (paused) {
      this._indicator._state._currentPlayer = paused;
      this._indicator._uiUpdater.updateUI();
      this._indicator._uiUpdater.updateTabs();
      this._indicator._uiUpdater.updateVisibility();
      return;
    }

    if (players.length > 0) {
      // Keep the current player set so the indicator stays visible even when
      // the player reports Stopped (GSConnect, Shortwave, remote streams).
      this._indicator._state._currentPlayer = players[0];
      this._indicator._uiUpdater.updateTabs();
      // updateVisibility will decide show/hide based on the full player list.
      this._indicator._uiUpdater.updateVisibility();
    } else {
      // No players at all — safe to hide.
      this._indicator._state._currentPlayer = null;
      this._indicator._panelUI.stopScrolling();
      this._indicator._panelUI.label.hide();
      this._indicator.hide();
    }
  }

  destroy() {
    if (this._updateThrottle) {
      GLib.source_remove(this._updateThrottle);
      this._updateThrottle = null;
    }
  }
}