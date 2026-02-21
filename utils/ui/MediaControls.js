import St from "gi://St";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import { ControlButtons } from "./ControlButtons.js";
import { AlbumArt } from "./AlbumArt.js";
import { ProgressSlider } from "./ProgressSlider.js";
import { PlayerTabs } from "./PlayerTabs.js";
import { ScrollingLabel } from "./ScrollingLabel.js";

const TITLE_VIEWPORT_WIDTH  = 300;
const ARTIST_VIEWPORT_WIDTH = 280;
const LOOP_PAUSE_MS         = 1200;
const BASE_PX_PER_SEC       = 50;

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

      this._buildUI();
    }

    _buildUI() {
      // Player tabs
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

      // Album art — manager + playerName will be supplied on first update().
      this._albumArt = new AlbumArt(this._settings, null, null);
      this.add_child(this._albumArt);

      // Info box
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

      // Progress slider
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

      // Control buttons
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

    // ── Main update ───────────────────────────────────────────────────────────

    update(info, playerName, manager) {
      if (!info) return;

      const playerChanged         = this._currentPlayerName !== playerName;
      this._currentPlayerName     = playerName;
      this._currentManager        = manager;

      // Notify ProgressSlider first so cached position is restored instantly.
      this._progressSlider.setPlayerName(playerName);

      // Tell AlbumArt which player/manager is active so it can compute the
      // correct per-app vinyl state.
      if (playerChanged)
        this._albumArt.setPlayer(manager, playerName);

      // Album art image
      if (playerChanged) {
        if (info.artUrl) this._albumArt.loadCover(info.artUrl, true);
        else             this._albumArt.setDefaultCover();
      } else if (info.artUrl && this._playerArtCache.get(playerName) !== info.artUrl) {
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
    }

    stopPositionUpdate() {
      this._progressSlider.stopPositionUpdate();
      this._titleScrollLabel?.pauseScrolling();
      this._artistScrollLabel?.pauseScrolling();
      this._albumArt?.pauseRotation();
    }

    onSeeked(position) {
      this._progressSlider.onSeeked(position);
      if (this._currentPlayerName) {
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: this._progressSlider.currentPosition,
          length:   this._progressSlider.trackLength,
          value:    this._progressSlider.currentPosition / this._progressSlider.trackLength,
        });
      }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    destroy() {
      this._stopTitleLabel();
      this._stopArtistLabel();
      this._progressSlider.stopPositionUpdate();
      this._playerSliderPositions.clear();
      this._playerArtCache.clear();
      this._albumArt?.destroy();
      super.destroy();
    }
  },
);