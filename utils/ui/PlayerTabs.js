import St from "gi://St";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

// ─── Module-level icon cache ───────────────────────────────────────────────
// Keyed by MPRIS bus name → Gio.Icon | null
// Lives for the extension's lifetime; PlayerTabs instances are cheap to
// recreate but Gio.AppInfo.get_all() is expensive — we only pay that cost
// once per unique player name.
const _iconCache = new Map();

/**
 * Build the set of candidate tokens used to match an MPRIS bus name against
 * the system's installed .desktop files.  Handles:
 *   • Native packages  (org.mpris.MediaPlayer2.vlc → vlc)
 *   • Flatpak          (org.videolan.VLC → org.videolan.vlc.desktop)
 *   • Snap             (org.mpris.MediaPlayer2.spotify.snap → spotify)
 *   • Instance suffix  (…spotify.instance12345 → spotify)
 *   • MPRIS Identity   ("VLC media player" → vlc)
 *
 * @param {string|null}  playerName  raw MPRIS D-Bus service name
 * @param {object|null}  manager     MprisManager instance (may be null)
 * @returns {{ exact: Set<string>, segments: Set<string> }}
 */
function _buildCandidateTokens(playerName, manager) {
  const exact = new Set();
  const segments = new Set();

  const SKIP = new Set([
    "org", "com", "net", "io", "app", "application",
    "browser", "client", "player", "media", "desktop",
    "instance", "snap", "flatpak", "gnome", "kde",
  ]);

  const _add = (str) => {
    if (!str) return;
    const lower = str.toLowerCase();
    exact.add(lower);
    exact.add(lower.endsWith(".desktop") ? lower : `${lower}.desktop`);
    exact.add(lower.endsWith(".desktop") ? lower.slice(0, -8) : lower);
    for (const seg of lower.replace(/\.desktop$/, "").split(".")) {
      if (seg.length > 2 && !SKIP.has(seg)) segments.add(seg);
    }
  };

  // 1. Desktop-entry hint from manager (most reliable for Flatpak)
  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) _add(de);
  }

  if (!playerName) return { exact, segments };

  // 2. Sanitise the raw bus name
  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw
    .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, "");

  _add(clean);

  // 3. Last segment (e.g. "vlc" from "org.videolan.vlc")
  const tail = clean.split(".").pop();
  if (tail && tail !== clean) {
    _add(tail);
    _add(`${tail}_${tail}`); // snap-style "spotify_spotify"
  }

  // 4. MPRIS Identity string ("VLC media player" → vlc)
  if (manager) {
    const identity = manager._identities?.get(playerName);
    if (identity?.trim()) {
      const norm = identity.trim().toLowerCase().replace(/\s+/g, "");
      segments.add(norm);
      const first = identity.trim().toLowerCase().split(/\s+/)[0];
      if (first.length > 2) segments.add(first);
    }
  }

  return { exact, segments };
}

/**
 * Resolve a Gio.Icon for a player using a multi-pass strategy that covers
 * every common Linux packaging format.
 *
 * Pass 1 – manager.getAppInfo()  (fast path: manager already does a lookup)
 * Pass 2 – full Gio.AppInfo.get_all() scan with exact .desktop-id matching
 * Pass 3 – segment match against .desktop ids (reverse-DNS, e.g. org.videolan.vlc)
 * Pass 4 – display-name / first-word fuzzy match
 * Pass 5 – themed icon from sanitised bus-name tail (no Gio.AppInfo.get_all needed)
 * Pass 6 – generic audio fallback
 *
 * Results are cached so get_all() is only called once per unique player name.
 *
 * @param {string|null}  playerName
 * @param {object|null}  manager
 * @returns {Gio.Icon}   always returns a valid icon (never null)
 */
function _resolveGicon(playerName, manager) {
  // Pass 1 — fast path via manager
  if (manager) {
    try {
      const ai = manager.getAppInfo(playerName);
      if (ai) {
        const gi = ai.get_icon();
        if (gi) return gi;
      }
    } catch (_) {}
  }

  // Passes 2-4 — full .desktop scan (expensive; cached)
  if (!_iconCache.has(playerName)) {
    _iconCache.set(playerName, null); // mark "searched, not found" by default

    try {
      const candidates = _buildCandidateTokens(playerName, manager);
      const allApps = Gio.AppInfo.get_all();

      // Pass 2 — exact .desktop id match
      for (const app of allApps) {
        const rawId = (app.get_id() ?? "").toLowerCase();
        const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
        if (candidates.exact.has(rawId) || candidates.exact.has(noSuffix)) {
          const gi = app.get_icon();
          if (gi) { _iconCache.set(playerName, gi); break; }
        }
      }

      // Pass 3 — segment match inside .desktop id
      if (!_iconCache.get(playerName)) {
        outer3:
        for (const app of allApps) {
          const rawId = (app.get_id() ?? "").toLowerCase();
          const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
          for (const seg of noSuffix.split(".")) {
            if (seg.length > 2 && candidates.segments.has(seg)) {
              const gi = app.get_icon();
              if (gi) { _iconCache.set(playerName, gi); break outer3; }
            }
          }
        }
      }

      // Pass 4 — display-name / first-word fuzzy match
      if (!_iconCache.get(playerName)) {
        for (const app of allApps) {
          const displayName = (app.get_display_name() ?? "").toLowerCase();
          const noSpace = displayName.replace(/\s+/g, "");
          const first = displayName.split(/\s+/)[0];
          if (
            (noSpace && candidates.segments.has(noSpace)) ||
            (first.length > 2 && candidates.segments.has(first))
          ) {
            const gi = app.get_icon();
            if (gi) { _iconCache.set(playerName, gi); break; }
          }
        }
      }
    } catch (_) {}
  }

  const cached = _iconCache.get(playerName);
  if (cached) return cached;

  // Pass 5 — themed icon from sanitised bus-name tail (no file I/O)
  if (playerName) {
    const tail = playerName
      .replace(/^org\.mpris\.MediaPlayer2\./, "")
      .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\.snap$/i, "")
      .split(".")
      .pop()
      .toLowerCase();

    if (tail && tail.length > 1) {
      // Return a themed icon — St.Icon will silently use the generic fallback
      // if the name isn't in the current theme, so this is always safe.
      return Gio.ThemedIcon.new(tail);
    }
  }

  // Pass 6 — generic audio icon
  return Gio.ThemedIcon.new("audio-x-generic-symbolic");
}

// ─── PlayerTabs ────────────────────────────────────────────────────────────

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

      this._currentPlayers = [];
      this._currentActivePlayer = null;
    }

    updateTabs(players, currentPlayer, manager) {
      // Skip full rebuild when nothing changed — prevents flickering and
      // dropped click events while a Flatpak/Snap player is emitting rapid
      // metadata-changed signals.
      const playersChanged =
        players.length !== this._currentPlayers.length ||
        players.some((p, i) => p !== this._currentPlayers[i]);
      const activeChanged = currentPlayer !== this._currentActivePlayer;

      if (!playersChanged && !activeChanged) return;

      this._currentPlayers = players.slice();
      this._currentActivePlayer = currentPlayer;

      this.destroy_all_children();

      // Only render tabs when there are multiple players to switch between
      if (players.length <= 1) return;

      for (const name of players) {
        const tab = this._createTab(name, currentPlayer, manager);
        this.add_child(tab);
      }
    }

    _createTab(playerName, currentPlayer, manager) {
      const isActive = playerName === currentPlayer;

      const button = new St.Button({
        style_class: "media-tab-modern",
        style: isActive
          ? "padding: 10px 14px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);"
          : "padding: 10px 14px; border-radius: 12px; opacity: 0.6;",
        reactive: true,
        can_focus: true,
        track_hover: true,
      });

      const gicon = _resolveGicon(playerName, manager);
      button.set_child(new St.Icon({ gicon, icon_size: 20 }));

      // Capture the exact raw MPRIS bus name in the closure.
      // Flatpak/Snap players use instance-suffixed names like
      // "org.mpris.MediaPlayer2.spotify.instance12345" — the manager's
      // proxy map is keyed by this exact string.
      button.connect("clicked", () => {
        this.emit("player-changed", playerName);
      });

      button.connect("enter-event", () => {
        if (!isActive)
          button.style = "padding: 10px 14px; border-radius: 12px; opacity: 1;";
      });

      button.connect("leave-event", () => {
        if (!isActive)
          button.style = "padding: 10px 14px; border-radius: 12px; opacity: 0.6;";
      });

      return button;
    }

    // Called by the extension's disable() path so the module-level cache
    // doesn't hold stale Gio.Icon references across re-enables.
    static clearIconCache() {
      _iconCache.clear();
    }

    destroy() {
      this._currentPlayers = [];
      this._currentActivePlayer = null;
      super.destroy();
    }
  },
);