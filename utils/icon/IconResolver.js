import Gio from "gi://Gio";

//  Module-level icon cache
export const _iconCache = new Map();

//  Well-known MPRIS identity → desktop-id overrides

const _IDENTITY_DESKTOP_MAP = new Map([
  ["firefox", "firefox.desktop"],
  ["firefox esr", "firefox-esr.desktop"],
  ["firefox nightly", "firefox-nightly.desktop"],
  ["mozilla firefox", "firefox.desktop"],
  ["thunderbird", "thunderbird.desktop"],
  ["mozilla thunderbird", "thunderbird.desktop"],
  ["chromium", "chromium.desktop"],
  ["chromium-browser", "chromium-browser.desktop"],
  ["google chrome", "google-chrome.desktop"],
  ["brave", "brave-browser.desktop"],
  ["brave browser", "brave-browser.desktop"],
  ["vivaldi", "vivaldi.desktop"],
  ["opera", "opera.desktop"],
  ["spotify", "spotify.desktop"],
  ["vlc media player", "vlc.desktop"],
  ["vlc", "vlc.desktop"],
  ["rhythmbox", "rhythmbox.desktop"],
  ["clementine", "clementine.desktop"],
  ["strawberry", "strawberry.desktop"],
  ["lollypop", "org.gnome.Lollypop.desktop"],
  ["mpv", "mpv.desktop"],
  ["celluloid", "io.github.celluloid_player.Celluloid.desktop"],
  ["totem", "org.gnome.Totem.desktop"],
]);

//  Token sets that carry no identity information
const _SKIP = new Set([
  "org",
  "com",
  "net",
  "io",
  "app",
  "application",
  "browser",
  "client",
  "player",
  "media",
  "desktop",
  "instance",
  "snap",
  "flatpak",
  "gnome",
  "kde",
  "stable",
  "beta",
  "nightly",
  "dev",
  "bin",
  "linux",
  "project",
  "free",
  "open",
]);

// Internal helpers

/**
 * Retrieve the MPRIS Identity string for a player (lower-cased, trimmed)
 * Returns "" if unavailable.
 * @param {string|null} playerName
 * @param {object|null} manager
 * @returns {string}
 */
function _getIdentity(playerName, manager) {
  if (!manager || !playerName) return "";
  try {
    const identity = manager._identities && manager._identities.get(playerName);
    return identity ? identity.trim().toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

/**

 * @param {string} identity  lower-case MPRIS Identity
 * @returns {string|null}
 */
function _identityToDesktopId(identity) {
  if (!identity) return null;
  // Direct look-up
  if (_IDENTITY_DESKTOP_MAP.has(identity))
    return _IDENTITY_DESKTOP_MAP.get(identity);

  const first = identity.split(/\s+/)[0];
  if (first && _IDENTITY_DESKTOP_MAP.has(first))
    return _IDENTITY_DESKTOP_MAP.get(first);
  return null;
}

/**

 * @param {Gio.AppInfo} app
 * @param {Set<string>} segments
 * @param {Set<string>} exact
 * @param {string}      identity  lower-case MPRIS Identity
 * @returns {number}
 */
function _scoreApp(app, segments, exact, identity) {
  let score = 0;

  try {
    const rawId = (app.get_id() || "").toLowerCase();
    const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
    const dn = (app.get_display_name() || "").toLowerCase();
    const exec = (app.get_executable() || "").toLowerCase().trim();

    // Exact id match — strongest signal
    if (exact.has(rawId) || exact.has(noSuffix)) score += 100;

    // Dot-segments of id
    for (const seg of noSuffix.split(".")) {
      if (seg.length > 2 && segments.has(seg)) score += 40;
    }

    // Display-name match
    const dnFirst = dn.split(/\s+/)[0];
    const dnNoSpace = dn.replace(/\s+/g, "");
    if (dnFirst.length > 2 && segments.has(dnFirst)) score += 35;
    if (dnNoSpace.length > 2 && segments.has(dnNoSpace)) score += 30;

    // Executable match
    if (exec.length > 2 && segments.has(exec)) score += 25;
    for (const part of exec.split(/[-_]/)) {
      if (part.length > 2 && segments.has(part)) score += 15;
    }

    // Snap pattern  appname_appname.desktop
    const snapParts = noSuffix.split("_");
    if (
      snapParts.length >= 2 &&
      snapParts[0].length > 2 &&
      segments.has(snapParts[0])
    )
      score += 20;

    if (identity) {
      const idFirst = identity.split(/\s+/)[0];
      if (dn.includes(idFirst) || noSuffix.includes(idFirst)) {
        score += 50;
      } else {
        score -= 80;
      }
    }
  } catch (_) {}

  return score;
}

/**
 * @param {string|null}  playerName   MPRIS bus name
 * @param {object|null}  manager      MprisManager
 * @returns {{ exact: Set<string>, segments: Set<string> }}
 */
export function _buildCandidateTokens(playerName, manager) {
  const exact = new Set();
  const segments = new Set();

  const _add = (str) => {
    if (!str) return;
    const lower = str.toLowerCase().trim();
    if (!lower) return;

    exact.add(lower);
    if (lower.endsWith(".desktop")) {
      exact.add(lower.slice(0, -8));
    } else {
      exact.add(`${lower}.desktop`);
    }

    const base = lower.replace(/\.desktop$/, "");

    for (const seg of base.split(".")) {
      if (seg.length > 2 && !_SKIP.has(seg)) segments.add(seg);
    }

    const hParts = base.split(/[-_]/);
    if (hParts.length > 1) {
      for (const p of hParts) {
        if (p.length > 2 && !_SKIP.has(p)) segments.add(p);
      }
      const joined = hParts.filter((p) => !_SKIP.has(p)).join("");
      if (joined.length > 2) segments.add(joined);
    }
  };

  if (manager) {
    const de =
      manager._desktopEntries && manager._desktopEntries.get(playerName);
    if (de) _add(de);
  }

  if (!playerName) return { exact, segments };

  // Strip standard MPRIS prefix
  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");

  // Normalise suffixes
  const clean = raw
    .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, "")
    .replace(/[-_]stable$/i, "")
    .replace(/[-_]beta$/i, "")
    .replace(/[-_]nightly$/i, "")
    .replace(/[-_]esr$/i, "");

  _add(clean);

  const dotTail = clean.split(".").pop();
  if (dotTail && dotTail !== clean) {
    _add(dotTail);
    _add(`${dotTail}_${dotTail}`);
  }

  const dotParts = clean.split(".");
  if (dotParts.length >= 3) {
    const last2 = dotParts.slice(-2).join("").toLowerCase();
    if (last2.length > 3 && !_SKIP.has(last2)) segments.add(last2);
  }

  // MPRIS Identity string
  const identity = _getIdentity(playerName, manager);
  if (identity) {
    const norm = identity.replace(/\s+/g, "");
    const first = identity.split(/\s+/)[0];
    if (norm.length > 2) segments.add(norm);
    if (first.length > 2) segments.add(first);
  }

  return { exact, segments };
}

// resolveGicon

/**
 * @param {string|null}  playerName   MPRIS bus name
 * @param {object|null}  manager      MprisManager instance
 * @returns {Gio.Icon}
 */
export function resolveGicon(playerName, manager) {
  const identity = _getIdentity(playerName, manager);

  if (manager) {
    try {
      const ai = manager.getAppInfo(playerName);
      if (ai) {
        const safe = _appMatchesIdentity(ai, identity);
        if (safe) {
          const gi = ai.get_icon();
          if (gi) return gi;
        }
      }
    } catch (_) {}
  }

  //  Identity → known desktop-id override
  if (!_iconCache.has(playerName)) {
    const knownId = _identityToDesktopId(identity);
    if (knownId) {
      try {
        const allApps = Gio.AppInfo.get_all();
        for (const app of allApps) {
          const rawId = (app.get_id() || "").toLowerCase();
          if (
            rawId === knownId ||
            rawId === knownId.replace(/\.desktop$/, "")
          ) {
            const gi = app.get_icon();
            if (gi) {
              _iconCache.set(playerName, gi);
              break;
            }
          }
        }
      } catch (_) {}
    }
  }

  if (!_iconCache.has(playerName)) {
    _iconCache.set(playerName, null); // placeholder — prevents re-scan

    try {
      const cand = _buildCandidateTokens(playerName, manager);
      const allApps = Gio.AppInfo.get_all();

      // Collect all candidates with their score, then pick the best
      let bestApp = null;
      let bestScore = 0;

      for (const app of allApps) {
        const score = _scoreApp(app, cand.segments, cand.exact, identity);
        if (score > 0 && score > bestScore) {
          bestScore = score;
          bestApp = app;
        }
      }

      if (bestApp) {
        const gi = bestApp.get_icon();
        if (gi) _iconCache.set(playerName, gi);
      }
    } catch (_) {}
  }

  const cached = _iconCache.get(playerName);
  if (cached) return cached;

  // Gio.ThemedIcon from bus-name tail
  if (playerName) {
    const tail = playerName
      .replace(/^org\.mpris\.MediaPlayer2\./, "")
      .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\.snap$/i, "")
      .split(".")
      .pop()
      .toLowerCase();
    if (tail && tail.length > 1) return Gio.ThemedIcon.new(tail);
  }

  // guaranteed fallback
  return Gio.ThemedIcon.new("audio-x-generic-symbolic");
}

/**
 * @param {string|null}  playerName   MPRIS bus name
 * @param {object|null}  manager      MprisManager instance
 * @param {number}       size         Desired icon size in logical pixels
 * @param {number}       [scale=1]    Device scale factor (2 for HiDPI)
 * @returns {GdkPixbuf.Pixbuf|null}
 */
export function resolvePixbuf(playerName, manager, size, scale) {
  scale = scale && scale >= 1 ? Math.round(scale) : 1;
  const physicalSize = size * scale;

  const gicon = resolveGicon(playerName, manager);
  if (!gicon) return null;

  try {
    const GdkPixbuf = imports.gi.GdkPixbuf;
    const Gtk = imports.gi.Gtk;

    if (gicon instanceof Gio.ThemedIcon) {
      const theme = Gtk.IconTheme.get_default();

      let info = null;
      try {
        info = theme.lookup_icon(
          gicon.get_names()[0],
          physicalSize,
          Gtk.IconLookupFlags.USE_BUILTIN | Gtk.IconLookupFlags.FORCE_SVG,
        );
      } catch (_) {
        try {
          info = theme.lookup_icon(gicon.get_names()[0], physicalSize, 0);
        } catch (__) {}
      }
      if (info) {
        try {
          return info.load_icon();
        } catch (_) {}
      }
    }

    if (gicon instanceof Gio.FileIcon) {
      const file = gicon.get_file();
      const path = file && file.get_path();
      if (path) {
        return GdkPixbuf.Pixbuf.new_from_file_at_size(
          path,
          physicalSize,
          physicalSize,
        );
      }
    }
  } catch (_) {}

  return null;
}

/**
 * @param {Gio.AppInfo} app
 * @param {string}
 * @returns {boolean}
 */
function _appMatchesIdentity(app, identity) {
  if (!identity) return true; // no identity → accept anything
  try {
    const dn = (app.get_display_name() || "").toLowerCase();
    const id = (app.get_id() || "").toLowerCase();
    const exc = (app.get_executable() || "").toLowerCase();

    const first = identity.split(/\s+/)[0];
    return dn.includes(first) || id.includes(first) || exc.includes(first);
  } catch (_) {
    return true;
  }
}

// resolveDisplayName

/**
 * @param {string|null}  playerName
 * @param {object|null}  manager
 * @returns {string}
 */
export function resolveDisplayName(playerName, manager) {
  if (manager) {
    try {
      const identity =
        manager._identities && manager._identities.get(playerName);
      if (identity && identity.trim()) return identity.trim();
    } catch (_) {}
  }

  try {
    if (manager) {
      const identity = _getIdentity(playerName, manager);
      const ai = manager.getAppInfo(playerName);
      if (ai && _appMatchesIdentity(ai, identity)) {
        const n = ai.get_display_name();
        if (n) return n;
      }
    }

    const cand = _buildCandidateTokens(playerName, manager);
    const allApps = Gio.AppInfo.get_all();

    for (const app of allApps) {
      const rawId = (app.get_id() || "").toLowerCase();
      const noSuffix = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
      if (cand.exact.has(rawId) || cand.exact.has(noSuffix)) {
        const n = app.get_display_name();
        if (n) return n;
      }
    }
  } catch (_) {}

  //  Sanitised tail of bus name, title-cased
  if (playerName) {
    const tail = playerName
      .replace(/^org\.mpris\.MediaPlayer2\./, "")
      .replace(/\.instance[_-]?\d+(_\d+)?$/i, "")
      .replace(/\.\d+$/, "")
      .replace(/\.snap$/i, "")
      .split(".")
      .pop();
    if (tail) return tail.charAt(0).toUpperCase() + tail.slice(1);
  }

  return "Unknown";
}

// Cache management

export function clearIconCache() {
  _iconCache.clear();
}
