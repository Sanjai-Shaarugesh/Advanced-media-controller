import St from "gi://St";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import { ScrollingLabel } from "../ui/ScrollingLabel.js";
import { resolveGicon } from "../icon/IconResolver.js";

// Base px/sec scrolling speed; scaled by the "scroll-speed" setting (1-10)
const BASE_SCROLL_PX_PER_SEC = 50;
// Pause between scroll loop iterations (ms)
const LOOP_PAUSE_MS = 1200;

//  GSettings for theme detection
const INTERFACE_SCHEMA = "org.gnome.desktop.interface";
const INTERFACE_KEY = "color-scheme";
const GTK_THEME_KEY = "gtk-theme";

// Theme detection

/**
 * Return true when the shell is running a dark colour scheme
 * Supports GNOME 40-50
 * @returns {boolean}
 */
function _isDarkTheme() {
  try {
    const s = new Gio.Settings({ schema_id: INTERFACE_SCHEMA });
    const keys = s.list_keys();
    if (keys.indexOf(INTERFACE_KEY) !== -1)
      return s.get_string(INTERFACE_KEY) === "prefer-dark";
    if (keys.indexOf(GTK_THEME_KEY) !== -1)
      return s.get_string(GTK_THEME_KEY).toLowerCase().includes("dark");
  } catch (_) {}
  return true;
}

/** @param {Gio.Settings} settings @returns {number} */
function _labelWidth(settings) {
  try {
    return Math.max(60, settings.get_int("panel-label-width"));
  } catch (_e) {
    return 160;
  }
}

export class PanelUI {
  constructor(indicator) {
    this._indicator = indicator;
    this._scrollLabel = null;
    this._settings = null;
    this._status = "Stopped";

    // Theme state
    this._dark = _isDarkTheme();
    this._themeSettings = null;
    this._themeSettingsId = 0;

    this._buildUI();
    this._watchTheme();
  }

  //  Theme watcher

  _watchTheme() {
    try {
      this._themeSettings = new Gio.Settings({ schema_id: INTERFACE_SCHEMA });
      const keys = this._themeSettings.list_keys();
      const key =
        keys.indexOf(INTERFACE_KEY) !== -1 ? INTERFACE_KEY : GTK_THEME_KEY;

      this._themeSettingsId = this._themeSettings.connect(
        `changed::${key}`,
        () => {
          this._dark = _isDarkTheme();
          this._applyButtonTheme();
        },
      );
    } catch (_) {
      this._themeSettings = null;
      this._themeSettingsId = 0;
    }
  }

  // Re-apply button styles after theme switch
  _applyButtonTheme() {
    if (this._panelPrevBtn)
      this._panelPrevBtn.style = _panelButtonStyle(this._dark);
    if (this._panelPlayBtn)
      this._panelPlayBtn.style = _panelButtonStyle(this._dark);
    if (this._panelNextBtn)
      this._panelNextBtn.style = _panelButtonStyle(this._dark);
  }

  _buildUI() {
    this._box = new St.BoxLayout({
      style_class: "panel-status-menu-box panel-button-box",
      style: "spacing: 6px;",
    });
    this._indicator.add_child(this._box);

    // icon_size 18 px → 36 px physical on HiDPI; GNOME Shell handles scaling
    this._icon = new St.Icon({
      gicon: Gio.ThemedIcon.new("audio-x-generic-symbolic"),
      icon_size: 18,
      y_align: Clutter.ActorAlign.CENTER,
      // Prefer scalable (SVG) icons at any DPI via the themed-icon pipeline
      style: "icon-style: requested;",
    });
    this._box.add_child(this._icon);

    this._panelControlsBox = new St.BoxLayout({
      style_class: "panel-controls-box",
      style: "spacing: 2px;",
    });
    this._box.add_child(this._panelControlsBox);

    this._panelPrevBtn = this._makeButton("media-skip-backward-symbolic");
    this._panelControlsBox.add_child(this._panelPrevBtn);

    this._panelPlayBtn = this._makeButton("media-playback-start-symbolic");
    this._panelControlsBox.add_child(this._panelPlayBtn);

    this._panelNextBtn = this._makeButton("media-skip-forward-symbolic");
    this._panelControlsBox.add_child(this._panelNextBtn);

    this._labelContainer = new St.BoxLayout({
      y_align: Clutter.ActorAlign.CENTER,
      style: "margin-left: 6px;",
    });
    this._labelContainer.hide();
    this._box.add_child(this._labelContainer);
  }

  _makeButton(iconName) {
    const btn = new St.Button({
      style_class: "panel-media-button",
      style: _panelButtonStyle(this._dark),
      can_focus: true,
      track_hover: true,
      reactive: true,
    });
    btn.set_child(new St.Icon({ icon_name: iconName, icon_size: 14 }));
    return btn;
  }

  //  Accessors

  get box() {
    return this._box;
  }
  get icon() {
    return this._icon;
  }
  get panelPrevBtn() {
    return this._panelPrevBtn;
  }
  get panelPlayBtn() {
    return this._panelPlayBtn;
  }
  get panelNextBtn() {
    return this._panelNextBtn;
  }

  get label() {
    if (!this._labelShim) {
      this._labelShim = {
        show: () => {
          this._labelContainer.show();
        },
        hide: () => {
          this._labelContainer.hide();
          this.stopScrolling();
        },
      };
    }
    return this._labelShim;
  }

  //  Track label / scrolling

  /**
   * @param {string}       fullText   "Title • Artist" combined string
   * @param {Gio.Settings} settings   GSettings instance
   * @param {string}       status     "Playing" | "Paused" | "Stopped"
   */
  startScrolling(fullText, settings, status = "Playing") {
    if (!fullText) {
      this.stopScrolling();
      return;
    }

    this._settings = settings;
    this._status = status;

    const labelW = _labelWidth(settings);
    const isPlaying = status === "Playing";
    const enabled = settings.get_boolean("enable-panel-scroll");

    if (!isPlaying || !enabled) {
      // Static label
      if (this._scrollLabel) {
        this._scrollLabel.destroy();
        this._scrollLabel = null;
      }
      this._labelContainer.destroy_all_children();

      const lbl = new St.Label({
        text: fullText,
        y_align: Clutter.ActorAlign.CENTER,
        style: `font-size: 13px; max-width: ${labelW}px;`,
      });
      lbl.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
      lbl.clutter_text.single_line_mode = true;
      this._labelContainer.add_child(lbl);
      this._labelContainer.show();
      return;
    }

    // Scrolling label
    const speed = this._calcSpeed(settings);

    if (this._scrollLabel) {
      this._scrollLabel.setScrollSpeed(speed);
      this._scrollLabel.setText(fullText);

      if (this._scrollLabel._viewW !== labelW) {
        this._scrollLabel.destroy();
        this._scrollLabel = null;
        this._labelContainer.destroy_all_children();
      } else {
        this._labelContainer.show();
        return;
      }
    }

    this._labelContainer.destroy_all_children();
    this._scrollLabel = new ScrollingLabel({
      text: fullText,
      viewportWidth: labelW,
      isScrolling: true,
      initPaused: false,
      scrollSpeed: speed,
      scrollPauseTime: LOOP_PAUSE_MS,
      textStyle: "font-size: 13px;",
    });
    this._labelContainer.add_child(this._scrollLabel);
    this._labelContainer.show();
  }

  _calcSpeed(settings) {
    const pref = settings.get_int("scroll-speed");
    return Math.round(BASE_SCROLL_PX_PER_SEC * (pref / 5));
  }

  stopScrolling() {
    if (this._scrollLabel) {
      this._scrollLabel.destroy();
      this._scrollLabel = null;
    }
    this._labelContainer.destroy_all_children();
    this._settings = null;
  }

  //  App icon panel bar

  /**
   * @param {object}      manager        MprisManager instance
   * @param {string|null} currentPlayer  MPRIS bus name
   */

  updateAppIcon(manager, currentPlayer) {
    if (this._indicator._state._sessionChanging) return;

    if (!currentPlayer) {
      this._icon.gicon = Gio.ThemedIcon.new("audio-x-generic-symbolic");
      return;
    }

    this._icon.gicon = resolveGicon(currentPlayer, manager);
  }

  destroy() {
    // Disconnect theme watcher
    if (this._themeSettings && this._themeSettingsId) {
      try {
        this._themeSettings.disconnect(this._themeSettingsId);
      } catch (_) {}
      this._themeSettingsId = 0;
      this._themeSettings = null;
    }

    this.stopScrolling();
    this._labelShim = null;
    this._indicator = null;
  }
}

/**
 * @param {boolean} dark
 * @returns {string}
 */
function _panelButtonStyle(dark) {
  return "padding: 2px 4px; border-radius: 5px;";
}
