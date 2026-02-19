import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import St from "gi://St";
import GLib from "gi://GLib";

const FRAME_MS = 16; // ~60 fps

export const ScrollingLabel = GObject.registerClass(
  { GTypeName: "AMCScrollingLabel" },
  class ScrollingLabel extends St.Widget {
    /**
     * @param {object}  params
     * @param {string}  params.text              – text to display / scroll
     * @param {number}  params.viewportWidth     – visible pixel width
     * @param {boolean} [params.isScrolling]     – enable scrolling (default true)
     * @param {boolean} [params.initPaused]      – start paused (default false)
     * @param {number}  [params.scrollSpeed]     – px/second (default 50)
     * @param {number}  [params.scrollPauseTime] – ms pause between loops (default 1200)
     * @param {string}  [params.textStyle]       – inline CSS for the inner St.Label
     */
    _init(params = {}) {
      super._init({
        clip_to_allocation: true,
        x_expand: false,
        y_expand: false,
        reactive: false,
      });

      this._origText = params.text ?? "";
      this._viewW = params.viewportWidth ?? 280;
      this._isScrolling = params.isScrolling ?? true;
      this._paused = params.initPaused ?? false;
      this._speed = Math.max(10, params.scrollSpeed ?? 50);
      this._pauseMs = Math.max(0, params.scrollPauseTime ?? 1200);
      this._textStyle = params.textStyle ?? "";

      this._pxPerFrame = (this._speed / 1000) * FRAME_MS;
      this._oneWidth = 0;

      this._measureId = null;
      this._pauseId = null;
      this._tickId = null;
      this._mappedSigId = null;

      this._buildUI();
    }

    _buildUI() {
      this.set_width(this._viewW);

      this._label = new St.Label({
        text: this._origText,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
        style: this._textStyle,
      });
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
      this._label.clutter_text.single_line_mode = true;

      this.add_child(this._label);

      this._mappedSigId = this.connect("notify::mapped", () => {
        if (this.is_mapped()) {
          this.disconnect(this._mappedSigId);
          this._mappedSigId = null;
          this._scheduleMeasure();
        }
      });

      if (this.is_mapped()) {
        this.disconnect(this._mappedSigId);
        this._mappedSigId = null;
        this._scheduleMeasure();
      }
    }

    _scheduleMeasure() {
      if (this._measureId !== null) return;
      this._measureId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._measureId = null;
        this._measure();
        return GLib.SOURCE_REMOVE;
      });
    }

    _measure() {
      if (!this._label) return;

      const labelW = this._label.width;

      if (!this._isScrolling || labelW <= this._viewW || this._viewW <= 0) {
        this._label.x_align = Clutter.ActorAlign.CENTER;
        this._label.x_expand = true;
        return;
      }

      this._label.text = this._origText + "   " + this._origText;

      this._measureId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._measureId = null;
        this._startLoop();
        return GLib.SOURCE_REMOVE;
      });
    }

    _startLoop() {
      if (!this._label) return;

      this._oneWidth = Math.ceil(this._label.width / 2);
      this._label.translation_x = 0;

      if (this._paused) return;
      this._scheduleAfterPause(true);
    }

    _scheduleAfterPause(firstLoop = false) {
      this._stopTickAndPause();

      const delay = firstLoop && this._pauseMs === 0 ? 0 : this._pauseMs;

      if (delay > 0) {
        this._pauseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
          this._pauseId = null;
          if (!this._paused) this._startTick();
          return GLib.SOURCE_REMOVE;
        });
      } else {
        this._startTick();
      }
    }

    _startTick() {
      if (this._tickId !== null) return;

      this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
        if (this._paused || !this._label) {
          this._tickId = null;
          return GLib.SOURCE_REMOVE;
        }

        const next = this._label.translation_x - this._pxPerFrame;

        if (-next >= this._oneWidth) {
          this._label.translation_x = 0;
          this._tickId = null;
          this._scheduleAfterPause(false);
          return GLib.SOURCE_REMOVE;
        }

        this._label.translation_x = next;
        return GLib.SOURCE_CONTINUE;
      });
    }

    pauseScrolling() {
      this._paused = true;
      this._stopTickAndPause();
    }

    resumeScrolling() {
      if (!this._paused) return;
      this._paused = false;
      if (this._oneWidth > 0) this._startTick();
    }

    setText(text) {
      if (text === this._origText) return;
      this._stopAll();
      this._oneWidth = 0;
      this._origText = text;
      if (this._label) {
        this._label.text = text;
        this._label.translation_x = 0;
      }
      this._scheduleMeasure();
    }

    setScrollSpeed(pxPerSec) {
      this._speed = Math.max(10, pxPerSec);
      this._pxPerFrame = (this._speed / 1000) * FRAME_MS;
    }

    _stopTickAndPause() {
      if (this._tickId !== null) {
        GLib.source_remove(this._tickId);
        this._tickId = null;
      }
      if (this._pauseId !== null) {
        GLib.source_remove(this._pauseId);
        this._pauseId = null;
      }
    }

    _stopAll() {
      this._stopTickAndPause();
      if (this._measureId !== null) {
        GLib.source_remove(this._measureId);
        this._measureId = null;
      }
    }

    destroy() {
      this._stopAll();
      if (this._mappedSigId !== null) {
        this.disconnect(this._mappedSigId);
        this._mappedSigId = null;
      }
      super.destroy();
    }
  },
);
