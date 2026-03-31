import St from "gi://St";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { ControlButtons } from "./ControlButtons.js";
import { AlbumArt } from "./AlbumArt.js";
import { ProgressSlider } from "./ProgressSlider.js";
import { PlayerTabs } from "./PlayerTabs.js";
import { ScrollingLabel } from "./ScrollingLabel.js";
import { LyricsClient } from "../../Lyrics/client/LyricsClient.js";
import { LyricsWidget } from "../../Lyrics/widgets/LyricsWidget.js";

const LOOP_PAUSE_MS = 1200;
const BASE_PX_PER_SEC = 50;

// 250 ms gives smooth enough lyric transitions without hammering D-Bus
const LYRICS_POLL_MS = 250;

/** @param {Gio.Settings} s @returns {number} */
function _popupWidth(s) {
  try {
    return Math.max(280, s.get_int("popup-width"));
  } catch (_e) {
    return 340;
  }
}

/** Title viewport: 88 % of popup width */
function _titleW(s) {
  return Math.round(_popupWidth(s) * 0.88);
}

/** Artist viewport: 82 % of popup width */
function _artistW(s) {
  return Math.round(_popupWidth(s) * 0.82);
}

export const MediaControls = GObject.registerClass(
  {
    Signals: {
      "play-pause": {},
      next: {},
      previous: {},
      shuffle: {},
      repeat: {},
      seek: { param_types: [GObject.TYPE_DOUBLE] },
      "player-changed": { param_types: [GObject.TYPE_STRING] },
    },
  },
  class MediaControls extends St.BoxLayout {
    _init(settings) {
      const w = _popupWidth(settings);

      super._init({
        vertical: true,
        style_class: "media-controls-modern",
        style: `min-width: ${w}px; max-width: ${w}px;`,
      });

      this._settings = settings;
      this._currentPlayerName = null;
      this._currentManager = null;
      this._playerSliderPositions = new Map();
      this._playerArtCache = new Map();

      this._titleScrollLabel = null;
      this._artistScrollLabel = null;

      // Lyrics state
      this._lyricsClient = null;
      this._lyricsView = null;

      // Per-player lyrics state keyed by playerName so each tab independently
      this._playerLyricsState = new Map();
      this._lyricsCache = new Map();
      this._currentTrackInfo = null;

      this._lyricsSyncTimer = null;

      // Listen for popup-width changes and resize everything live
      this._widthChangedId = this._settings.connect(
        "changed::popup-width",
        () => {
          if (!this._isDestroyed) this._applyPopupWidth();
        },
      );

      this._buildUI();
    }

    //  Width update

    _applyPopupWidth() {
      const w = _popupWidth(this._settings);
      this.style = `min-width: ${w}px; max-width: ${w}px;`;

      // Update title / artist slot widths
      const tw = _titleW(this._settings);
      const aw = _artistW(this._settings);
      this._titleSlot.style = `min-height: 28px; width: ${tw}px;`;
      this._artistSlot.style = `min-height: 22px; width: ${aw}px;`;

      // Rebuild scroll labels with new viewport widths
      if (this._currentTrackInfo) {
        const info = this._currentTrackInfo;
        this._updateTitleLabel(info.title || "Unknown", info.status);
        if (info.artists?.length > 0)
          this._updateArtistLabel(info.artists.join(", "), info.status);
      }

      // Resize the lyrics widget too
      this._lyricsView?.setSize?.(w, w);
    }

    _buildUI() {
      const tw = _titleW(this._settings);
      const aw = _artistW(this._settings);

      const headerBox = new St.BoxLayout({
        style: "margin-bottom: 20px; spacing: 8px;",
        x_align: Clutter.ActorAlign.CENTER,
      });
      this._playerTabs = new PlayerTabs();
      this._playerTabs.connect("player-changed", (_, name) =>
        this.emit("player-changed", name),
      );
      headerBox.add_child(this._playerTabs);
      this.add_child(headerBox);

      this._artSlot = new St.Bin({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._albumArt = new AlbumArt(this._settings, null, null);
      this._albumArt.connectObject(
        "triple-click",
        () => this._onAlbumArtTripleClick(),
        this,
      );

      const w = _popupWidth(this._settings);
      this._lyricsView = new LyricsWidget(w, w, this._settings);
      this._lyricsView.connectObject(
        "dismiss",
        () => this._hideLyricsForPlayer(this._currentPlayerName),
        this,
      );

      this._artSlot.set_child(this._albumArt);
      this.add_child(this._artSlot);

      this._infoBox = new St.BoxLayout({
        vertical: true,
        style: "spacing: 6px; margin-bottom: 24px;",
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._titleSlot = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `min-height: 28px; width: ${tw}px;`,
      });
      this._infoBox.add_child(this._titleSlot);

      this._artistSlot = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `min-height: 22px; width: ${aw}px;`,
      });
      this._infoBox.add_child(this._artistSlot);

      this.add_child(this._infoBox);

      this._progressSlider = new ProgressSlider();
      this._progressSlider.connect("seek", (_, position) =>
        this.emit("seek", position),
      );
      this._progressSlider.connect("drag-begin", () =>
        this.stopPositionUpdate(),
      );
      this._progressSlider.connect("drag-end", () => {
        if (this._currentPlayerName) {
          this._playerSliderPositions.set(this._currentPlayerName, {
            position: this._progressSlider.currentPosition,
            length: this._progressSlider.trackLength,
            value: this._progressSlider.sliderValue,
          });
        }
      });
      // Slider-to-vinyl sync: forward position ratio to album art so the
      // vinyl disc rotates in lockstep with the progress slider (GPU path).
      this._progressSlider.connect("slider-ratio-changed", (_, ratio) => {
        this._albumArt?.syncRotationToPosition?.(ratio);
      });
      this.add_child(this._progressSlider);

      this._controlButtons = new ControlButtons(this._settings);
      this._controlButtons.connect("play-pause", () => this.emit("play-pause"));
      this._controlButtons.connect("next", () => this.emit("next"));
      this._controlButtons.connect("previous", () => this.emit("previous"));
      this._controlButtons.connect("shuffle", () => this.emit("shuffle"));
      this._controlButtons.connect("repeat", () => this.emit("repeat"));
      this.add_child(this._controlButtons);
    }

    //  Scroll-label helpers

    _calcSpeed(speedPref, status) {
      const eff =
        status === "Paused"
          ? Math.max(1, Math.floor(speedPref / 3))
          : speedPref;
      return Math.round(BASE_PX_PER_SEC * (eff / 5));
    }

    _updateSlotLabel(
      slot,
      existing,
      fullText,
      enabled,
      viewW,
      speedPref,
      status,
      textStyle,
    ) {
      if (!enabled) {
        existing?.destroy();
        slot.destroy_all_children();
        const lbl = new St.Label({
          text: fullText,
          y_align: Clutter.ActorAlign.CENTER,
          style: `${textStyle} max-width: ${viewW}px;`,
        });
        lbl.clutter_text.ellipsize = 3;
        lbl.clutter_text.single_line_mode = true;
        slot.add_child(lbl);
        return null;
      }

      const speed = this._calcSpeed(speedPref, status);
      if (existing) {
        existing.setScrollSpeed(speed);
        existing.setText(fullText);
        return existing;
      }

      slot.destroy_all_children();
      const widget = new ScrollingLabel({
        text: fullText,
        viewportWidth: viewW,
        isScrolling: true,
        initPaused: false,
        scrollSpeed: speed,
        scrollPauseTime: LOOP_PAUSE_MS,
        textStyle,
      });
      slot.add_child(widget);
      return widget;
    }

    _updateTitleLabel(fullText, status) {
      const enabled = this._settings.get_boolean("enable-title-scroll");
      const speed = this._settings.get_int("title-scroll-speed");
      this._titleScrollLabel = this._updateSlotLabel(
        this._titleSlot,
        this._titleScrollLabel,
        fullText,
        enabled,
        _titleW(this._settings),
        speed,
        status,
        "font-weight: 700; font-size: 16px;",
      );
    }

    _updateArtistLabel(fullText, status) {
      const enabled = this._settings.get_boolean("enable-artist-scroll");
      const speed = this._settings.get_int("artist-scroll-speed");
      this._artistScrollLabel = this._updateSlotLabel(
        this._artistSlot,
        this._artistScrollLabel,
        fullText,
        enabled,
        _artistW(this._settings),
        speed,
        status,
        "font-size: 13px; font-weight: 500;",
      );
    }

    _stopTitleLabel() {
      this._titleScrollLabel?.destroy();
      this._titleScrollLabel = null;
      this._titleSlot.destroy_all_children();
    }

    _stopArtistLabel() {
      this._artistScrollLabel?.destroy();
      this._artistScrollLabel = null;
      this._artistSlot.destroy_all_children();
    }

    update(info, playerName, manager) {
      if (!info) return;

      const playerChanged = this._currentPlayerName !== playerName;
      this._currentPlayerName = playerName;
      this._currentManager = manager;
      this._currentTrackInfo = info;

      this._progressSlider.setPlayerName(playerName);

      if (playerChanged) this._albumArt.setPlayer(manager, playerName);

      if (playerChanged) {
        if (info.artUrl) this._albumArt.loadCover(info.artUrl, true);
        else this._albumArt.setDefaultCover();
      } else if (
        info.artUrl &&
        this._playerArtCache.get(playerName) !== info.artUrl
      ) {
        this._albumArt.loadCover(info.artUrl);
      }
      this._playerArtCache.set(playerName, info.artUrl);

      this._updateTitleLabel(info.title || "Unknown", info.status);

      if (info.artists?.length > 0) {
        this._updateArtistLabel(info.artists.join(", "), info.status);
        this._artistSlot.show();
      } else {
        this._stopArtistLabel();
        this._artistSlot.hide();
      }

      this._controlButtons.updateButtons(info);

      const metadata = this._getMetadata(playerName, manager);
      this._progressSlider.updatePlaybackState(
        info.status === "Playing",
        metadata,
        info.status,
      );

      if (info.status === "Playing") this._albumArt.startRotation(true);
      else if (info.status === "Paused") this._albumArt.pauseRotation();
      else this._albumArt.stopRotation();

      if (!this._settings.get_boolean("enable-lyrics")) {
        const s = this._playerLyricsState.get(playerName);
        if (s?.visible) this._hideLyricsForPlayer(playerName);
        return;
      }

      const playerState = this._getPlayerLyricsState(playerName);

      if (playerChanged) {
        this._stopLyricsSyncTimer();
        this._applyLyricsState(playerName, playerState);
        return;
      }

      if (playerState.visible) {
        const newKey = `${info.title || ""}||${(info.artists || []).join(",")}`;
        if (newKey !== playerState.lastKey) {
          playerState.lastKey = newKey;
          this._lyricsView.clear();
          this._fetchLyricsForCurrentTrack();
        }
        this._pushLyricsPosition();
      }
    }

    _getMetadata(playerName, manager) {
      if (!playerName || !manager) return null;
      const proxy = manager._proxies.get(playerName);
      if (!proxy) return null;
      const metaV = proxy.get_cached_property("Metadata");
      if (!metaV) return null;

      const meta = {};
      const len = metaV.n_children();
      for (let i = 0; i < len; i++) {
        const item = metaV.get_child_value(i);
        const key = item.get_child_value(0).get_string()[0];
        const val = item.get_child_value(1).get_variant();
        if (key) meta[key] = val ? val.recursiveUnpack() : null;
      }
      return meta;
    }

    updateTabs(players, currentPlayer, manager) {
      this._playerTabs.updateTabs(players, currentPlayer, manager);
    }

    startPositionUpdate() {
      this._progressSlider.startPositionUpdate();
      this._titleScrollLabel?.resumeScrolling();
      this._artistScrollLabel?.resumeScrolling();

      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (state?.visible) this._startLyricsSyncTimer();
    }

    stopPositionUpdate() {
      this._progressSlider.stopPositionUpdate();
      this._titleScrollLabel?.pauseScrolling();
      this._artistScrollLabel?.pauseScrolling();
      this._albumArt?.pauseRotation();
      this._stopLyricsSyncTimer();
    }

    onSeeked(position) {
      this._progressSlider.onSeeked(position);
      if (this._currentPlayerName) {
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: this._progressSlider.currentPosition,
          length: this._progressSlider.trackLength,
          value:
            this._progressSlider.currentPosition /
            this._progressSlider.trackLength,
        });
      }

      const _seekState = this._playerLyricsState.get(this._currentPlayerName);
      if (_seekState?.visible && this._lyricsView)
        this._lyricsView.setPosition(position * 1000);
    }

    onMenuClosed() {
      this._stopLyricsSyncTimer();
    }

    _startLyricsSyncTimer() {
      this._stopLyricsSyncTimer();
      this._lyricsSyncTimer = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        LYRICS_POLL_MS,
        () => {
          const _s = this._playerLyricsState.get(this._currentPlayerName);
          if (!_s?.visible) {
            this._lyricsSyncTimer = null;
            return GLib.SOURCE_REMOVE;
          }
          this._pushLyricsPosition();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _stopLyricsSyncTimer() {
      if (this._lyricsSyncTimer) {
        GLib.source_remove(this._lyricsSyncTimer);
        this._lyricsSyncTimer = null;
      }
    }

    _pushLyricsPosition() {
      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (!state?.visible || !this._lyricsView) return;
      const posUs = this._progressSlider?.currentPosition ?? 0;
      this._lyricsView.setPosition(posUs / 1000);
    }

    _getPlayerLyricsState(playerName) {
      if (!this._playerLyricsState.has(playerName))
        this._playerLyricsState.set(playerName, {
          visible: false,
          lastKey: null,
        });
      return this._playerLyricsState.get(playerName);
    }

    _applyLyricsState(playerName, state) {
      if (state.visible) {
        this._artSlot.set_child(this._lyricsView);
        const info = this._currentTrackInfo;
        const newKey = info
          ? `${info.title || ""}||${(info.artists || []).join(",")}`
          : null;
        if (newKey && newKey !== state.lastKey) {
          state.lastKey = newKey;
          this._lyricsView.clear();
          this._fetchLyricsForCurrentTrack();
        }
        this._pushLyricsPosition();
        this._startLyricsSyncTimer();
      } else {
        if (this._artSlot?.get_child() === this._lyricsView)
          this._artSlot.set_child(this._albumArt);
        this._stopLyricsSyncTimer();
      }
    }

    _onAlbumArtTripleClick() {
      if (!this._settings.get_boolean("enable-lyrics")) return;
      const state = this._getPlayerLyricsState(this._currentPlayerName);
      if (state.visible) this._hideLyricsForPlayer(this._currentPlayerName);
      else this._showLyricsForPlayer(this._currentPlayerName);
    }

    _showLyricsForPlayer(playerName) {
      const state = this._getPlayerLyricsState(playerName);
      state.visible = true;
      this._artSlot.set_child(this._lyricsView);

      const info = this._currentTrackInfo;
      if (!info) {
        this._lyricsView.clear();
        return;
      }

      const newKey = `${info.title || ""}||${(info.artists || []).join(",")}`;
      state.lastKey = newKey;
      if (!this._lyricsCache.has(newKey)) this._lyricsView.clear();
      this._fetchLyricsForCurrentTrack();
      this._startLyricsSyncTimer();
    }

    _hideLyricsForPlayer(playerName) {
      const state = this._getPlayerLyricsState(playerName);
      state.visible = false;
      this._stopLyricsSyncTimer();
      if (this._artSlot) this._artSlot.set_child(this._albumArt);
    }

    async _fetchLyricsForCurrentTrack() {
      if (!this._currentTrackInfo || !this._currentPlayerName) return;

      const fetchPlayerName = this._currentPlayerName;
      const info = this._currentTrackInfo;
      const trackKey = `${info.title || ""}||${(info.artists || []).join(",")}`;

      if (this._lyricsCache.has(trackKey)) {
        const cached = this._lyricsCache.get(trackKey);
        const state = this._getPlayerLyricsState(fetchPlayerName);
        if (state.visible && this._currentPlayerName === fetchPlayerName) {
          this._lyricsView.setLyrics(cached);
          this._pushLyricsPosition();
        }
        return;
      }

      if (!this._lyricsClient) this._lyricsClient = new LyricsClient();

      const artist = (info.artists || []).join(", ");
      const durationS = (info.length || 0) > 0 ? info.length / 1_000_000 : 0;

      try {
        const lines = await this._lyricsClient.getLyrics(
          info.title || "",
          artist,
          info.album || "",
          durationS,
        );

        this._lyricsCache.set(trackKey, lines ?? null);

        const state = this._getPlayerLyricsState(fetchPlayerName);
        if (!state.visible || this._currentPlayerName !== fetchPlayerName)
          return;

        this._lyricsView.setLyrics(lines);
        this._pushLyricsPosition();
      } catch (_e) {
        const state = this._getPlayerLyricsState(fetchPlayerName);
        if (state.visible && this._currentPlayerName === fetchPlayerName)
          this._lyricsView.setLyrics(null);
      }
    }

    updateLyricsPosition(positionUs) {
      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (!state?.visible || !this._lyricsView) return;
      this._lyricsView.setPosition(positionUs / 1000);
    }

    destroy() {
      this._isDestroyed = true;

      if (this._widthChangedId) {
        this._settings.disconnect(this._widthChangedId);
        this._widthChangedId = 0;
      }

      this._stopTitleLabel();
      this._stopArtistLabel();
      this._progressSlider.stopPositionUpdate();
      this._stopLyricsSyncTimer();
      this._playerSliderPositions.clear();
      this._playerArtCache.clear();
      this._playerLyricsState.clear();
      this._lyricsCache.clear();

      this._albumArt?.disconnectObject(this);
      this._lyricsView?.disconnectObject(this);

      if (this._lyricsClient) {
        this._lyricsClient.destroy();
        this._lyricsClient = null;
      }

      if (this._artSlot) {
        this._artSlot.set_child(null);
        this._artSlot = null;
      }

      if (this._lyricsView) {
        this._lyricsView.destroy();
        this._lyricsView = null;
      }

      this._albumArt?.destroy();
      this._albumArt = null;
      super.destroy();
    }
  },
);