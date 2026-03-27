import St from "gi://St";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import { ScrollingLabel } from "../ui/ScrollingLabel.js";

// Base px/sec; scaled by speed setting (1-10)
const BASE_SCROLL_PX_PER_SEC = 50;
// Pause between scroll loops (ms)
const LOOP_PAUSE_MS = 1200;

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

    this._buildUI();
  }

  _buildUI() {
    this._box = new St.BoxLayout({
      style_class: "panel-status-menu-box panel-button-box",
      style: "spacing: 6px;",
    });
    this._indicator.add_child(this._box);

    // app icon
    this._icon = new St.Icon({
      gicon: Gio.icon_new_for_string("audio-x-generic-symbolic"),
      icon_size: 18,
      y_align: Clutter.ActorAlign.CENTER,
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
      can_focus: true,
      track_hover: true,
      reactive: true,
    });
    btn.set_child(new St.Icon({ icon_name: iconName, icon_size: 14 }));
    return btn;
  }

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

  /**
   * @param {string} fullText   "Title • Artist" combined string
   * @param {Gio.Settings} settings   GSettings instance
   * @param {string} status     "Playing" | "Paused" | "Stopped"
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
      lbl.clutter_text.ellipsize = 3;
      lbl.clutter_text.single_line_mode = true;
      this._labelContainer.add_child(lbl);
      this._labelContainer.show();
      return;
    }

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

  //App icon

  updateAppIcon(manager, currentPlayer) {
    if (this._indicator._state._sessionChanging) return;
    if (!currentPlayer) {
      this._icon.gicon = Gio.icon_new_for_string("audio-x-generic-symbolic");
      return;
    }
    const appInfo = manager.getAppInfo(currentPlayer);
    this._icon.gicon =
      appInfo && appInfo.get_icon()
        ? appInfo.get_icon()
        : Gio.icon_new_for_string("audio-x-generic-symbolic");
  }

  destroy() {
    this.stopScrolling();
  }
}
