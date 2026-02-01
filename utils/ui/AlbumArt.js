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
        style: "margin-bottom: 0px;",
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

      // Container for vinyl mode (circular with tonearm)
      this._vinylContainer = new St.Widget({
        style: "width: 340px; height: 340px;",
        layout_manager: new Clutter.FixedLayout(),
      });

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

      this._vinylLayer.connect("repaint", (area) => {
        this._drawVinylLayer(area);
      });

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

      // Tonearm (static)
      this._tonearm = new St.DrawingArea({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
      });

      this._tonearm.connect("repaint", (area) => {
        this._drawTonearm(area);
      });

      // Add layers to vinyl container
      this._vinylContainer.add_child(this._rotatingContainer);
      this._vinylContainer.add_child(this._tonearm);

      // Add both containers to main layout
      this.add_child(this._normalContainer);
      this.add_child(this._vinylContainer);

      // Show/hide based on current mode
      this._updateMode();
    }

    _onRotationSettingChanged() {
      const newVinylMode = this._settings.get_boolean("enable-album-art-rotation");
      
      if (newVinylMode !== this._vinylMode) {
        this._vinylMode = newVinylMode;
        
        // Stop any ongoing rotation
        this.stopRotation();
        
        // Reload current cover in new mode
        if (this._currentArtUrl) {
          this.loadCover(this._currentArtUrl, true);
        }
        
        // Update visibility
        this._updateMode();
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

      // Vinyl grooves
      cr.setLineWidth(0.6);
      for (let i = 0; i < 15; i++) {
        const grooveRadius = radius - 5 - (i * 2);
        cr.arc(centerX, centerY, grooveRadius, 0, 2 * Math.PI);
        const alpha = i % 2 === 0 ? 0.2 : 0.1;
        cr.setSourceRGBA(0, 0, 0, alpha);
        cr.stroke();
      }

      cr.$dispose();
    }

    _drawTonearm(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = width / 2;

      // Tonearm at top-right
      const armBaseX = centerX + radius * 0.7;
      const armBaseY = centerY - radius * 0.7;
      const armLength = 90;
      const armAngle = Math.PI / 3.5;

      // Base
      cr.arc(armBaseX, armBaseY, 7, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.75, 0.75, 0.75, 0.95);
      cr.fill();

      cr.arc(armBaseX, armBaseY, 9, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.55, 0.55, 0.55, 0.8);
      cr.setLineWidth(1.5);
      cr.stroke();

      // Arm
      const armEndX = armBaseX - armLength * Math.cos(armAngle);
      const armEndY = armBaseY + armLength * Math.sin(armAngle);

      cr.setLineWidth(3.5);
      cr.moveTo(armBaseX, armBaseY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.68, 0.68, 0.68, 0.95);
      cr.stroke();

      cr.setLineWidth(1.2);
      cr.moveTo(armBaseX, armBaseY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.88, 0.88, 0.88, 0.7);
      cr.stroke();

      // Cartridge
      const headshellLength = 18;
      const headshellEndX = armEndX - headshellLength * Math.cos(armAngle);
      const headshellEndY = armEndY + headshellLength * Math.sin(armAngle);

      cr.setLineWidth(4.5);
      cr.moveTo(armEndX, armEndY);
      cr.lineTo(headshellEndX, headshellEndY);
      cr.setSourceRGBA(0.62, 0.62, 0.62, 1);
      cr.stroke();

      // Needle
      cr.arc(headshellEndX, headshellEndY, 3, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.95, 0.95, 0.95, 1);
      cr.fill();

      cr.arc(headshellEndX, headshellEndY, 5, 0, 2 * Math.PI);
      cr.setSourceRGBA(1, 1, 1, 0.35);
      cr.fill();

      cr.$dispose();
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
        background-size: cover;
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
        background-size: 128px;
        background-position: center;
        background-repeat: no-repeat;
        background-image: url('resource:///org/gnome/shell/theme/process-working.svg');
        opacity: 0.3;
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
      this._isRotating = false;

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
      this._isRotating = false;
      
      if (this._rotationInterval) {
        GLib.source_remove(this._rotationInterval);
        this._rotationInterval = null;
      }
    }

    destroy() {
      this.stopRotation();
      
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }
      
      this._coverCache.clear();
      this._currentArtUrl = null;
      super.destroy();
    }
  },
);