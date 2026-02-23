import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import GLib from "gi://GLib";
import { MediaIndicator } from "./utils/indicator.js";

export default class MediaExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._repositionDebounceId = null;
    this._settingsChangedId = 0;

    this._indicator = new MediaIndicator(this._settings, this);
    this._addToPanel();

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

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._settings = null;
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
      console.error("MediaControls: failed to reposition indicator:", e);
    }
  }

  /**

   * @returns {{ position: string, index: number }}
   */
  _getPanelPlacement() {
    const position = this._settings.get_string("panel-position"); // "left"|"center"|"right"
    const rawIndex = this._settings.get_int("panel-index"); // -1 = automatic → 0

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
}
