import GObject from "gi://GObject";
import St from "gi://St";
import PangoCairo from "gi://PangoCairo";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import Cairo from "cairo";

// Smooth-scroll easing duration (ms)
const SCROLL_EASING_MS = 450;
// Repaint ticker interval — ~60 fps
const TICK_INTERVAL_MS = 16;

const DESKTOP_INTERFACE_SCHEMA = "org.gnome.desktop.interface";
const COLOR_SCHEME_KEY = "color-scheme";

/**
 * Compute font and layout metrics from the widget  current pixel width
 *
 * @param {number} w  widget width in pixels
 * @returns {{ activeSize, neighborSize, inactiveSize, lineSpacing, paddingX }}
 */
function _metricsForWidth(w) {
  // Base design was 340 px,  all values scale linearly with width
  const scale = Math.max(0.7, w / 340);
  const activeSize = Math.round(20 * scale);
  const neighborSize = Math.round(14 * scale);
  const inactiveSize = Math.round(12 * scale);
  const lineSpacing = Math.round(16 * scale);
  const paddingX = Math.round(24 * scale);
  return { activeSize, neighborSize, inactiveSize, lineSpacing, paddingX };
}

export const LyricsWidget = GObject.registerClass(
  {
    GTypeName: "LyricsWidget",
    Signals: {
      dismiss: {},
    },
  },
  class LyricsWidget extends St.Widget {
    /**
     * @param {number}             [width=340]
     * @param {number}             [height=340]
     * @param {Gio.Settings|null}  [settings]   Extension GSettings
     */
    _init(width = 340, height = 340, settings = null) {
      super._init({
        style_class: "lyrics-widget",
        reactive: false,
        can_focus: false,
        width,
        height,
        layout_manager: new Clutter.FixedLayout(),
      });

      this._width = width;
      this._height = height;
      this._settings = settings;
      this._widthChangedId = 0;

      // Canvas
      this._canvas = new St.DrawingArea({
        style: "padding: 0; margin: 0;",
        reactive: false,
        can_focus: false,
        x: 0,
        y: 0,
        width,
        height,
      });
      this._canvas.connectObject(
        "repaint",
        (_area) => this._onRepaint(_area),
        this,
      );
      this.add_child(this._canvas);

      //  Transparent dismiss button
      this._dismissBtn = new St.Button({
        style: "background: transparent; border: none; padding: 0;",
        reactive: true,
        can_focus: false,
        track_hover: false,
        x: 0,
        y: 0,
        width,
        height,
      });
      this._dismissBtn.connectObject(
        "clicked",
        () => this.emit("dismiss"),
        this,
      );
      this.add_child(this._dismissBtn);

      //  Lyrics state
      this._lyrics = [];
      this._lineGeometries = [];
      this._totalHeight = 0;
      this._needsGeometryUpdate = false;

      this._activeIndex = -1;
      this._currentTime = 0; // ms

      // Smooth-scroll state
      this._scrollOffset = 0;
      this._scrollFrom = 0;
      this._scrollTo = 0;
      this._scrollStart = 0;
      this._scrollAnimating = false;

      this._tickId = 0; // GLib timeout source id

      this._state = "loading";
      this._palette = this._buildDefaultPalette();

      // Font config
      this._fontConfig = _metricsForWidth(width);
      this._fontConfigOverride = {};

      //  Theme tracking
      const themeCtx = St.ThemeContext.get_for_stage(global.stage);
      themeCtx.connectObject("changed", () => this._onThemeChanged(), this);

      this._interfaceSettings = null;
      try {
        const schemaSource = Gio.SettingsSchemaSource.get_default();
        if (schemaSource.lookup(DESKTOP_INTERFACE_SCHEMA, true)) {
          this._interfaceSettings = new Gio.Settings({
            schema_id: DESKTOP_INTERFACE_SCHEMA,
          });
          this._interfaceSettings.connectObject(
            `changed::${COLOR_SCHEME_KEY}`,
            () => this._onThemeChanged(),
            this,
          );
        }
      } catch (_e) {
        // Schema unavailable => fall back to ThemeContext::changed only
      }

      this.connectObject(
        "notify::mapped",
        () => {
          if (this.mapped) this._refreshThemeColors();
        },
        this,
      );

      if (this._settings) {
        this._widthChangedId = this._settings.connect(
          "changed::popup-width",
          () => this._onPopupWidthChanged(),
        );
      }
    }

    //  Popup-width setting handler

    _onPopupWidthChanged() {
      if (!this._settings) return;
      try {
        const w = Math.max(280, this._settings.get_int("popup-width"));
        this.setSize(w, w);
      } catch (_e) {}
    }

    /**
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
      if (this._width === width && this._height === height) return;

      this._width = width;
      this._height = height;

      // Resize outer widget
      this.set_width(width);
      this.set_height(height);

      // Resize canvas
      this._canvas.set_width(width);
      this._canvas.set_height(height);

      // Resize dismiss button overlay
      this._dismissBtn.set_width(width);
      this._dismissBtn.set_height(height);

      this._fontConfig = this._buildFontConfig(width);

      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    /**
     * Build a font-config object for the given width, then apply any per-key
     * @param {number} w
     */
    _buildFontConfig(w) {
      const base = _metricsForWidth(w);
      return Object.assign(base, this._fontConfigOverride);
    }

    // Theme helpers

    _buildDefaultPalette() {
      return {
        activeColor: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
        neighborColor: { r: 1.0, g: 1.0, b: 1.0, a: 0.55 },
        inactiveColor: { r: 1.0, g: 1.0, b: 1.0, a: 0.22 },
      };
    }

    _refreshThemeColors() {
      if (!this.mapped) return;

      let fg;
      try {
        fg = this.get_theme_node().get_foreground_color();
      } catch (_e) {
        return;
      }

      const r = fg.red / 255;
      const g = fg.green / 255;
      const b = fg.blue / 255;
      const isDark = this._isDarkMode();

      this._palette = {
        activeColor: { r, g, b, a: isDark ? 1.0 : 0.92 },
        neighborColor: { r, g, b, a: isDark ? 0.55 : 0.5 },
        inactiveColor: { r, g, b, a: isDark ? 0.22 : 0.2 },
      };

      this._canvas.queue_repaint();
    }

    _isDarkMode() {
      if (this._interfaceSettings) {
        const scheme = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        if (scheme === "prefer-dark") return true;
        if (scheme === "prefer-light") return false;
      }
      try {
        const fg = this.get_theme_node().get_foreground_color();
        const lum =
          (fg.red * 299 + fg.green * 587 + fg.blue * 114) / (255 * 1000);
        return lum > 0.5;
      } catch (_e) {
        return true;
      }
    }

    _onThemeChanged() {
      this._refreshThemeColors();
    }

    /**
     * @param {object} config
     * @param {number} [config.activeSize]
     * @param {number} [config.neighborSize]
     * @param {number} [config.inactiveSize]
     * @param {number} [config.spacing]
     */
    updateAppearance(config) {
      if (config.activeSize !== undefined)
        this._fontConfigOverride.activeSize = config.activeSize;
      if (config.neighborSize !== undefined)
        this._fontConfigOverride.neighborSize = config.neighborSize;
      if (config.inactiveSize !== undefined)
        this._fontConfigOverride.inactiveSize = config.inactiveSize;
      if (config.spacing !== undefined)
        this._fontConfigOverride.lineSpacing = config.spacing;

      // Rebuild from current width with the new overrides
      this._fontConfig = this._buildFontConfig(this._width);
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    showLoading() {
      this._stopTick();
      this._state = "loading";
      this._lyrics = [];
      this._lineGeometries = [];
      this._needsGeometryUpdate = false;
      this._canvas.queue_repaint();
    }

    showEmpty() {
      this._stopTick();
      this._state = "empty";
      this._lyrics = [];
      this._lineGeometries = [];
      this._needsGeometryUpdate = false;
      this._canvas.queue_repaint();
    }

    setLyrics(lyrics) {
      this._stopTick();
      if (!lyrics || lyrics.length === 0) {
        this.showEmpty();
        return;
      }
      this._state = "lyrics";
      this._lyrics = lyrics;
      this._activeIndex = -1;
      this._currentTime = 0;
      this._scrollOffset = 0;
      this._scrollFrom = 0;
      this._scrollTo = 0;
      this._scrollAnimating = false;
      this._lineGeometries = [];
      this._needsGeometryUpdate = true;
      this._canvas.queue_repaint();
    }

    /**
     * Update the current playback position
     * Called from MediaControls every ~250 ms
     * @param {number} timeInMs
     */
    updatePosition(timeInMs) {
      if (this._state !== "lyrics") return;

      this._currentTime = timeInMs;

      let newIndex = -1;
      for (let i = 0; i < this._lyrics.length; i++) {
        if (this._lyrics[i].time <= timeInMs) newIndex = i;
        else break;
      }

      if (this._activeIndex !== newIndex) {
        this._activeIndex = newIndex;
        this._invalidateGeometry();
        this._needsGeometryUpdate = true;
        this._canvas.queue_repaint();
      }
    }

    // Backward-compat alias
    setPosition(timeInMs) {
      this.updatePosition(timeInMs);
    }

    // Backward-compat alias
    clear() {
      this.showLoading();
    }

    _invalidateGeometry() {
      this._lineGeometries = [];
      this._totalHeight = 0;
    }

    _startTick() {
      if (this._tickId) return;
      this._tickId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        TICK_INTERVAL_MS,
        () => this._onTick(),
      );
    }

    _stopTick() {
      if (this._tickId) {
        GLib.source_remove(this._tickId);
        this._tickId = 0;
      }
      this._scrollAnimating = false;
    }

    _onTick() {
      if (!this._scrollAnimating) {
        this._tickId = 0;
        return GLib.SOURCE_REMOVE;
      }

      const elapsedMs = (GLib.get_monotonic_time() - this._scrollStart) / 1000;

      if (elapsedMs >= SCROLL_EASING_MS) {
        this._scrollOffset = this._scrollTo;
        this._scrollAnimating = false;
        this._canvas.queue_repaint();
        this._tickId = 0;
        return GLib.SOURCE_REMOVE;
      }

      const t = elapsedMs / SCROLL_EASING_MS;
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this._scrollOffset =
        this._scrollFrom + (this._scrollTo - this._scrollFrom) * ease;

      this._canvas.queue_repaint();
      return GLib.SOURCE_CONTINUE;
    }

    // Cairo repaint

    _onRepaint(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();

      if (!width || !height) {
        cr.$dispose();
        return;
      }

      // Clear to transparent
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();

      const layout = PangoCairo.create_layout(cr);
      const { activeColor, neighborColor, inactiveColor } = this._palette;
      const { activeSize, neighborSize, inactiveSize, lineSpacing, paddingX } =
        this._fontConfig;

      if (this._state !== "lyrics") {
        const msg =
          this._state === "loading" ? "Fetching lyrics…" : "No lyrics found";
        const font = Pango.FontDescription.from_string(
          `Sans Bold ${activeSize}`,
        );
        layout.set_font_description(font);
        layout.set_text(msg, -1);
        layout.set_alignment(Pango.Alignment.CENTER);
        layout.set_width(width * Pango.SCALE);

        const [, logical] = layout.get_extents();
        const textH = logical.height / Pango.SCALE;

        const c = activeColor;
        cr.setSourceRGBA(c.r, c.g, c.b, 0.7);
        cr.moveTo(0, (height - textH) / 2);
        PangoCairo.show_layout(cr, layout);
        cr.$dispose();
        return;
      }

      const TEXT_WIDTH = width - paddingX * 2;

      const needsBuild =
        this._needsGeometryUpdate ||
        (this._lineGeometries.length === 0 && this._lyrics.length > 0);

      if (needsBuild) {
        this._needsGeometryUpdate = false;

        layout.set_width(TEXT_WIDTH * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        layout.set_alignment(Pango.Alignment.CENTER);

        this._lineGeometries = [];
        let cursorY = 0;

        for (let i = 0; i < this._lyrics.length; i++) {
          const active = i === this._activeIndex;
          const neighbor = Math.abs(i - this._activeIndex) === 1;

          let fontSize = inactiveSize;
          if (active) fontSize = activeSize;
          else if (neighbor) fontSize = neighborSize;

          const font = Pango.FontDescription.from_string(
            `Sans Bold ${fontSize}`,
          );
          layout.set_font_description(font);
          layout.set_text(this._lyrics[i].text, -1);

          const [, logical] = layout.get_extents();
          const lineH = logical.height / Pango.SCALE;

          this._lineGeometries.push({
            y: cursorY,
            height: lineH,
            text: this._lyrics[i].text,
            font,
            active,
            neighbor,
          });
          cursorY += lineH + lineSpacing;
        }
        this._totalHeight = Math.max(cursorY - lineSpacing, 0);

        const maxScroll = Math.max(0, this._totalHeight - height);
        let target = this._scrollOffset;

        if (this._activeIndex >= 0) {
          const geo = this._lineGeometries[this._activeIndex];
          const ideal = geo.y + geo.height / 2 - height / 2;
          target = Math.min(Math.max(ideal, 0), maxScroll);
        }

        if (Math.abs(target - this._scrollOffset) >= 1) {
          this._scrollFrom = this._scrollOffset;
          this._scrollTo = target;
          this._scrollStart = GLib.get_monotonic_time();
          this._scrollAnimating = true;
          this._startTick();
        }
      }

      layout.set_width(TEXT_WIDTH * Pango.SCALE);
      layout.set_wrap(Pango.WrapMode.WORD_CHAR);
      layout.set_alignment(Pango.Alignment.CENTER);

      for (const geo of this._lineGeometries) {
        const y = geo.y - this._scrollOffset;

        // Skip lines fully outside the visible area
        if (y + geo.height < -40 || y > height + 40) continue;

        layout.set_font_description(geo.font);
        layout.set_text(geo.text, -1);

        const c = geo.active
          ? activeColor
          : geo.neighbor
            ? neighborColor
            : inactiveColor;

        cr.setSourceRGBA(c.r, c.g, c.b, c.a);
        cr.moveTo(paddingX, y);
        PangoCairo.show_layout(cr, layout);
      }

      cr.$dispose();
    }

    destroy() {
      this._stopTick();

      if (this._widthChangedId && this._settings) {
        this._settings.disconnect(this._widthChangedId);
        this._widthChangedId = 0;
      }

      const themeCtx = St.ThemeContext.get_for_stage(global.stage);
      themeCtx.disconnectObject(this);

      if (this._interfaceSettings) {
        this._interfaceSettings.disconnectObject(this);
        this._interfaceSettings = null;
      }

      if (this._canvas) this._canvas.disconnectObject(this);
      if (this._dismissBtn) this._dismissBtn.disconnectObject(this);
      this.disconnectObject(this); // notify::mapped

      super.destroy();
    }
  },
);
