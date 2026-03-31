import Soup from "gi://Soup";
import GLib from "gi://GLib";

const decode = (data) => new TextDecoder().decode(data);

// LRU cache cap — keeps memory bounded
const CACHE_MAX = 60;

export class LyricsClient {
  constructor() {
    this._session = new Soup.Session();
    this._session.timeout = 8; // 8 s hard timeout per request

    // In-memory LRU cache
    this._cache = new Map();
  }

  /**
   * Fetch synced lyrics, returning as fast as possible
   * Fires exact + search requests in parallel; returns whichever wins
   *
   * @param {string} title
   * @param {string} artist
   * @param {string} album
   * @param {number} durationSec
   * @returns {Promise<{time:number, text:string}[]|null>}
   */
  async getLyrics(title, artist, album, durationSec) {
    if (!this._session) return null;
    if (!title && !artist) return null;

    const cacheKey = `${title}||${artist}||${album}||${Math.round(durationSec)}`;
    if (this._cache.has(cacheKey)) {
      // Refresh LRU order
      const v = this._cache.get(cacheKey);
      this._cache.delete(cacheKey);
      this._cache.set(cacheKey, v);
      return v;
    }

    try {
      
      const [exactP, searchP] = [
        this._getExact(title, artist, album, durationSec),
        this._search(title, artist, durationSec),
      ];

      
      const firstOf = (p) => new Promise((res) => p.then((v) => { if (v) res(v); }).catch(() => {}));

      
      let result = null;
      try {
        result = await Promise.race([firstOf(exactP), firstOf(searchP)]);
      } catch (_) {}

      if (!result) {
        
        result = (await exactP) ?? (await searchP) ?? null;
      }

      this._setCache(cacheKey, result);
      return result;
    } catch (_e) {
      return null;
    }
  }

  destroy() {
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
    this._cache.clear();
  }

  

  _setCache(key, value) {
    // Evict oldest entry if over cap
    if (this._cache.size >= CACHE_MAX) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  }

  async _getExact(title, artist, album, durationSec) {
    if (!this._session) return null;
    try {
      const p = new URLSearchParams();
      p.set("track_name", title || "");
      p.set("artist_name", artist || "");
      if (album) p.set("album_name", album);
      if (durationSec > 0) p.set("duration", String(Math.round(durationSec)));

      const msg = Soup.Message.new("GET", `https://lrclib.net/api/get?${p.toString()}`);
      if (!msg) return null;
      msg.request_headers.append("User-Agent", "AdvancedMediaController/5 (https://github.com)");

      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code !== 200) return null;

      const raw = bytes?.get_data();
      if (!raw) return null;

      const data = JSON.parse(decode(raw));
      return data?.syncedLyrics ? this._parseLRC(data.syncedLyrics) : null;
    } catch (_e) {
      return null;
    }
  }

  async _search(title, artist, durationSec) {
    if (!this._session) return null;
    try {
      const q = encodeURIComponent(`${title} ${artist}`.trim());
      const msg = Soup.Message.new("GET", `https://lrclib.net/api/search?q=${q}`);
      if (!msg) return null;
      msg.request_headers.append("User-Agent", "AdvancedMediaController/5 (https://github.com)");

      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code !== 200) return null;

      const raw = bytes?.get_data();
      if (!raw) return null;

      const data = JSON.parse(decode(raw));
      if (!Array.isArray(data) || data.length === 0) return null;

      const withSynced = data.filter((r) => r.syncedLyrics);
      if (withSynced.length === 0) return null;

      let best = null, bestDiff = Infinity;
      for (const r of withSynced) {
        const diff = durationSec > 0 ? Math.abs((r.duration ?? 0) - durationSec) : 0;
        if (diff < bestDiff) { bestDiff = diff; best = r; }
      }
      if (!best) return null;
      if (durationSec > 0 && bestDiff > 5) return null;

      return this._parseLRC(best.syncedLyrics);
    } catch (_e) {
      return null;
    }
  }

  _parseLRC(lrcText) {
    if (!lrcText) return null;
    const lines = [];
    const RE = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    for (const raw of lrcText.split("\n")) {
      const m = raw.match(RE);
      if (!m) continue;
      const ms =
        parseInt(m[1], 10) * 60_000 +
        parseInt(m[2], 10) * 1_000 +
        (m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10));
      const text = m[4].trim();
      if (text) lines.push({ time: ms, text });
    }
    return lines.length > 0 ? lines : null;
  }
}