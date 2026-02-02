import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene";
import Cairo from "cairo";

export const AlbumArt = GObject.registerClass(
  class AlbumArt extends St.BoxLayout {
    _init(settings) {
      super._init({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._settings = settings;
      this._coverCache = new Map();
      this._currentArtUrl = null;
      this._rotationAngle = 0;
      this._rotationInterval = null;
      this._isRotating = false;
      this._vinylMode = this._settings.get_boolean("enable-album-art-rotation");
      this._isPlaying = false;
      this._tonearmAngle = 25; // Start position (away from record)
      this._tonearmTargetAngle = 25;
      this._tonearmAnimationId = null;
      
      // Double-click detection
      this._lastClickTime = 0;
      this._clickTimeout = null;
      
      this._buildUI();
      
      // Listen for settings changes
      this._settingsChangedId = this._settings.connect("changed::enable-album-art-rotation", () => {
        this._onRotationSettingChanged();
      });
    }

    _buildUI() {
      // Container for normal mode (square album art)
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
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
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

      // Add click handler for normal mode
      this._normalContainer.connectObject(
        "button-press-event",
        (actor, event) => this._onAlbumArtClicked(event),
        this,
      );

      // Container for vinyl mode (circular with tonearm)
      this._vinylContainer = new St.Widget({
        style: "width: 340px; height: 340px;",
        layout_manager: new Clutter.FixedLayout(),
        reactive: true,
      });

      // Add click handler for vinyl mode
      this._vinylContainer.connectObject(
        "button-press-event",
        (actor, event) => this._onAlbumArtClicked(event),
        this,
      );

      // Rotating container for vinyl
      this._rotatingContainer = new St.Widget({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        layout_manager: new Clutter.FixedLayout(),
      });

      // Vinyl layer with grooves
      this._vinylLayer = new St.DrawingArea({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        style: "border-radius: 170px;",
      });

      this._vinylLayer.connectObject("repaint", (area) => {
        this._drawVinylLayer(area);
      }, this);

      // Album art for vinyl mode (circular)
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

      // Add to rotating container
      this._rotatingContainer.add_child(this._vinylLayer);
      this._rotatingContainer.add_child(this._vinylCoverArt);

      // Tonearm container (for rotation)
      this._tonearmContainer = new St.Widget({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        layout_manager: new Clutter.FixedLayout(),
      });

      // Tonearm drawing area
      this._tonearm = new St.DrawingArea({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
      });

      this._tonearm.connectObject("repaint", (area) => {
        this._drawTonearm(area);
      }, this);

      this._tonearmContainer.add_child(this._tonearm);

      // Add layers to vinyl container
      this._vinylContainer.add_child(this._rotatingContainer);
      this._vinylContainer.add_child(this._tonearmContainer);

      // Add both containers to main layout
      this.add_child(this._normalContainer);
      this.add_child(this._vinylContainer);

      // Show/hide based on current mode
      this._updateMode();
    }

    _onAlbumArtClicked(event) {
      if (event.get_button() !== 1) {
        return Clutter.EVENT_PROPAGATE;
      }

      const currentTime = GLib.get_monotonic_time() / 1000;
      const timeSinceLastClick = currentTime - this._lastClickTime;

      // Double-click detected (within 400ms)
      if (timeSinceLastClick < 400) {
        // Remove pending single-click timeout
        if (this._clickTimeout) {
          GLib.source_remove(this._clickTimeout);
          this._clickTimeout = null;
        }

        // Toggle vinyl mode
        const newMode = !this._vinylMode;
        this._settings.set_boolean("enable-album-art-rotation", newMode);

        this._lastClickTime = 0;
        return Clutter.EVENT_STOP;
      }

      this._lastClickTime = currentTime;

      // Remove existing timeout before creating new one
      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }

      // Wait to see if it's a double-click
      this._clickTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        this._clickTimeout = null;
        return GLib.SOURCE_REMOVE;
      });

      return Clutter.EVENT_STOP;
    }

    _onRotationSettingChanged() {
      const newVinylMode = this._settings.get_boolean("enable-album-art-rotation");
      
      if (newVinylMode !== this._vinylMode) {
        const wasPlaying = this._isPlaying;
        
        this._vinylMode = newVinylMode;
        
        // Stop any ongoing rotation
        this.stopRotation();
        
        // Update visibility
        this._updateMode();
        
        // Reload current cover in new mode
        if (this._currentArtUrl) {
          this.loadCover(this._currentArtUrl, true);
        }
        
        // Restore playback state
        if (this._vinylMode && wasPlaying) {
          // Restart rotation if we were playing
          this.startRotation(true);
        } else if (this._vinylMode && !wasPlaying) {
          // Just position the tonearm correctly
          this._moveTonearm(25);
        }
      }
    }

    _updateMode() {
      if (this._vinylMode) {
        // Show vinyl mode, hide normal mode
        this._normalContainer.hide();
        this._vinylContainer.show();
      } else {
        // Show normal mode, hide vinyl mode
        this._vinylContainer.hide();
        this._normalContainer.show();
      }
    }

    _drawVinylLayer(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = width / 2;

      // Full vinyl disc background
      const gradient = new Cairo.RadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius
      );
      gradient.addColorStopRGBA(0, 0.12, 0.12, 0.12, 1);
      gradient.addColorStopRGBA(0.8, 0.08, 0.08, 0.08, 1);
      gradient.addColorStopRGBA(1, 0.05, 0.05, 0.05, 1);

      cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      cr.setSource(gradient);
      cr.fill();

      // Vinyl grooves - more realistic
      cr.setLineWidth(0.5);
      for (let i = 0; i < 20; i++) {
        const grooveRadius = radius - 10 - (i * 1.5);
        if (grooveRadius > 0) {
          cr.arc(centerX, centerY, grooveRadius, 0, 2 * Math.PI);
          const alpha = (i % 3 === 0) ? 0.15 : 0.08;
          cr.setSourceRGBA(0, 0, 0, alpha);
          cr.stroke();
        }
      }

      // Center label area
      const labelRadius = radius * 0.25;
      const labelGradient = new Cairo.RadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        labelRadius
      );
      labelGradient.addColorStopRGBA(0, 0.2, 0.2, 0.2, 1);
      labelGradient.addColorStopRGBA(1, 0.15, 0.15, 0.15, 1);
      
      cr.arc(centerX, centerY, labelRadius, 0, 2 * Math.PI);
      cr.setSource(labelGradient);
      cr.fill();

      // Center hole
      cr.arc(centerX, centerY, 8, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.05, 0.05, 0.05, 1);
      cr.fill();

      cr.$dispose();
    }

    _drawTonearm(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = width / 2;

      // Tonearm pivot point (top-right area)
      const pivotX = centerX + radius * 0.75;
      const pivotY = centerY - radius * 0.75;
      
      // Convert angle to radians (0-10 = on record, 25+ = away from record)
      const angleRad = (this._tonearmAngle * Math.PI) / 180;
      const armLength = 95;

      // Calculate tonearm end position
      const armEndX = pivotX - armLength * Math.cos(angleRad);
      const armEndY = pivotY + armLength * Math.sin(angleRad);

      // Draw pivot base (larger, more detailed)
      // Outer ring (shadow)
      cr.arc(pivotX, pivotY, 11, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.2, 0.2, 0.2, 0.4);
      cr.fill();

      // Base plate
      cr.arc(pivotX, pivotY, 10, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.45, 0.45, 0.45, 0.9);
      cr.fill();

      // Inner ring
      cr.arc(pivotX, pivotY, 7.5, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.65, 0.65, 0.65, 0.95);
      cr.fill();

      // Center point (screw)
      cr.arc(pivotX, pivotY, 4, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.35, 0.35, 0.35, 1);
      cr.fill();

      // Screw slot detail
      cr.setLineWidth(1);
      cr.moveTo(pivotX - 2.5, pivotY);
      cr.lineTo(pivotX + 2.5, pivotY);
      cr.setSourceRGBA(0.1, 0.1, 0.1, 0.8);
      cr.stroke();

      // Main tonearm tube shadow
      cr.setLineWidth(5.5);
      cr.moveTo(pivotX + 1, pivotY + 1);
      cr.lineTo(armEndX + 1, armEndY + 1);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.stroke();

      // Main tonearm tube (metallic look)
      cr.setLineWidth(4.5);
      cr.moveTo(pivotX, pivotY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.55, 0.55, 0.58, 0.95);
      cr.stroke();

      // Highlight on tonearm (metallic shine)
      cr.setLineWidth(1.5);
      cr.moveTo(pivotX, pivotY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.85, 0.85, 0.88, 0.6);
      cr.stroke();

      // Headshell (cartridge holder)
      const headshellLength = 20;
      const headshellEndX = armEndX - headshellLength * Math.cos(angleRad);
      const headshellEndY = armEndY + headshellLength * Math.sin(angleRad);

      // Headshell shadow
      cr.setLineWidth(6.5);
      cr.moveTo(armEndX + 0.5, armEndY + 0.5);
      cr.lineTo(headshellEndX + 0.5, headshellEndY + 0.5);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.stroke();

      // Headshell body
      cr.setLineWidth(5.5);
      cr.moveTo(armEndX, armEndY);
      cr.lineTo(headshellEndX, headshellEndY);
      cr.setSourceRGBA(0.5, 0.5, 0.52, 1);
      cr.stroke();

      // Headshell detail
      cr.setLineWidth(2);
      cr.moveTo(armEndX, armEndY);
      cr.lineTo(headshellEndX, headshellEndY);
      cr.setSourceRGBA(0.75, 0.75, 0.77, 0.7);
      cr.stroke();

      // Cartridge body (more realistic shape)
      const cartridgeRadius = 4.5;
      
      // Cartridge shadow
      cr.arc(headshellEndX + 0.5, headshellEndY + 0.5, cartridgeRadius + 1, 0, 2 * Math.PI);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.fill();
      
      // Cartridge body
      cr.arc(headshellEndX, headshellEndY, cartridgeRadius, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.3, 0.3, 0.32, 1);
      cr.fill();

      // Cartridge top highlight
      cr.arc(headshellEndX - 1, headshellEndY - 1, cartridgeRadius * 0.6, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.5, 0.5, 0.52, 0.6);
      cr.fill();

      // Stylus (needle)
      const stylusLength = 6;
      const stylusEndX = headshellEndX - stylusLength * Math.cos(angleRad);
      const stylusEndY = headshellEndY + stylusLength * Math.sin(angleRad);

      cr.setLineWidth(1.2);
      cr.moveTo(headshellEndX, headshellEndY);
      cr.lineTo(stylusEndX, stylusEndY);
      cr.setSourceRGBA(0.9, 0.9, 0.92, 1);
      cr.stroke();

      // Stylus tip
      cr.arc(stylusEndX, stylusEndY, 1.5, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.95, 0.95, 0.95, 1);
      cr.fill();

      // Glow effect on stylus tip when playing
      if (this._isPlaying && this._tonearmAngle < 15) {
        cr.arc(stylusEndX, stylusEndY, 3.5, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.fill();
      }

      // Counterweight (on the opposite end of tonearm)
      const counterweightX = pivotX + 25 * Math.cos(angleRad);
      const counterweightY = pivotY - 25 * Math.sin(angleRad);
      
      cr.arc(counterweightX, counterweightY, 6, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.4, 0.4, 0.42, 0.95);
      cr.fill();
      
      cr.arc(counterweightX, counterweightY, 4, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.6, 0.6, 0.62, 0.8);
      cr.fill();

      cr.$dispose();
    }

    _moveTonearm(targetAngle) {
      this._tonearmTargetAngle = targetAngle;
      
      // Stop any existing animation
      if (this._tonearmAnimationId) {
        GLib.source_remove(this._tonearmAnimationId);
        this._tonearmAnimationId = null;
      }

      // Animate tonearm movement
      const startAngle = this._tonearmAngle;
      const angleDiff = this._tonearmTargetAngle - startAngle;
      const duration = 600; // milliseconds
      const fps = 60;
      const steps = (duration / 1000) * fps;
      let currentStep = 0;

      this._tonearmAnimationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 / fps, () => {
        currentStep++;
        const progress = currentStep / steps;
        
        // Easing function (ease-in-out)
        const easeProgress = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        this._tonearmAngle = startAngle + (angleDiff * easeProgress);
        
        // Redraw tonearm
        if (this._tonearm) {
          this._tonearm.queue_repaint();
        }

        if (currentStep >= steps) {
          this._tonearmAngle = this._tonearmTargetAngle;
          this._tonearmAnimationId = null;
          return GLib.SOURCE_REMOVE;
        }

        return GLib.SOURCE_CONTINUE;
      });
    }

    loadCover(url, forceRefresh = false) {
      if (!forceRefresh && this._currentArtUrl === url) {
        return;
      }

      this._currentArtUrl = url;

      if (!forceRefresh) {
        const cached = this._coverCache.get(url);
        if (cached) {
          this._applyCoverStyle(cached);
          return;
        }
      }

      let imageUrl = url;

      if (url.startsWith("file://")) {
        imageUrl = url;
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        this._downloadCover(url);
        return;
      } else {
        imageUrl = `file://${url}`;
      }

      this._setCoverImage(imageUrl);
    }

    _setCoverImage(imageUrl) {
      // Normal mode style (square with rounded corners)
      const normalStyle = `
        width: 340px;
        height: 340px;
        border-radius: 16px;
        background-image: url('${imageUrl}');
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
      `;

      // Vinyl mode style (circular)
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

      this._coverCache.set(imageUrl, { normal: normalStyle, vinyl: vinylStyle });
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

      const source = Gio.File.new_for_uri(url);
      source.copy_async(
        cacheFile,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_LOW,
        null,
        null,
        (src, res) => {
          try {
            src.copy_finish(res);
            this._setCoverImage(`file://${cachePath}`);
          } catch (e) {
            console.error("Failed to download cover:", e);
          }
        },
      );
    }

    setDefaultCover() {
      this._currentArtUrl = null;
      
      const normalDefault = `
        width: 340px;
        height: 340px;
        border-radius: 16px;
        background-image: url('file://${cachePath}');
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
      `;

      const vinylDefault = `
        width: 340px;
        height: 340px;
        border-radius: 170px;
        background-size: 100px;
        background-position: center;
        background-repeat: no-repeat;
        background-image: url('resource:///org/gnome/shell/theme/process-working.svg');
        opacity: 0.3;
      `;

      this._normalCoverImage.style = normalDefault;
      this._vinylCoverImage.style = vinylDefault;
    }

    startRotation(isPlaying = true) {
      this._isPlaying = isPlaying;

      // Only rotate in vinyl mode
      if (!this._vinylMode) {
        this.stopRotation();
        return;
      }

      if (!this._settings.get_boolean("enable-album-art-rotation")) {
        this.stopRotation();
        return;
      }

      if (!isPlaying) {
        this.stopRotation();
        return;
      }

      // Move tonearm onto record when playing
      this._moveTonearm(8);

      if (this._isRotating) {
        return;
      }

      this._isRotating = true;
      const rotationSpeed = this._settings.get_int("album-art-rotation-speed");
      
      const interval = 50;
      const degreesPerInterval = (360 / (rotationSpeed * 1000)) * interval;

      this._rotationInterval = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
        if (!this._isRotating) {
          return GLib.SOURCE_REMOVE;
        }

        this._rotationAngle = (this._rotationAngle + degreesPerInterval) % 360;
        this._rotatingContainer.rotation_angle_z = this._rotationAngle;

        return GLib.SOURCE_CONTINUE;
      });
    }

    stopRotation() {
      this._isPlaying = false;
      this._isRotating = false;

      // Move tonearm away from record when stopped
      if (this._vinylMode) {
        this._moveTonearm(25);
      }

      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }

      this._rotationAngle = 0;
      if (this._rotatingContainer) {
        this._rotatingContainer.rotation_angle_z = 0;
      }
    }

    pauseRotation() {
      this._isPlaying = false;
      this._isRotating = false;
      
      // Move tonearm away from record when paused
      if (this._vinylMode) {
        this._moveTonearm(25);
      }
      
      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }
    }

    destroy() {
      this.stopRotation();
      
      // Remove tonearm animation
      if (this._tonearmAnimationId) {
        GLib.source_remove(this._tonearmAnimationId);
        this._tonearmAnimationId = null;
      }

      // Remove click timeout
      if (this._clickTimeout) {
        GLib.source_remove(this._clickTimeout);
        this._clickTimeout = null;
      }
      
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }

      // Disconnect objects
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
