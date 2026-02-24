import Gio from "gi://Gio";

/**

 * @param {string|null} playerName  – MPRIS bus name
 * @param {object|null} manager     – MprisManager exposing _desktopEntries / _identities
 * @returns {Set<string>}
 */
export function resolveCanonicalIds(playerName, manager) {
  const ids = new Set();
  if (!playerName) return ids;

  try {
    const candidates = _buildCandidateSet(playerName, manager);
    const allApps = Gio.AppInfo.get_all();
    for (const app of allApps) {
      const appId = (app.get_id() ?? "").toLowerCase();
      const appIdNoSuffix = appId.endsWith(".desktop")
        ? appId.slice(0, -8)
        : appId;
      if (candidates.has(appId) || candidates.has(appIdNoSuffix)) {
        ids.add(appIdNoSuffix);

        const parts = appIdNoSuffix.split(".");
        if (parts.length > 1) ids.add(parts[parts.length - 1]);
        break;
      }
    }
  } catch (_e) {}

  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) {
      const normalized = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      ids.add(normalized.toLowerCase());
      const parts = normalized.split(".");
      if (parts.length > 1) ids.add(parts[parts.length - 1].toLowerCase());
    }
  }

  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw.replace(/\.instance_\d+_\d+$/i, "").replace(/\.\d+$/, "");
  ids.add(clean.toLowerCase());

  const cleanParts = clean.split(".");
  if (cleanParts.length > 1)
    ids.add(cleanParts[cleanParts.length - 1].toLowerCase());

  ids.add(raw.toLowerCase());

  return ids;
}

/**

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
  const clean = raw.replace(/\.instance_\d+_\d+$/i, "").replace(/\.\d+$/, "");

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
    if (canonicalIds.has(base)) return true;
  }
  return false;
}

/**
 * Read vinyl-app-ids from settings
 *
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
 * Write vinyl-app-ids to settings, silently ignoring errors.
 *
 * @param {Gio.Settings} settings
 * @param {string[]}     ids
 */
export function setVinylApps(settings, ids) {
  try {
    settings.set_strv("vinyl-app-ids", ids);
  } catch (_e) {}
}
