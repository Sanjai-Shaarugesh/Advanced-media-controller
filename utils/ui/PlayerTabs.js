import St from "gi://St";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import {
  resolveGicon,
  resolveDisplayName,
  clearIconCache,
} from "../icon/IconResolver.js";

// Animation
const ANIM_DURATION_MS = 160;
const ANIM_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;
const TAB_ICON_SIZE = 22; // px — inside switcher tabs
const SINGLE_ICON_SIZE = 32; // px — single-player centred icon

// Pin-active red
const PIN_ACTIVE_RED = "#e01b24";

//  GSettings schema for detecting light/dark preference
const INTERFACE_SCHEMA = "org.gnome.desktop.interface";
const INTERFACE_KEY = "color-scheme"; // "prefer-dark" | "default"
const GTK_THEME_KEY = "gtk-theme"; // legacy (GNOME ≤ 42)

// Theme detection helpers

/**
 * Return true when the desktop is currently running a dark colour scheme

 * @returns {boolean}
 */
function _isDarkTheme() {
  try {
    const settings = new Gio.Settings({ schema_id: INTERFACE_SCHEMA });
    // GNOME 42+ has color-scheme key
    const keys = settings.list_keys();
    if (keys.indexOf(INTERFACE_KEY) !== -1) {
      return settings.get_string(INTERFACE_KEY) === "prefer-dark";
    }
    // GNOME 40-41 fallback
    if (keys.indexOf(GTK_THEME_KEY) !== -1) {
      return settings.get_string(GTK_THEME_KEY).toLowerCase().includes("dark");
    }
  } catch (_) {}
  return true;
}

// PlayerTabs widget

export const PlayerTabs = GObject.registerClass(
  {
    Signals: {
      /**
       * Emitted when a tab is clicked
       * @param {string} playerName  MPRIS bus name
       */
      "player-changed": { param_types: [GObject.TYPE_STRING] },
      /**
       * Emitted when the pin button is toggled.
       * @param {boolean} pinned  New state
       */
      "pin-toggled": { param_types: [GObject.TYPE_BOOLEAN] },
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

      // Theme-change listener
      this._themeSettingsId = 0;
      this._themeSettings = null;
      this._watchTheme();

      this._buildPinButton();
      this._buildSingleRow();
      this._buildSwitcherRow();

      this._singleRow.opacity = 0;
      this._switcherRow.opacity = 0;
      this._singleRow.hide();
      this._switcherRow.hide();
    }

    // Theme-change watcher

    _watchTheme() {
      try {
        this._themeSettings = new Gio.Settings({ schema_id: INTERFACE_SCHEMA });

        // Listen on color-scheme if available (GNOME 42+)
        const keys = this._themeSettings.list_keys();
        const key =
          keys.indexOf(INTERFACE_KEY) !== -1 ? INTERFACE_KEY : GTK_THEME_KEY;

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

    // Refresh all dynamic styles when the theme changes without rebuilding

    _refreshStyles() {
      // Re-apply the switcher frame background
      if (this._tabRow) {
        this._tabRow.style = _switcherFrameStyle(this._dark);
      }

      // Re-apply active/idle styles for each tab
      for (const entry of this._buttonEntries) {
        const isActive = entry.playerName === this._currentActivePlayer;
        entry.button.style = isActive
          ? _tabActiveStyle(this._dark)
          : _tabIdleStyle(this._dark);
        entry.icon.opacity = isActive ? 255 : 128;
      }

      // Re-apply pin styles
      this._applyPinStyle();
    }

    // Pin button

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
        this._pinned = !this._pinned;
        this._applyPinStyle();
        this.emit("pin-toggled", this._pinned);
      });

      this._pinEnterId = this._pinButton.connect("enter-event", () => {
        if (!this._pinned) {
          this._pinButton.style = _pinHoverStyle(this._dark);
          this._easeOpacity(this._pinIcon, 210, ANIM_DURATION_MS);
          this._easeScale(this._pinButton, 1.12, 100);
        }
      });

      this._pinLeaveId = this._pinButton.connect("leave-event", () => {
        if (!this._pinned) {
          this._pinButton.style = _pinIdleStyle(this._dark);
          this._easeOpacity(this._pinIcon, 130, ANIM_DURATION_MS);
          this._easeScale(this._pinButton, 1.0, 100);
        }
      });
    }

    _applyPinStyle() {
      if (!this._pinButton) return;

      if (this._pinned) {
        this._pinButton.style = _pinActiveStyle(this._dark);
        this._pinIcon.style = _pinIconStyle(true, this._dark); // red
        this._easeOpacity(this._pinIcon, 255, ANIM_DURATION_MS);
        this._easeScale(this._pinButton, 1.0, 100);
      } else {
        this._pinButton.style = _pinIdleStyle(this._dark);
        this._pinIcon.style = _pinIconStyle(false, this._dark); // muted
        this._easeOpacity(this._pinIcon, 130, ANIM_DURATION_MS);
        this._easeScale(this._pinButton, 1.0, 100);
      }
    }

    _buildSingleRow() {
      this._singleRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: "spacing: 0px;",
      });

      this._singleRow.add_child(new St.Bin({ x_expand: true }));

      this._singleIcon = new St.Icon({
        icon_size: SINGLE_ICON_SIZE,
        gicon: Gio.ThemedIcon.new("audio-x-generic-symbolic"),
        y_align: Clutter.ActorAlign.CENTER,
        style: "margin: 2px 0px;",
      });
      this._singleRow.add_child(this._singleIcon);

      this._singleRow.add_child(new St.Bin({ x_expand: true }));
      // Pin appended in _activateSingleMode()

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

      // Centre the tab row
      const tabSpacer1 = new St.Bin({ x_expand: true });
      const tabSpacer2 = new St.Bin({ x_expand: true });
      this._switcherRow.add_child(tabSpacer1);
      this._switcherRow.add_child(this._tabRow);
      this._switcherRow.add_child(tabSpacer2);

      this.add_child(this._switcherRow);
    }

    // Mode activation

    _activateSingleMode() {
      this._reparentPin(this._singleRow);
      this._switcherRow.hide();
      this._switcherRow.opacity = 0;
      this._singleRow.show();
      this._easeOpacity(this._singleRow, 255, ANIM_DURATION_MS * 2);
    }

    _activateMultiMode() {
      this._reparentPin(this._switcherRow);
      this._singleRow.hide();
      this._singleRow.opacity = 0;
      this._switcherRow.show();
      this._easeOpacity(this._switcherRow, 255, ANIM_DURATION_MS * 2);
    }

    /**
     * Safely move the pin button to a new parent container
     * @param {St.BoxLayout} target
     */
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

    // Animation helpers

    _easeOpacity(actor, targetOpacity, durationMs) {
      if (!actor) return;
      try {
        actor.save_easing_state();
        actor.set_easing_duration(durationMs);
        actor.set_easing_mode(ANIM_MODE);
        actor.opacity = targetOpacity;
        actor.restore_easing_state();
      } catch (_) {
        try {
          actor.opacity = targetOpacity;
        } catch (__) {}
      }
    }

    _easeScale(actor, scale, durationMs) {
      if (!actor) return;
      try {
        actor.save_easing_state();
        actor.set_easing_duration(durationMs);
        actor.set_easing_mode(ANIM_MODE);
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

    /** @returns {boolean} */
    get isPinned() {
      return this._pinned;
    }

    /**
     * Restore pin state from GSettings without emitting "pin-toggled"
     * @param {boolean} value
     */
    setPinned(value) {
      this._pinned = !!value;
      this._applyPinStyle();
    }

    updateTabs(players, currentPlayer, manager) {
      const playersChanged =
        players.length !== this._currentPlayers.length ||
        players.some((p, i) => p !== this._currentPlayers[i]);
      const activeChanged = currentPlayer !== this._currentActivePlayer;

      if (!playersChanged && !activeChanged) return;

      this._currentPlayers = players.slice();
      this._currentActivePlayer = currentPlayer;

      // Refresh dark/light state on every update
      this._dark = _isDarkTheme();

      if (players.length <= 1) {
        //  Single-player
        this._singleIcon.gicon = currentPlayer
          ? resolveGicon(currentPlayer, manager)
          : Gio.ThemedIcon.new("audio-x-generic-symbolic");

        this._activateSingleMode();
        this._destroyTabButtons();
        this._tabRow.destroy_all_children();
      } else {
        //  Multi-player
        this._tabRow.style = _switcherFrameStyle(this._dark);
        this._activateMultiMode();
        this._destroyTabButtons();
        this._tabRow.destroy_all_children();

        for (const pName of players) {
          const entry = this._createTab(pName, currentPlayer, manager);
          this._buttonEntries.push(entry);
          this._tabRow.add_child(entry.button);
        }
      }
    }

    // Tab creation

    _createTab(playerName, currentPlayer, manager) {
      const isActive = playerName === currentPlayer;
      const gicon = resolveGicon(playerName, manager);
      const name = resolveDisplayName(playerName, manager);

      //  Button shell
      const button = new St.Button({
        style_class: "media-switcher-tab",
        style: isActive
          ? _tabActiveStyle(this._dark)
          : _tabIdleStyle(this._dark),
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: false,
        accessible_name: `Switch to ${name}`,
      });
      button.set_pivot_point(0.5, 0.5);

      //  Icon
      const icon = new St.Icon({
        gicon,
        icon_size: TAB_ICON_SIZE,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
      });
      icon.set_pivot_point(0.5, 0.5);
      icon.opacity = isActive ? 255 : 128;

      button.set_child(icon);

      const handlers = [];

      handlers.push(
        button.connect("clicked", () => {
          this.emit("player-changed", playerName);
        }),
      );

      handlers.push(
        button.connect("enter-event", () => {
          if (!isActive) {
            button.style = _tabHoverStyle(this._dark);
            this._easeOpacity(icon, 215, ANIM_DURATION_MS);
            this._easeScale(button, 1.06, 100);
          }
        }),
      );

      handlers.push(
        button.connect("leave-event", () => {
          if (!isActive) {
            button.style = _tabIdleStyle(this._dark);
            this._easeOpacity(icon, 128, ANIM_DURATION_MS);
            this._easeScale(button, 1.0, 100);
          }
        }),
      );

      handlers.push(
        button.connect("button-press-event", () => {
          this._easeScale(button, 0.88, 80);
          return Clutter.EVENT_PROPAGATE;
        }),
      );

      handlers.push(
        button.connect("button-release-event", () => {
          this._easeScale(button, 1.0, 120);
          return Clutter.EVENT_PROPAGATE;
        }),
      );

      return { button, icon, playerName, handlers };
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

      this._destroyTabButtons();

      if (this._pinButton) {
        const pairs = [
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
        ];
        for (const [prop, clear] of pairs) {
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
      this._singleRow = null;
      this._singleIcon = null;
      this._switcherRow = null;
      this._tabRow = null;
      this._pinButton = null;
      this._pinIcon = null;

      super.destroy();
    }
  },
);

//  Libadwaita StackSwitcher outer frame
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

// Tab active selected page

function _tabActiveStyle(dark) {
  // Dark
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

// Tab idle unselected
function _tabIdleStyle(_dark) {
  return "padding: 6px 10px; border-radius: 9px;";
}

// Tab hovered unselected
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

//  Pin button states

function _pinIdleStyle(dark) {
  return "padding: 5px; border-radius: 8px; margin-left: 6px;";
}

function _pinHoverStyle(dark) {
  const bg = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  return [
    "padding: 5px;",
    "border-radius: 8px;",
    "margin-left: 6px;",
    `background-color: ${bg};`,
  ].join(" ");
}

function _pinActiveStyle(dark) {
  const bg = dark ? "rgba(224,27,36,0.18)" : "rgba(224,27,36,0.12)";
  const border = dark ? "rgba(224,27,36,0.35)" : "rgba(224,27,36,0.25)";
  return [].join(" ");
}

function _pinIconStyle(pinned, dark) {
  if (pinned) return `color: ${PIN_ACTIVE_RED};`;

  const alpha = dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.40)";
  return `color: ${alpha};`;
}
