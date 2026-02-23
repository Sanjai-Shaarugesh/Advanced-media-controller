import St from "gi://St";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

export const ProgressSlider = GObject.registerClass(
  {
    Signals: {
      seek: { param_types: [GObject.TYPE_DOUBLE] },
      "drag-begin": {},
      "drag-end": {},
    },
  },
  class ProgressSlider extends St.BoxLayout {
    _init() {
      super._init({
        vertical: true,
        style: "spacing: 10px; margin-bottom: 20px;",
      });

      this._updateInterval = null;
      this._resumeTimeout = null;
      this._sliderDragging = false;
      this._currentPosition = 0;
      this._trackLength = 0;
      this._isPlaying = false;
      this._playerName = null;
      this._trackId = null;
      this._canSeek = true;
      this._isDestroyed = false;

      // Per-player snapshot so switching tabs never causes a jump or flicker.
      this._playerCache = new Map();

      this._buildUI();
    }

    _buildUI() {
      const sliderContainer = new St.BoxLayout({ style: "margin: 0 8px;" });

      this._positionSlider = new Slider.Slider(0);
      this._positionSlider.accessible_name = "Position";

      this._sliderChangedId = this._positionSlider.connect(
        "notify::value",
        () => {
          if (this._sliderDragging) this._updateTimeLabel();
        },
      );

      this._positionSlider.connect("drag-begin", () => {
        this._sliderDragging = true;
        this.stopPositionUpdate();
        this.emit("drag-begin");
      });

      this._positionSlider.connect("drag-end", () => {
        if (!this._sliderDragging) return;
        this._sliderDragging = false;
        const pos = this._positionSlider.value * this._trackLength;
        this.emit("seek", pos / 1_000_000);
        this.emit("drag-end");
        this._saveCacheForCurrentPlayer();

        if (this._resumeTimeout) {
          GLib.source_remove(this._resumeTimeout);
          this._resumeTimeout = null;
        }
        this._resumeTimeout = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          200,
          () => {
            this._resumeTimeout = null;
            if (!this._isDestroyed && this._isPlaying)
              this.startPositionUpdate();
            return GLib.SOURCE_REMOVE;
          },
        );
      });

      sliderContainer.add_child(this._positionSlider);
      this.add_child(sliderContainer);

      const timeBox = new St.BoxLayout({ style: "margin: 0 8px;" });

      this._currentTimeLabel = new St.Label({
        text: "0:00",
        style:
          "font-size:12px;font-weight:600;color:color-mix(in srgb,currentColor 70%,transparent);",
      });
      this._totalTimeLabel = new St.Label({
        text: "0:00",
        style:
          "font-size:12px;font-weight:600;color:color-mix(in srgb,currentColor 50%,transparent);",
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
      });

      timeBox.add_child(this._currentTimeLabel);
      timeBox.add_child(this._totalTimeLabel);
      this.add_child(timeBox);
    }

    setPlayerName(name) {
      if (this._playerName === name) return;
      this._saveCacheForCurrentPlayer();
      this._playerName = name;
      this._restoreCacheForCurrentPlayer();
    }

    updatePlaybackState(isPlaying, metadata, _status) {
      if (this._isDestroyed) return;
      this._isPlaying = isPlaying;

      if (metadata) {
        this._trackLength = metadata["mpris:length"] || 0;
        this._trackId = metadata["mpris:trackid"] || null;
        this._totalTimeLabel.text = this._formatTime(
          this._trackLength / 1_000_000,
        );

        if (!this._trackId || !this._trackLength) {
          this._canSeek = false;
          this._positionSlider.reactive = false;
          this.visible = false;
          return;
        }
        this._canSeek = true;
        this._positionSlider.reactive = true;
        this.visible = true;
      }

      if (isPlaying) this.startPositionUpdate();
      else this.stopPositionUpdate();
    }

    startPositionUpdate() {
      if (this._isDestroyed) return;
      this.stopPositionUpdate();
      this._updateSliderPosition();

      this._updateInterval = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        1000,
        () => {
          if (this._isDestroyed) return GLib.SOURCE_REMOVE;
          if (!this._sliderDragging && this._isPlaying)
            this._updateSliderPosition();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    stopPositionUpdate() {
      if (this._updateInterval) {
        GLib.source_remove(this._updateInterval);
        this._updateInterval = null;
      }
    }

    onSeeked(position) {
      if (this._isDestroyed) return;
      this._currentPosition = position;
      if (!this._sliderDragging) {
        this._applyPosition(position);
        this._saveCacheForCurrentPlayer();
      }
    }

    _hardReset() {
      this.stopPositionUpdate();
      this._currentPosition = 0;
      this._sliderDragging = false;

      this._positionSlider.block_signal_handler(this._sliderChangedId);
      this._positionSlider.value = 0;
      this._positionSlider.unblock_signal_handler(this._sliderChangedId);

      this._currentTimeLabel.text = "0:00";
      this._totalTimeLabel.text = "0:00";
    }

    get currentPosition() {
      return this._currentPosition;
    }
    get trackLength() {
      return this._trackLength;
    }
    set trackLength(v) {
      this._trackLength = v;
    }
    get sliderValue() {
      return this._positionSlider.value;
    }

    // private helpers

    _saveCacheForCurrentPlayer() {
      if (!this._playerName) return;
      this._playerCache.set(this._playerName, {
        position: this._currentPosition,
        length: this._trackLength,
        sliderValue: this._positionSlider.value,
        currentTimeText: this._currentTimeLabel.text,
        totalTimeText: this._totalTimeLabel.text,
      });
    }

    _restoreCacheForCurrentPlayer() {
      const c = this._playerCache.get(this._playerName);
      if (c) {
        this._currentPosition = c.position;
        this._trackLength = c.length;
        this._positionSlider.block_signal_handler(this._sliderChangedId);
        this._positionSlider.value = c.sliderValue;
        this._positionSlider.unblock_signal_handler(this._sliderChangedId);
        this._currentTimeLabel.text = c.currentTimeText;
        this._totalTimeLabel.text = c.totalTimeText;
      } else {
        // No cache — show zero until updatePlaybackState() sets real values.
        this._hardReset();
      }
    }

    _syncGetProperty(busName, property) {
      if (!busName) return null;
      try {
        const res = Gio.DBus.session.call_sync(
          busName,
          "/org/mpris/MediaPlayer2",
          "org.freedesktop.DBus.Properties",
          "Get",
          new GLib.Variant("(ss)", ["org.mpris.MediaPlayer2.Player", property]),
          null,
          Gio.DBusCallFlags.NONE,
          50,
          null,
        );
        return res.recursiveUnpack()[0];
      } catch (_e) {
        return null;
      }
    }

    _updateSliderPosition() {
      if (
        this._isDestroyed ||
        this._sliderDragging ||
        !this._playerName ||
        !this._trackLength
      )
        return;

      let pos = this._syncGetProperty(this._playerName, "Position");
      if (pos === null || pos === 0) pos = this._currentPosition;
      else this._currentPosition = pos;

      this._applyPosition(pos);
      this._saveCacheForCurrentPlayer();
    }

    _applyPosition(position) {
      position = Math.max(0, Math.min(position, this._trackLength));
      this._positionSlider.block_signal_handler(this._sliderChangedId);
      this._positionSlider.value =
        this._trackLength > 0 ? position / this._trackLength : 0;
      this._positionSlider.unblock_signal_handler(this._sliderChangedId);
      this._currentTimeLabel.text = this._formatTime(position / 1_000_000);
    }

    _updateTimeLabel() {
      if (this._trackLength > 0) {
        const pos = this._positionSlider.value * this._trackLength;
        this._currentTimeLabel.text = this._formatTime(pos / 1_000_000);
      }
    }

    _formatTime(seconds) {
      if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
      seconds = Math.floor(seconds);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }

    destroy() {
      this._isDestroyed = true;
      this.stopPositionUpdate();

      if (this._resumeTimeout) {
        GLib.source_remove(this._resumeTimeout);
        this._resumeTimeout = null;
      }
      if (this._sliderChangedId) {
        this._positionSlider.disconnect(this._sliderChangedId);
        this._sliderChangedId = 0;
      }

      this._playerCache.clear();
      super.destroy();
    }
  },
);
