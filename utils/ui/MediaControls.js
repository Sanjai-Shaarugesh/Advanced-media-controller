import St from "gi://St";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ControlButtons } from "./ControlButtons.js";
import { AlbumArt } from "./AlbumArt.js";
import { ProgressSlider } from "./ProgressSlider.js";
import { PlayerTabs } from "./PlayerTabs.js";
import { ScrollingLabel } from "./ScrollingLabel.js";
import { LyricsClient } from "./LyricsClient.js";
import { LyricsWidget } from "./LyricsWidget.js";

const TITLE_VIEWPORT_WIDTH  = 300;
const ARTIST_VIEWPORT_WIDTH = 280;
const LOOP_PAUSE_MS         = 1200;
const BASE_PX_PER_SEC       = 50;

// How often (ms) we poll MPRIS for position while lyrics are visible.
// 250 ms gives smooth enough lyric transitions without hammering D-Bus.
const LYRICS_POLL_MS = 250;

export const MediaControls = GObject.registerClass(
  {
    Signals: {
      "play-pause":      {},
      next:              {},
      previous:          {},
      shuffle:           {},
      repeat:            {},
      seek:              { param_types: [GObject.TYPE_DOUBLE] },
      "player-changed":  { param_types: [GObject.TYPE_STRING] },
    },
  },
  class MediaControls extends St.BoxLayout {
    _init(settings) {
      super._init({
        vertical: true,
        style_class: "media-controls-modern",
        style: "min-width: 340px; max-width: 340px;",
      });

      this._settings          = settings;
      this._currentPlayerName = null;
      this._currentManager    = null;
      this._playerSliderPositions = new Map();
      this._playerArtCache        = new Map();

      this._titleScrollLabel  = null;
      this._artistScrollLabel = null;

      // Lyrics state
      this._lyricsClient      = null;
      this._lyricsView        = null;

      // Per-player lyrics state keyed by playerName so each tab independently
      // remembers whether the user has activated lyrics for it.
      // Schema: Map<playerName, { visible: boolean, lastKey: string|null }>
      this._playerLyricsState = new Map();

      this._currentTrackInfo  = null;

      // Dedicated timer that drives lyrics position updates independently of
      // the general MPRIS change event (which fires only ~1 s).
      this._lyricsSyncTimer   = null;

      this._buildUI();
    }

    _buildUI() {
      // ── Player tabs ─────────────────────────────────────────────────────────
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

      // ── Art / lyrics slot ───────────────────────────────────────────────────
      // AlbumArt and LyricsWidget share this one fixed-size bin.
      // Swapping via set_child() keeps the layout stable — no size jumps.
      this._artSlot = new St.Bin({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._albumArt = new AlbumArt(this._settings, null, null);
      // connectObject() tracks the handler so it is auto-disconnected when
      // either this MediaControls or the AlbumArt instance is destroyed.
      this._albumArt.connectObject(
        "triple-click", () => this._onAlbumArtTripleClick(), this);

      this._lyricsView = new LyricsWidget(340, 340);
      // Single click anywhere on the lyrics panel dismisses it for the
      // current player only (per-player state).  connectObject() ensures the
      // handler is removed if either party is destroyed first.
      this._lyricsView.connectObject(
        "dismiss", () => this._hideLyricsForPlayer(this._currentPlayerName),
        this);

      // Album art is shown by default
      this._artSlot.set_child(this._albumArt);
      this.add_child(this._artSlot);

      // ── Info box (title + artist) ───────────────────────────────────────────
      this._infoBox = new St.BoxLayout({
        vertical: true,
        style: "spacing: 6px; margin-bottom: 24px;",
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._titleSlot = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `min-height: 28px; width: ${TITLE_VIEWPORT_WIDTH}px;`,
      });
      this._infoBox.add_child(this._titleSlot);

      this._artistSlot = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `min-height: 22px; width: ${ARTIST_VIEWPORT_WIDTH}px;`,
      });
      this._infoBox.add_child(this._artistSlot);

      this.add_child(this._infoBox);

      // ── Progress slider ─────────────────────────────────────────────────────
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
            length:   this._progressSlider.trackLength,
            value:    this._progressSlider.sliderValue,
          });
        }
      });
      this.add_child(this._progressSlider);

      // ── Control buttons ─────────────────────────────────────────────────────
      this._controlButtons = new ControlButtons();
      this._controlButtons.connect("play-pause", () => this.emit("play-pause"));
      this._controlButtons.connect("next",       () => this.emit("next"));
      this._controlButtons.connect("previous",   () => this.emit("previous"));
      this._controlButtons.connect("shuffle",    () => this.emit("shuffle"));
      this._controlButtons.connect("repeat",     () => this.emit("repeat"));
      this.add_child(this._controlButtons);
    }

    // ── Scroll-label helpers ──────────────────────────────────────────────────

    _calcSpeed(speedPref, status) {
      const eff = status === "Paused"
        ? Math.max(1, Math.floor(speedPref / 3))
        : speedPref;
      return Math.round(BASE_PX_PER_SEC * (eff / 5));
    }

    _updateSlotLabel(slot, existing, fullText, enabled, viewW, speedPref, status, textStyle) {
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
      const speed   = this._settings.get_int("title-scroll-speed");
      this._titleScrollLabel = this._updateSlotLabel(
        this._titleSlot, this._titleScrollLabel, fullText, enabled,
        TITLE_VIEWPORT_WIDTH, speed, status,
        "font-weight: 700; font-size: 16px;",
      );
    }

    _updateArtistLabel(fullText, status) {
      const enabled = this._settings.get_boolean("enable-artist-scroll");
      const speed   = this._settings.get_int("artist-scroll-speed");
      this._artistScrollLabel = this._updateSlotLabel(
        this._artistSlot, this._artistScrollLabel, fullText, enabled,
        ARTIST_VIEWPORT_WIDTH, speed, status,
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

    // ── Main update (called by IndicatorUIUpdater) ────────────────────────────

    update(info, playerName, manager) {
      if (!info) return;

      const playerChanged         = this._currentPlayerName !== playerName;
      this._currentPlayerName     = playerName;
      this._currentManager        = manager;
      this._currentTrackInfo      = info;

      // Notify ProgressSlider first so cached position is restored instantly
      this._progressSlider.setPlayerName(playerName);

      // Tell AlbumArt which player/manager is active (vinyl state is per-app)
      if (playerChanged)
        this._albumArt.setPlayer(manager, playerName);

      // Album art image
      if (playerChanged) {
        if (info.artUrl) this._albumArt.loadCover(info.artUrl, true);
        else             this._albumArt.setDefaultCover();
      } else if (info.artUrl &&
                 this._playerArtCache.get(playerName) !== info.artUrl) {
        this._albumArt.loadCover(info.artUrl);
      }
      this._playerArtCache.set(playerName, info.artUrl);

      // Labels
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

      if (info.status === "Playing")
        this._albumArt.startRotation(true);
      else if (info.status === "Paused")
        this._albumArt.pauseRotation();
      else
        this._albumArt.stopRotation();

      // ── Lyrics: per-player state restore & track-change detection ──────────
      if (!this._settings.get_boolean("enable-lyrics")) {
        // Feature disabled — force-hide for every player
        const s = this._playerLyricsState.get(playerName);
        if (s?.visible) this._hideLyricsForPlayer(playerName);
        return;
      }

      const playerState = this._getPlayerLyricsState(playerName);

      if (playerChanged) {
        // Tab switch: restore the incoming player's lyrics preference.
        // Stop the sync timer first; _applyLyricsState restarts it if needed.
        this._stopLyricsSyncTimer();
        this._applyLyricsState(playerName, playerState);
        return;
      }

      // Same player — check for a track change while lyrics are open
      if (playerState.visible) {
        const newKey =
          `${info.title || ""}||${(info.artists || []).join(",")}`;
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
      const len  = metaV.n_children();
      for (let i = 0; i < len; i++) {
        const item = metaV.get_child_value(i);
        const key  = item.get_child_value(0).get_string()[0];
        const val  = item.get_child_value(1).get_variant();
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
      // Restart the lyrics sync timer only if the current player has lyrics
      // visible (per-player state).
      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (state?.visible) this._startLyricsSyncTimer();
    }

    stopPositionUpdate() {
      this._progressSlider.stopPositionUpdate();
      this._titleScrollLabel?.pauseScrolling();
      this._artistScrollLabel?.pauseScrolling();
      this._albumArt?.pauseRotation();
      // Stop lyrics timer when menu is closed — no point polling off-screen
      this._stopLyricsSyncTimer();
    }

    onSeeked(position) {
      this._progressSlider.onSeeked(position);
      if (this._currentPlayerName) {
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: this._progressSlider.currentPosition,
          length:   this._progressSlider.trackLength,
          value:    this._progressSlider.currentPosition /
                    this._progressSlider.trackLength,
        });
      }
      // Immediately reflect seek in lyrics so the correct line highlights.
      // position here is in seconds from the Seeked signal; widget wants ms.
      const _seekState = this._playerLyricsState.get(this._currentPlayerName);
      if (_seekState?.visible && this._lyricsView)
        this._lyricsView.setPosition(position * 1000);
    }

    // ── Lyrics sync timer ─────────────────────────────────────────────────────

    /**
     * Start a 250 ms repeating timer that reads the MPRIS Position property
     * directly from the D-Bus proxy cache and feeds it to LyricsWidget.
     * This runs independently of MPRIS property-change signals, which only
     * fire once per second at best.
     */
    _startLyricsSyncTimer() {
      this._stopLyricsSyncTimer(); // clear any existing timer first

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

    /**
     * Push the current playback position (µs) to the LyricsWidget (ms).
     *
     * Reads from ProgressSlider.currentPosition rather than the D-Bus proxy
     * cache: the MPRIS "Position" property is only emitted on Seeked signals,
     * so the cached value is stale during normal playback.  ProgressSlider
     * polls D-Bus every second and interpolates between polls, giving an
     * accurate, smoothly-advancing value at zero extra D-Bus cost.
     */
    _pushLyricsPosition() {
      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (!state?.visible || !this._lyricsView) return;
      const posUs = this._progressSlider?.currentPosition ?? 0;
      this._lyricsView.setPosition(posUs / 1000);
    }

    // ── Per-player lyrics state helpers ──────────────────────────────────────

    /**
     * Return (creating if absent) the lyrics state record for playerName.
     * @param {string} playerName
     * @returns {{ visible: boolean, lastKey: string|null }}
     */
    _getPlayerLyricsState(playerName) {
      if (!this._playerLyricsState.has(playerName))
        this._playerLyricsState.set(playerName, { visible: false, lastKey: null });
      return this._playerLyricsState.get(playerName);
    }

    /**
     * Show or hide the lyrics view to match the stored state for playerName,
     * and (re)start / stop the sync timer accordingly.
     * Called on every player-tab switch.
     */
    _applyLyricsState(playerName, state) {
      if (state.visible) {
        this._artSlot.set_child(this._lyricsView);

        // Fetch if the track changed while this player was in the background
        const info   = this._currentTrackInfo;
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
        // Restore correct per-player art (vinyl or normal) for this player
        if (this._artSlot?.get_child() === this._lyricsView)
          this._artSlot.set_child(this._albumArt);
        this._stopLyricsSyncTimer();
      }
    }

    // ── Lyrics toggle ─────────────────────────────────────────────────────────

    _onAlbumArtTripleClick() {
      if (!this._settings.get_boolean("enable-lyrics")) return;
      const state = this._getPlayerLyricsState(this._currentPlayerName);
      if (state.visible)
        this._hideLyricsForPlayer(this._currentPlayerName);
      else
        this._showLyricsForPlayer(this._currentPlayerName);
    }

    _showLyricsForPlayer(playerName) {
      const state   = this._getPlayerLyricsState(playerName);
      state.visible = true;

      this._artSlot.set_child(this._lyricsView);
      // Always start with a clean loading state
      this._lyricsView.clear();

      const info = this._currentTrackInfo;
      if (!info) return;

      const newKey  = `${info.title || ""}||${(info.artists || []).join(",")}`;
      state.lastKey = newKey;
      this._fetchLyricsForCurrentTrack();
      this._startLyricsSyncTimer();
    }

    /**
     * Hide lyrics for playerName and restore the correct album-art widget
     * (vinyl or normal) for that player instance.
     * Called both from the dismiss signal and from _onAlbumArtTripleClick.
     */
    _hideLyricsForPlayer(playerName) {
      const state   = this._getPlayerLyricsState(playerName);
      state.visible = false;
      this._stopLyricsSyncTimer();
      // Restore the album-art slot — AlbumArt tracks vinyl/normal state per
      // player via setPlayer() so the correct view is shown automatically.
      if (this._artSlot)
        this._artSlot.set_child(this._albumArt);
    }

    async _fetchLyricsForCurrentTrack() {
      if (!this._currentTrackInfo || !this._currentPlayerName) return;

      if (!this._lyricsClient)
        this._lyricsClient = new LyricsClient();

      // Capture the player at call time.  If the user switches tabs while the
      // network request is in flight the result belongs to fetchPlayerName,
      // not necessarily the current player.
      const fetchPlayerName = this._currentPlayerName;
      const info            = this._currentTrackInfo;
      const artist          = (info.artists || []).join(", ");
      const durationS       =
        (info.length || 0) > 0 ? info.length / 1_000_000 : 0;

      try {
        const lines = await this._lyricsClient.getLyrics(
          info.title  || "",
          artist,
          info.album  || "",
          durationS,
        );

        // Discard result if lyrics were dismissed or player switched away
        // while the network request was in flight.
        const state = this._getPlayerLyricsState(fetchPlayerName);
        if (!state.visible || this._currentPlayerName !== fetchPlayerName)
          return;

        this._lyricsView.setLyrics(lines); // null → shows "not found"
        this._pushLyricsPosition();
      } catch (_e) {
        const state = this._getPlayerLyricsState(fetchPlayerName);
        if (state.visible && this._currentPlayerName === fetchPlayerName)
          this._lyricsView.setLyrics(null);
      }
    }

    /**
     * Called externally (IndicatorPlayerHandlers) with the MPRIS Seeked
     * position in **microseconds**.
     */
    updateLyricsPosition(positionUs) {
      const state = this._playerLyricsState.get(this._currentPlayerName);
      if (!state?.visible || !this._lyricsView) return;
      this._lyricsView.setPosition(positionUs / 1000);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    destroy() {
      this._stopTitleLabel();
      this._stopArtistLabel();
      this._progressSlider.stopPositionUpdate();
      this._stopLyricsSyncTimer();
      this._playerSliderPositions.clear();
      this._playerArtCache.clear();
      this._playerLyricsState.clear();

      // Disconnect cross-object signals that were connected with connectObject()
      this._albumArt?.disconnectObject(this);
      this._lyricsView?.disconnectObject(this);

      if (this._lyricsClient) {
        this._lyricsClient.destroy();
        this._lyricsClient = null;
      }

      // Clear the slot before destroying children to avoid double-destroy
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