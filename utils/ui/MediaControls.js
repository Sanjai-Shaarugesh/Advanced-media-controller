import St from "gi://St";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";
import { ControlButtons } from "./ControlButtons.js";
import { AlbumArt } from "./AlbumArt.js";
import { ProgressSlider } from "./ProgressSlider.js";
import { PlayerTabs } from "./PlayerTabs.js";

export const MediaControls = GObject.registerClass(
  {
    Signals: {
      "play-pause": {},
      "next": {},
      "previous": {},
      "shuffle": {},
      "repeat": {},
      "seek": { param_types: [GObject.TYPE_DOUBLE] },
      "player-changed": { param_types: [GObject.TYPE_STRING] },
    },
  },
  class MediaControls extends St.BoxLayout {
    _init() {
      super._init({
        vertical: true,
        style_class: "media-controls-modern",
      });

      this._currentPlayerName = null;
      this._playerSliderPositions = new Map();
      this._playerArtCache = new Map();
      
      this._buildUI();
    }

    _buildUI() {
      // Player tabs
      const headerBox = new St.BoxLayout({
        style: "margin-bottom: 20px; spacing: 8px;",
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._playerTabs = new PlayerTabs();
      this._playerTabs.connect("player-changed", (_, name) => this.emit("player-changed", name));
      headerBox.add_child(this._playerTabs);
      this.add_child(headerBox);

      // Album art
      this._albumArt = new AlbumArt();
      this.add_child(this._albumArt);

      // Track info
      const infoBox = new St.BoxLayout({
        vertical: true,
        style: "spacing: 6px; margin-bottom: 24px;",
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._titleLabel = new St.Label({
        text: "No media playing",
        style: "font-weight: 700; font-size: 16px; color: rgba(255,255,255,0.95);",
      });
      this._titleLabel.clutter_text.ellipsize = 3;
      infoBox.add_child(this._titleLabel);

      this._artistLabel = new St.Label({
        text: "",
        style: "font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.6);",
      });
      this._artistLabel.clutter_text.ellipsize = 3;
      infoBox.add_child(this._artistLabel);
      this.add_child(infoBox);

      // Progress slider
      this._progressSlider = new ProgressSlider();
      this._progressSlider.connect("seek", (_, position) => this.emit("seek", position));
      this._progressSlider.connect("drag-begin", () => this.stopPositionUpdate());
      this._progressSlider.connect("drag-end", () => {
        if (this._currentPlayerName) {
          this._playerSliderPositions.set(this._currentPlayerName, {
            position: this._progressSlider.currentPosition,
            length: this._progressSlider.trackLength,
            value: this._progressSlider.sliderValue
          });
        }
      });
      this.add_child(this._progressSlider);

      // Control buttons
      this._controlButtons = new ControlButtons();
      this._controlButtons.connect("play-pause", () => this.emit("play-pause"));
      this._controlButtons.connect("next", () => this.emit("next"));
      this._controlButtons.connect("previous", () => this.emit("previous"));
      this._controlButtons.connect("shuffle", () => this.emit("shuffle"));
      this._controlButtons.connect("repeat", () => this.emit("repeat"));
      this.add_child(this._controlButtons);
    }

    update(info, playerName, manager) {
      if (!info) return;

      const playerChanged = this._currentPlayerName !== playerName;
      const previousPlayer = this._currentPlayerName;
      this._currentPlayerName = playerName;

      if (playerChanged) {
        if (previousPlayer) {
          this._playerSliderPositions.set(previousPlayer, {
            position: this._progressSlider.currentPosition,
            length: this._progressSlider.trackLength,
            value: this._progressSlider.sliderValue
          });
        }

        const savedState = this._playerSliderPositions.get(playerName);
        if (savedState) {
          this._progressSlider.setPosition(savedState.position, savedState.length, savedState.value);
        } else {
          this._progressSlider.setPosition(info.position || 0, info.length || 0, 0);
        }

        const savedArt = this._playerArtCache.get(playerName);
        if (savedArt && savedArt === info.artUrl) {
          this._albumArt.loadCover(info.artUrl, true);
        } else if (info.artUrl) {
          this._albumArt.loadCover(info.artUrl, true);
        } else {
          this._albumArt.setDefaultCover();
        }
      } else {
        this._progressSlider.trackLength = info.length;
        if (info.artUrl && this._playerArtCache.get(playerName) !== info.artUrl) {
          this._albumArt.loadCover(info.artUrl);
        }
      }

      this._playerArtCache.set(playerName, info.artUrl);

      this._titleLabel.text = info.title || "Unknown";
      
      if (info.artists && info.artists.length > 0) {
        this._artistLabel.text = info.artists.join(", ");
        this._artistLabel.show();
      } else {
        this._artistLabel.hide();
      }

      this._controlButtons.updateButtons(info);
      this._progressSlider.updatePlaybackState(info.status === "Playing", info.position, playerChanged);
    }

    updateTabs(players, currentPlayer, manager) {
      this._playerTabs.updateTabs(players, currentPlayer, manager);
    }

    startPositionUpdate() {
      this._progressSlider.startPositionUpdate();
    }

    stopPositionUpdate() {
      this._progressSlider.stopPositionUpdate();
    }

    onSeeked(position) {
      this._progressSlider.onSeeked(position);
      
      if (this._currentPlayerName) {
        this._playerSliderPositions.set(this._currentPlayerName, {
          position: this._progressSlider.currentPosition,
          length: this._progressSlider.trackLength,
          value: this._progressSlider.currentPosition / this._progressSlider.trackLength
        });
      }
    }

    destroy() {
      this.stopPositionUpdate();
      
      this._playerSliderPositions.clear();
      this._playerArtCache.clear();
      
      if (this._albumArt) {
        this._albumArt.destroy();
      }
      
      super.destroy();
    }
  }
);