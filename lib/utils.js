/**
 * Returns true when an app id belongs to a browser.
 * @param {string} appId lower-cased canonical id (no .desktop)
 */
export function isBrowserId(appId) {
  if (!appId) return false;
  const BROWSER_FRAGMENTS = [
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
  ];
  const lower = appId.toLowerCase();
  return BROWSER_FRAGMENTS.some(
    (f) => lower.includes(f) || f.includes(lower.split(".").pop()),
  );
}

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
    firefox: "Firefox",
    "org-mozilla-firefox": "Firefox",
    "microsoft-edge": "Edge",
    msedge: "Edge",
    vivaldi: "Vivaldi",
    opera: "Opera",
    epiphany: "Web",
    midori: "Midori",
    falkon: "Falkon",
  };
  const browserLabel = browserLabels[parsed.browser] ?? parsed.browser;
  return `${sourceLabel} (${browserLabel})`;
}