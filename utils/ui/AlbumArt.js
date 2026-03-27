import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene";
import Cairo from "cairo";

import { Tonearm } from "./widgets/tonearm.js";
import {
  resolveCanonicalIds,
  isVinylEnabledForIds,
  getVinylApps,
  setVinylApps,
  isBrowserId,
  buildBrowserSourceId,
  labelForId,
} from "./helper/vinylHelpers.js";

/** @param {Gio.Settings} settings @returns {number} */
function _artSize(settings) {
  try {
    return Math.max(180, settings.get_int("popup-width"));
  } catch (_e) {
    return 340;
  }
}

export const AlbumArt = GObject.registerClass(
  {
    Signals: {
      "triple-click": {},
    },
  },
  class AlbumArt extends St.BoxLayout {
    _init(settings, manager = null, playerName = null) {
      super._init({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._settings = settings;
      this._manager = manager;
      this._playerName = playerName;
      this._isDestroyed = false;

      this._coverCache = new Map();
      this._currentArtUrl = null;
      this._rotationAngle = 0;
      this._rotationInterval = null;
      this._isRotating = false;
      this._isPlaying = false;

      this._vinylMode = this._isVinylEnabledForCurrentPlayer();

      // Multi-click detection
      this._clickCount = 0;
      this._lastClickTime = 0;
      this._clickTimeout = null;

      this._buildUI();

      this._settingsChangedId = this._settings.connect(
        "changed::vinyl-app-ids",
        () => {
          if (!this._isDestroyed) this._onVinylAppsSettingChanged();
        },
      );

      // Resize every UI element when the user changes popup-width
      this._sizeChangedId = this._settings.connect(
        "changed::popup-width",
        () => {
          if (!this._isDestroyed) this._applySize();
        },
      );
    }

    setPlayer(manager, playerName) {
      this._manager = manager;
      this._playerName = playerName;
      if (!this._isDestroyed) this._onVinylAppsSettingChanged();
    }

    //  Per-app vinyl helpers

    _isVinylEnabledForCurrentPlayer() {
      const ids = resolveCanonicalIds(this._playerName, this._manager);
      return isVinylEnabledForIds(ids, getVinylApps(this._settings));
    }

    _resolvePreferredId() {
      let baseId = null;
      const appInfo = this._resolveAppInfo();
      if (appInfo) {
        const id = appInfo.get_id();
        if (id) baseId = id.endsWith(".desktop") ? id.slice(0, -8) : id;
      }

      if (!baseId && this._manager) {
        const de = this._manager._desktopEntries?.get(this._playerName);
        if (de) baseId = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      }

      if (!baseId) {
        const raw = this._playerName?.replace(
          /^org\.mpris\.MediaPlayer2\./,
          "",
        );
        baseId =
          raw
            ?.replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
            .replace(/\.\d+$/, "") ?? null;
      }

      if (!baseId) return null;

      const cleanBase = baseId
        .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
        .replace(/\.\d+$/, "");

      if (isBrowserId(cleanBase)) {
        const identity = this._manager?._identities?.get(this._playerName);
        if (identity && identity.trim()) {
          return buildBrowserSourceId(cleanBase, identity.trim());
        }
        return cleanBase;
      }

      return cleanBase;
    }

    /**
     * Universal app-info resolver

     * @returns {Gio.AppInfo|null}
     */
    _resolveAppInfo() {
      try {
        const candidates = _buildCandidateTokens(
          this._playerName,
          this._manager,
        );

        const allApps = Gio.AppInfo.get_all();

        for (const app of allApps) {
          const rawId = app.get_id() ?? "";
          const lower = rawId.toLowerCase();
          const noSuffix = lower.endsWith(".desktop")
            ? lower.slice(0, -8)
            : lower;
          if (candidates.exact.has(lower) || candidates.exact.has(noSuffix))
            return app;
        }

        //  segment match (handles reverse-DNS like org.videolan.vlc)
        for (const app of allApps) {
          const rawId = app.get_id() ?? "";
          const lower = rawId.toLowerCase();
          const noSuffix = lower.endsWith(".desktop")
            ? lower.slice(0, -8)
            : lower;
          for (const seg of noSuffix.split(".")) {
            if (seg.length > 2 && candidates.segments.has(seg)) return app;
          }
        }

        // display-name / first-word match
        for (const app of allApps) {
          const name = (app.get_display_name() ?? "")
            .toLowerCase()
            .replace(/\s+/g, "");
          if (name && candidates.segments.has(name)) return app;
          const first = (app.get_display_name() ?? "")
            .toLowerCase()
            .split(/\s+/)[0];
          if (first && first.length > 2 && candidates.segments.has(first))
            return app;
        }
      } catch (_e) {}
      return null;
    }

    _toggleVinylForCurrentPlayer() {
      const ids = resolveCanonicalIds(this._playerName, this._manager);
      const list = getVinylApps(this._settings);
      const enabled = isVinylEnabledForIds(ids, list);

      if (ids.size === 0) {
        const cur = this._settings.get_boolean("enable-album-art-rotation");
        this._settings.set_boolean("enable-album-art-rotation", !cur);
        return;
      }

      if (enabled) {
        const filtered = list.filter((id) => !isVinylEnabledForIds(ids, [id]));
        setVinylApps(this._settings, filtered);
        this._markInstanceEnabled(ids, false);
      } else {
        const preferred = this._resolvePreferredId();
        if (
          preferred &&
          !list.some((id) => id.toLowerCase() === preferred.toLowerCase())
        )
          list.push(preferred);
        setVinylApps(this._settings, list);
        this._saveInstance(preferred);
      }
    }

    _saveInstance(preferredId) {
      if (!preferredId) return;

      const _parseBSI = (id) => {
        if (!id || !id.includes("--")) return null;
        const idx = id.indexOf("--");
        return { browser: id.slice(0, idx), source: id.slice(idx + 2) };
      };

      const parsed = _parseBSI(preferredId);
      const isBrowser = parsed !== null;

      const appInfo = this._resolveAppInfo();

      let canonicalId = preferredId;
      let desktopId = preferredId;
      let displayName = isBrowser ? labelForId(preferredId) : preferredId;

      if (appInfo) {
        const rawId = appInfo.get_id() ?? "";
        const clean = rawId.endsWith(".desktop") ? rawId.slice(0, -8) : rawId;
        if (isBrowser) {
          desktopId = clean;
        } else {
          canonicalId = clean;
          desktopId = clean;
          displayName =
            appInfo.get_display_name() || appInfo.get_name() || displayName;
        }
      } else {
        if (this._manager) {
          const identity = this._manager._identities?.get(this._playerName);
          if (isBrowser) {
            const de = this._manager._desktopEntries?.get(this._playerName);
            if (de) desktopId = de.endsWith(".desktop") ? de.slice(0, -8) : de;
          } else {
            if (identity) displayName = identity;
            const de = this._manager._desktopEntries?.get(this._playerName);
            if (de) {
              const clean = de.endsWith(".desktop") ? de.slice(0, -8) : de;
              canonicalId = clean;
              desktopId = clean;
            }
          }
        }
      }

      const canonicalLower = canonicalId.toLowerCase();
      const canonicalTail = canonicalLower.split(".").pop();

      const record = JSON.stringify({
        id: canonicalId,
        name: displayName,
        desktopId,
        busName: this._playerName || "",
        enabled: true,
        ...(isBrowser && {
          browserSource: parsed.source,
          browserBase: parsed.browser,
          mprisIdentity:
            this._manager?._identities?.get(this._playerName) ?? "",
        }),
      });

      try {
        const existing = this._settings.get_strv("vinyl-app-instances") ?? [];

        let preservedCustomName = null;
        let preservedEnabled = true;

        const deduped = existing.filter((raw) => {
          try {
            const obj = JSON.parse(raw);
            const storedId = (obj.id ?? "").toLowerCase();
            const storedDesktop = (obj.desktopId ?? "").toLowerCase();

            const isComposite = canonicalLower.includes("--");
            let isMatch;
            if (isComposite) {
              isMatch = storedId === canonicalLower;
            } else {
              const storedTail = storedId.split(".").pop();
              isMatch =
                storedId === canonicalLower ||
                storedDesktop === canonicalLower ||
                storedTail === canonicalTail ||
                storedId === canonicalTail;
            }

            if (isMatch) {
              if (obj.customName) preservedCustomName = obj.customName;
              if (typeof obj.enabled === "boolean")
                preservedEnabled = obj.enabled;
              return false;
            }
            return true;
          } catch (_) {
            return true;
          }
        });

        const finalRecord = JSON.parse(record);
        if (preservedCustomName) finalRecord.customName = preservedCustomName;
        finalRecord.enabled = preservedEnabled;

        deduped.push(JSON.stringify(finalRecord));
        this._settings.set_strv("vinyl-app-instances", deduped);
      } catch (_e) {}
    }

    _markInstanceEnabled(canonicalIds, enabledValue) {
      try {
        const existing = this._settings.get_strv("vinyl-app-instances") ?? [];
        const updated = existing.map((raw) => {
          try {
            const obj = JSON.parse(raw);
            const lower = (obj.id ?? "").toLowerCase();
            const match =
              canonicalIds.has(lower) ||
              canonicalIds.has(lower.split(".").pop());
            if (match) return JSON.stringify({ ...obj, enabled: enabledValue });
          } catch (_) {}
          return raw;
        });
        this._settings.set_strv("vinyl-app-instances", updated);
      } catch (_e) {}
    }

    _onVinylAppsSettingChanged() {
      const newVinyl = this._isVinylEnabledForCurrentPlayer();
      if (newVinyl === this._vinylMode) return;

      const wasPlaying = this._isPlaying;
      this._vinylMode = newVinyl;

      this.stopRotation();
      this._updateMode();

      if (this._currentArtUrl) this.loadCover(this._currentArtUrl, true);

      if (this._vinylMode && wasPlaying) this.startRotation(true);
    }

    //  Build UI
    _buildUI() {
      const sz = _artSize(this._settings);
      const br = Math.round(sz * 0.047); // ~16 px at 340

      // Normal mode

      this._normalContainer = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
        reactive: true,
      });

      this._normalButton = new St.Button({
        style_class: "media-album-art",
        style: `
          width: ${sz}px;
          height: ${sz}px;
          border-radius: ${br}px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          background: linear-gradient(135deg,
            rgba(255,255,255,0.05) 0%,
            rgba(255,255,255,0.02) 100%);
          padding: 0;
          border: none;
        `,
        can_focus: false,
        track_hover: false,
      });

      this._normalCoverImage = new St.Widget({
        style_class: "cover-art-image",
        width: sz,
        height: sz,
        style: `
          border-radius: ${br}px;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        `,
        reactive: false,
      });

      this._normalButton.set_child(this._normalCoverImage);
      this._normalContainer.add_child(this._normalButton);
      this._normalButton.connectObject(
        "clicked",
        () => this._onAlbumArtClicked(),
        this,
      );

      // Vinyl mode

      this._vinylContainer = new St.Widget({
        style: `width: ${sz}px; height: ${sz}px;`,
        layout_manager: new Clutter.FixedLayout(),
        reactive: true,
      });

      this._rotatingContainer = new St.Widget({
        width: sz,
        height: sz,
        x: 0,
        y: 0,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        layout_manager: new Clutter.FixedLayout(),
        reactive: false,
      });

      const halfSz = Math.round(sz / 2);

      this._vinylLayer = new St.DrawingArea({
        width: sz,
        height: sz,
        x: 0,
        y: 0,
        style: `border-radius: ${halfSz}px;`,
        reactive: false,
      });
      this._vinylLayer.connectObject(
        "repaint",
        (area) => this._drawVinylLayer(area),
        this,
      );

      this._vinylCoverArt = new St.Bin({
        style_class: "media-album-art",
        x: 0,
        y: 0,
        style: `
          width: ${sz}px;
          height: ${sz}px;
          border-radius: ${halfSz}px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `,
        reactive: false,
      });
      this._vinylCoverImage = new St.Widget({
        style_class: "cover-art-image",
        width: sz,
        height: sz,
        style: `
          border-radius: ${halfSz}px;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        `,
        reactive: false,
      });

      this._vinylCoverArt.set_child(this._vinylCoverImage);
      this._rotatingContainer.add_child(this._vinylLayer);
      this._rotatingContainer.add_child(this._vinylCoverArt);

      this._vinylButton = new St.Button({
        width: sz,
        height: sz,
        x: 0,
        y: 0,
        style: "background: transparent; border: none; padding: 0;",
        can_focus: false,
        track_hover: false,
        reactive: true,
      });
      this._vinylButton.connectObject(
        "clicked",
        () => this._onAlbumArtClicked(),
        this,
      );

      // Pass settings to Tonearm so it can read angle prefs live
      this._tonearm = new Tonearm({ settings: this._settings });
      this._vinylContainer.add_child(this._rotatingContainer);
      this._vinylContainer.add_child(this._vinylButton);
      this._vinylContainer.add_child(this._tonearm);

      this.add_child(this._normalContainer);
      this.add_child(this._vinylContainer);

      this._updateMode();
    }

    // Size update

    _applySize() {
      const sz = _artSize(this._settings);
      const br = Math.round(sz * 0.047);
      const halfSz = Math.round(sz / 2);

      //  Resize structural widgets

      this._normalButton.style = `
        width: ${sz}px; height: ${sz}px; border-radius: ${br}px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        background: linear-gradient(135deg,
          rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
        padding: 0; border: none;
      `;
      this._normalCoverImage.set_width(sz);
      this._normalCoverImage.set_height(sz);

      this._vinylContainer.style = `width: ${sz}px; height: ${sz}px;`;
      this._rotatingContainer.set_width(sz);
      this._rotatingContainer.set_height(sz);

      this._vinylLayer.set_width(sz);
      this._vinylLayer.set_height(sz);
      this._vinylLayer.style = `border-radius: ${halfSz}px;`;
      this._vinylLayer.queue_repaint();

      this._vinylCoverArt.style = `
        width: ${sz}px; height: ${sz}px;
        border-radius: ${halfSz}px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      `;
      this._vinylCoverImage.set_width(sz);
      this._vinylCoverImage.set_height(sz);

      this._vinylButton.set_width(sz);
      this._vinylButton.set_height(sz);

      this._tonearm.set_width(sz);
      this._tonearm.set_height(sz);
      this._tonearm.queue_repaint();

      // Invalidate cover cache

      this._coverCache.clear();

      // Reload cover at the new size

      const pendingUrl = this._currentArtUrl;
      this._currentArtUrl = null;
      if (pendingUrl) {
        this.loadCover(pendingUrl);
      } else {
        this.setDefaultCover();
      }
    }

    //  Click handling

    _onAlbumArtClicked() {
      const MULTI_CLICK_MS = 400;
      const now = GLib.get_monotonic_time();
      const elapsedMs = (now - this._lastClickTime) / 1000;

      let vinylClicks = 2;
      let lyricsClicks = 3;
      try {
        vinylClicks = this._settings.get_int("vinyl-click-count");
        lyricsClicks = this._settings.get_int("lyrics-click-count");
      } catch (_e) {}

      vinylClicks = Math.max(1, Math.min(5, vinylClicks));
      lyricsClicks = Math.max(1, Math.min(5, lyricsClicks));

      if (this._lastClickTime > 0 && elapsedMs < MULTI_CLICK_MS) {
        this._clickCount++;
      } else {
        this._clickCount = 1;
      }
      this._lastClickTime = now;

      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }

      const count = this._clickCount;
      const maxThreshold = Math.max(vinylClicks, lyricsClicks);

      if (count >= maxThreshold) {
        this._clickTimeout = null;
        this._clickCount = 0;
        this._lastClickTime = 0;
        this._dispatchClickAction(count, vinylClicks, lyricsClicks);
        return;
      }

      this._clickTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        MULTI_CLICK_MS,
        () => {
          this._clickTimeout = null;
          this._clickCount = 0;
          this._lastClickTime = 0;
          this._dispatchClickAction(count, vinylClicks, lyricsClicks);
          return GLib.SOURCE_REMOVE;
        },
      );
    }

    _dispatchClickAction(count, vinylClicks, lyricsClicks) {
      if (count === lyricsClicks) {
        this.emit("triple-click"); // signal name kept for backward-compat
      } else if (count === vinylClicks) {
        this._toggleVinylForCurrentPlayer();
      }
    }

    _updateMode() {
      if (this._vinylMode) {
        this._normalContainer.hide();
        this._vinylContainer.show();
      } else {
        this._vinylContainer.hide();
        this._normalContainer.show();
      }
    }

    // Vinyl disc drawing

    _drawVinylLayer(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = width / 2;

      // Full disc background
      const gradient = new Cairo.RadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius,
      );
      gradient.addColorStopRGBA(0, 0.12, 0.12, 0.12, 1);
      gradient.addColorStopRGBA(0.8, 0.08, 0.08, 0.08, 1);
      gradient.addColorStopRGBA(1, 0.05, 0.05, 0.05, 1);

      cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      cr.setSource(gradient);
      cr.fill();

      // Grooves
      cr.setLineWidth(0.5);
      for (let i = 0; i < 20; i++) {
        const grooveRadius = radius - 10 - i * 1.5;
        if (grooveRadius > 0) {
          cr.arc(centerX, centerY, grooveRadius, 0, 2 * Math.PI);
          cr.setSourceRGBA(0, 0, 0, i % 3 === 0 ? 0.15 : 0.08);
          cr.stroke();
        }
      }

      // Center label
      const labelRadius = radius * 0.25;
      const labelGrad = new Cairo.RadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        labelRadius,
      );
      labelGrad.addColorStopRGBA(0, 0.2, 0.2, 0.2, 1);
      labelGrad.addColorStopRGBA(1, 0.15, 0.15, 0.15, 1);

      cr.arc(centerX, centerY, labelRadius, 0, 2 * Math.PI);
      cr.setSource(labelGrad);
      cr.fill();

      cr.arc(centerX, centerY, 8, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.05, 0.05, 0.05, 1);
      cr.fill();

      cr.$dispose();
    }

    //  Cover art loading
    loadCover(url, forceRefresh = false) {
      if (!forceRefresh && this._currentArtUrl === url) return;
      this._currentArtUrl = url;

      if (!forceRefresh) {
        const cached = this._coverCache.get(url);
        if (cached) {
          this._applyCoverStyle(cached);
          return;
        }
      }

      if (url.startsWith("file://") || url.startsWith("/")) {
        this._setCoverImage(url.startsWith("file://") ? url : `file://${url}`);
      } else {
        this._downloadCover(url);
      }
    }

    _setCoverImage(imageUrl) {
      const sz = _artSize(this._settings);
      const br = Math.round(sz * 0.047);
      const halfSz = Math.round(sz / 2);

      const normalStyle = `
        width: ${sz}px;
        height: ${sz}px;
        border-radius: ${br}px;
        background-image: url('${imageUrl}');
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
      `;
      const vinylStyle = `
        width: ${sz}px;
        height: ${sz}px;
        border-radius: ${halfSz}px;
        background-image: url('${imageUrl}');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      `;

      this._normalCoverImage.style = normalStyle;
      this._vinylCoverImage.style = vinylStyle;
      this._coverCache.set(imageUrl, {
        normal: normalStyle,
        vinyl: vinylStyle,
      });
    }

    _applyCoverStyle(styles) {
      this._normalCoverImage.style = styles.normal;
      this._vinylCoverImage.style = styles.vinyl;
    }

    _downloadCover(url) {
      const hash = GLib.compute_checksum_for_string(
        GLib.ChecksumType.MD5,
        url,
        -1,
      );
      const cacheDir = GLib.build_filenamev([
        GLib.get_user_cache_dir(),
        "mpris-covers",
      ]);
      GLib.mkdir_with_parents(cacheDir, 0o755);
      const cachePath = GLib.build_filenamev([cacheDir, hash]);
      const cacheFile = Gio.File.new_for_path(cachePath);

      if (cacheFile.query_exists(null)) {
        this._setCoverImage(`file://${cachePath}`);
        return;
      }

      this.setDefaultCover();

      Gio.File.new_for_uri(url).copy_async(
        cacheFile,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_LOW,
        null,
        null,
        (src, res) => {
          if (this._isDestroyed) return;
          try {
            src.copy_finish(res);
            this._setCoverImage(`file://${cachePath}`);
          } catch (e) {
            console.error("AlbumArt: failed to download cover:", e);
          }
        },
      );
    }

    setDefaultCover() {
      this._currentArtUrl = null;
      const sz = _artSize(this._settings);
      const br = Math.round(sz * 0.047);
      const halfSz = Math.round(sz / 2);
      const ph = "url('resource:///org/gnome/shell/theme/process-working.svg')";

      this._normalCoverImage.style = `
        width: ${sz}px; height: ${sz}px; border-radius: ${br}px;
        background-size: contain; background-position: center;
        background-repeat: no-repeat;
        background-image: ${ph}; opacity: 0.3;
      `;
      this._vinylCoverImage.style = `
        width: ${sz}px; height: ${sz}px; border-radius: ${halfSz}px;
        background-size: 100px; background-position: center;
        background-repeat: no-repeat;
        background-image: ${ph}; opacity: 0.3;
      `;
    }

    //  Rotation

    startRotation(isPlaying = true) {
      this._isPlaying = isPlaying;

      if (!this._vinylMode) {
        this._stopRotationInterval();
        return;
      }

      if (!isPlaying) {
        this.pauseRotation();
        return;
      }

      this._tonearm.moveToPlaying();

      if (this._isRotating) return;

      this._isRotating = true;
      const speed = this._settings.get_int("album-art-rotation-speed");
      const interval = 50;
      const degPerInterval = (360 / (speed * 1000)) * interval;

      this._rotationInterval = GLib.timeout_add(
        GLib.PRIORITY_LOW,
        interval,
        () => {
          if (this._isDestroyed || !this._isRotating) return GLib.SOURCE_REMOVE;
          this._rotationAngle = (this._rotationAngle + degPerInterval) % 360;
          if (this._rotatingContainer)
            this._rotatingContainer.rotation_angle_z = this._rotationAngle;
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    stopRotation() {
      this._isPlaying = false;
      this._isRotating = false;
      this._stopRotationInterval();
      if (this._vinylMode) this._tonearm.moveToParked();
      this._rotationAngle = 0;
      if (this._rotatingContainer) this._rotatingContainer.rotation_angle_z = 0;
    }

    pauseRotation() {
      this._isPlaying = false;
      this._isRotating = false;
      this._stopRotationInterval();
      if (this._vinylMode) this._tonearm.moveToParked();
    }

    _stopRotationInterval() {
      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }
    }

    destroy() {
      this._isDestroyed = true;

      this.stopRotation();

      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }
      this._clickCount = 0;
      this._lastClickTime = 0;

      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }
      if (this._sizeChangedId) {
        this._settings.disconnect(this._sizeChangedId);
        this._sizeChangedId = 0;
      }

      this._normalButton?.disconnectObject(this);
      this._vinylButton?.disconnectObject(this);
      this._normalContainer?.disconnectObject(this);
      this._vinylContainer?.disconnectObject(this);
      this._vinylLayer?.disconnectObject(this);

      this._tonearm?.destroy();
      this._tonearm = null;

      this._coverCache.clear();
      this._currentArtUrl = null;
      super.destroy();
    }
  },
);

// Module-level helpers

/**

 * @param {string|null}  playerName
 * @param {object|null}  manager
 * @returns {{ exact: Set<string>, segments: Set<string> }}
 */
function _buildCandidateTokens(playerName, manager) {
  const exact = new Set();
  const segments = new Set();

  const _add = (str) => {
    if (!str) return;
    const lower = str.toLowerCase();
    exact.add(lower);
    exact.add(lower.endsWith(".desktop") ? lower : `${lower}.desktop`);
    exact.add(lower.endsWith(".desktop") ? lower.slice(0, -8) : lower);

    // Meaningful reverse-DNS segments
    const SKIP = new Set([
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
    ]);
    for (const seg of lower.replace(/\.desktop$/, "").split(".")) {
      if (seg.length > 2 && !SKIP.has(seg)) segments.add(seg);
    }
  };

  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) _add(de);
  }

  if (!playerName) return { exact, segments };

  // Clean MPRIS bus name
  const raw = playerName.replace(/^org\.mpris\.MediaPlayer2\./, "");

  // Strip instance / numeric suffixes
  const clean = raw
    .replace(/\.instance[_\-]?\d+(_\d+)?$/i, "")
    .replace(/\.\d+$/, "")
    .replace(/\.snap$/i, ""); // some snaps append .snap

  _add(clean);

  const snapBase = clean.split(".").pop();
  if (snapBase && snapBase !== clean) {
    _add(snapBase);
    // Snap-style "appname_appname" variant
    _add(`${snapBase}_${snapBase}`);
  }

  // MPRIS identity string
  if (manager) {
    const identity = manager._identities?.get(playerName);
    if (identity && identity.trim()) {
      const normalized = identity.trim().toLowerCase().replace(/\s+/g, "");
      segments.add(normalized);
      // First word only (handles "VLC media player" → "vlc")
      const firstWord = identity.trim().toLowerCase().split(/\s+/)[0];
      if (firstWord.length > 2) segments.add(firstWord);
    }
  }

  return { exact, segments };
}
