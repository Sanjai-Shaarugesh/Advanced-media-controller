/** * Resolve ALL possible IDs for a player so we can match against vinyl-app-ids.
 * Returns a Set of lowercase strings.
 *
 * Handles the "Spotify / spotify" duplicate bug and ensures multiple instances
 * of the same app (e.g. two Spotify windows) map to the same ID.
 *
 * @param {string|null} playerName  - MPRIS bus name (e.g. org.mpris.MediaPlayer2.spotify)
 * @param {object|null} manager     - MprisManager that exposes _desktopEntries / _identities
 * @returns {Set<string>}
 */
export function resolveCanonicalIds(playerName, manager) {
  const ids = new Set();
  if (!playerName) return ids;

  // 1. Desktop-entry from MPRIS DesktopEntry property (most reliable)
  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) {
      const normalized = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      ids.add(normalized.toLowerCase());
      // Also add basename component (e.g. "spotify" from "com.spotify.Client")
      const parts = normalized.split(".");
      if (parts.length > 1) ids.add(parts[parts.length - 1].toLowerCase());
    }
  }

  // 2. Strip MPRIS prefix and instance suffixes from bus name
  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");
  const clean = raw.replace(/\.instance_\d+_\d+$/i, "").replace(/\.\d+$/, "");
  ids.add(clean.toLowerCase());

  // 3. Basename of cleaned bus suffix
  const cleanParts = clean.split(".");
  if (cleanParts.length > 1)
    ids.add(cleanParts[cleanParts.length - 1].toLowerCase());

  // 4. Raw suffix (unchanged) for edge cases
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
    // Basename match: stored "com.spotify.Client" vs resolved "spotify"
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
