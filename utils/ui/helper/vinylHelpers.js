import Gio from "gi://Gio";

// Browser detection helpers

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
    .replace(/-{2,}/g, "-"); // collapse multiple hyphens
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

  const sourceParts = parsed.source
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const sourceLabel = sourceParts.join(" ");

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

/**
 * Resolve a Set of lowercase canonical IDs for a player

 * @param {string|null}  playerName  - MPRIS bus name
 * @param {object|null}  manager     - MprisManager
 * @returns {Set<string>}
 */
export function resolveCanonicalIds(playerName, manager) {
  const ids = new Set();
  if (!playerName) return ids;

  let resolvedBaseId = null; // canonical desktop id WITHOUT .desktop

  try {
    const candidates = _buildCandidateSet(playerName, manager);
    const allApps = Gio.AppInfo.get_all();
    for (const app of allApps) {
      const appId = (app.get_id() ?? "").toLowerCase();
      const appIdNoSuffix = appId.endsWith(".desktop")
        ? appId.slice(0, -8)
        : appId;
      if (candidates.has(appId) || candidates.has(appIdNoSuffix)) {
        resolvedBaseId = appIdNoSuffix;
        ids.add(appIdNoSuffix);
        const parts = appIdNoSuffix.split(".");
        if (parts.length > 1) ids.add(parts[parts.length - 1]);
        break;
      }
    }
  } catch (_e) {}

  // desktopEntries map
  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) {
      const normalized = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      if (!resolvedBaseId) resolvedBaseId = normalized.toLowerCase();
      ids.add(normalized.toLowerCase());
      const parts = normalized.split(".");
      if (parts.length > 1) ids.add(parts[parts.length - 1].toLowerCase());
    }
  }

  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "");
  const cleanLower = clean.toLowerCase();

  ids.add(cleanLower);
  const cleanParts = clean.split(".");
  if (cleanParts.length > 1)
    ids.add(cleanParts[cleanParts.length - 1].toLowerCase());
  ids.add(raw.toLowerCase());

  if (!resolvedBaseId) resolvedBaseId = cleanLower;

  let browserBase = resolvedBaseId;

  browserBase = browserBase
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "");

  if (isBrowserId(browserBase)) {
    const identity = manager?._identities?.get(playerName);
    if (identity && identity.trim()) {
      const compositeId = buildBrowserSourceId(browserBase, identity.trim());
      ids.add(compositeId);

      const tail = browserBase.split(".").pop();
      if (tail !== browserBase) {
        ids.add(buildBrowserSourceId(tail, identity.trim()));
      }
    }
  }

  return ids;
}

/**
 * Build the set of candidate strings used to find the app in

 * @param {string}      playerName
 * @param {object|null} manager
 * @returns {Set<string>}
 */
function _buildCandidateSet(playerName, manager) {
  const candidates = new Set();

  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) {
      candidates.add(de.toLowerCase());
      candidates.add(
        (de.endsWith(".desktop") ? de : `${de}.desktop`).toLowerCase(),
      );
    }
  }

  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");

  const clean = raw
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "");

  candidates.add(clean.toLowerCase());
  candidates.add(`${clean}.desktop`.toLowerCase());

  const parts = clean.split(".");
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].toLowerCase();
    candidates.add(tail);
    candidates.add(`${tail}.desktop`);
  }

  return candidates;
}

/**
 * Returns true if any entry in vinylApps matches any id in canonicalIds.

 * @param {Set<string>} canonicalIds
 * @param {string[]}    vinylApps
 * @returns {boolean}
 */
export function isVinylEnabledForIds(canonicalIds, vinylApps) {
  for (const appId of vinylApps) {
    const appLower = appId.toLowerCase();

    if (canonicalIds.has(appLower)) return true;

    const base = appLower.split(".").pop();
    if (base && canonicalIds.has(base)) return true;

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
 *
 * @param {Gio.Settings} settings
 * @param {string[]}     ids
 */
export function setVinylApps(settings, ids) {
  try {
    settings.set_strv("vinyl-app-ids", ids);
  } catch (_e) {}
}
