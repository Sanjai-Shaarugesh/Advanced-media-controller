import St from "gi://St";
import GObject from "gi://GObject";

export const PlayerTabs = GObject.registerClass(
  {
    Signals: {
      "player-changed": { param_types: [GObject.TYPE_STRING] },
    },
  },
  class PlayerTabs extends St.BoxLayout {
    _init() {
      super._init({
        style: "spacing: 8px;",
        reactive: true,
      });

      // Track current state to avoid unnecessary rebuilds
      this._currentPlayers = [];
      this._currentActivePlayer = null;
    }

    updateTabs(players, currentPlayer, manager) {
      // Avoid full rebuild if nothing changed.
      // This prevents flickering and lost hover state while a Flatpak/Snap
      // player is actively emitting metadata-changed signals.
      const playersChanged =
        players.length !== this._currentPlayers.length ||
        players.some((p, i) => p !== this._currentPlayers[i]);
      const activeChanged = currentPlayer !== this._currentActivePlayer;

      if (!playersChanged && !activeChanged) return;

      this._currentPlayers = players.slice();
      this._currentActivePlayer = currentPlayer;

      this.destroy_all_children();

      // Only show tabs when there is more than one player
      if (players.length <= 1) return;

      players.forEach((name) => {
        const appInfo = manager ? manager.getAppInfo(name) : null;
        const tab = this._createTab(appInfo, name, currentPlayer, manager);
        this.add_child(tab);
      });
    }

    _createTab(appInfo, playerName, currentPlayer, manager) {
      const isActive = playerName === currentPlayer;

      const button = new St.Button({
        style_class: isActive
          ? "media-tab-modern media-tab-active"
          : "media-tab-modern",
        style: isActive
          ? `padding: 10px 14px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);`
          : `padding: 10px 14px; border-radius: 12px; opacity: 0.6;`,
        reactive: true,
        can_focus: true,
        track_hover: true,
      });

      const icon = this._resolveIcon(appInfo, playerName, manager);
      button.set_child(icon);

      // Capture the exact MPRIS bus name in the closure.
      // Flatpak/Snap players use instance-suffixed names like
      // "org.mpris.MediaPlayer2.spotify.instance12345" — we must emit
      // the raw name so the manager can look up the right proxy.
      button.connect("clicked", () => {
        this.emit("player-changed", playerName);
      });

      button.connect("enter-event", () => {
        if (!isActive)
          button.style = `padding: 10px 14px; border-radius: 12px; opacity: 1;`;
      });

      button.connect("leave-event", () => {
        if (!isActive)
          button.style = `padding: 10px 14px; border-radius: 12px; opacity: 0.6;`;
      });

      return button;
    }

    /**
     * Resolve an icon with multiple fallbacks so Flatpak, Snap, AUR,
     * AppImage and deb players all get a reasonable icon.
     *
     * Priority:
     *   1. AppInfo icon (MprisManager's broad lookup already handles most cases)
     *   2. Themed icon derived from the sanitised bus-name tail
     *   3. Generic audio icon
     */
    _resolveIcon(appInfo, playerName, _manager) {
      if (appInfo) {
        const gicon = appInfo.get_icon();
        if (gicon) return new St.Icon({ gicon, icon_size: 20 });
      }

      // Derive a theme icon name from the MPRIS bus name.
      // "org.mpris.MediaPlayer2.spotify.instance123" → "spotify"
      if (playerName) {
        const raw = playerName
          .replace(/^org\.mpris\.MediaPlayer2\./, "")
          .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
          .replace(/\.\d+$/, "")
          .replace(/\.snap$/i, "")
          .split(".")
          .pop()
          .toLowerCase();

        if (raw && raw.length > 1) {
          for (const name of [raw, `${raw}-symbolic`, `application-x-${raw}`]) {
            try {
              return new St.Icon({ icon_name: name, icon_size: 20 });
            } catch (_) {}
          }
        }
      }

      return new St.Icon({
        icon_name: "audio-x-generic-symbolic",
        icon_size: 20,
      });
    }
  },
);