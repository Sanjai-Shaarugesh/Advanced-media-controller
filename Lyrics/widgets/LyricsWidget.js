import GObject from "gi://GObject";
import St from "gi://St";
import PangoCairo from "gi://PangoCairo";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import Cairo from "cairo";

// Smooth-scroll duration (ms)
const SCROLL_EASING_MS = 380;

const NEIGHBOR_RANGE = 1;

const DESKTOP_INTERFACE_SCHEMA = "org.gnome.desktop.interface";
const COLOR_SCHEME_KEY = "color-scheme";

function _metricsForWidth(w) {
  const scale = Math.max(0.7, w / 340);
  return {
    activeSize: Math.round(20 * scale),
    neighborSize: Math.round(14 * scale),
    inactiveSize: Math.round(12 * scale),
    lineSpacing: Math.round(16 * scale),
    paddingX: Math.round(24 * scale),
  };
}

export const LyricsWidget = GObject.registerClass(
  {
    GTypeName: "LyricsWidget",
    Signals: { dismiss: {} },
  },
  class LyricsWidget extends St.Widget {
    _init(width = 340, height = 340, settings = null) {
      super._init({
        style_class: "lyrics-widget",
        reactive: false,
        can_focus: false,
        width,
        height,
        layout_manager: new Clutter.FixedLayout(),

        offscreen_redirect: Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY,
      });

      this._width = width;
      this._height = height;
      this._settings = settings;
      this._widthChangedId = 0;

      // Canvas
      this._canvas = new St.DrawingArea({
        style: "padding:0;margin:0;",
        reactive: false,
        can_focus: false,
        x: 0,
        y: 0,
        width,
        height,
      });
      this._canvas.connectObject("repaint", (_a) => this._onRepaint(_a), this);
      this.add_child(this._canvas);

      // Dismiss button overlay
      this._dismissBtn = new St.Button({
        style: "background:transparent;border:none;padding:0;",
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

      // Lyrics state
      this._lyrics = [];
      this._lineGeometries = [];
      this._totalHeight = 0;
      this._dirtyGeometry = false;

      this._activeIndex = -1;
      this._currentTime = 0; // ms

      // Scroll offset
      this._scrollOffset = 0;

      this._state = "loading";
      this._palette = this._buildDefaultPalette();

      this._fontConfig = _metricsForWidth(width);
      this._fontConfigOverride = {};

      // Theme tracking
      const themeCtx = St.ThemeContext.get_for_stage(global.stage);
      themeCtx.connectObject("changed", () => this._onThemeChanged(), this);

      this._interfaceSettings = null;
      try {
        const src = Gio.SettingsSchemaSource.get_default();
        if (src.lookup(DESKTOP_INTERFACE_SCHEMA, true)) {
          this._interfaceSettings = new Gio.Settings({
            schema_id: DESKTOP_INTERFACE_SCHEMA,
          });
          this._interfaceSettings.connectObject(
            `changed::${COLOR_SCHEME_KEY}`,
            () => this._onThemeChanged(),
            this,
          );
        }
      } catch (_e) {}

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

    // Size

    _onPopupWidthChanged() {
      if (!this._settings) return;
      try {
        const w = Math.max(280, this._settings.get_int("popup-width"));
        this.setSize(w, w);
      } catch (_e) {}
    }

    setSize(width, height) {
      if (this._width === width && this._height === height) return;
      this._width = width;
      this._height = height;
      this.set_width(width);
      this.set_height(height);
      this._canvas.set_width(width);
      this._canvas.set_height(height);
      this._dismissBtn.set_width(width);
      this._dismissBtn.set_height(height);
      this._fontConfig = this._buildFontConfig(width);
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    _buildFontConfig(w) {
      return Object.assign(_metricsForWidth(w), this._fontConfigOverride);
    }

    //  Theme

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
      const r = fg.red / 255,
        g = fg.green / 255,
        b = fg.blue / 255;
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
        const s = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        if (s === "prefer-dark") return true;
        if (s === "prefer-light") return false;
      }
      try {
        const fg = this.get_theme_node().get_foreground_color();
        return (
          (fg.red * 299 + fg.green * 587 + fg.blue * 114) / (255 * 1000) > 0.5
        );
      } catch (_e) {
        return true;
      }
    }

    _onThemeChanged() {
      this._refreshThemeColors();
    }

    updateAppearance(config) {
      if (config.activeSize !== undefined)
        this._fontConfigOverride.activeSize = config.activeSize;
      if (config.neighborSize !== undefined)
        this._fontConfigOverride.neighborSize = config.neighborSize;
      if (config.inactiveSize !== undefined)
        this._fontConfigOverride.inactiveSize = config.inactiveSize;
      if (config.spacing !== undefined)
        this._fontConfigOverride.lineSpacing = config.spacing;
      this._fontConfig = this._buildFontConfig(this._width);
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    showLoading() {
      this._state = "loading";
      this._lyrics = [];
      this._lineGeometries = [];
      this._dirtyGeometry = false;
      this._canvas.queue_repaint();
    }

    showEmpty() {
      this._state = "empty";
      this._lyrics = [];
      this._lineGeometries = [];
      this._dirtyGeometry = false;
      this._canvas.queue_repaint();
    }

    setLyrics(lyrics) {
      if (!lyrics || lyrics.length === 0) {
        this.showEmpty();
        return;
      }
      this._state = "lyrics";
      this._lyrics = lyrics;
      this._activeIndex = -1;
      this._currentTime = 0;
      this._scrollOffset = 0;
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    /**
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
        this._canvas.queue_repaint();
      }
    }

    setPosition(ms) {
      this.updatePosition(ms);
    }
    clear() {
      this.showLoading();
    }

    //  Geometry

    _invalidateGeometry() {
      this._lineGeometries = [];
      this._totalHeight = 0;
      this._dirtyGeometry = true;
    }

    _smoothScrollTo(target) {
      if (Math.abs(target - this._scrollOffset) < 1) return;

      if (this._scrollEaseId) {
        GLib.source_remove(this._scrollEaseId);
        this._scrollEaseId = 0;
      }

      const from = this._scrollOffset;
      const diff = target - from;
      const start = GLib.get_monotonic_time();

      this._scrollEaseId = GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE, 8, () => {
        if (!this.mapped || this._state !== "lyrics") {
          this._scrollOffset = target;
          this._canvas.queue_repaint();
          this._scrollEaseId = 0;
          return GLib.SOURCE_REMOVE;
        }

        const elapsed = (GLib.get_monotonic_time() - start) / 1000;
        const t = Math.min(1, elapsed / SCROLL_EASING_MS);
        // Ease-out cubic
        const ease = 1 - Math.pow(1 - t, 3);
        this._scrollOffset = from + diff * ease;
        this._canvas.queue_repaint();

        if (t >= 1) {
          this._scrollOffset = target;
          this._scrollEaseId = 0;
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }

    // Cairo repaint

    _onRepaint(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();

      if (!width || !height) {
        cr.$dispose();
        return;
      }

      // Clear
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

      // Rebuild geometry lazily
      if (this._dirtyGeometry || this._lineGeometries.length === 0) {
        this._dirtyGeometry = false;
        layout.set_width(TEXT_WIDTH * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        layout.set_alignment(Pango.Alignment.CENTER);

        this._lineGeometries = [];
        let cursorY = 0;

        for (let i = 0; i < this._lyrics.length; i++) {
          const dist = Math.abs(i - this._activeIndex);
          const active = dist === 0;
          const neighbor = dist <= NEIGHBOR_RANGE && dist > 0;
          const fontSize = active
            ? activeSize
            : neighbor
              ? neighborSize
              : inactiveSize;

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

        // Compute target scroll
        const maxScroll = Math.max(0, this._totalHeight - height);
        let target = this._scrollOffset;
        if (this._activeIndex >= 0 && this._lineGeometries[this._activeIndex]) {
          const geo = this._lineGeometries[this._activeIndex];
          const ideal = geo.y + geo.height / 2 - height / 2;
          target = Math.min(Math.max(ideal, 0), maxScroll);
        }

        this._smoothScrollTo(target);
      }

      // Draw lines
      layout.set_width(TEXT_WIDTH * Pango.SCALE);
      layout.set_wrap(Pango.WrapMode.WORD_CHAR);
      layout.set_alignment(Pango.Alignment.CENTER);

      for (const geo of this._lineGeometries) {
        const y = geo.y - this._scrollOffset;
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
      if (this._scrollEaseId) {
        GLib.source_remove(this._scrollEaseId);
        this._scrollEaseId = 0;
      }

      if (this._widthChangedId && this._settings) {
        this._settings.disconnect(this._widthChangedId);
        this._widthChangedId = 0;
      }

      St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
      if (this._interfaceSettings) {
        this._interfaceSettings.disconnectObject(this);
        this._interfaceSettings = null;
      }
      if (this._canvas) this._canvas.disconnectObject(this);
      if (this._dismissBtn) this._dismissBtn.disconnectObject(this);
      this.disconnectObject(this);

      super.destroy();
    }
  },
);
