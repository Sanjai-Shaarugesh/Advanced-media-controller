import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import {
  resolveGicon,
  resolveDisplayName,
  clearIconCache,
} from "../icon/IconResolver.js";
import { playerConstant } from "./playerConstant.js";

function _isDarkTheme() {
  try {
    const s = new Gio.Settings({ schema_id: playerConstant.INTERFACE_SCHEMA });
    const keys = s.list_keys();
    if (keys.indexOf(playerConstant.INTERFACE_KEY) !== -1)
      return s.get_string(playerConstant.INTERFACE_KEY) === "prefer-dark";
    if (keys.indexOf(playerConstant.GTK_THEME_KEY) !== -1)
      return s
        .get_string(playerConstant.GTK_THEME_KEY)
        .toLowerCase()
        .includes("dark");
  } catch (_) {}
  return true;
}

export const PlayerTabs = GObject.registerClass(
  {
    Signals: {
      "player-changed": { param_types: [GObject.TYPE_STRING] },
      "pin-toggled": {
        param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING],
      },
    },
  },
  class PlayerTabs extends St.BoxLayout {
    _init() {
      super._init({
        vertical: true,
        style: "spacing: 0px;",
        reactive: true,
        x_expand: true,
      });

      this._currentPlayers = [];
      this._currentActivePlayer = null;
      this._pinned = false;
      this._dark = _isDarkTheme();
      this._buttonEntries = [];
      this._pinClickId = 0;
      this._pinEnterId = 0;
      this._pinLeaveId = 0;
      this._clickTimers = new Map();
      this._pulseTimers = new Set();
      this._themeSettings = null;
      this._themeSettingsId = 0;
      this._singleIconLastPressUs = 0;
      this._singleIconButton = null;
      this._singleIconPressId = 0;
      this._singleHoverEnterId = 0;
      this._singleHoverLeaveId = 0;

      this._playingPlayer = null;

      this._watchTheme();
      this._buildPinButton();
      this._buildSingleRow();
      this._buildSwitcherRow();

      this._singleRow.opacity = 0;
      this._switcherRow.opacity = 0;
      this._singleRow.hide();
      this._switcherRow.hide();
    }

    _watchTheme() {
      try {
        this._themeSettings = new Gio.Settings({
          schema_id: playerConstant.INTERFACE_SCHEMA,
        });
        const keys = this._themeSettings.list_keys();
        const key =
          keys.indexOf(playerConstant.INTERFACE_KEY) !== -1
            ? playerConstant.INTERFACE_KEY
            : playerConstant.GTK_THEME_KEY;
        this._themeSettingsId = this._themeSettings.connect(
          `changed::${key}`,
          () => {
            this._dark = _isDarkTheme();
            this._refreshStyles();
          },
        );
      } catch (_) {
        this._themeSettings = null;
        this._themeSettingsId = 0;
      }
    }

    _refreshStyles() {
      if (this._tabRow) this._tabRow.style = _switcherFrameStyle(this._dark);

      for (const entry of this._buttonEntries) {
        const active = entry.playerName === this._currentActivePlayer;
        entry.button.style = active
          ? _tabActiveStyle(this._dark)
          : _tabIdleStyle(this._dark);
        entry.icon.opacity = active ? 255 : 128;
      }

      this._applyPinStyle();
    }

    _buildPinButton() {
      this._pinIcon = new St.Icon({
        icon_name: "view-pin-symbolic",
        icon_size: 14,
        y_align: Clutter.ActorAlign.CENTER,
        style: _pinIconStyle(false, this._dark),
      });

      this._pinButton = new St.Button({
        style_class: "media-tab-pin-button",
        style: _pinIdleStyle(this._dark),
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: "Pin media player popup",
      });
      this._pinButton.set_child(this._pinIcon);
      this._pinButton.set_pivot_point(0.5, 0.5);

      this._pinClickId = this._pinButton.connect("clicked", () => {
        this._togglePin();
      });

      this._pinEnterId = this._pinButton.connect("enter-event", () => {
        if (!this._pinned) {
          this._pinButton.style = _pinHoverStyle(this._dark);
          this._easeOpacity(
            this._pinIcon,
            210,
            playerConstant.ANIM_DURATION_MS,
          );
          this._easeScale(this._pinButton, 1.12, 80);
        }
      });

      this._pinLeaveId = this._pinButton.connect("leave-event", () => {
        if (!this._pinned) {
          this._pinButton.style = _pinIdleStyle(this._dark);
          this._easeOpacity(
            this._pinIcon,
            130,
            playerConstant.ANIM_DURATION_MS,
          );
          this._easeScale(this._pinButton, 1.0, 80);
        }
      });
    }

    _togglePin() {
      this._pinned = !this._pinned;
      this._applyPinStyle();
      this._pulsePinButton();
      this.emit("pin-toggled", this._pinned, this._currentActivePlayer || "");
    }

    _applyPinStyle() {
      if (!this._pinButton) return;
      if (this._pinned) {
        this._pinButton.style = _pinActiveStyle(this._dark);
        this._pinIcon.style = _pinIconStyle(true, this._dark);
        this._easeOpacity(this._pinIcon, 255, playerConstant.ANIM_DURATION_MS);
      } else {
        this._pinButton.style = _pinIdleStyle(this._dark);
        this._pinIcon.style = _pinIconStyle(false, this._dark);
        this._easeOpacity(this._pinIcon, 130, playerConstant.ANIM_DURATION_MS);
        this._easeScale(this._pinButton, 1.0, 80);
      }
    }

    _pulsePinButton() {
      if (!this._pinButton) return;
      this._easeScale(
        this._pinButton,
        playerConstant.PULSE_SCALE_UP,
        playerConstant.PULSE_UP_MS,
      );
      const tid = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        playerConstant.PULSE_UP_MS,
        () => {
          this._pulseTimers.delete(tid);
          this._easeScale(this._pinButton, 1.0, playerConstant.PULSE_DOWN_MS);
          return GLib.SOURCE_REMOVE;
        },
      );
      this._pulseTimers.add(tid);
    }

    _buildSingleRow() {
      this._singleRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: "spacing: 0px;",
      });

      this._singleIconButton = new St.Button({
        style_class: "media-single-icon-button",
        reactive: true,
        can_focus: false,
        track_hover: true,
        x_align: Clutter.ActorAlign.CENTER,
      });
      this._singleIconButton.set_pivot_point(0.5, 0.5);

      this._singleIcon = new St.Icon({
        icon_size: playerConstant.SINGLE_ICON_SIZE,
        gicon: Gio.ThemedIcon.new("audio-x-generic-symbolic"),
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin: 2px 0px;",
      });
      this._singleIconButton.set_child(this._singleIcon);

      this._singleHoverEnterId = this._singleIconButton.connect(
        "enter-event",
        () => {
          this._easeScale(this._singleIconButton, 1.06, 80);
        },
      );
      this._singleHoverLeaveId = this._singleIconButton.connect(
        "leave-event",
        () => {
          this._easeScale(this._singleIconButton, 1.0, 80);
        },
      );

      this._singleIconPressId = this._singleIconButton.connect(
        "button-press-event",
        (_actor, _event) => {
          const nowUs = GLib.get_monotonic_time();
          const deltaMs = (nowUs - this._singleIconLastPressUs) / 1000;
          this._singleIconLastPressUs = nowUs;

          if (deltaMs > 0 && deltaMs <= playerConstant.DOUBLE_CLICK_MS) {
            this._singleIconLastPressUs = 0;

            this._easeScale(this._singleIconButton, 0.82, 60);
            const squishTid = GLib.timeout_add(
              GLib.PRIORITY_DEFAULT,
              60,
              () => {
                this._pulseTimers.delete(squishTid);
                this._easeScale(this._singleIconButton, 1.0, 100);
                return GLib.SOURCE_REMOVE;
              },
            );
            this._pulseTimers.add(squishTid);

            this._togglePin();
          }

          return Clutter.EVENT_PROPAGATE;
        },
      );

      const centerBin = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      centerBin.set_child(this._singleIconButton);
      this._singleRow.add_child(centerBin);

      this.add_child(this._singleRow);
    }

    _buildSwitcherRow() {
      this._switcherRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: "spacing: 2px;",
      });

      this._tabRow = new St.BoxLayout({
        x_expand: false,
        style: _switcherFrameStyle(this._dark),
      });

      this._switcherRow.add_child(new St.Bin({ x_expand: true }));
      this._switcherRow.add_child(this._tabRow);
      this._switcherRow.add_child(new St.Bin({ x_expand: true }));

      this.add_child(this._switcherRow);
    }

    _activateSingleMode() {
      this._reparentPin(this._singleRow);
      this._switcherRow.hide();
      this._switcherRow.opacity = 0;
      this._singleRow.show();
      this._easeOpacity(this._singleRow, 255, playerConstant.ANIM_DURATION_MS);
    }

    _activateMultiMode() {
      this._reparentPin(this._switcherRow);
      this._singleRow.hide();
      this._singleRow.opacity = 0;
      this._switcherRow.show();
      this._easeOpacity(
        this._switcherRow,
        255,
        playerConstant.ANIM_DURATION_MS,
      );
    }

    _reparentPin(target) {
      if (!this._pinButton) return;
      const current = this._pinButton.get_parent();
      if (current === target) return;
      if (current) {
        try {
          current.remove_child(this._pinButton);
        } catch (_) {}
      }
      target.add_child(this._pinButton);
    }

    _easeOpacity(actor, target, ms) {
      if (!actor) return;
      try {
        actor.save_easing_state();
        actor.set_easing_duration(ms);
        actor.set_easing_mode(playerConstant.ANIM_MODE);
        actor.opacity = target;
        actor.restore_easing_state();
      } catch (_) {
        try {
          actor.opacity = target;
        } catch (__) {}
      }
    }

    _easeScale(actor, scale, ms) {
      if (!actor) return;
      try {
        actor.save_easing_state();
        actor.set_easing_duration(ms);
        actor.set_easing_mode(playerConstant.ANIM_MODE);
        actor.scale_x = scale;
        actor.scale_y = scale;
        actor.restore_easing_state();
      } catch (_) {
        try {
          actor.scale_x = scale;
          actor.scale_y = scale;
        } catch (__) {}
      }
    }

    get isPinned() {
      return this._pinned;
    }

    setPinned(value) {
      this._pinned = !!value;
      this._applyPinStyle();
    }

    // Called by the host when PlaybackStatus "Playing" moves to a different player
    // Stored separately so the tab highlight can follow the actual playing app

    notifyPlayingPlayer(playerName) {
      this._playingPlayer = playerName || null;
    }

    updateTabs(players, currentPlayer, manager) {
      const playersChanged =
        players.length !== this._currentPlayers.length ||
        players.some((p, i) => p !== this._currentPlayers[i]);
      const activeChanged = currentPlayer !== this._currentActivePlayer;

      if (!playersChanged && !activeChanged) return;

      this._currentPlayers = players.slice();
      this._currentActivePlayer = currentPlayer;
      this._dark = _isDarkTheme();

      if (players.length <= 1) {
        this._singleIcon.gicon = currentPlayer
          ? resolveGicon(currentPlayer, manager)
          : Gio.ThemedIcon.new("audio-x-generic-symbolic");

        this._activateSingleMode();
        this._cancelAllClickTimers();
        this._destroyTabButtons();
        this._tabRow.destroy_all_children();
      } else {
        this._tabRow.style = _switcherFrameStyle(this._dark);
        this._activateMultiMode();
        this._cancelAllClickTimers();
        this._destroyTabButtons();
        this._tabRow.destroy_all_children();

        for (const pName of players) {
          const entry = this._createTab(pName, currentPlayer, manager);
          this._buttonEntries.push(entry);
          this._tabRow.add_child(entry.button);
        }
      }
    }

    _createTab(playerName, currentPlayer, manager) {
      const isActive = () => playerName === this._currentActivePlayer;
      const gicon = resolveGicon(playerName, manager);
      const name = resolveDisplayName(playerName, manager);

      const button = new St.Button({
        style_class: "media-switcher-tab",
        style: isActive()
          ? _tabActiveStyle(this._dark)
          : _tabIdleStyle(this._dark),
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: false,
        accessible_name: `Switch to ${name}`,
      });
      button.set_pivot_point(0.5, 0.5);

      const icon = new St.Icon({
        gicon,
        icon_size: playerConstant.TAB_ICON_SIZE,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
      });
      icon.set_pivot_point(0.5, 0.5);
      icon.opacity = isActive() ? 255 : 128;
      button.set_child(icon);

      const handlers = [];
      let lastPressUs = 0;

      handlers.push(
        button.connect("button-press-event", (_a, _e) => {
          const nowUs = GLib.get_monotonic_time();
          const deltaMs = (nowUs - lastPressUs) / 1000;
          lastPressUs = nowUs;

          if (deltaMs > 0 && deltaMs <= playerConstant.DOUBLE_CLICK_MS) {
            lastPressUs = 0;

            const pending = this._clickTimers.get(button);
            if (pending !== undefined) {
              GLib.source_remove(pending);
              this._clickTimers.delete(button);
            }

            this._easeScale(button, 0.82, 60);
            const squishTid = GLib.timeout_add(
              GLib.PRIORITY_DEFAULT,
              60,
              () => {
                this._pulseTimers.delete(squishTid);
                this._easeScale(button, 1.0, 110);
                return GLib.SOURCE_REMOVE;
              },
            );
            this._pulseTimers.add(squishTid);

            this._togglePin();
          } else {
            this._easeScale(button, 0.88, 60);
          }

          return Clutter.EVENT_PROPAGATE;
        }),
      );

      handlers.push(
        button.connect("button-release-event", () => {
          this._easeScale(button, 1.0, 90);
          return Clutter.EVENT_PROPAGATE;
        }),
      );

      handlers.push(
        button.connect("clicked", () => {
          const existing = this._clickTimers.get(button);
          if (existing !== undefined) {
            GLib.source_remove(existing);
            this._clickTimers.delete(button);
          }

          const tid = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            playerConstant.DOUBLE_CLICK_MS,
            () => {
              this._clickTimers.delete(button);
              if (!this._currentPlayers || this._currentPlayers.length === 0)
                return GLib.SOURCE_REMOVE;
              this.emit("player-changed", playerName);
              return GLib.SOURCE_REMOVE;
            },
          );
          this._clickTimers.set(button, tid);
        }),
      );

      // Hover styles query live active state so they're always correct after
      // updateTabs rebuilds the list with a different currentActivePlayer
      handlers.push(
        button.connect("enter-event", () => {
          if (!isActive()) {
            button.style = _tabHoverStyle(this._dark);
            this._easeOpacity(icon, 215, playerConstant.ANIM_DURATION_MS);
            this._easeScale(button, 1.06, 80);
          }
        }),
      );

      handlers.push(
        button.connect("leave-event", () => {
          if (!isActive()) {
            button.style = _tabIdleStyle(this._dark);
            this._easeOpacity(icon, 128, playerConstant.ANIM_DURATION_MS);
            this._easeScale(button, 1.0, 80);
          }
        }),
      );

      return { button, icon, playerName, handlers };
    }

    _cancelAllClickTimers() {
      for (const [, id] of this._clickTimers) {
        try {
          GLib.source_remove(id);
        } catch (_) {}
      }
      this._clickTimers.clear();
    }

    _cancelAllPulseTimers() {
      for (const id of this._pulseTimers) {
        try {
          GLib.source_remove(id);
        } catch (_) {}
      }
      this._pulseTimers.clear();
    }

    _destroyTabButtons() {
      for (const { button, handlers } of this._buttonEntries) {
        for (const id of handlers) {
          try {
            button.disconnect(id);
          } catch (_) {}
        }
      }
      this._buttonEntries = [];
    }

    static clearIconCache() {
      clearIconCache();
    }

    destroy() {
      if (this._themeSettings && this._themeSettingsId) {
        try {
          this._themeSettings.disconnect(this._themeSettingsId);
        } catch (_) {}
        this._themeSettingsId = 0;
        this._themeSettings = null;
      }

      this._cancelAllClickTimers();
      this._cancelAllPulseTimers();

      if (this._singleIconButton) {
        for (const [idProp, btnProp] of [
          ["_singleIconPressId", "_singleIconButton"],
          ["_singleHoverEnterId", "_singleIconButton"],
          ["_singleHoverLeaveId", "_singleIconButton"],
        ]) {
          if (this[idProp] && this[btnProp]) {
            try {
              this[btnProp].disconnect(this[idProp]);
            } catch (_) {}
            this[idProp] = 0;
          }
        }
      }

      this._destroyTabButtons();

      if (this._pinButton) {
        for (const [prop, clear] of [
          [
            "_pinClickId",
            () => {
              this._pinClickId = 0;
            },
          ],
          [
            "_pinEnterId",
            () => {
              this._pinEnterId = 0;
            },
          ],
          [
            "_pinLeaveId",
            () => {
              this._pinLeaveId = 0;
            },
          ],
        ]) {
          if (this[prop]) {
            try {
              this._pinButton.disconnect(this[prop]);
            } catch (_) {}
            clear();
          }
        }
      }

      this._currentPlayers = [];
      this._currentActivePlayer = null;
      this._playingPlayer = null;
      this._singleRow = null;
      this._singleIcon = null;
      this._singleIconButton = null;
      this._switcherRow = null;
      this._tabRow = null;
      this._pinButton = null;
      this._pinIcon = null;

      super.destroy();
    }
  },
);

function _switcherFrameStyle(dark) {
  const bg = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const border = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  return [
    `background-color: ${bg};`,
    "border-radius: 12px;",
    "padding: 3px;",
    "spacing: 2px;",
    `border: 1px solid ${border};`,
  ].join(" ");
}

function _tabActiveStyle(dark) {
  const bg = dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.15)";
  const border = dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)";
  const shadow = dark
    ? "0 1px 6px rgba(0,0,0,0.35)"
    : "0 1px 4px rgba(0,0,0,0.18)";
  return [
    "padding: 6px 10px;",
    "border-radius: 9px;",
    `background-color: ${bg};`,
    `box-shadow: ${shadow};`,
    `border: 1px solid ${border};`,
  ].join(" ");
}

function _tabIdleStyle(_dark) {
  return "padding: 6px 10px; border-radius: 9px;";
}

function _tabHoverStyle(dark) {
  const bg = dark ? "rgba(255,255,255,0.11)" : "rgba(0,0,0,0.08)";
  const border = dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)";
  return [
    "padding: 6px 10px;",
    "border-radius: 9px;",
    `background-color: ${bg};`,
    `border: 1px solid ${border};`,
  ].join(" ");
}

function _pinIdleStyle(_dark) {
  return "padding: 5px;";
}

function _pinHoverStyle(_dark) {
  return "padding: 5px;";
}

function _pinActiveStyle(_dark) {
  return "";
}

function _pinIconStyle(pinned, dark) {
  if (pinned) return `color: ${playerConstant.PIN_ACTIVE_RED};`;
  const alpha = dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.40)";
  return `color: ${alpha};`;
}
