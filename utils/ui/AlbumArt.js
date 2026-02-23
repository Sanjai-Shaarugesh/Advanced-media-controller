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
} from "./helper/vinylHelpers.js";

// albumart

export const AlbumArt = GObject.registerClass(
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

      // Double-click detection
      this._lastClickTime = 0;
      this._clickTimeout = null;

      this._buildUI();

      this._settingsChangedId = this._settings.connect(
        "changed::vinyl-app-ids",
        () => {
          if (!this._isDestroyed) this._onVinylAppsSettingChanged();
        },
      );
    }

    // Update the active player (call when the tracked player changes)
    setPlayer(manager, playerName) {
      this._manager = manager;
      this._playerName = playerName;
      if (!this._isDestroyed) this._onVinylAppsSettingChanged();
    }

    // Per-app vinyl helpers

    _isVinylEnabledForCurrentPlayer() {
      const ids = resolveCanonicalIds(this._playerName, this._manager);
      return isVinylEnabledForIds(ids, getVinylApps(this._settings));
    }

    _resolvePreferredId() {
      if (this._manager) {
        const de = this._manager._desktopEntries?.get(this._playerName);
        if (de) return de.endsWith(".desktop") ? de.slice(0, -8) : de;
      }
      const raw = this._playerName?.replace(/^org\.mpris\.MediaPlayer2\./, "");
      return (
        raw?.replace(/\.instance_\d+_\d+$/i, "").replace(/\.\d+$/, "") ?? null
      );
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
        // Remove from list but keep the instance record (mark disabled)
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

    /**
     * Persist a rich JSON record into vinyl-app-instances so the prefs
     * page can show it with the correct icon and display name.
     */
    _saveInstance(preferredId) {
      if (!preferredId) return;

      let displayName = preferredId;
      let desktopId = preferredId;

      if (this._manager) {
        const identity = this._manager._identities?.get(this._playerName);
        if (identity) displayName = identity;

        const de = this._manager._desktopEntries?.get(this._playerName);
        if (de) desktopId = de.endsWith(".desktop") ? de.slice(0, -8) : de;
      }

      const record = JSON.stringify({
        id: preferredId,
        name: displayName,
        desktopId,
        busName: this._playerName || "",
        enabled: true,
      });

      try {
        const existing = this._settings.get_strv("vinyl-app-instances") ?? [];
        const deduped = existing.filter((raw) => {
          try {
            return (
              JSON.parse(raw).id?.toLowerCase() !== preferredId.toLowerCase()
            );
          } catch (_) {
            return true;
          }
        });
        deduped.push(record);
        this._settings.set_strv("vinyl-app-instances", deduped);
      } catch (_e) {}
    }

    // Update the `enabled` field on a stored instance without removing it
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

    _buildUI() {
      // normal mode
      this._normalContainer = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
        reactive: true,
      });

      this._normalCoverArt = new St.Bin({
        style_class: "media-album-art",
        style: `
                  width: 340px;
                  height: 340px;
                  border-radius: 16px;
                  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                  background: linear-gradient(135deg,
                    rgba(255,255,255,0.05) 0%,
                    rgba(255,255,255,0.02) 100%);
                `,
      });

      this._normalCoverImage = new St.Widget({
        style_class: "cover-art-image",
        width: 340,
        height: 340,
        style: `
                  border-radius: 16px;
                  background-size: cover;
                  background-position: center;
                  background-repeat: no-repeat;
                `,
      });

      this._normalCoverArt.set_child(this._normalCoverImage);
      this._normalContainer.add_child(this._normalCoverArt);

      this._normalContainer.connectObject(
        "button-press-event",
        (_actor, event) => this._onAlbumArtClicked(event),
        this,
      );

      // Vinyl mode
      this._vinylContainer = new St.Widget({
        style: "width: 340px; height: 340px;",
        layout_manager: new Clutter.FixedLayout(),
        reactive: true,
      });

      this._vinylContainer.connectObject(
        "button-press-event",
        (_actor, event) => this._onAlbumArtClicked(event),
        this,
      );

      // Rotating disc & cover image
      this._rotatingContainer = new St.Widget({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        layout_manager: new Clutter.FixedLayout(),
      });

      this._vinylLayer = new St.DrawingArea({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        style: "border-radius: 170px;",
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
                  width: 340px;
                  height: 340px;
                  border-radius: 170px;
                  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
                `,
      });
      this._vinylCoverImage = new St.Widget({
        style_class: "cover-art-image",
        width: 340,
        height: 340,
        style: `
                  border-radius: 170px;
                  background-size: cover;
                  background-position: center;
                  background-repeat: no-repeat;
                `,
      });
      this._vinylCoverArt.set_child(this._vinylCoverImage);

      this._rotatingContainer.add_child(this._vinylLayer);
      this._rotatingContainer.add_child(this._vinylCoverArt);

      // Tonearm
      this._tonearmContainer = new St.Widget({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        layout_manager: new Clutter.FixedLayout(),
      });

      // Tonearm widget
      this._tonearm = new Tonearm();
      this._tonearmContainer.add_child(this._tonearm);

      this._vinylContainer.add_child(this._rotatingContainer);
      this._vinylContainer.add_child(this._tonearmContainer);

      this.add_child(this._normalContainer);
      this.add_child(this._vinylContainer);

      this._updateMode();
    }

    //Click & double-click
    _onAlbumArtClicked(event) {
      if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

      const now = GLib.get_monotonic_time() / 1000;
      const elapsed = now - this._lastClickTime;

      if (this._lastClickTime > 0 && elapsed < 400) {
        // Double-click confirmed
        if (this._clickTimeout) {
          GLib.source_remove(this._clickTimeout);
          this._clickTimeout = null;
        }
        this._lastClickTime = 0;
        this._toggleVinylForCurrentPlayer();
        return Clutter.EVENT_STOP;
      }

      this._lastClickTime = now;

      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }

      this._clickTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        this._clickTimeout = null;
        return GLib.SOURCE_REMOVE;
      });

      return Clutter.EVENT_STOP;
    }

    // mode display

    _updateMode() {
      if (this._vinylMode) {
        this._normalContainer.hide();
        this._vinylContainer.show();
      } else {
        this._vinylContainer.hide();
        this._normalContainer.show();
      }
    }

    //Vinyl disc drawing

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

    // cover art

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
      const normalStyle = `
              width: 340px;
              height: 340px;
              border-radius: 16px;
              background-image: url('${imageUrl}');
              background-size: contain;
              background-position: center;
              background-repeat: no-repeat;
            `;
      const vinylStyle = `
              width: 340px;
              height: 340px;
              border-radius: 170px;
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
      const ph = "url('resource:///org/gnome/shell/theme/process-working.svg')";

      this._normalCoverImage.style = `
              width: 340px; height: 340px; border-radius: 16px;
              background-size: contain; background-position: center;
              background-repeat: no-repeat;
              background-image: ${ph}; opacity: 0.3;
            `;
      this._vinylCoverImage.style = `
              width: 340px; height: 340px; border-radius: 170px;
              background-size: 100px; background-position: center;
              background-repeat: no-repeat;
              background-image: ${ph}; opacity: 0.3;
            `;
    }

    //rotation

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

      // Move tonearm onto the groove (playing position)
      this._tonearm.moveToPlaying();

      if (this._isRotating) return;

      this._isRotating = true;
      const speed = this._settings.get_int("album-art-rotation-speed");
      const interval = 50; // ms
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

      // Reset disc to home position
      this._rotationAngle = 0;
      if (this._rotatingContainer) this._rotatingContainer.rotation_angle_z = 0;
    }

    pauseRotation() {
      this._isPlaying = false;
      this._isRotating = false;
      this._stopRotationInterval();

      // Park the tonearm — disc angle preserved so resume feels natural
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

      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }

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
