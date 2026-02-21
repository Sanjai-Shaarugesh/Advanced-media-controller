import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene";
import Cairo from "cairo";

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a desktop-entry ID from a MPRIS bus name.
 * Prefers the manager's cached desktop-entry map, falls back to the
 * bus-name suffix (e.g. "org.mpris.MediaPlayer2.spotify" → "spotify").
 */
function _resolveAppId(playerName, manager) {
  if (!playerName) return null;
  if (manager) {
    const de = manager._desktopEntries?.get(playerName);
    if (de) return de;
  }
  return playerName.replace(/^org\.mpris\.MediaPlayer2\./, "") || null;
}

function _getVinylApps(settings) {
  try {
    return settings.get_strv("vinyl-app-ids") ?? [];
  } catch (_e) {
    return [];
  }
}

function _setVinylApps(settings, ids) {
  try {
    settings.set_strv("vinyl-app-ids", ids);
  } catch (_e) {}
}

// ---------------------------------------------------------------------------
// AlbumArt widget
// ---------------------------------------------------------------------------

export const AlbumArt = GObject.registerClass(
  class AlbumArt extends St.BoxLayout {
    /**
     * @param {Gio.Settings} settings
     * @param {object|null}  manager    – MprisManager instance
     * @param {string|null}  playerName – current MPRIS bus name
     */
    _init(settings, manager = null, playerName = null) {
      super._init({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._settings   = settings;
      this._manager    = manager;
      this._playerName = playerName;
      this._isDestroyed = false;

      this._coverCache       = new Map();
      this._currentArtUrl    = null;
      this._rotationAngle    = 0;
      this._rotationInterval = null;
      this._isRotating       = false;
      this._isPlaying        = false;

      // Per-app vinyl mode — derived from vinyl-app-ids setting.
      this._vinylMode = this._isVinylEnabledForCurrentPlayer();

      this._tonearmAngle       = 25;
      this._tonearmTargetAngle = 25;
      this._tonearmAnimationId = null;

      // Double-click: track timestamps, never use a timeout to absorb events.
      this._lastClickTime = 0;  // GLib monotonic ms
      this._clickTimeout  = null;

      this._buildUI();

      // React when the per-app list changes (e.g. from the prefs window).
      this._settingsChangedId = this._settings.connect(
        "changed::vinyl-app-ids",
        () => {
          if (!this._isDestroyed) this._onVinylAppsSettingChanged();
        },
      );
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Call when the active player changes so vinyl mode is recomputed. */
    setPlayer(manager, playerName) {
      this._manager    = manager;
      this._playerName = playerName;
      if (!this._isDestroyed) this._onVinylAppsSettingChanged();
    }

    // ── Per-app vinyl helpers ─────────────────────────────────────────────────

    _isVinylEnabledForCurrentPlayer() {
      const appId = _resolveAppId(this._playerName, this._manager);
      if (!appId) return false;
      return _getVinylApps(this._settings).some(
        (id) => id.toLowerCase() === appId.toLowerCase(),
      );
    }

    _toggleVinylForCurrentPlayer() {
      const appId = _resolveAppId(this._playerName, this._manager);
      if (!appId) {
        // No resolvable app — toggle the global legacy key as a fallback.
        const cur = this._settings.get_boolean("enable-album-art-rotation");
        this._settings.set_boolean("enable-album-art-rotation", !cur);
        return;
      }

      const list = _getVinylApps(this._settings);
      const idx  = list.findIndex(
        (id) => id.toLowerCase() === appId.toLowerCase(),
      );
      if (idx >= 0)
        list.splice(idx, 1);
      else
        list.push(appId);

      // Writing back fires 'changed::vinyl-app-ids' → _onVinylAppsSettingChanged.
      _setVinylApps(this._settings, list);
    }

    _onVinylAppsSettingChanged() {
      const newVinyl = this._isVinylEnabledForCurrentPlayer();
      if (newVinyl === this._vinylMode) return;

      const wasPlaying = this._isPlaying;
      this._vinylMode  = newVinyl;

      this.stopRotation();
      this._updateMode();

      if (this._currentArtUrl)
        this.loadCover(this._currentArtUrl, true);

      if (this._vinylMode && wasPlaying)
        this.startRotation(true);
      else if (this._vinylMode)
        this._moveTonearm(25);
    }

    // ── UI construction ───────────────────────────────────────────────────────

    _buildUI() {
      // ── Normal (square) mode ──────────────────────────────────────────────
      this._normalContainer = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        // CSS cursor property is the correct way to change the pointer inside
        // a GNOME Shell popup — no compositor grab or Meta.Cursor needed.
        style: "margin-bottom: 24px; cursor: pointer;",
        reactive: true,
      });

      this._normalCoverArt = new St.Bin({
        style_class: "media-album-art",
        style: `
          width: 340px; height: 340px;
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

      // Connect events — always return EVENT_PROPAGATE so the popup menu
      // keeps working and GNOME Shell's event loop is never starved.
      this._normalContainer.connectObject(
        "button-press-event",   (_a, ev) => this._onButtonPress(ev),
        "button-release-event", (_a, _ev) => this._onButtonRelease(),
        "enter-event",          (_a, _ev) => this._onEnter(),
        "leave-event",          (_a, _ev) => this._onLeave(),
        this,
      );

      // ── Vinyl (circular) mode ─────────────────────────────────────────────
      this._vinylContainer = new St.Widget({
        style: "width: 340px; height: 340px; cursor: pointer;",
        layout_manager: new Clutter.FixedLayout(),
        reactive: true,
      });

      this._vinylContainer.connectObject(
        "button-press-event",   (_a, ev) => this._onButtonPress(ev),
        "button-release-event", (_a, _ev) => this._onButtonRelease(),
        "enter-event",          (_a, _ev) => this._onEnter(),
        "leave-event",          (_a, _ev) => this._onLeave(),
        this,
      );

      this._rotatingContainer = new St.Widget({
        width: 340, height: 340, x: 0, y: 0,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        layout_manager: new Clutter.FixedLayout(),
      });

      this._vinylLayer = new St.DrawingArea({
        width: 340, height: 340, x: 0, y: 0,
        style: "border-radius: 170px;",
      });
      this._vinylLayer.connectObject(
        "repaint", (area) => this._drawVinylLayer(area), this,
      );

      this._vinylCoverArt = new St.Bin({
        style_class: "media-album-art",
        x: 0, y: 0,
        style: `
          width: 340px; height: 340px;
          border-radius: 170px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `,
      });
      this._vinylCoverImage = new St.Widget({
        style_class: "cover-art-image",
        width: 340, height: 340,
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

      this._tonearmContainer = new St.Widget({
        width: 340, height: 340, x: 0, y: 0,
        layout_manager: new Clutter.FixedLayout(),
      });
      this._tonearm = new St.DrawingArea({
        width: 340, height: 340, x: 0, y: 0,
      });
      this._tonearm.connectObject(
        "repaint", (area) => this._drawTonearm(area), this,
      );
      this._tonearmContainer.add_child(this._tonearm);

      this._vinylContainer.add_child(this._rotatingContainer);
      this._vinylContainer.add_child(this._tonearmContainer);

      this.add_child(this._normalContainer);
      this.add_child(this._vinylContainer);

      this._updateMode();
    }

    // ── Cursor management ─────────────────────────────────────────────────────
    //
    // The correct way to change the pointer cursor inside a GNOME Shell
    // extension popup is via the CSS `cursor` property on the St widget's
    // style string.  Clutter.Cursor / Meta.Cursor both require a compositor-
    // level pointer grab that a popup-menu widget cannot own, so they silently
    // fail (or crash).  St respects standard CSS cursor keywords:
    //   "pointer"  – hand, shown on hover
    //   "grabbing" – closed fist, shown while button is held

    _setCursorStyle(name) {
      // Update the inline style of both containers, preserving their existing
      // non-cursor style rules by only replacing the cursor declaration.
      const normal = this._normalContainer.style ?? "";
      const vinyl  = this._vinylContainer.style  ?? "";

      // Remove any previous cursor declaration then append the new one.
      const strip  = (s) => s.replace(/\s*cursor\s*:[^;]*;?/g, "").trim();
      this._normalContainer.style = strip(normal) + ` cursor: ${name};`;
      this._vinylContainer.style  = strip(vinyl)  + ` cursor: ${name};`;
    }

    _onEnter() {
      this._setCursorStyle("pointer");
      return Clutter.EVENT_PROPAGATE;
    }

    _onLeave() {
      this._setCursorStyle("default");
      return Clutter.EVENT_PROPAGATE;
    }

    _onButtonPress(event) {
      if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

      // Show closed-fist cursor while button is held.
      this._setCursorStyle("grabbing");

      // Record click for double-click detection.
      // Always propagate — returning EVENT_STOP inside a popup menu breaks
      // the Shell's pointer grab and can force a session logout.
      this._recordClick();

      return Clutter.EVENT_PROPAGATE;
    }

    _onButtonRelease() {
      // Restore hand cursor on release.
      this._setCursorStyle("pointer");
      return Clutter.EVENT_PROPAGATE;
    }

    // ── Double-click detection ────────────────────────────────────────────────
    //
    // We track timestamps ourselves rather than relying on Clutter's
    // multi-click flags, because popup-menu widgets can suppress those.
    // No GLib timeout is used for the detection window — we just compare
    // monotonic timestamps on each press.  The optional 400 ms reset timer
    // only clears _lastClickTime so stale first-clicks don't accidentally
    // pair with a future click much later.

    _recordClick() {
      const now     = GLib.get_monotonic_time() / 1000; // µs → ms
      const elapsed = now - this._lastClickTime;

      // Cancel any pending reset timer.
      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }

      if (this._lastClickTime > 0 && elapsed < 400) {
        // ── Double-click confirmed ────────────────────────────────────────
        this._lastClickTime = 0;
        this._toggleVinylForCurrentPlayer();
        return;
      }

      // ── First click — arm a reset timer ──────────────────────────────────
      this._lastClickTime = now;

      // After 400 ms with no second click, forget the first click.
      this._clickTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        this._lastClickTime = 0;
        this._clickTimeout  = null;
        return GLib.SOURCE_REMOVE;
      });
    }

    // ── Mode display ──────────────────────────────────────────────────────────

    _updateMode() {
      if (this._vinylMode) {
        this._normalContainer.hide();
        this._vinylContainer.show();
      } else {
        this._vinylContainer.hide();
        this._normalContainer.show();
      }
    }

    // ── Drawing ───────────────────────────────────────────────────────────────

    _drawVinylLayer(area) {
      const cr = area.get_context();
      const [w, h] = area.get_surface_size();
      const cx = w / 2, cy = h / 2, r = w / 2;

      // Disc background gradient
      const bg = new Cairo.RadialGradient(cx, cy, 0, cx, cy, r);
      bg.addColorStopRGBA(0,   0.12, 0.12, 0.12, 1);
      bg.addColorStopRGBA(0.3, 0.08, 0.08, 0.08, 1);
      bg.addColorStopRGBA(1,   0.05, 0.05, 0.05, 1);
      cr.arc(cx, cy, r, 0, 2 * Math.PI);
      cr.setSource(bg);
      cr.fill();

      // Vinyl grooves
      for (let i = 0; i < 20; i++) {
        cr.arc(cx, cy, r * 0.45 + (r * 0.5 * i) / 20, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.03);
        cr.setLineWidth(0.5);
        cr.stroke();
      }

      // Centre label ring
      cr.arc(cx, cy, r * 0.28, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.15, 0.15, 0.15, 1);
      cr.fill();

      // Centre hole
      cr.arc(cx, cy, r * 0.04, 0, 2 * Math.PI);
      cr.setSourceRGBA(0, 0, 0, 1);
      cr.fill();

      cr.$dispose();
    }

    _drawTonearm(area) {
      const cr = area.get_context();
      const [w, h] = area.get_surface_size();
      const px = w * 0.85, py = h * 0.08;
      const len = h * 0.62;
      const ang = (this._tonearmAngle * Math.PI) / 180;
      const tx = px + Math.sin(ang) * len;
      const ty = py + Math.cos(ang) * len;

      // Drop shadow
      cr.save();
      cr.translate(2, 2);
      cr.setSourceRGBA(0, 0, 0, 0.4);
      cr.setLineWidth(4);
      cr.moveTo(px, py); cr.lineTo(tx, ty);
      cr.stroke();
      cr.restore();

      // Arm body
      const g = new Cairo.LinearGradient(px - 5, py, px + 5, py + len);
      g.addColorStopRGBA(0,   0.8, 0.8, 0.8, 1);
      g.addColorStopRGBA(0.5, 0.6, 0.6, 0.6, 1);
      g.addColorStopRGBA(1,   0.4, 0.4, 0.4, 1);
      cr.setSource(g);
      cr.setLineWidth(4);
      cr.moveTo(px, py); cr.lineTo(tx, ty);
      cr.stroke();

      // Pivot circles
      cr.arc(px, py, 8, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.5, 0.5, 0.5, 1); cr.fill();
      cr.arc(px, py, 4, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.8, 0.8, 0.8, 1); cr.fill();

      // Stylus tip
      cr.arc(tx, ty, 3, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.9, 0.2, 0.2, 1); cr.fill();

      cr.$dispose();
    }

    // ── Tonearm animation ─────────────────────────────────────────────────────

    _moveTonearm(targetAngle) {
      this._tonearmTargetAngle = targetAngle;

      if (this._tonearmAnimationId) {
        GLib.source_remove(this._tonearmAnimationId);
        this._tonearmAnimationId = null;
      }

      const start = this._tonearmAngle;
      const diff  = targetAngle - start;
      const fps   = 60;
      const steps = (600 / 1000) * fps; // 600 ms animation
      let   step  = 0;

      this._tonearmAnimationId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        Math.round(1000 / fps),
        () => {
          if (this._isDestroyed) return GLib.SOURCE_REMOVE;

          step++;
          const p    = step / steps;
          const ease = p < 0.5
            ? 2 * p * p
            : 1 - Math.pow(-2 * p + 2, 2) / 2;

          this._tonearmAngle = start + diff * ease;
          this._tonearm?.queue_repaint();

          if (step >= steps) {
            this._tonearmAngle       = targetAngle;
            this._tonearmAnimationId = null;
            return GLib.SOURCE_REMOVE;
          }
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    // ── Cover art ─────────────────────────────────────────────────────────────

    loadCover(url, forceRefresh = false) {
      if (!forceRefresh && this._currentArtUrl === url) return;

      this._currentArtUrl = url;

      if (!forceRefresh) {
        const cached = this._coverCache.get(url);
        if (cached) { this._applyCoverStyle(cached); return; }
      }

      if (
        url.startsWith("file://") ||
        (!url.startsWith("http://") && !url.startsWith("https://"))
      ) {
        this._setCoverImage(url.startsWith("file://") ? url : `file://${url}`);
      } else {
        this._downloadCover(url);
      }
    }

    _setCoverImage(imageUrl) {
      const n = `
        width: 340px; height: 340px; border-radius: 16px;
        background-image: url('${imageUrl}');
        background-size: contain; background-position: center;
        background-repeat: no-repeat;
      `;
      const v = `
        width: 340px; height: 340px; border-radius: 170px;
        background-image: url('${imageUrl}');
        background-size: cover; background-position: center;
        background-repeat: no-repeat;
      `;
      this._normalCoverImage.style = n;
      this._vinylCoverImage.style  = v;
      this._coverCache.set(imageUrl, { normal: n, vinyl: v });
    }

    _applyCoverStyle(styles) {
      this._normalCoverImage.style = styles.normal;
      this._vinylCoverImage.style  = styles.vinyl;
    }

    _downloadCover(url) {
      const hash = GLib.compute_checksum_for_string(
        GLib.ChecksumType.MD5, url, -1,
      );
      const dir  = GLib.build_filenamev([
        GLib.get_user_cache_dir(), "mpris-covers",
      ]);
      GLib.mkdir_with_parents(dir, 0o755);
      const path = GLib.build_filenamev([dir, hash]);
      const file = Gio.File.new_for_path(path);

      if (file.query_exists(null)) {
        this._setCoverImage(`file://${path}`);
        return;
      }

      this.setDefaultCover();
      Gio.File.new_for_uri(url).copy_async(
        file,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_LOW,
        null,
        null,
        (src, res) => {
          if (this._isDestroyed) return;
          try {
            src.copy_finish(res);
            this._setCoverImage(`file://${path}`);
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

    // ── Rotation ──────────────────────────────────────────────────────────────

    startRotation(isPlaying = true) {
      this._isPlaying = isPlaying;

      if (!this._vinylMode) {
        if (this._rotationInterval) {
          GLib.source_remove(this._rotationInterval);
          this._rotationInterval = null;
        }
        this._isRotating = false;
        return;
      }

      if (!isPlaying) { this.pauseRotation(); return; }

      this._moveTonearm(8);
      if (this._isRotating) return;

      this._isRotating = true;
      const speed   = this._settings.get_int("album-art-rotation-speed");
      const intv    = 50; // ms
      const degPer  = (360 / (speed * 1000)) * intv;

      this._rotationInterval = GLib.timeout_add(
        GLib.PRIORITY_LOW, intv, () => {
          if (this._isDestroyed || !this._isRotating) return GLib.SOURCE_REMOVE;
          this._rotationAngle = (this._rotationAngle + degPer) % 360;
          if (this._rotatingContainer)
            this._rotatingContainer.rotation_angle_z = this._rotationAngle;
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    stopRotation() {
      this._isPlaying  = false;
      this._isRotating = false;

      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }
      if (this._vinylMode) this._moveTonearm(25);

      this._rotationAngle = 0;
      if (this._rotatingContainer)
        this._rotatingContainer.rotation_angle_z = 0;
    }

    pauseRotation() {
      this._isPlaying  = false;
      this._isRotating = false;

      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }
      if (this._vinylMode) this._moveTonearm(25);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    destroy() {
      this._isDestroyed = true;

      // Stop all GLib main-loop sources — required by review guidelines.
      this.stopRotation();

      if (this._tonearmAnimationId) {
        GLib.source_remove(this._tonearmAnimationId);
        this._tonearmAnimationId = null;
      }
      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }

      // Disconnect settings signal.
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }

      // Disconnect all connectObject signals in one call each.
      this._normalContainer?.disconnectObject(this);
      this._vinylContainer?.disconnectObject(this);
      this._vinylLayer?.disconnectObject(this);
      this._tonearm?.disconnectObject(this);

      this._coverCache.clear();
      this._currentArtUrl = null;
      super.destroy();
    }
  },
);