import {
  Extension,
  gettext as _,
  InjectionManager,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import GLib from "gi://GLib";
import { MediaIndicator } from "./utils/indicator.js";
import * as Mpris from "resource:///org/gnome/shell/ui/mpris.js";

export default class MediaExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._repositionDebounceId = null;
    this._settingsChangedId = 0;
    this._hideDefaultChangedId = null;
    this._injectionManager = null;

    this._indicator = new MediaIndicator(this._settings, this);
    this._addToPanel();

    this._applyHideDefaultPlayer(
      this._settings.get_boolean("hide-default-player"),
    );

    this._hideDefaultChangedId = this._settings.connect(
      "changed::hide-default-player",
      () => this._applyHideDefaultPlayer(this._updateDefaultPlayerVisibility()),
    );

    this._updateDefaultPlayerVisibility();

    this._settingsChangedId = this._settings.connect("changed", (_, key) => {
      if (key !== "panel-position" && key !== "panel-index") return;

      if (this._repositionDebounceId) {
        GLib.source_remove(this._repositionDebounceId);
        this._repositionDebounceId = null;
      }

      this._repositionDebounceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT_IDLE,
        150,
        () => {
          this._repositionDebounceId = null;
          this._repositionIndicator();
          return GLib.SOURCE_REMOVE;
        },
      );
    });
  }

  disable() {
    if (this._repositionDebounceId) {
      GLib.source_remove(this._repositionDebounceId);
      this._repositionDebounceId = null;
    }

    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }

    if (this._hideDefaultChangedId) {
      this._settings.disconnect(this._hideDefaultChangedId);
      this._hideDefaultChangedId = null;
    }

    this._applyHideDefaultPlayer(false);

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._updateDefaultPlayerVisibility(true);

    this._settings = null;
    this._injectionManager = null;
  }

  get _statusAreaKey() {
    return `media-controls-${this.uuid}`;
  }

  _addToPanel() {
    const { position, index } = this._getPanelPlacement();
    Main.panel.addToStatusArea(
      this._statusAreaKey,
      this._indicator,
      index,
      position,
    );
  }

  _repositionIndicator() {
    if (!this._indicator) return;

    try {
      const container = this._indicator.container;
      const parent = container.get_parent?.();
      if (parent) parent.remove_child(container);

      if (Main.panel.statusArea[this._statusAreaKey])
        delete Main.panel.statusArea[this._statusAreaKey];

      const { position, index } = this._getPanelPlacement();
      Main.panel.addToStatusArea(
        this._statusAreaKey,
        this._indicator,
        index,
        position,
      );
    } catch (e) {
      console.error("[advanced-media-controller] reposition failed:", e);
    }
  }

  /**
   * @returns {{ position: string, index: number }}
   */
  _getPanelPlacement() {
    const position = this._settings.get_string("panel-position");
    const rawIndex = this._settings.get_int("panel-index");

    const boxMap = {
      left: "_leftBox",
      center: "_centerBox",
      right: "_rightBox",
    };
    const targetBox = Main.panel[boxMap[position] ?? "_rightBox"];
    const index =
      rawIndex === -1 ? 0 : Math.min(rawIndex, targetBox.get_n_children());

    return { position, index };
  }

  _applyHideDefaultPlayer(hide) {
    try {
      const dateMenu = Main.panel.statusArea?.dateMenu;
      if (!dateMenu) return;

      const mediaSection = dateMenu._messageList?._mediaSection;
      if (mediaSection) {
        mediaSection.visible = !hide;
        return;
      }

      const messageList = dateMenu._messageList;
      if (!messageList) return;

      let found = false;
      let child = messageList.get_first_child?.();
      while (child) {
        const ctorName = child.constructor?.name ?? "";
        if (
          ctorName === "MediaSection" ||
          ctorName === "MprisSection" ||
          ctorName === "MprisSource"
        ) {
          child.visible = !hide;
          found = true;
          break;
        }
        child = child.get_next_sibling?.();
      }

      if (!found) {
        console.info(
          "[advanced-media-controller] hide-default-player: " +
            "native media section not found on this GNOME Shell version. " +
            "The setting has no effect here.",
        );
      }
    } catch (e) {
      console.error("[advanced-media-controller] _applyHideDefaultPlayer:", e);
    }
  }

  _updateDefaultPlayerVisibility(shouldReset = false) {
    if (!this._settings) return;
    const hide = this._settings.get_boolean("hide-default-player");

    const MprisSource = Mpris.MprisSource ?? Mpris.MediaSection;
    const mediaSection =
      Main.panel.statusArea.dateMenu?._messageList?._messageView
        ?._mediaSource ??
      Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
    const qsMedia =
      Main.panel.statusArea.quickSettings?._media ||
      Main.panel.statusArea.quickSettings?._mediaSection;

    if (shouldReset || hide === false) {
      if (this._injectionManager) {
        this._injectionManager.clear();
        this._injectionManager = null;
      }

      if (mediaSection && mediaSection._onProxyReady)
        mediaSection._onProxyReady();
      if (qsMedia && qsMedia._onProxyReady) qsMedia._onProxyReady();
    } else if (!this._injectionManager && hide === true) {
      this._injectionManager = new InjectionManager();
      this._injectionManager.overrideMethod(
        MprisSource.prototype,
        "_addPlayer",
        () => {
          return function () {};
        },
      );

      [mediaSection, qsMedia].forEach((section) => {
        if (section && section._players) {
          for (const player of section._players.values()) {
            const busName = player._busName || player.busName;
            if (section._onNameOwnerChanged) {
              section._onNameOwnerChanged(null, null, [busName, busName, ""]);
            }
          }
        }
      });
    }
  }
}
