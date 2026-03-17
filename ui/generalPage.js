import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * @param {Gio.Settings} settings
 * @returns {Adw.PreferencesPage}
 */
export function buildGeneralPage(settings) {
  const generalPage = new Adw.PreferencesPage({
    title: _("General"),
    icon_name: "preferences-system-symbolic",
  });

  // Panel Placement 
  const panelGroup = new Adw.PreferencesGroup({
    title: _("Panel Placement"),
    description: _("Where the indicator sits in the top bar"),
  });
  generalPage.add(panelGroup);

  const positionRow = new Adw.ComboRow({ title: _("Panel Position") });
  const positionModel = new Gtk.StringList();
  [_("Left"), _("Center"), _("Right")].forEach((l) =>
    positionModel.append(l),
  );
  positionRow.model = positionModel;
  const positions = ["left", "center", "right"];
  positionRow.selected = Math.max(
    0,
    positions.indexOf(settings.get_string("panel-position")),
  );
  positionRow.connect("notify::selected", (w) =>
    settings.set_string("panel-position", positions[w.selected]),
  );
  panelGroup.add(positionRow);

  const indexRow = new Adw.SpinRow({
    title: _("Panel Index"),
    subtitle: _("Position within the panel area (-1 = automatic)"),
    adjustment: new Gtk.Adjustment({
      lower: -1,
      upper: 20,
      step_increment: 1,
      page_increment: 5,
      value: settings.get_int("panel-index"),
    }),
  });
  settings.bind(
    "panel-index",
    indexRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelGroup.add(indexRow);

  // Panel Label 
  const labelGroup = new Adw.PreferencesGroup({
    title: _("Panel Label"),
    description: _("Track name shown in the top bar"),
  });
  generalPage.add(labelGroup);

  const showTrackRow = new Adw.SwitchRow({
    title: _("Show Track Name"),
    subtitle: _("Display the current track title in the panel"),
  });
  settings.bind(
    "show-track-name",
    showTrackRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  labelGroup.add(showTrackRow);

  const showArtistRow = new Adw.SwitchRow({
    title: _("Show Artist Name"),
    subtitle: _("Append the artist name to the track title"),
  });
  settings.bind(
    "show-artist",
    showArtistRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  labelGroup.add(showArtistRow);

  const separatorRow = new Adw.EntryRow({
    title: _("Title / Artist Separator"),
    text: settings.get_string("separator-text"),
    show_apply_button: true,
  });
  separatorRow.connect("apply", () =>
    settings.set_string("separator-text", separatorRow.text),
  );
  labelGroup.add(separatorRow);

  // Panel Scrolling 
  const panelScrollGroup = new Adw.PreferencesGroup({
    title: _("Panel Scrolling"),
    description: _("Marquee scroll of the track label in the top bar"),
  });
  generalPage.add(panelScrollGroup);

  const enablePanelScrollRow = new Adw.SwitchRow({
    title: _("Enable Panel Label Scrolling"),
    subtitle: _(
      "Scroll the track/artist text one full loop then pause before repeating. " +
        "When off, the text is truncated with an ellipsis.",
    ),
  });
  settings.bind(
    "enable-panel-scroll",
    enablePanelScrollRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelScrollGroup.add(enablePanelScrollRow);

  const panelScrollSpeedRow = new Adw.SpinRow({
    title: _("Panel Scroll Speed"),
    subtitle: _("1 = slowest, 10 = fastest"),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 10,
      step_increment: 1,
      page_increment: 2,
      value: settings.get_int("scroll-speed"),
    }),
  });
  settings.bind(
    "scroll-speed",
    panelScrollSpeedRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelScrollGroup.add(panelScrollSpeedRow);

  //  System Integration 
  const systemGroup = new Adw.PreferencesGroup({
    title: _("System Integration"),
    description: _(
      "Controls how this extension interacts with other parts of GNOME Shell.",
    ),
  });
  generalPage.add(systemGroup);

  const hideDefaultExpanderRow = new Adw.ExpanderRow({
    title: _("Hide Default GNOME Media Player"),
    subtitle: _(
      "Remove the built-in media controls from the system date/time menu",
    ),
  });

  const hideDefaultToggle = new Gtk.Switch({
    active: settings.get_boolean("hide-default-player"),
    valign: Gtk.Align.CENTER,
  });
  settings.bind(
    "hide-default-player",
    hideDefaultToggle,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );

  hideDefaultExpanderRow.add_suffix(hideDefaultToggle);
  hideDefaultExpanderRow.activatable_widget = hideDefaultToggle;

  const hideDefaultInfoLabel = new Gtk.Label({
    label: _(
      "When ON, the extension hides the stock GNOME media controls that\n" +
        "normally appear in the calendar / notification panel (the date-time\n" +
        "menu). This prevents a duplicate 'now playing' widget.\n\n" +
        "The built-in controls are fully restored the moment you:\n" +
        "  \u2022 Turn this switch off, or\n" +
        "  \u2022 Disable or uninstall this extension.",
    ),
    wrap: true,
    xalign: 0,
    margin_top: 10,
    margin_bottom: 10,
    margin_start: 16,
    margin_end: 16,
    css_classes: ["dim-label"],
  });

  const hideDefaultInfoBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
  });
  hideDefaultInfoBox.append(hideDefaultInfoLabel);
  hideDefaultExpanderRow.add_row(hideDefaultInfoBox);

  systemGroup.add(hideDefaultExpanderRow);

  return generalPage;
}