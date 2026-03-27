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

      // Per-player snapshot: switching tabs never causes jump or flicker
      // Keyed by playerName → { position, length, sliderValue, currentTimeText, totalTimeText }
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

    /**
     * Switch to a different player.  Saves current state, then restores the
     * cached state for the new player (or hard-resets if no cache exists).
     * This is the main entry point called by MediaControls on tab switch.
     *
     * @param {string} name  MPRIS bus name of the player
     */
    setPlayerName(name) {
      if (this._playerName === name) return;

      // Persist the current player's slider state before switching
      this._saveCacheForCurrentPlayer();

      // Stop any live polling for the old player
      this.stopPositionUpdate();

      this._playerName = name;

      // Restore or reset for the new player
      this._restoreCacheForCurrentPlayer();

      // If the new player is playing, restart the update ticker
      if (this._isPlaying && this._trackLength > 0) {
        this.startPositionUpdate();
      }
    }

    /**
     * Hard-reset this slider for the current player — used when the video/track
     * changes (e.g. switching YouTube videos or YouTube Shorts).
     */
    resetForNewTrack() {
      if (this._isDestroyed) return;
      // Invalidate the cache entry for this player so we start fresh
      if (this._playerName) this._playerCache.delete(this._playerName);
      this._hardReset();
    }

    /**
     * Called when playback state or metadata changes.
     * Updates the total-time label, seek capability, and starts/stops polling.
     *
     * @param {boolean} isPlaying
     * @param {object|null} metadata  raw MPRIS metadata dict
     * @param {string} _status
     */
    updatePlaybackState(isPlaying, metadata, _status) {
      if (this._isDestroyed) return;

      const wasPlaying = this._isPlaying;
      this._isPlaying = isPlaying;

      if (metadata) {
        const newLength = metadata["mpris:length"] || 0;
        const newTrackId = metadata["mpris:trackid"] || null;

        // If length changed meaningfully, update the total-time label and cache
        if (newLength !== this._trackLength) {
          this._trackLength = newLength;
          this._totalTimeLabel.text = this._formatTime(
            this._trackLength / 1_000_000,
          );
          this._saveCacheForCurrentPlayer();
        }

        this._trackId = newTrackId;

        if (!this._trackId || !this._trackLength) {
          this._canSeek = false;
          this._positionSlider.reactive = false;
          this.visible = false;
          this.stopPositionUpdate();
          return;
        }
        this._canSeek = true;
        this._positionSlider.reactive = true;
        this.visible = true;
      }

      if (isPlaying && !wasPlaying) {
        this.startPositionUpdate();
      } else if (!isPlaying && wasPlaying) {
        this.stopPositionUpdate();
        // Persist the paused position so tab switches restore it accurately
        this._saveCacheForCurrentPlayer();
      }
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

    /**
     * Called when an MPRIS Seeked signal arrives.
     * @param {number} position  position in microseconds
     */
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
      this._trackLength = 0;
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

    

    _saveCacheForCurrentPlayer() {
      if (!this._playerName) return;
      this._playerCache.set(this._playerName, {
        position: this._currentPosition,
        length: this._trackLength,
        sliderValue: this._positionSlider.value,
        currentTimeText: this._currentTimeLabel.text,
        totalTimeText: this._totalTimeLabel.text,
        isPlaying: this._isPlaying,
      });
    }

    _restoreCacheForCurrentPlayer() {
      const c = this._playerCache.get(this._playerName);
      if (c) {
        this._currentPosition = c.position;
        this._trackLength = c.length;
        this._isPlaying = c.isPlaying ?? false;

        // Apply slider value without triggering the notify::value handler
        this._positionSlider.block_signal_handler(this._sliderChangedId);
        this._positionSlider.value = c.sliderValue;
        this._positionSlider.unblock_signal_handler(this._sliderChangedId);

        this._currentTimeLabel.text = c.currentTimeText;
        this._totalTimeLabel.text = c.totalTimeText;

        // Show/hide based on whether the cached player had valid seek info
        const hasTrack = this._trackLength > 0;
        this._canSeek = hasTrack;
        this._positionSlider.reactive = hasTrack;
        this.visible = hasTrack;
      } else {
        this._hardReset();
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

      Gio.DBus.session.call(
        this._playerName,
        "/org/mpris/MediaPlayer2",
        "org.freedesktop.DBus.Properties",
        "Get",
        new GLib.Variant("(ss)", ["org.mpris.MediaPlayer2.Player", "Position"]),
        null,
        Gio.DBusCallFlags.NONE,
        200,
        null,
        (conn, result) => {
          if (this._isDestroyed || this._sliderDragging) return;
          let pos = null;
          try {
            pos = conn.call_finish(result).recursiveUnpack()[0];
          } catch (_e) {}
          if (pos === null || pos === 0) pos = this._currentPosition;
          else this._currentPosition = pos;
          this._applyPosition(pos);
          this._saveCacheForCurrentPlayer();
        },
      );
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
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      return `${m}:${String(s).padStart(2, "0")}`;
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