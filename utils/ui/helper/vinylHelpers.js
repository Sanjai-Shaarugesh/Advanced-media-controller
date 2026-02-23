/** *
 * Returns a Set of lowercase strings.
 *
 * Handles  multiple instances
 * of the same app  map to the same ID.
 *
 * @param {string|null} playerName  - MPRIS bus name
 * @param {object|null} manager     - MprisManager that exposes _desktopEntries / _identities
 * @returns {Set<string>}
 */
export function resolveCanonicalIds(playerName, manager) {
  const ids = new Set();
  if (!playerName) return ids;

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
 * Returns true if any entry in vinylApps matches any id in canonicalIds.
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
 * Read vinyl-app-ids from settings, returning [] on any error.
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
