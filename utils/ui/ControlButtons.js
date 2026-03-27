import St from "gi://St";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";

//  Size helpers

/** @param {Gio.Settings|null} s  @returns {number} popup width in px */
function _pw(s) {
  if (!s) return 340;
  try {
    return Math.max(280, s.get_int("popup-width"));
  } catch (_e) {
    return 340;
  }
}

function _metrics(s) {
  const pw = _pw(s);
  const sidePad = Math.round(pw * 0.04); // ~14 px at 340
  const total = pw - sidePad * 2;
  const spacing = Math.max(4, Math.round(total * 0.04));
  const btnW = Math.round((total - spacing * 4) / 5);
  const btnH = Math.round(btnW * 0.82); // slight portrait shape
  const iconSm = Math.max(14, Math.round(btnW * 0.38)); // shuffle / repeat
  const iconMd = Math.max(16, Math.round(btnW * 0.44)); // prev / next
  const iconLg = Math.max(20, Math.round(btnW * 0.52)); // play/pause
  const playW = Math.round(btnW * 1.18); // play button slightly larger
  const playH = playW;
  const radius = Math.round(btnW * 0.3); // rounded rect
  const padV = Math.max(8, Math.round(btnH * 0.22));
  const padH = Math.max(8, Math.round(btnW * 0.18));
  const playPad = Math.max(10, Math.round(playW * 0.22));

  return {
    spacing,
    btnW,
    btnH,
    iconSm,
    iconMd,
    iconLg,
    playW,
    playH,
    radius,
    padV,
    padH,
    playPad,
  };
}

export const ControlButtons = GObject.registerClass(
  {
    Signals: {
      "play-pause": {},
      next: {},
      previous: {},
      shuffle: {},
      repeat: {},
    },
  },
  class ControlButtons extends St.BoxLayout {
    /**
     * @param {Gio.Settings|null} [settings]  Extension GSettings
     *   re-sizes live when that setting changes
     */
    _init(settings = null) {
      super._init({
        x_align: Clutter.ActorAlign.FILL,
        x_expand: true,
        style: "padding-left: 0; padding-right: 0;",
      });

      this._settings = settings;
      this._widthChangedId = 0;

      this._buildUI();

      if (this._settings) {
        this._widthChangedId = this._settings.connect(
          "changed::popup-width",
          () => this._applyMetrics(),
        );
      }
    }

    _buildUI() {
      const m = _metrics(this._settings);

      // Container spacing and side padding
      this.style = `spacing: ${m.spacing}px; padding: 0 ${Math.round(_pw(this._settings) * 0.04)}px;`;

      this._shuffleBtn = this._makeSecondaryBtn(
        "media-playlist-shuffle-symbolic",
        m.iconSm,
        m,
      );
      this._shuffleBtn.connect("clicked", () => this.emit("shuffle"));

      this._prevBtn = this._makeSecondaryBtn(
        "media-skip-backward-symbolic",
        m.iconMd,
        m,
      );
      this._prevBtn.connect("clicked", () => this.emit("previous"));

      this._playBtn = this._makePlayBtn(
        "media-playback-start-symbolic",
        m.iconLg,
        m,
      );
      this._playBtn.connect("clicked", () => this.emit("play-pause"));

      this._nextBtn = this._makeSecondaryBtn(
        "media-skip-forward-symbolic",
        m.iconMd,
        m,
      );
      this._nextBtn.connect("clicked", () => this.emit("next"));

      this._repeatBtn = this._makeSecondaryBtn(
        "media-playlist-repeat-symbolic",
        m.iconSm,
        m,
      );
      this._repeatBtn.connect("clicked", () => this.emit("repeat"));

      this.add_child(this._shuffleBtn);
      this.add_child(this._prevBtn);
      this.add_child(this._playBtn);
      this.add_child(this._nextBtn);
      this.add_child(this._repeatBtn);
    }

    // Live resize

    _applyMetrics() {
      const m = _metrics(this._settings);
      const pw = _pw(this._settings);

      this.style = `spacing: ${m.spacing}px; padding: 0 ${Math.round(pw * 0.04)}px;`;

      this._resizeSecondary(this._shuffleBtn, m);
      this._resizeSecondary(this._prevBtn, m);
      this._resizePlay(this._playBtn, m);
      this._resizeSecondary(this._nextBtn, m);
      this._resizeSecondary(this._repeatBtn, m);
    }

    _resizeSecondary(btn, m) {
      btn.style = _secondaryStyle(m);
      btn.set_width(m.btnW);
      btn.set_height(m.btnH);
      if (btn.child) btn.child.icon_size = m.iconSm;
    }

    _resizePlay(btn, m) {
      btn.style = _playStyle(m);
      btn.set_width(m.playW);
      btn.set_height(m.playH);
      if (btn.child) btn.child.icon_size = m.iconLg;
    }

    //  Button factories

    _makeSecondaryBtn(iconName, iconSize, m) {
      const btn = new St.Button({
        style_class: "media-button-modern",
        style: _secondaryStyle(m),
        width: m.btnW,
        height: m.btnH,
        x_expand: true,
        child: new St.Icon({
          icon_name: iconName,
          icon_size: iconSize,
          style_class: "media-icon",
        }),
        can_focus: true,
        track_hover: true,
      });

      btn.connect("enter-event", () => {
        btn.style = _secondaryHoverStyle(m);
      });
      btn.connect("leave-event", () => {
        btn.style = _secondaryStyle(m);
      });

      return btn;
    }

    _makePlayBtn(iconName, iconSize, m) {
      const btn = new St.Button({
        style_class: "media-play-button-modern",
        style: _playStyle(m),
        width: m.playW,
        height: m.playH,
        x_expand: true,
        child: new St.Icon({
          icon_name: iconName,
          icon_size: iconSize,
          style: "color: #ffffff;",
        }),
        can_focus: true,
        track_hover: true,
      });

      btn.connect("enter-event", () => {
        btn.style = _playHoverStyle(m);
      });
      btn.connect("leave-event", () => {
        btn.style = _playStyle(m);
      });

      return btn;
    }

    updateButtons(info) {
      // Play/pause icon
      this._playBtn.child.icon_name =
        info.status === "Playing"
          ? "media-playback-pause-symbolic"
          : "media-playback-start-symbolic";

      // Shuffle
      const m = _metrics(this._settings);

      if (info.shuffle) {
        this._shuffleBtn.add_style_class_name("active");
        this._shuffleBtn.style = _activeStyle(m);
        this._shuffleBtn.child.style = "color: #1db954;";
      } else {
        this._shuffleBtn.remove_style_class_name("active");
        this._shuffleBtn.style = _secondaryStyle(m);
        this._shuffleBtn.child.style_class = "media-icon";
        this._shuffleBtn.child.style = "";
      }

      //  Repeat
      if (info.loopStatus === "Track") {
        this._repeatBtn.child.icon_name = "media-playlist-repeat-song-symbolic";
        this._repeatBtn.add_style_class_name("active");
        this._repeatBtn.style = _activeStyle(m);
        this._repeatBtn.child.style = "color: #1db954;";
      } else if (info.loopStatus === "Playlist") {
        this._repeatBtn.child.icon_name = "media-playlist-repeat-symbolic";
        this._repeatBtn.add_style_class_name("active");
        this._repeatBtn.style = _activeStyle(m);
        this._repeatBtn.child.style = "color: #1db954;";
      } else {
        this._repeatBtn.child.icon_name = "media-playlist-repeat-symbolic";
        this._repeatBtn.remove_style_class_name("active");
        this._repeatBtn.style = _secondaryStyle(m);
        this._repeatBtn.child.style_class = "media-icon";
        this._repeatBtn.child.style = "";
      }
    }

    destroy() {
      if (this._widthChangedId && this._settings) {
        this._settings.disconnect(this._widthChangedId);
        this._widthChangedId = 0;
      }
      super.destroy();
    }
  },
);

function _secondaryStyle(m) {
  return `
    width: ${m.btnW}px;
    height: ${m.btnH}px;
    padding: ${m.padV}px ${m.padH}px;
    border-radius: ${m.radius}px;
    background-color: rgba(127,127,127,0.15);
    border: 1px solid rgba(127,127,127,0.10);
  `;
}

function _secondaryHoverStyle(m) {
  return `
    width: ${m.btnW}px;
    height: ${m.btnH}px;
    padding: ${m.padV}px ${m.padH}px;
    border-radius: ${m.radius}px;
    background-color: rgba(127,127,127,0.25);
    border: 1px solid rgba(127,127,127,0.20);
    transform: scale(1.05);
  `;
}

function _activeStyle(m) {
  return `
    width: ${m.btnW}px;
    height: ${m.btnH}px;
    padding: ${m.padV}px ${m.padH}px;
    border-radius: ${m.radius}px;
    background-color: rgba(29,185,84,0.20);
    border: 1px solid rgba(29,185,84,0.30);
  `;
}

function _playStyle(m) {
  return `
    width: ${m.playW}px;
    height: ${m.playH}px;
    padding: ${m.playPad}px;
    border-radius: 50%;
    background: linear-gradient(135deg,rgba(255,255,255,0.20) 0%,rgba(255,255,255,0.10) 100%);
    box-shadow: 0 4px 16px rgba(0,0,0,0.30);
  `;
}

function _playHoverStyle(m) {
  return `
    width: ${m.playW}px;
    height: ${m.playH}px;
    padding: ${m.playPad}px;
    border-radius: 50%;
    background: linear-gradient(135deg,rgba(255,255,255,0.25) 0%,rgba(255,255,255,0.15) 100%);
    box-shadow: 0 6px 20px rgba(0,0,0,0.40);
    transform: scale(1.08);
  `;
}
