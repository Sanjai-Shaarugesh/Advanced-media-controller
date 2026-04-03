import Gio from "gi://Gio";

//  Browser detection

const BROWSER_FRAGMENTS = new Set([
  "google-chrome",
  "chrome",
  "chromium",
  "chromium-browser",
  "brave",
  "brave-browser",
  "com.brave.browser",
  "firefox",
  "org.mozilla.firefox",
  "firefox-esr",
  "microsoft-edge",
  "msedge",
  "com.microsoft.edge",
  "vivaldi",
  "opera",
  "epiphany",
  "org.gnome.epiphany",
  "midori",
  "falkon",
]);

/**
 * @param {string} appId
 * @returns {boolean}
 */
export function isBrowserId(appId) {
  if (!appId) return false;
  const lower = appId.toLowerCase();
  for (const frag of BROWSER_FRAGMENTS) {
    if (lower.includes(frag) || frag.includes(lower.split(".").pop())) {
      return true;
    }
  }
  return false;
}

// Slug / composite-ID helpers

/**
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-");
}

/**
 * @param {string} browserBaseId   canonical browser id
 * @param {string} mprisIdentity   MPRIS Identity string
 * @returns {string}
 */
export function buildBrowserSourceId(browserBaseId, mprisIdentity) {
  const base = browserBaseId.toLowerCase().replace(/\.desktop$/i, "");
  const slug = slugify(mprisIdentity);
  if (!slug) return base;
  return `${base}--${slug}`;
}

/**
 * @param {string} id
 * @returns {{ browser: string, source: string } | null}
 */
export function parseBrowserSourceId(id) {
  if (!id || !id.includes("--")) return null;
  const idx = id.indexOf("--");
  return { browser: id.slice(0, idx), source: id.slice(idx + 2) };
}

/**
 * @param {string} id
 * @returns {string}
 */
export function labelForId(id) {
  const parsed = parseBrowserSourceId(id);
  if (!parsed) return id;

  const sourceLabel = parsed.source
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const browserLabels = {
    "google-chrome": "Chrome",
    chromium: "Chromium",
    "chromium-browser": "Chromium",
    brave: "Brave",
    "brave-browser": "Brave",
    "com-brave-browser": "Brave",
    firefox: "Firefox",
    "org-mozilla-firefox": "Firefox",
    "microsoft-edge": "Edge",
    msedge: "Edge",
    "com-microsoft-edge": "Edge",
    vivaldi: "Vivaldi",
    opera: "Opera",
    epiphany: "Web",
    "org-gnome-epiphany": "Web",
    midori: "Midori",
    falkon: "Falkon",
  };
  const browserLabel = browserLabels[parsed.browser] ?? parsed.browser;

  return `${sourceLabel} (${browserLabel})`;
}

// Generic tokens used to skip unhelpful reverse-DNS segments

const SKIP_SEGMENTS = new Set([
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
  "freedesktop",
  "github",
]);

//  resolveCanonicalIds

/**

 * @param {string|null}  playerName  – MPRIS bus name
 * @param {object|null}  manager     – MprisManager instance
 * @returns {Set<string>}
 */
export function resolveCanonicalIds(playerName, manager) {
  const ids = new Set();
  if (!playerName) return ids;

  let resolvedBaseId = null;

  //Resolve against installed .desktop database
  try {
    const candidates = _buildCandidateTokens(playerName, manager);
    const allApps = Gio.AppInfo.get_all();

    //  exact match on full app-id with or without .desktop
    for (const app of allApps) {
      const appId = (app.get_id() ?? "").toLowerCase();
      const noSuffix = appId.endsWith(".desktop") ? appId.slice(0, -8) : appId;
      if (candidates.exact.has(appId) || candidates.exact.has(noSuffix)) {
        resolvedBaseId = noSuffix;
        _addAppIdVariants(ids, noSuffix);
        break;
      }
    }

    // meaningful segment match handles reverse-DNS & snap prefixes
    if (!resolvedBaseId) {
      outer: for (const app of allApps) {
        const appId = (app.get_id() ?? "").toLowerCase();
        const noSuffix = appId.endsWith(".desktop")
          ? appId.slice(0, -8)
          : appId;
        for (const seg of noSuffix.split(".")) {
          if (
            seg.length > 2 &&
            !SKIP_SEGMENTS.has(seg) &&
            candidates.segments.has(seg)
          ) {
            resolvedBaseId = noSuffix;
            _addAppIdVariants(ids, noSuffix);
            break outer;
          }
        }
      }
    }

    // display-name / first-word match last resort — covers AppImages
    if (!resolvedBaseId) {
      outer2: for (const app of allApps) {
        const name = (app.get_display_name() ?? "")
          .toLowerCase()
          .replace(/\s+/g, "");
        if (name && candidates.segments.has(name)) {
          const appId = (app.get_id() ?? "").toLowerCase();
          const noSuffix = appId.endsWith(".desktop")
            ? appId.slice(0, -8)
            : appId;
          resolvedBaseId = noSuffix;
          _addAppIdVariants(ids, noSuffix);
          break outer2;
        }
        const first = (app.get_display_name() ?? "")
          .toLowerCase()
          .split(/\s+/)[0];
        if (first && first.length > 2 && candidates.segments.has(first)) {
          const appId = (app.get_id() ?? "").toLowerCase();
          const noSuffix = appId.endsWith(".desktop")
            ? appId.slice(0, -8)
            : appId;
          resolvedBaseId = noSuffix;
          _addAppIdVariants(ids, noSuffix);
          break outer2;
        }
      }
    }
  } catch (_e) {}

  //MprisManager desktopEntries map
  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) {
      const normalized = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      if (!resolvedBaseId) resolvedBaseId = normalized.toLowerCase();
      _addAppIdVariants(ids, normalized);
    }
  }

  //Bus-name derived IDs
  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, ""); // snap suffix
  const cleanLower = clean.toLowerCase();

  ids.add(cleanLower);
  ids.add(raw.toLowerCase());

  const parts = clean.split(".");
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].toLowerCase();
    if (!SKIP_SEGMENTS.has(tail)) ids.add(tail);
  }

  const snapBase = cleanLower.split(".").pop();
  if (snapBase && !SKIP_SEGMENTS.has(snapBase)) {
    ids.add(snapBase);
    ids.add(`${snapBase}_${snapBase}`); // snap double-name convention
  }

  if (!resolvedBaseId) resolvedBaseId = cleanLower;

  // Browser composite ID
  let browserBase = resolvedBaseId
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "");

  if (isBrowserId(browserBase)) {
    const identity = manager?._identities?.get(playerName);
    if (identity && identity.trim()) {
      const compositeId = buildBrowserSourceId(browserBase, identity.trim());
      ids.add(compositeId);

      const tail = browserBase.split(".").pop();
      if (tail !== browserBase && !SKIP_SEGMENTS.has(tail)) {
        ids.add(buildBrowserSourceId(tail, identity.trim()));
      }
    }
  }

  return ids;
}

// Vinyl state helpers

/**
 * Returns true if any entry in vinylApps matches any id in canonicalIds
 *
 * @param {Set<string>} canonicalIds
 * @param {string[]}    vinylApps
 * @returns {boolean}
 */
export function isVinylEnabledForIds(canonicalIds, vinylApps) {
  for (const appId of vinylApps) {
    const appLower = appId.toLowerCase();

    if (canonicalIds.has(appLower)) return true;

    const base = appLower.split(".").pop();
    if (base && !SKIP_SEGMENTS.has(base) && canonicalIds.has(base)) return true;

    const parsed = parseBrowserSourceId(appLower);
    if (parsed) {
      for (const cid of canonicalIds) {
        if (cid === appLower) return true;
        const cparsed = parseBrowserSourceId(cid);
        if (
          cparsed &&
          cparsed.source === parsed.source &&
          (cparsed.browser === parsed.browser ||
            cparsed.browser.includes(parsed.browser) ||
            parsed.browser.includes(cparsed.browser))
        )
          return true;
      }
    }
  }
  return false;
}

/**
 * Read vinyl-app-ids from settings
 * @param {Gio.Settings} settings
 * @returns {string[]}
 */
export function getVinylApps(settings) {
  try {
    return settings.get_strv("vinyl-app-ids") ?? [];
  } catch (_e) {
    return [];
  }
}

/**
 * Write vinyl-app-ids to settings
 * @param {Gio.Settings} settings
 * @param {string[]}     ids
 */
export function setVinylApps(settings, ids) {
  try {
    settings.set_strv("vinyl-app-ids", ids);
  } catch (_e) {}
}

// Private helpers

function _addAppIdVariants(ids, appId) {
  const lower = appId.toLowerCase();
  ids.add(lower);
  const parts = lower.split(".");
  if (parts.length > 1) {
    const tail = parts[parts.length - 1];
    if (!SKIP_SEGMENTS.has(tail)) ids.add(tail);
  }
}

/**
 * Build token sets used for app-info resolution
 *
 * @param {string|null}  playerName
 * @param {object|null}  manager
 * @returns {{ exact: Set<string>, segments: Set<string> }}
 */
function _buildCandidateTokens(playerName, manager) {
  const exact = new Set();
  const segments = new Set();

  const _add = (str) => {
    if (!str) return;
    const lower = str.toLowerCase().replace(/\.desktop$/, "");
    exact.add(lower);
    exact.add(`${lower}.desktop`);
    for (const seg of lower.split(".")) {
      if (seg.length > 2 && !SKIP_SEGMENTS.has(seg)) segments.add(seg);
    }
  };

  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) _add(de);
  }

  if (!playerName) return { exact, segments };

  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, "");

  _add(clean);

  const snapBase = clean.split(".").pop();
  if (snapBase && snapBase !== clean) {
    _add(snapBase);
    _add(`${snapBase}_${snapBase}`);
  }

  if (manager) {
    const identity = manager._identities?.get(playerName);
    if (identity && identity.trim()) {
      const normalized = identity.trim().toLowerCase().replace(/\s+/g, "");
      segments.add(normalized);
      const first = identity.trim().toLowerCase().split(/\s+/)[0];
      if (first.length > 2) segments.add(first);
    }
  }

  return { exact, segments };
}