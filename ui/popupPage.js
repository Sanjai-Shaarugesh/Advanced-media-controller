import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * Builds and returns the Popup Player preferences page
 *
 * @param {Gio.Settings} settings
 * @returns {Adw.PreferencesPage}
 */
export function buildPopupPage(settings) {
  const popupPage = new Adw.PreferencesPage({
    title: _("Popup Player"),
    icon_name: "media-playback-start-symbolic",
  });

  // Popup Size
  const sizeGroup = new Adw.PreferencesGroup({
    title: _("Popup Size"),
    description: _("Width of the popup media player panel (height scales with album art)"),
  });
  popupPage.add(sizeGroup);

  const popupWidthRow = new Adw.SpinRow({
    title: _("Popup Width"),
    subtitle: _("Width in pixels — album art, labels and lyrics panel all scale with this value (280 – 600 px)"),
    adjustment: new Gtk.Adjustment({
      lower: 280,
      upper: 600,
      step_increment: 10,
      page_increment: 40,
      value: settings.get_int("popup-width"),
    }),
  });
  settings.bind(
    "popup-width",
    popupWidthRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  sizeGroup.add(popupWidthRow);

  //  Title Scrolling 
  const titleScrollGroup = new Adw.PreferencesGroup({
    title: _("Title Scrolling"),
    description: _("Marquee behaviour for the track title inside the popup"),
  });
  popupPage.add(titleScrollGroup);

  const enableTitleScrollRow = new Adw.SwitchRow({
    title: _("Enable Title Scrolling"),
    subtitle: _(
      "Scroll long track titles from start to end, pause, then repeat. " +
        "When off, the text is truncated with an ellipsis.",
    ),
  });
  settings.bind(
    "enable-title-scroll",
    enableTitleScrollRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  titleScrollGroup.add(enableTitleScrollRow);

  const titleScrollSpeedRow = new Adw.SpinRow({
    title: _("Title Scroll Speed"),
    subtitle: _("1 = slowest, 10 = fastest"),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 10,
      step_increment: 1,
      page_increment: 2,
      value: settings.get_int("title-scroll-speed"),
    }),
  });
  settings.bind(
    "title-scroll-speed",
    titleScrollSpeedRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  titleScrollGroup.add(titleScrollSpeedRow);

  //  Artist Scrolling 
  const artistScrollGroup = new Adw.PreferencesGroup({
    title: _("Artist Scrolling"),
    description: _("Marquee behaviour for the artist name inside the popup"),
  });
  popupPage.add(artistScrollGroup);

  const enableArtistScrollRow = new Adw.SwitchRow({
    title: _("Enable Artist Scrolling"),
    subtitle: _(
      "Scroll long artist names from start to end, pause, then repeat. " +
        "When off, the text is truncated with an ellipsis.",
    ),
  });
  settings.bind(
    "enable-artist-scroll",
    enableArtistScrollRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  artistScrollGroup.add(enableArtistScrollRow);

  const artistScrollSpeedRow = new Adw.SpinRow({
    title: _("Artist Scroll Speed"),
    subtitle: _("1 = slowest, 10 = fastest"),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 10,
      step_increment: 1,
      page_increment: 2,
      value: settings.get_int("artist-scroll-speed"),
    }),
  });
  settings.bind(
    "artist-scroll-speed",
    artistScrollSpeedRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  artistScrollGroup.add(artistScrollSpeedRow);

  // ── Album Art & Vinyl ────────────────────────────────────────────────────
  const albumArtGroup = new Adw.PreferencesGroup({
    title: _("Album Art"),
    description: _("Vinyl-record rotation animation"),
  });
  popupPage.add(albumArtGroup);

  const enableRotationRow = new Adw.SwitchRow({
    title: _("Enable Vinyl Record Rotation (Global Default)"),
    subtitle: _(
      "Global default when no per-app setting exists. " +
        "Per-app overrides in the \u2018Vinyl Apps\u2019 section take priority.",
    ),
    icon_name: "media-optical-cd-audio-symbolic",
  });
  settings.bind(
    "enable-album-art-rotation",
    enableRotationRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  albumArtGroup.add(enableRotationRow);

  const rotationSpeedRow = new Adw.SpinRow({
    title: _("Rotation Speed (seconds per revolution)"),
    subtitle: _("5 = fastest, 60 = slowest. Recommended: 20\u201330"),
    adjustment: new Gtk.Adjustment({
      lower: 5,
      upper: 60,
      step_increment: 1,
      page_increment: 5,
      value: settings.get_int("album-art-rotation-speed"),
    }),
  });
  settings.bind(
    "album-art-rotation-speed",
    rotationSpeedRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  albumArtGroup.add(rotationSpeedRow);

  const rotationInfoRow = new Adw.ExpanderRow({
    title: _("Vinyl Effect Details"),
    subtitle: _("How the animated vinyl record works"),
    icon_name: "dialog-information-symbolic",
  });
  const infoLabel = new Gtk.Label({
    label: _(
      "- Album cover appears on a spinning vinyl disc\n" +
        "- Black vinyl grooves are visible around the edges\n" +
        "- Animated tonearm moves in and out with playback state\n" +
        "- Rotation pauses smoothly when music pauses\n" +
        "  (disc angle is preserved and resumes from the same position)\n" +
        "- Disc resets to 0\u00b0 only on a genuine Stop\n" +
        "- Double-click album art to toggle vinyl for THAT player\u2019s app only\n" +
        "- Per-app settings override the global default above\n" +
        "- All seen apps are stored; re-enable any time from Vinyl Apps page",
    ),
    wrap: true,
    xalign: 0,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
    css_classes: ["dim-label"],
  });
  const infoBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  infoBox.append(infoLabel);
  rotationInfoRow.add_row(infoBox);
  albumArtGroup.add(rotationInfoRow);

  //  Tonearm Angles 
  const tonearmGroup = new Adw.PreferencesGroup({
    title: _("Tonearm Angles"),
    description: _("Control how far the animated tonearm swings when playing or at rest"),
  });
  popupPage.add(tonearmGroup);

  const parkedAngleRow = new Adw.SpinRow({
    title: _("Parked (resting) angle"),
    subtitle: _("Degrees from vertical when music is paused or stopped. Higher moves the arm further from the disc (10 – 60°)"),
    adjustment: new Gtk.Adjustment({
      lower: 10,
      upper: 60,
      step_increment: 1,
      page_increment: 5,
      value: settings.get_int("tonearm-parked-angle"),
    }),
  });
  settings.bind(
    "tonearm-parked-angle",
    parkedAngleRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  tonearmGroup.add(parkedAngleRow);

  const playingAngleRow = new Adw.SpinRow({
    title: _("Playing angle"),
    subtitle: _("Degrees from vertical when the stylus rests on the groove. Lower brings the arm closer to the disc centre (0 – 30°)"),
    adjustment: new Gtk.Adjustment({
      lower: 0,
      upper: 30,
      step_increment: 1,
      page_increment: 3,
      value: settings.get_int("tonearm-playing-angle"),
    }),
  });
  settings.bind(
    "tonearm-playing-angle",
    playingAngleRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  tonearmGroup.add(playingAngleRow);

  const tonearmNote = new Adw.ActionRow({
    title: _("Tip: parked angle must be greater than playing angle"),
    subtitle: _("E.g. parked = 25°, playing = 8°. If they are equal or reversed the arm will animate incorrectly."),
    activatable: false,
  });
  tonearmNote.add_prefix(
    new Gtk.Image({
      icon_name: "dialog-information-symbolic",
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
    }),
  );
  tonearmGroup.add(tonearmNote);

  //  Album Art Click Thresholds
  const clickGroup = new Adw.PreferencesGroup({
    title: _("Album Art Click Thresholds"),
    description: _("Set how many rapid clicks trigger each album art action"),
  });
  popupPage.add(clickGroup);

  const vinylClickRow = new Adw.SpinRow({
    title: _("Clicks to toggle vinyl effect"),
    subtitle: _(
      "Rapidly click the album art this many times to enable or disable the vinyl record style for the current app",
    ),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 5,
      step_increment: 1,
      page_increment: 1,
      value: settings.get_int("vinyl-click-count"),
    }),
  });
  settings.bind(
    "vinyl-click-count",
    vinylClickRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  clickGroup.add(vinylClickRow);

  const lyricsClickRow = new Adw.SpinRow({
    title: _("Clicks to toggle lyrics view"),
    subtitle: _(
      "Rapidly click the album art this many times to open or close the synced lyrics panel",
    ),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 5,
      step_increment: 1,
      page_increment: 1,
      value: settings.get_int("lyrics-click-count"),
    }),
  });
  settings.bind(
    "lyrics-click-count",
    lyricsClickRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  clickGroup.add(lyricsClickRow);

  const thresholdNote = new Adw.ActionRow({
    title: _("Note: thresholds must be different"),
    subtitle: _(
      "If both thresholds are set to the same number the lyrics action takes priority. Use distinct values (e.g. 2 for vinyl, 3 for lyrics) to trigger both independently.",
    ),
    activatable: false,
  });
  thresholdNote.add_prefix(
    new Gtk.Image({
      icon_name: "dialog-warning-symbolic",
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
      css_classes: ["warning"],
    }),
  );
  clickGroup.add(thresholdNote);

  return popupPage;
}