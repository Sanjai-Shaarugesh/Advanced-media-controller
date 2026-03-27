import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} settings
 */
export function buildLyricsPage(page, settings) {
  //  Synced Lyrics 
  const enableGroup = new Adw.PreferencesGroup({
    title: _("Synced Lyrics"),
    description: _(
      "Time-synced lyrics fetched from lrclib.net — free, no account needed",
    ),
  });
  page.add(enableGroup);

  const enableLyricsRow = new Adw.SwitchRow({
    title: _("Enable Synced Lyrics"),
    subtitle: _(
      "Fetch and display scrolling lyrics that follow the current playback position",
    ),
    icon_name: "audio-x-generic-symbolic",
  });
  settings.bind(
    "enable-lyrics",
    enableLyricsRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  enableGroup.add(enableLyricsRow);

  //  How to Use Lyrics 
  const howtoGroup = new Adw.PreferencesGroup({
    title: _("How to Use Lyrics"),
    description: _(
      "Lyrics are tied to each player tab independently — Spotify and Firefox each remember their own setting",
    ),
  });
  page.add(howtoGroup);

  let lyricsN = 3;
  try {
    lyricsN = settings.get_int("lyrics-click-count");
  } catch (_e) {}
  lyricsN = Math.max(1, Math.min(5, lyricsN));
  const clickWord = (n) =>
    n === 1 ? _("once") : n === 2 ? _("twice") : _("%d times").format(n);

  const steps = [
    {
      icon: "media-playback-start-symbolic",
      title: _("Start playing a song"),
      subtitle: _(
        "Open any media player or browser tab (Spotify, YouTube Music, VLC, Rhythmbox\u2026) and play a track so it appears in the panel.",
      ),
    },
    {
      icon: "input-mouse-symbolic",
      title: _("Open the popup player"),
      subtitle: _(
        "Click the media controller icon in the top panel to open the popup. You\u2019ll see the album art, track title, and playback controls.",
      ),
    },
    {
      icon: "go-jump-symbolic",
      
      title: _("Click the album art %s to show lyrics").format(
        clickWord(lyricsN),
      ),
      subtitle: _(
        "Click the album art in quick succession. The cover image will be replaced by the lyrics panel, which scrolls automatically in time with the music.",
      ),
    },
    {
      icon: "go-first-symbolic",
      title: _("Single-click the lyrics panel to go back"),
      subtitle: _(
        "Tap anywhere on the lyrics panel once to dismiss it and return to the album art — vinyl or normal cover, whichever that app uses.",
      ),
    },
    {
      icon: "media-optical-cd-audio-symbolic",
      title: _("Click again to re-open"),
      subtitle: _(
        "You can toggle the lyrics panel as many times as you like. Each player tab remembers independently whether lyrics are open.",
      ),
    },
  ];

  steps.forEach(({ icon, title, subtitle }) => {
    const row = new Adw.ActionRow({ title, subtitle, activatable: false });
    row.add_prefix(
      new Gtk.Image({
        icon_name: icon,
        pixel_size: 22,
        valign: Gtk.Align.CENTER,
        css_classes: ["accent"],
      }),
    );
    howtoGroup.add(row);
  });

  // Lyrics Behaviour 
  const detailsGroup = new Adw.PreferencesGroup({
    title: _("Lyrics Behaviour"),
    description: _("What happens behind the scenes"),
  });
  page.add(detailsGroup);

  const detailsRow = new Adw.ExpanderRow({
    title: _("Lyrics details & edge cases"),
    subtitle: _("What to expect when the lyrics panel is open"),
    icon_name: "dialog-information-symbolic",
  });

  const detailsLabel = new Gtk.Label({
    label: _(
      "Source\n" +
        "  \u2022 Lyrics are fetched from lrclib.net — a free, open public database\n" +
        "  \u2022 No account or API key is required; the request is made silently in the background\n" +
        "\n" +
        "Display\n" +
        "  \u2022 The active lyric line is shown larger and centred in the panel\n" +
        "  \u2022 The line above and below are shown at medium size; all others fade out\n" +
        "  \u2022 The panel scrolls smoothly so the active line is always in view\n" +
        "\n" +
        "Track changes\n" +
        "  \u2022 When a new song starts while the lyrics panel is open, the view clears\n" +
        "    and new lyrics are fetched automatically\n" +
        "  \u2022 If no lyrics are found, a \u201cNo lyrics found\u201d message is shown\n" +
        "\n" +
        "Multiple players\n" +
        "  \u2022 Each player tab (Spotify, YouTube, VLC\u2026) has its own independent\n" +
        "    lyrics toggle — opening lyrics for one player does not affect any other\n" +
        "  \u2022 Switching tabs restores the correct view (lyrics or album art) for\n" +
        "    the player you switch to\n" +
        "\n" +
        "Seeking\n" +
        "  \u2022 When you seek forward or backward, the highlighted line jumps\n" +
        "    instantly to the correct position",
    ),
    wrap: true,
    xalign: 0,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
    css_classes: ["dim-label"],
  });

  const detailsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  detailsBox.append(detailsLabel);
  detailsRow.add_row(detailsBox);
  detailsGroup.add(detailsRow);

  //  Album Art Click Actions cheat-sheet 
  const cheatGroup = new Adw.PreferencesGroup({
    title: _("Album Art Click Actions"),
    description: _(
      "Summary of what each click pattern does on the album art cover",
    ),
  });
  page.add(cheatGroup);

  const nClicks = (n) => (n === 1 ? _("1 click") : _("%d clicks").format(n));

  const makeSubtitle = (vc, lc) => [
    {
      icon: "input-mouse-symbolic",
      title: _("Single click"),
      subtitle: _(
        "When lyrics are showing: closes the lyrics panel and returns to the album art",
      ),
    },
    {
      icon: "input-mouse-symbolic",
      title: _("%s — toggle vinyl effect").format(nClicks(vc)),
      subtitle: _(
        "Toggles the spinning vinyl record effect for that specific app (remembered independently per app)",
      ),
    },
    {
      icon: "input-mouse-symbolic",
      title: _("%s — toggle lyrics").format(nClicks(lc)),
      subtitle: _(
        "Toggles the synced lyrics panel for the current player tab (remembered independently per player)",
      ),
    },
  ];

  let cheatRows = [];
  const renderCheatRows = (vc, lc) => {
    for (const r of cheatRows) cheatGroup.remove(r);
    cheatRows = [];

    makeSubtitle(vc, lc).forEach(({ icon, title, subtitle }) => {
      const row = new Adw.ActionRow({ title, subtitle, activatable: false });
      row.add_prefix(
        new Gtk.Image({
          icon_name: icon,
          pixel_size: 22,
          valign: Gtk.Align.CENTER,
        }),
      );
      cheatGroup.add(row);
      cheatRows.push(row);
    });
  };

  renderCheatRows(
    settings.get_int("vinyl-click-count"),
    settings.get_int("lyrics-click-count"),
  );

  const cheatVinylId = settings.connect("changed::vinyl-click-count", () => {
    renderCheatRows(
      settings.get_int("vinyl-click-count"),
      settings.get_int("lyrics-click-count"),
    );
  });
  const cheatLyricsId = settings.connect(
    "changed::lyrics-click-count",
    () => {
      renderCheatRows(
        settings.get_int("vinyl-click-count"),
        settings.get_int("lyrics-click-count"),
      );
    },
  );

  page.connect("destroy", () => {
    settings.disconnect(cheatVinylId);
    settings.disconnect(cheatLyricsId);
  });

  // Data Source 
  const sourceGroup = new Adw.PreferencesGroup({
    title: _("Data Source"),
    description: _("Where lyrics come from"),
  });
  page.add(sourceGroup);

  const lrclibRow = new Adw.ActionRow({
    title: _("lrclib.net"),
    subtitle: _(
      "Free, open-source time-synced lyrics database — no sign-up, no tracking, no ads",
    ),
    activatable: true,
  });
  lrclibRow.add_prefix(
    new Gtk.Image({
      icon_name: "network-wireless-symbolic",
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
    }),
  );
  lrclibRow.add_suffix(
    new Gtk.Image({
      icon_name: "adw-external-link-symbolic",
      pixel_size: 16,
      valign: Gtk.Align.CENTER,
    }),
  );
  lrclibRow.connect("activated", () => {
    try {
      Gio.AppInfo.launch_default_for_uri("https://lrclib.net", null);
    } catch (e) {
      console.error("Could not open lrclib.net:", e);
    }
  });
  sourceGroup.add(lrclibRow);

  const privacyRow = new Adw.ActionRow({
    title: _("Privacy note"),
    subtitle: _(
      "A request containing the track title, artist, album and duration is sent to lrclib.net when you open the lyrics panel. No personal data or user identifiers are included.",
    ),
    activatable: false,
  });
  privacyRow.add_prefix(
    new Gtk.Image({
      icon_name: "security-high-symbolic",
      pixel_size: 20,
      valign: Gtk.Align.CENTER,
    }),
  );
  sourceGroup.add(privacyRow);
}