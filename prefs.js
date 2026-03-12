import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * Returns true when an app id belongs to a browser.
 * @param {string} appId lower-cased canonical id (no .desktop)
 */
function _isBrowserId(appId) {
  if (!appId) return false;
  const BROWSER_FRAGMENTS = [
    "google-chrome",
    "chrome",
    "chromium",
    "chromium-browser",
    "brave",
    "brave-browser",
    "com.brave.browser",
    "firefox",
    "org.mozilla.firefox",
    "firefox-esr",
    "microsoft-edge",
    "msedge",
    "com.microsoft.edge",
    "vivaldi",
    "opera",
    "epiphany",
    "org.gnome.epiphany",
    "midori",
    "falkon",
  ];
  const lower = appId.toLowerCase();
  return BROWSER_FRAGMENTS.some(
    (f) => lower.includes(f) || f.includes(lower.split(".").pop()),
  );
}

function _slugify(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-");
}

function _parseBrowserSourceId(id) {
  if (!id || !id.includes("--")) return null;
  const idx = id.indexOf("--");
  return { browser: id.slice(0, idx), source: id.slice(idx + 2) };
}

function _labelForId(id) {
  const parsed = _parseBrowserSourceId(id);
  if (!parsed) return id;
  const sourceLabel = parsed.source
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const browserLabels = {
    "google-chrome": "Chrome",
    chromium: "Chromium",
    "chromium-browser": "Chromium",
    brave: "Brave",
    "brave-browser": "Brave",
    firefox: "Firefox",
    "org-mozilla-firefox": "Firefox",
    "microsoft-edge": "Edge",
    msedge: "Edge",
    vivaldi: "Vivaldi",
    opera: "Opera",
    epiphany: "Web",
    midori: "Midori",
    falkon: "Falkon",
  };
  const browserLabel = browserLabels[parsed.browser] ?? parsed.browser;
  return `${sourceLabel} (${browserLabel})`;
}

export default class MediaControlsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    window.set_title(_("Advanced Media Controller"));
    window.set_default_size(700, 760);
    window.set_resizable(true);

    // ── General page ────────────────────────────────────────────────────────
    const generalPage = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "preferences-system-symbolic",
    });
    window.add(generalPage);

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

    const systemGroup = new Adw.PreferencesGroup({
      title: _("System Integration"),
      description: _(
        "Controls how this extension interacts with other parts of GNOME Shell.",
      ),
    });
    generalPage.add(systemGroup);

    // ── Hide Default GNOME Media Player ──────────────────────────────────────
    // Prefs side: binds the GSettings boolean.
    // Extension side: _applyHideDefaultPlayer(hide) must be called on enable(),
    // on every "changed::hide-default-player" signal, and with hide=false on
    // disable() so the widget is unconditionally restored.
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
    // Attach the switch as the activatable widget so clicking the row title
    // toggles the switch but does not fight the expander arrow.
    hideDefaultExpanderRow.add_suffix(hideDefaultToggle);
    hideDefaultExpanderRow.activatable_widget = hideDefaultToggle;

    const hideDefaultInfoLabel = new Gtk.Label({
      label: _(
        "When ON, the extension hides the stock GNOME media controls that\n" +
        "normally appear in the calendar / notification panel (the date-time\n" +
        "menu). This prevents a duplicate 'now playing' widget.\n\n" +
        "The built-in controls are fully restored the moment you:\n" +
        "  \u2022 Turn this switch off, or\n" +
        "  \u2022 Disable or uninstall this extension."
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

    // ── Popup Player page ────────────────────────────────────────────────────
    const popupPage = new Adw.PreferencesPage({
      title: _("Popup Player"),
      icon_name: "media-playback-start-symbolic",
    });
    window.add(popupPage);

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

    // ── Album Art & Vinyl group (Popup Player page) ──────────────────────────
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

    // ── Vinyl Apps page ──────────────────────────────────────────────────────
    const vinylPage = new Adw.PreferencesPage({
      title: _("Vinyl Apps"),
      icon_name: "media-optical-cd-audio-symbolic",
    });
    window.add(vinylPage);
    this._buildVinylAppsPage(vinylPage, settings);

    // ── Player Filter page ───────────────────────────────────────────────────
    const filterPage = new Adw.PreferencesPage({
      title: _("Player Filter"),
      icon_name: "view-list-symbolic",
    });
    window.add(filterPage);
    this._buildPlayerFilterPage(filterPage, settings);

    // ── Lyrics page ──────────────────────────────────────────────────────────
    const lyricsPage = new Adw.PreferencesPage({
      title: _("Lyrics"),
      // "audio-x-generic-symbolic" is widely available and renders correctly
      icon_name: "audio-x-generic-symbolic",
    });
    window.add(lyricsPage);
    this._buildLyricsPage(lyricsPage, settings);

    // ── About page ───────────────────────────────────────────────────────────
    window.add(this._createAboutPage(window));
  }

  // ── Player Filter page builder ────────────────────────────────────────────
  //
  // Storage format for player-filter-list:
  //   Comma-separated entries.  Each entry is either:
  //     "shortName"          – app is in the list AND enabled (active)
  //     "~shortName"         – app is in the list BUT disabled (inactive)
  //
  // The MprisManager only acts on entries WITHOUT the "~" prefix.
  // The "~" prefix lets users keep the app saved while temporarily
  // bypassing the filter for it (toggle off = disabled = "~name").

  _buildPlayerFilterPage(page, settings) {

    // ── Helper: parse the raw list string into an array of {name, enabled} ──
    const parseList = () => {
      const raw = settings.get_string("player-filter-list") || "";
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
          if (entry.startsWith("~")) {
            return { name: entry.slice(1).trim(), enabled: false };
          }
          return { name: entry, enabled: true };
        });
    };

    // ── Helper: write an array of {name, enabled} back to settings ──────────
    const serializeList = (entries) => {
      const str = entries
        .map((e) => (e.enabled ? e.name : `~${e.name}`))
        .join(", ");
      settings.set_string("player-filter-list", str);
    };

    // ── Helper: get short MPRIS name from a full bus name ────────────────────
    const toShort = (busName) =>
      busName
        .replace("org.mpris.MediaPlayer2.", "")
        .replace(/\.instance[_\d]+$/i, "")
        .replace(/\.\d+$/, "");

    // ═════════════════════════════════════════════════════════════════════════
    // Section 1 – Filter Mode
    // ═════════════════════════════════════════════════════════════════════════
    const modeGroup = new Adw.PreferencesGroup({
      title: _("Filter Mode"),
      description: _(
        "Choose whether the list below acts as a blacklist (block listed " +
          "apps) or a whitelist (allow only listed apps). Set to Off to " +
          "disable filtering entirely.",
      ),
    });
    page.add(modeGroup);

    const filterModel = new Gtk.StringList();
    [
      _("Off — Show all media players (no filtering)"),
      _("Blacklist — Hide only the players you add to the list"),
      _("Whitelist — Show only the players you add to the list"),
    ].forEach((l) => filterModel.append(l));

    const filterModeRow = new Adw.ComboRow({
      title: _("Filter Mode"),
      subtitle: _("Controls which media players the extension tracks and displays"),
      model: filterModel,
      selected: settings.get_int("player-filter-mode"),
    });
    filterModeRow.connect("notify::selected", () => {
      settings.set_int("player-filter-mode", filterModeRow.selected);
    });
    settings.connect("changed::player-filter-mode", () => {
      const v = settings.get_int("player-filter-mode");
      if (filterModeRow.selected !== v) filterModeRow.selected = v;
    });
    modeGroup.add(filterModeRow);

    // ═════════════════════════════════════════════════════════════════════════
    // Section 2 – Saved Players List  (toggle + remove per row)
    // ═════════════════════════════════════════════════════════════════════════
    const savedGroup = new Adw.PreferencesGroup({
      title: _("Saved Players"),
      description: _(
        "Each saved player can be individually enabled or disabled in the " +
          "filter without removing it. The toggle controls whether the filter " +
          "rule is active for that app. Use the trash button to remove it " +
          "from the list entirely.",
      ),
    });
    page.add(savedGroup);

    // We keep track of dynamically-added rows so we can rebuild the list
    this._savedFilterRows = [];

    // Central rebuild function – called after every list mutation
    const rebuildSavedList = () => {
      // Remove all previously built rows
      for (const r of this._savedFilterRows) {
        try {
          savedGroup.remove(r);
        } catch (_e) {}
      }
      this._savedFilterRows = [];

      const entries = parseList();

      if (entries.length === 0) {
        // Placeholder when list is empty
        const ph = new Adw.ActionRow({
          title: _("No players saved yet"),
          subtitle: _(
            "Detect running players below and click \u201cAdd to Filter\u201d " +
              "to add them here.",
          ),
          activatable: false,
        });
        ph.add_prefix(
          new Gtk.Image({
            icon_name: "view-list-symbolic",
            pixel_size: 28,
            valign: Gtk.Align.CENTER,
            opacity: 0.4,
          }),
        );
        savedGroup.add(ph);
        this._savedFilterRows.push(ph);
        return;
      }

      for (const entry of entries) {
        const { name, enabled } = entry;

        // Try to resolve a system app icon
        const appInfo = this._findAppInfo(name, name);
        const appIcon = appInfo ? appInfo.get_icon() : null;

        const row = new Adw.ActionRow({
          title: appInfo
            ? appInfo.get_display_name() || appInfo.get_name() || name
            : name,
          subtitle: name,
          activatable: false,
        });

        // App icon prefix
        row.add_prefix(
          appIcon
            ? new Gtk.Image({
                gicon: appIcon,
                pixel_size: 32,
                valign: Gtk.Align.CENTER,
              })
            : new Gtk.Image({
                icon_name: "application-x-executable-symbolic",
                pixel_size: 32,
                valign: Gtk.Align.CENTER,
                opacity: 0.6,
              }),
        );

        // ── Toggle switch: enable / disable this entry in the filter ──────
        const toggle = new Gtk.Switch({
          active: enabled,
          valign: Gtk.Align.CENTER,
          tooltip_text: enabled
            ? _("Filter rule active for \u201c%s\u201d \u2014 click to disable").format(name)
            : _("Filter rule disabled for \u201c%s\u201d \u2014 click to enable").format(name),
        });

        toggle.connect("state-set", (_sw, state) => {
          // Re-read the latest list (may have changed since row was built)
          const current = parseList();
          const idx = current.findIndex((e) => e.name === name);
          if (idx !== -1) {
            current[idx].enabled = state;
            serializeList(current);
          }
          // Return false so GTK updates the visual state normally
          return false;
        });

        row.add_suffix(toggle);

        // ── Remove button: delete this entry from the list entirely ───────
        const removeBtn = new Gtk.Button({
          icon_name: "user-trash-symbolic",
          valign: Gtk.Align.CENTER,
          css_classes: ["flat", "destructive-action"],
          tooltip_text: _("Remove \u201c%s\u201d from the filter list").format(name),
        });

        removeBtn.connect("clicked", () => {
          const current = parseList();
          const updated = current.filter((e) => e.name !== name);
          serializeList(updated);
          // rebuildSavedList is triggered by the settings changed signal below
        });

        row.add_suffix(removeBtn);

        savedGroup.add(row);
        this._savedFilterRows.push(row);
      }
    };

    // Rebuild the saved list whenever the underlying setting changes
    // (covers direct edits from any source)
    settings.connect("changed::player-filter-list", () => {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        rebuildSavedList();
        return GLib.SOURCE_REMOVE;
      });
    });

    // Initial build
    rebuildSavedList();

    // ═════════════════════════════════════════════════════════════════════════
    // Section 3 – Detect running players  (live D-Bus scan)
    // ═════════════════════════════════════════════════════════════════════════
    const detectGroup = new Adw.PreferencesGroup({
      title: _("Detected Players"),
      description: _(
        "Active MPRIS players found on the session D-Bus. " +
          "Click \u201cAdd to Filter\u201d to save a player to the list above.",
      ),
    });
    page.add(detectGroup);

    const scanHeaderRow = new Adw.ActionRow({
      title: _("Scan for running players"),
      subtitle: _("Detects players currently broadcasting on MPRIS"),
    });
    const refreshBtn = new Gtk.Button({
      icon_name: "view-refresh-symbolic",
      valign: Gtk.Align.CENTER,
      css_classes: ["flat"],
      tooltip_text: _("Refresh the detected player list"),
    });
    scanHeaderRow.add_suffix(refreshBtn);
    detectGroup.add(scanHeaderRow);

    // Live rows live in a separate group so we can wipe them cleanly
    const liveGroup = new Adw.PreferencesGroup();
    page.add(liveGroup);

    this._filterLiveRows = [];

    const clearLiveRows = () => {
      for (const r of this._filterLiveRows) {
        try {
          liveGroup.remove(r);
        } catch (_e) {}
      }
      this._filterLiveRows = [];
    };

    const scanPlayers = () => {
      clearLiveRows();

      let connection;
      try {
        connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
      } catch (_e) {
        const errRow = new Adw.ActionRow({
          title: _("Could not connect to the session bus"),
          activatable: false,
        });
        liveGroup.add(errRow);
        this._filterLiveRows.push(errRow);
        return;
      }

      connection.call(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "ListNames",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
          try {
            const result = conn.call_finish(res);
            const names = result.deep_unpack()[0];
            const mprisNames = names.filter((n) =>
              n.startsWith("org.mpris.MediaPlayer2."),
            );

            clearLiveRows();

            if (mprisNames.length === 0) {
              const noneRow = new Adw.ActionRow({
                title: _("No active players detected"),
                subtitle: _("Open a music app and click Refresh"),
                activatable: false,
              });
              noneRow.add_prefix(
                new Gtk.Image({
                  icon_name: "media-playback-stop-symbolic",
                  pixel_size: 24,
                  valign: Gtk.Align.CENTER,
                  opacity: 0.5,
                }),
              );
              liveGroup.add(noneRow);
              this._filterLiveRows.push(noneRow);
              return;
            }

            const seen = new Set();

            for (const fullBus of mprisNames) {
              const short = toShort(fullBus);
              if (seen.has(short)) continue;
              seen.add(short);

              const appInfo = this._findAppInfo(short, short);
              const appIcon = appInfo ? appInfo.get_icon() : null;
              const displayName = appInfo
                ? appInfo.get_display_name() || appInfo.get_name() || short
                : short;

              const row = new Adw.ActionRow({
                title: displayName,
                subtitle: fullBus,
                activatable: false,
              });

              // App icon
              row.add_prefix(
                appIcon
                  ? new Gtk.Image({
                      gicon: appIcon,
                      pixel_size: 32,
                      valign: Gtk.Align.CENTER,
                    })
                  : new Gtk.Image({
                      icon_name: "application-x-executable-symbolic",
                      pixel_size: 32,
                      valign: Gtk.Align.CENTER,
                      opacity: 0.6,
                    }),
              );

              // Helper: is this short name already in the saved list?
              const isAlreadySaved = () =>
                parseList().some((e) => e.name === short);

              // "Add to Filter" button – becomes "Saved ✓" once added
              const addBtn = new Gtk.Button({
                label: isAlreadySaved()
                  ? _("Saved \u2713")
                  : _("Add to Filter"),
                valign: Gtk.Align.CENTER,
                css_classes: isAlreadySaved()
                  ? ["flat"]
                  : ["suggested-action"],
                tooltip_text: isAlreadySaved()
                  ? _("\u201c%s\u201d is already in the filter list").format(short)
                  : _("Add \u201c%s\u201d to the filter list (enabled by default)").format(short),
              });

              addBtn.connect("clicked", () => {
                if (isAlreadySaved()) return; // idempotent

                const current = parseList();
                current.push({ name: short, enabled: true });
                serializeList(current);

                // Update button appearance immediately
                addBtn.label = _("Saved \u2713");
                addBtn.css_classes = ["flat"];
                addBtn.tooltip_text = _(
                  "\u201c%s\u201d is already in the filter list",
                ).format(short);
              });

              // Keep the button state in sync if the list changes elsewhere
              settings.connect("changed::player-filter-list", () => {
                const saved = isAlreadySaved();
                addBtn.label = saved ? _("Saved \u2713") : _("Add to Filter");
                addBtn.css_classes = saved ? ["flat"] : ["suggested-action"];
              });

              row.add_suffix(addBtn);
              liveGroup.add(row);
              this._filterLiveRows.push(row);
            }
          } catch (e) {
            console.error("AMC prefs: error scanning players:", e);
          }
        },
      );
    };

    refreshBtn.connect("clicked", scanPlayers);

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      scanPlayers();
      return GLib.SOURCE_REMOVE;
    });
  }

  // ── Lyrics page builder ───────────────────────────────────────────────────

  _buildLyricsPage(page, settings) {
    // ── Enable / Disable toggle ──────────────────────────────────────────────
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
      // "audio-x-generic-symbolic" is a standard GNOME icon that exists on all
      // supported shell versions (45-49) and renders without the blank-square
      // artefact that format-text-symbolic shows in some themes.
      icon_name: "audio-x-generic-symbolic",
    });
    settings.bind(
      "enable-lyrics",
      enableLyricsRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    enableGroup.add(enableLyricsRow);

    // ── How it works — step-by-step ──────────────────────────────────────────
    const howtoGroup = new Adw.PreferencesGroup({
      title: _("How to Use Lyrics"),
      description: _(
        "Lyrics are tied to each player tab independently — Spotify and Firefox each remember their own setting",
      ),
    });
    page.add(howtoGroup);

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
        title: _("Triple-click the album art to show lyrics"),
        subtitle: _(
          "Click the album art three times in quick succession. The cover image will be replaced by the lyrics panel, which scrolls automatically in time with the music.",
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
        title: _("Triple-click again to re-open"),
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

    // ── Behaviour details ────────────────────────────────────────────────────
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

    // ── Keyboard / click cheat-sheet ─────────────────────────────────────────
    const cheatGroup = new Adw.PreferencesGroup({
      title: _("Album Art Click Actions"),
      description: _(
        "Summary of what each click pattern does on the album art cover",
      ),
    });
    page.add(cheatGroup);

    const clickActions = [
      {
        icon: "input-mouse-symbolic",
        title: _("Single click"),
        subtitle: _(
          "When lyrics are showing: closes the lyrics panel and returns to the album art",
        ),
      },
      {
        icon: "input-mouse-symbolic",
        title: _("Double click"),
        subtitle: _(
          "Toggles the spinning vinyl record effect for that specific app (remembered independently per app)",
        ),
      },
      {
        icon: "input-mouse-symbolic",
        title: _("Triple click"),
        subtitle: _(
          "Toggles the synced lyrics panel for the current player tab (remembered independently per player)",
        ),
      },
    ];

    clickActions.forEach(({ icon, title, subtitle }) => {
      const row = new Adw.ActionRow({ title, subtitle, activatable: false });
      row.add_prefix(
        new Gtk.Image({
          icon_name: icon,
          pixel_size: 22,
          valign: Gtk.Align.CENTER,
        }),
      );
      cheatGroup.add(row);
    });

    // ── Data source ───────────────────────────────────────────────────────────
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

  // ── Vinyl Apps page ───────────────────────────────────────────────────────

  _buildVinylAppsPage(page, settings) {
    const howtoGroup = new Adw.PreferencesGroup({
      title: _("How to Enable Vinyl Style for an App"),
    });
    page.add(howtoGroup);

    const steps = [
      {
        icon: "media-playback-start-symbolic",
        title: _("Start playing music"),
        subtitle: _(
          "Open any media player or browser web app (YouTube, Spotify Web, SoundCloud, etc.) and play a track so it appears as a media source.",
        ),
      },
      {
        icon: "input-mouse-symbolic",
        title: _("Open the extension popup"),
        subtitle: _(
          "Click the media controller in the top panel to open the popup player.",
        ),
      },
      {
        icon: "go-jump-symbolic",
        title: _("Double-click the album art"),
        subtitle: _(
          "Double-click the album art image in the popup to toggle the vinyl record style for that specific app or browser source. " +
            "For browsers (Chrome, Firefox, etc.) each site (YouTube, YouTube Music, Spotify Web) is stored as its own separate entry.",
        ),
      },
      {
        icon: "media-optical-cd-audio-symbolic",
        title: _("Manage saved instances below"),
        subtitle: _(
          "All stored instances appear in the section below. " +
            "Browser web-app sources appear as e.g. \u201cYouTube Music (Chrome)\u201d and are tracked independently. " +
            "Toggle them on/off or remove them at any time.",
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

    const instancesGroup = new Adw.PreferencesGroup({
      title: _("Saved App Instances"),
      description: _(
        "Instances stored by double-clicking the album art in the popup. " +
          "Icons are loaded from the system .desktop database. " +
          "Toggle the vinyl effect on/off or remove any entry.",
      ),
    });
    page.add(instancesGroup);

    this._instancesGroup = instancesGroup;
    this._instanceRows = new Map();
    this._vinylSettings = settings;

    this._refreshInstancesList(settings);

    const searchGroup = new Adw.PreferencesGroup({
      title: _("Add an App Manually"),
      description: _(
        "Search installed apps \u2014 including browsers \u2014 to manually add a vinyl entry. " +
          "Useful for browser web apps whose instance hasn\u2019t been captured yet via double-click.",
      ),
    });
    page.add(searchGroup);

    const webTipRow = new Adw.ActionRow({
      title: _(
        "Browser sources tracked separately (YouTube, YouTube Music, Spotify Web)",
      ),
      subtitle: _(
        "For web apps, add the browser itself (e.g. Google Chrome, Firefox). " +
          "Then double-click the album art when that browser is playing music \u2014 " +
          "the extension will capture the exact instance automatically.",
      ),
      activatable: false,
    });
    webTipRow.add_prefix(
      new Gtk.Image({
        icon_name: "web-browser-symbolic",
        pixel_size: 20,
        valign: Gtk.Align.CENTER,
      }),
    );
    searchGroup.add(webTipRow);

    const searchRow = new Adw.ActionRow({
      title: _("Search apps"),
      activatable: false,
    });
    const searchEntry = new Gtk.SearchEntry({
      placeholder_text: _("Type an app or browser name\u2026"),
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    searchRow.add_suffix(searchEntry);
    searchGroup.add(searchRow);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      min_content_height: 180,
      max_content_height: 360,
    });

    this._appListBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ["boxed-list"],
      margin_top: 4,
    });
    scrolled.set_child(this._appListBox);

    const scrollRow = new Adw.ActionRow({ activatable: false });
    scrollRow.set_child(scrolled);
    searchGroup.add(scrollRow);

    this._allApps = this._loadMediaAndBrowserApps();
    this._currentSearchQuery = "";
    this._renderAppList(this._allApps, settings);

    const doFilter = () => {
      const query = searchEntry.text.toLowerCase().trim();
      this._currentSearchQuery = query;
      const filtered =
        query.length === 0
          ? this._allApps
          : this._allApps.filter(
              (app) =>
                app.get_name().toLowerCase().includes(query) ||
                (app.get_id() || "").toLowerCase().includes(query),
            );
      this._renderAppList(filtered, settings);
    };

    searchEntry.connect("search-changed", doFilter);

    this._vinylAppsChangedId = settings.connect(
      "changed::vinyl-app-ids",
      () => {
        this._refreshInstancesList(settings);
        this._renderAppList(this._allApps, settings);
      },
    );
    this._vinylInstancesChangedId = settings.connect(
      "changed::vinyl-app-instances",
      () => {
        this._refreshInstancesList(settings);
        this._renderAppList(this._allApps, settings);
      },
    );
    this._vinylDisabledChangedId = settings.connect(
      "changed::vinyl-app-disabled-ids",
      () => {
        this._refreshInstancesList(settings);
        this._renderAppList(this._allApps, settings);
      },
    );

    // ── Live player detector ──────────────────────────────────────────────────
    const liveDetectGroup = new Adw.PreferencesGroup({
      title: _("Running Players (Live Detection)"),
      description: _(
        "MPRIS players active right now. Click \u201cUse This\u201d to immediately " +
          "add the player as a vinyl-enabled instance without waiting for a double-click.",
      ),
    });
    page.add(liveDetectGroup);

    const liveRefreshRow = new Adw.ActionRow({
      title: _("Scan for active players"),
      subtitle: _("Detects players currently broadcasting on the MPRIS D-Bus"),
    });
    const liveRefreshBtn = new Gtk.Button({
      icon_name: "view-refresh-symbolic",
      valign: Gtk.Align.CENTER,
      css_classes: ["flat"],
      tooltip_text: _("Refresh"),
    });
    liveRefreshRow.add_suffix(liveRefreshBtn);
    liveDetectGroup.add(liveRefreshRow);

    const livePlayerGroup = new Adw.PreferencesGroup();
    page.add(livePlayerGroup);

    this._vinylLiveRows = [];

    const clearVinylLiveRows = () => {
      for (const r of this._vinylLiveRows) {
        try { livePlayerGroup.remove(r); } catch (_e) {}
      }
      this._vinylLiveRows = [];
    };

    const scanVinylPlayers = () => {
      clearVinylLiveRows();

      let connection;
      try {
        connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
      } catch (_e) {
        return;
      }

      connection.call(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "ListNames",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
          try {
            const result = conn.call_finish(res);
            const names = result.deep_unpack()[0];
            const mprisNames = names.filter((n) =>
              n.startsWith("org.mpris.MediaPlayer2."),
            );

            clearVinylLiveRows();

            if (mprisNames.length === 0) {
              const noneRow = new Adw.ActionRow({
                title: _("No active players detected"),
                subtitle: _("Open a music app and click Refresh"),
                activatable: false,
              });
              noneRow.add_prefix(
                new Gtk.Image({
                  icon_name: "media-playback-stop-symbolic",
                  pixel_size: 24,
                  valign: Gtk.Align.CENTER,
                  opacity: 0.5,
                }),
              );
              livePlayerGroup.add(noneRow);
              this._vinylLiveRows.push(noneRow);
              return;
            }

            const seenShort = new Set();
            for (const fullBus of mprisNames) {
              let short = fullBus.replace("org.mpris.MediaPlayer2.", "");
              // strip .instanceN suffixes
              short = short
                .replace(/\.instance[_\d]+$/i, "")
                .replace(/\.\d+$/, "");

              if (seenShort.has(short)) continue;
              seenShort.add(short);

              // Check if already saved
              const existing = (() => {
                try {
                  return settings.get_strv("vinyl-app-instances") ?? [];
                } catch (_e) {
                  return [];
                }
              })();
              const alreadySaved = existing.some((raw) => {
                try {
                  const obj = JSON.parse(raw);
                  const lower = (obj.id ?? "").toLowerCase();
                  return (
                    lower === short.toLowerCase() ||
                    lower.replace(/\.instance[_\d]+$/i, "") === short.toLowerCase()
                  );
                } catch (_) {
                  return false;
                }
              });

              if (alreadySaved) continue;

              const appInfo = this._findAppInfo(short, short);
              const appIcon = appInfo ? appInfo.get_icon() : null;
              const displayName = appInfo
                ? appInfo.get_display_name() || appInfo.get_name() || short
                : short;

              const row = new Adw.ActionRow({
                title: displayName,
                subtitle: fullBus,
                activatable: false,
              });

              row.add_prefix(
                appIcon
                  ? new Gtk.Image({
                      gicon: appIcon,
                      pixel_size: 28,
                      valign: Gtk.Align.CENTER,
                    })
                  : new Gtk.Image({
                      icon_name: "application-x-executable-symbolic",
                      pixel_size: 28,
                      valign: Gtk.Align.CENTER,
                    }),
              );

              const useBtn = new Gtk.Button({
                label: _("Use This"),
                valign: Gtk.Align.CENTER,
                css_classes: ["suggested-action"],
                tooltip_text: _(
                  "Add \u201c%s\u201d as a vinyl-enabled instance",
                ).format(displayName),
              });

              useBtn.connect("clicked", () => {
                const record = JSON.stringify({
                  id: short,
                  name: displayName,
                  desktopId: appInfo ? this._normalizeAppId(appInfo.get_id() ?? short) : short,
                  busName: fullBus,
                  enabled: true,
                });
                try {
                  const cur = settings.get_strv("vinyl-app-instances") ?? [];
                  const deduped = cur.filter((raw) => {
                    try {
                      return (
                        JSON.parse(raw).id?.toLowerCase() !== short.toLowerCase()
                      );
                    } catch (_) {
                      return true;
                    }
                  });
                  deduped.push(record);
                  settings.set_strv("vinyl-app-instances", deduped);
                } catch (_e) {
                  console.error("AMC prefs: failed to save vinyl instance:", _e);
                }
                this._setAppVinylState(settings, short, short.toLowerCase(), true);
                // Re-scan so this row disappears (it is now in saved instances)
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                  scanVinylPlayers();
                  return GLib.SOURCE_REMOVE;
                });
              });

              row.add_suffix(useBtn);
              livePlayerGroup.add(row);
              this._vinylLiveRows.push(row);
            }

            // If all running players are already saved, show a friendly note
            if (this._vinylLiveRows.length === 0) {
              const allSavedRow = new Adw.ActionRow({
                title: _("All running players are already saved"),
                subtitle: _("Manage them in the Saved App Instances section above"),
                activatable: false,
              });
              allSavedRow.add_prefix(
                new Gtk.Image({
                  icon_name: "object-select-symbolic",
                  pixel_size: 24,
                  valign: Gtk.Align.CENTER,
                }),
              );
              livePlayerGroup.add(allSavedRow);
              this._vinylLiveRows.push(allSavedRow);
            }
          } catch (e) {
            console.error("AMC prefs: error scanning vinyl players:", e);
          }
        },
      );
    };

    liveRefreshBtn.connect("clicked", scanVinylPlayers);

    // Auto-scan once the page is loaded
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      scanVinylPlayers();
      return GLib.SOURCE_REMOVE;
    });

    // Re-scan whenever saved instances change (so "Use This" rows hide)
    settings.connect("changed::vinyl-app-instances", () => {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        scanVinylPlayers();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  _refreshInstancesList(settings) {
    for (const row of this._instanceRows.values()) {
      try {
        this._instancesGroup.remove(row);
      } catch (_e) {}
    }
    this._instanceRows.clear();

    const rawInstances = (() => {
      try {
        return settings.get_strv("vinyl-app-instances") ?? [];
      } catch (_e) {
        return [];
      }
    })();

    const enabledIds = settings.get_strv("vinyl-app-ids");

    if (rawInstances.length === 0) {
      const ph = new Adw.ActionRow({
        title: _("No instances saved yet"),
        subtitle: _(
          "Double-click the album art in the popup while music is playing to save an instance here.",
        ),
        activatable: false,
      });
      ph.add_prefix(
        new Gtk.Image({
          icon_name: "media-optical-cd-audio-symbolic",
          pixel_size: 28,
          valign: Gtk.Align.CENTER,
          opacity: 0.4,
        }),
      );
      this._instanceRows.set("__placeholder__", ph);
      this._instancesGroup.add(ph);
      return;
    }

    const parsed = [];
    for (const raw of rawInstances) {
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (_) {
        continue;
      }
      const id = obj.id ?? "";
      if (!id) continue;

      const idLower = id.toLowerCase();
      const isComposite = idLower.includes("--");

      let appInfoR = null;
      let canonicalKey;

      if (isComposite) {
        canonicalKey = idLower;
        appInfoR = null;
      } else {
        appInfoR = this._findAppInfo(obj.desktopId || id, id);
        if (appInfoR) {
          const realId = (appInfoR.get_id() ?? "").replace(/\.desktop$/i, "");
          canonicalKey = realId.toLowerCase() || idLower;
        } else {
          canonicalKey = idLower
            .replace(/\.instance[_\d]+$/i, "")
            .replace(/\.\d+$/, "");
        }
      }
      parsed.push({ obj, appInfoR, canonicalKey });
    }

    const groupMap = new Map();
    for (const entry of parsed) {
      const { canonicalKey } = entry;
      if (groupMap.has(canonicalKey)) {
        const group = groupMap.get(canonicalKey);
        group.allIds.add(entry.obj.id.toLowerCase());
        if (!group.best.obj.enabled && entry.obj.enabled) group.best = entry;
      } else {
        groupMap.set(canonicalKey, {
          best: entry,
          allIds: new Set([entry.obj.id.toLowerCase()]),
        });
      }
    }

    for (const [, { best, allIds }] of groupMap) {
      const { obj, appInfoR } = best;
      const id = obj.id ?? "";
      const normId = id.toLowerCase();

      const parsedComposite = _parseBrowserSourceId(normId);
      const isBrowserInstance = parsedComposite !== null;

      let appName = obj.name || obj.desktopId || id;
      let appIcon = null;

      if (isBrowserInstance) {
        appName = _labelForId(normId);
        const browserDesktopId = obj.desktopId || parsedComposite.browser;
        const browserAppInfo = this._findAppInfo(
          browserDesktopId,
          browserDesktopId,
        );
        if (browserAppInfo) appIcon = browserAppInfo.get_icon();
      } else if (appInfoR) {
        appName = appInfoR.get_display_name() || appInfoR.get_name() || appName;
        appIcon = appInfoR.get_icon();
      }

      const resolvedName = appName;
      const displayName = obj.customName?.trim() || resolvedName;

      const isEnabled = [...allIds].some((aid) =>
        this._isAppEnabled(aid, enabledIds),
      );

      const rawSubtitle =
        isBrowserInstance && parsedComposite
          ? _("%s via %s").format(
              parsedComposite.source.replace(/-/g, " "),
              parsedComposite.browser,
            )
          : id;

      const row = new Adw.ActionRow({
        title: displayName,
        subtitle: obj.customName?.trim()
          ? `${rawSubtitle}  \u00b7  ${_("renamed from")} "${resolvedName}"`
          : rawSubtitle,
        activatable: false,
      });

      row.add_prefix(
        appIcon
          ? new Gtk.Image({
              gicon: appIcon,
              pixel_size: 28,
              valign: Gtk.Align.CENTER,
            })
          : new Gtk.Image({
              icon_name: "media-optical-cd-audio-symbolic",
              pixel_size: 28,
              valign: Gtk.Align.CENTER,
            }),
      );

      const renameBtn = new Gtk.Button({
        icon_name: "document-edit-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["flat"],
        tooltip_text: _("Rename \u201c%s\u201d").format(displayName),
      });
      renameBtn.connect("clicked", () => {
        this._showRenameDialog(settings, id, normId, displayName, resolvedName);
      });
      row.add_suffix(renameBtn);

      const sw = new Gtk.Switch({
        active: isEnabled,
        valign: Gtk.Align.CENTER,
      });
      sw.connect("state-set", (_widget, state) => {
        for (const aid of allIds) {
          this._setAppVinylState(settings, aid, aid, state);
          this._updateInstanceEnabledField(settings, aid, state);
        }
        return false;
      });
      row.add_suffix(sw);

      const removeBtn = new Gtk.Button({
        icon_name: "list-remove-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["destructive-action", "flat"],
        tooltip_text: _("Remove %s from saved instances").format(appName),
      });
      removeBtn.connect("clicked", () => {
        for (const aid of allIds) this._deleteInstance(settings, aid, aid);
      });
      row.add_suffix(removeBtn);

      this._instancesGroup.add(row);
      this._instanceRows.set(id, row);
    }
  }

  _showRenameDialog(settings, id, normId, currentDisplay, resolvedName) {
    const isComposite = normId.includes("--");
    const displayedSource = isComposite ? _labelForId(normId) : resolvedName;

    const dialog = new Adw.AlertDialog({
      heading: _("Rename Instance"),
      body: _(
        "Enter a custom display name for \"%s\".\nLeave blank to reset to the default.",
      ).format(displayedSource),
      default_response: "rename",
      close_response: "cancel",
    });

    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("rename", _("Rename"));
    dialog.set_response_appearance("rename", Adw.ResponseAppearance.SUGGESTED);

    const clamp = new Adw.Clamp({
      maximum_size: 480,
      tightening_threshold: 320,
    });

    const listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ["boxed-list"],
      margin_top: 12,
      margin_bottom: 4,
      margin_start: 0,
      margin_end: 0,
    });

    const entryRow = new Adw.EntryRow({
      title: _("Display name"),
      text:
        currentDisplay !== resolvedName && currentDisplay !== displayedSource
          ? currentDisplay
          : "",
      show_apply_button: true,
    });
    listBox.append(entryRow);
    clamp.set_child(listBox);
    dialog.set_extra_child(clamp);

    entryRow.connect("entry-activated", () => {
      dialog.response("rename");
    });
    entryRow.connect("apply", () => {
      dialog.response("rename");
    });

    dialog.connect("response", (_dlg, responseId) => {
      if (responseId !== "rename") return;
      const newName = entryRow.text.trim();
      this._renameInstance(settings, normId, newName, resolvedName);
    });

    let parent = this._instancesGroup.get_root?.();
    if (!(parent instanceof Gtk.Window)) parent = null;
    dialog.present(parent);

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      entryRow.grab_focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  _renameInstance(settings, normId, newName, resolvedName) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const isComposite = normId.includes("--");
      const updated = existing.map((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          const isMatch = isComposite
            ? lower === normId
            : lower === normId || lower.split(".").pop() === normId;
          if (isMatch) {
            if (!newName) {
              const copy = Object.assign({}, obj);
              delete copy.customName;
              return JSON.stringify(copy);
            }
            return JSON.stringify({ ...obj, customName: newName });
          }
        } catch (_) {}
        return raw;
      });
      settings.set_strv("vinyl-app-instances", updated);
    } catch (_e) {
      console.error("AMC prefs: failed to rename instance:", _e);
    }
  }

  _updateInstanceEnabledField(settings, normId, enabledValue) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const isComposite = normId.includes("--");
      const updated = existing.map((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          const isMatch = isComposite
            ? lower === normId
            : lower === normId || lower.split(".").pop() === normId;
          if (isMatch) {
            return JSON.stringify({ ...obj, enabled: enabledValue });
          }
        } catch (_) {}
        return raw;
      });
      settings.set_strv("vinyl-app-instances", updated);
    } catch (_e) {}
  }

  _deleteInstance(settings, id, normId) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const isComposite = normId.includes("--");
      const filtered = existing.filter((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          if (isComposite) return lower !== normId;
          return lower !== normId && lower.split(".").pop() !== normId;
        } catch (_) {
          return true;
        }
      });
      settings.set_strv("vinyl-app-instances", filtered);
    } catch (_e) {}
    this._setAppVinylState(settings, id, normId, false);
  }

  /** @deprecated */
  _removeInstance(settings, id, normId) {
    this._deleteInstance(settings, id, normId);
  }

  // ── App loading ───────────────────────────────────────────────────────────

  _loadMediaAndBrowserApps() {
    const allApps = Gio.AppInfo.get_all();

    const browserIds = new Set([
      "google-chrome",
      "google-chrome-stable",
      "google-chrome-beta",
      "chromium",
      "chromium-browser",
      "brave-browser",
      "com.brave.Browser",
      "brave-browser-stable",
      "firefox",
      "org.mozilla.firefox",
      "firefox-esr",
      "microsoft-edge",
      "microsoft-edge-stable",
      "microsoft-edge-beta",
      "com.microsoft.Edge",
      "vivaldi-stable",
      "vivaldi",
      "opera",
      "opera-stable",
      "com.opera.Opera",
      "epiphany",
      "org.gnome.Epiphany",
      "midori",
      "falkon",
    ]);

    const mediaCategories = [
      "audio",
      "music",
      "video",
      "player",
      "multimedia",
      "media",
    ];

    const seen = new Set();

    const apps = allApps.filter((app) => {
      if (!app.should_show()) return false;

      const rawId = app.get_id() || "";
      const normId = this._normalizeAppId(rawId).toLowerCase();

      if (seen.has(normId)) return false;

      const cats = (app.get_categories() || "").toLowerCase();
      const isMedia = mediaCategories.some((c) => cats.includes(c));
      const isBrowser =
        browserIds.has(normId) || browserIds.has(rawId.replace(".desktop", ""));

      if (isMedia || isBrowser) {
        seen.add(normId);
        return true;
      }
      return false;
    });

    return apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
  }

  _buildMatchSet(appId) {
    const ids = new Set();
    const lower = appId.toLowerCase();
    ids.add(lower);

    if (!lower.includes("--")) {
      const parts = lower.split(".");
      if (parts.length > 1) ids.add(parts[parts.length - 1]);
    }

    return ids;
  }

  _isAppEnabled(normId, vinylIds) {
    const isComposite = normId.includes("--");
    for (const stored of vinylIds) {
      const storedLower = stored.toLowerCase();
      const matchSet = this._buildMatchSet(stored);
      if (matchSet.has(normId)) return true;

      if (!isComposite) {
        if (matchSet.has(normId.split(".").pop())) return true;
      } else {
        if (storedLower === normId) return true;
        if (storedLower.includes("--")) {
          const parsed1 = _parseBrowserSourceId(normId);
          const parsed2 = _parseBrowserSourceId(storedLower);
          if (
            parsed1 &&
            parsed2 &&
            parsed1.source === parsed2.source &&
            (parsed1.browser === parsed2.browser ||
              parsed1.browser.includes(parsed2.browser) ||
              parsed2.browser.includes(parsed1.browser))
          )
            return true;
        }
      }
    }
    return false;
  }

  _setAppVinylState(settings, appId, normId, enable) {
    const enabledIds = settings.get_strv("vinyl-app-ids");
    const disabledIds = settings.get_strv("vinyl-app-disabled-ids");
    const isComposite = normId.includes("--");

    const sameApp = (id) => {
      const idLower = id.toLowerCase();
      if (idLower === normId) return true;
      if (isComposite) {
        if (!idLower.includes("--")) return false;
        const p1 = _parseBrowserSourceId(normId);
        const p2 = _parseBrowserSourceId(idLower);
        return (
          p1 &&
          p2 &&
          p1.source === p2.source &&
          (p1.browser === p2.browser ||
            p1.browser.includes(p2.browser) ||
            p2.browser.includes(p1.browser))
        );
      }

      const ms = this._buildMatchSet(id);
      return ms.has(normId) || ms.has(normId.split(".").pop());
    };

    if (enable) {
      if (!this._isAppEnabled(normId, enabledIds)) enabledIds.push(appId);
      const newDisabled = disabledIds.filter((id) => !sameApp(id));
      settings.set_strv("vinyl-app-ids", enabledIds);
      settings.set_strv("vinyl-app-disabled-ids", newDisabled);
    } else {
      const newEnabled = enabledIds.filter((id) => !sameApp(id));
      if (!this._isAppEnabled(normId, disabledIds)) disabledIds.push(appId);
      settings.set_strv("vinyl-app-ids", newEnabled);
      settings.set_strv("vinyl-app-disabled-ids", disabledIds);
    }
  }

  // ── Render search results ─────────────────────────────────────────────────

  _renderAppList(filteredSystemApps, settings) {
    let child = this._appListBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._appListBox.remove(child);
      child = next;
    }

    const enabledIds = settings.get_strv("vinyl-app-ids");
    const query = this._currentSearchQuery ?? "";

    const rawInstances = (() => {
      try {
        return settings.get_strv("vinyl-app-instances") ?? [];
      } catch (_e) {
        return [];
      }
    })();

    const shownInstanceIds = new Set();
    const instanceRows = [];

    for (const raw of rawInstances) {
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (_) {
        continue;
      }

      const id = obj.id ?? "";
      if (!id) continue;
      const normId = id.toLowerCase();
      if (shownInstanceIds.has(normId)) continue;

      const desktopId = obj.desktopId || id;

      const parsedComp = _parseBrowserSourceId(normId);
      const isCompBrowser = parsedComp !== null;

      let resolvedName = obj.name || desktopId || id;
      let appIcon = null;

      if (isCompBrowser) {
        resolvedName = _labelForId(normId);
        const browserDesktopId = obj.desktopId || parsedComp.browser;
        const browserAppInfo = this._findAppInfo(
          browserDesktopId,
          browserDesktopId,
        );
        if (browserAppInfo) appIcon = browserAppInfo.get_icon();
      } else {
        const appInfoR = this._findAppInfo(desktopId, id);
        if (appInfoR) {
          resolvedName =
            appInfoR.get_display_name() || appInfoR.get_name() || resolvedName;
          appIcon = appInfoR.get_icon();
        }
      }

      const customName = obj.customName?.trim() || "";
      const displayName = customName || resolvedName;

      const extraSearchText = isCompBrowser
        ? `${parsedComp.source} ${parsedComp.browser} ${obj.mprisIdentity ?? ""}`
        : "";
      if (
        query &&
        !displayName.toLowerCase().includes(query) &&
        !resolvedName.toLowerCase().includes(query) &&
        !normId.includes(query) &&
        !extraSearchText.toLowerCase().includes(query)
      )
        continue;

      shownInstanceIds.add(normId);
      instanceRows.push({
        id,
        normId,
        displayName,
        resolvedName,
        appIcon,
        customName,
      });
    }

    if (instanceRows.length > 0) {
      this._appListBox.append(
        new Gtk.Label({
          label: _("Saved Instances"),
          xalign: 0,
          css_classes: ["caption", "dim-label"],
          margin_top: 8,
          margin_bottom: 2,
          margin_start: 8,
        }),
      );

      for (const {
        id,
        normId,
        displayName,
        resolvedName,
        appIcon,
        customName,
      } of instanceRows) {
        const isEnabled = this._isAppEnabled(normId, enabledIds);

        const _pbc = _parseBrowserSourceId(normId);
        const _subtitleBase = _pbc
          ? _("Browser: %s · Source: %s").format(
              _pbc.browser,
              _pbc.source.replace(/-/g, " "),
            )
          : id;
        const row = new Adw.ActionRow({
          title: displayName,
          subtitle: customName
            ? `${_subtitleBase}  ·  ${_("renamed from")} "${resolvedName}"`
            : _subtitleBase,
          activatable: false,
        });

        row.add_prefix(
          appIcon
            ? new Gtk.Image({
                gicon: appIcon,
                pixel_size: 24,
                valign: Gtk.Align.CENTER,
              })
            : new Gtk.Image({
                icon_name: "media-optical-cd-audio-symbolic",
                pixel_size: 24,
                valign: Gtk.Align.CENTER,
              }),
        );

        const sw = new Gtk.Switch({
          active: isEnabled,
          valign: Gtk.Align.CENTER,
        });
        sw.connect("state-set", (_w, state) => {
          this._setAppVinylState(settings, id, normId, state);
          this._updateInstanceEnabledField(settings, normId, state);
          return false;
        });
        row.add_suffix(sw);
        this._appListBox.append(row);
      }
    }

    const sysApps = filteredSystemApps.filter((app) => {
      const rawId = app.get_id() || "";
      const normId = this._normalizeAppId(rawId)?.toLowerCase() ?? "";
      return !shownInstanceIds.has(normId);
    });

    if (sysApps.length > 0) {
      if (instanceRows.length > 0) {
        this._appListBox.append(
          new Gtk.Label({
            label: _("Other Apps"),
            xalign: 0,
            css_classes: ["caption", "dim-label"],
            margin_top: 10,
            margin_bottom: 2,
            margin_start: 8,
          }),
        );
      }

      sysApps.forEach((app) => {
        const rawId = app.get_id();
        const appId = this._normalizeAppId(rawId);
        if (!appId) return;

        const normId = appId.toLowerCase();
        const isEnabled = this._isAppEnabled(normId, enabledIds);

        const row = new Adw.ActionRow({
          title: app.get_name(),
          subtitle: appId,
          activatable: false,
        });

        const icon = app.get_icon();
        if (icon)
          row.add_prefix(
            new Gtk.Image({
              gicon: icon,
              pixel_size: 24,
              valign: Gtk.Align.CENTER,
            }),
          );

        const sw = new Gtk.Switch({
          active: isEnabled,
          valign: Gtk.Align.CENTER,
        });
        sw.connect("state-set", (_w, state) => {
          if (state) {
            const record = JSON.stringify({
              id: appId,
              name: app.get_name(),
              desktopId: appId,
              busName: "",
              enabled: true,
            });
            try {
              const existing = settings.get_strv("vinyl-app-instances") ?? [];
              const deduped = existing.filter((raw) => {
                try {
                  return JSON.parse(raw).id?.toLowerCase() !== normId;
                } catch (_) {
                  return true;
                }
              });
              deduped.push(record);
              settings.set_strv("vinyl-app-instances", deduped);
            } catch (_e) {}
          } else {
            this._updateInstanceEnabledField(settings, normId, false);
          }
          this._setAppVinylState(settings, appId, normId, state);
          return false;
        });
        row.add_suffix(sw);
        this._appListBox.append(row);
      });
    }

    if (instanceRows.length === 0 && sysApps.length === 0) {
      this._appListBox.append(
        new Gtk.Label({
          label: _("No matching apps found"),
          css_classes: ["dim-label"],
          margin_top: 16,
          margin_bottom: 16,
        }),
      );
    }
  }

  /**
   * Find Gio.AppInfo for a stored instance id.
   * Instance / numeric suffixes are stripped before matching.
   *
   * @param {string} desktopId   stored desktopId field
   * @param {string} fallbackId  stored id field
   * @returns {Gio.AppInfo|null}
   */
  _findAppInfo(desktopId, fallbackId) {
    const tokens = new Set();
    for (const base of [desktopId, fallbackId]) {
      if (!base) continue;
      const stripped = base
        .replace(/\.instance[_\d]+$/i, "")
        .replace(/\.\d+$/, "");
      for (const variant of [base, stripped]) {
        const lower = variant.toLowerCase();
        tokens.add(lower);
        tokens.add(`${lower}.desktop`);

        for (const seg of lower.split(".")) {
          if (seg.length > 2) tokens.add(seg);
        }
      }
    }

    for (const generic of [
      "org",
      "com",
      "net",
      "io",
      "app",
      "application",
      "browser",
      "client",
      "player",
      "media",
      "desktop",
      "instance",
      "snap",
      "flatpak",
    ]) {
      tokens.delete(generic);
    }

    try {
      const allApps = Gio.AppInfo.get_all();

      for (const app of allApps) {
        const appId = (app.get_id() ?? "").toLowerCase();
        if (tokens.has(appId)) return app;
        const appIdClean = appId.endsWith(".desktop")
          ? appId.slice(0, -8)
          : appId;
        if (tokens.has(appIdClean)) return app;
      }

      for (const app of allApps) {
        const appId = (app.get_id() ?? "").toLowerCase();
        const appIdClean = appId.endsWith(".desktop")
          ? appId.slice(0, -8)
          : appId;
        for (const seg of appIdClean.split(".")) {
          if (seg.length > 2 && tokens.has(seg)) return app;
        }
      }

      for (const app of allApps) {
        const name = (app.get_display_name() ?? "")
          .toLowerCase()
          .replace(/\s+/g, "");
        if (tokens.has(name)) return app;
        const firstWord = (app.get_display_name() ?? "")
          .toLowerCase()
          .split(/\s+/)[0];
        if (firstWord.length > 2 && tokens.has(firstWord)) return app;
      }
    } catch (_e) {}
    return null;
  }

  _normalizeAppId(id) {
    if (!id) return null;
    return id.endsWith(".desktop") ? id.slice(0, -8) : id;
  }

  // ── About page ────────────────────────────────────────────────────────────

  _createAboutPage() {
    const page = new Adw.PreferencesPage({
      title: _("About"),
      icon_name: "help-about-symbolic",
    });

    const infoGroup = new Adw.PreferencesGroup({
      title: _("Advanced Media Controller"),
      description: _(
        "Beautiful and modern media controls with multi-instance support",
      ),
    });

    const headerBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 20,
      margin_top: 20,
      margin_bottom: 20,
      halign: Gtk.Align.CENTER,
    });

    const logoPath = `${this.dir.get_path()}/icons/media-logo.png`;
    let logoImage;
    try {
      logoImage = Gtk.Image.new_from_file(logoPath);
      logoImage.set_pixel_size(72);
    } catch (_e) {
      logoImage = new Gtk.Image({
        icon_name: "multimedia-player-symbolic",
        pixel_size: 72,
      });
    }

    const infoBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      valign: Gtk.Align.CENTER,
    });
    infoBox.append(
      new Gtk.Label({
        label: _("Advanced Media Controller"),
        halign: Gtk.Align.START,
        css_classes: ["title-2"],
      }),
    );
    infoBox.append(
      new Gtk.Label({
        label: _("Version 5.2"),
        halign: Gtk.Align.START,
        css_classes: ["caption"],
      }),
    );
    infoBox.append(
      new Gtk.Label({
        label: _("Modern media controls with native GNOME design"),
        halign: Gtk.Align.START,
        wrap: true,
        max_width_chars: 40,
        css_classes: ["body"],
      }),
    );

    headerBox.append(logoImage);
    headerBox.append(infoBox);
    const headerRow = new Adw.ActionRow({ title: "", activatable: false });
    headerRow.add_suffix(headerBox);

    const linksGroup = new Adw.PreferencesGroup({
      title: _("Extension Links"),
      description: _("Source code, issues, and contributions"),
    });

    const githubRow = new Adw.ActionRow({
      title: _("View on GitHub"),
      subtitle: _("Source code, issues, and contributions"),
      activatable: true,
    });
    githubRow.add_prefix(this._createGitHubIcon());
    githubRow.add_suffix(
      new Gtk.Image({
        icon_name: "adw-external-link-symbolic",
        pixel_size: 16,
      }),
    );
    githubRow.connect("activated", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(
          "https://github.com/Sanjai-Shaarugesh/Advance-media-controller",
          null,
        );
      } catch (e) {
        console.error("Could not open GitHub link:", e);
      }
    });

    const qrGroup = new Adw.PreferencesGroup({
      title: _(
        "\u2615 Support by buying me a coffee \u2013 just scan the QR code!",
      ),
      description: _("Preferred Method - Scan QR code to support development"),
    });
    const qrContainer = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 16,
      halign: Gtk.Align.CENTER,
      margin_top: 24,
      margin_bottom: 24,
      margin_start: 24,
      margin_end: 24,
    });
    const qrPath = `${this.dir.get_path()}/icons/qr.png`;
    let qrImage;
    try {
      qrImage = Gtk.Image.new_from_file(qrPath);
      qrImage.set_pixel_size(200);
    } catch (_e) {
      qrImage = new Gtk.Image({
        icon_name: "camera-web-symbolic",
        pixel_size: 200,
      });
    }
    qrContainer.append(qrImage);
    const qrRow = new Adw.ActionRow({ title: "", activatable: false });
    qrRow.set_child(qrContainer);

    const addressGroup = new Adw.PreferencesGroup({
      title: _("Donation Address"),
    });
    const addressRow = new Adw.ActionRow({
      title: "https://buymeacoffee.com/sanjai",
      activatable: true,
    });
    addressRow.add_prefix(
      new Gtk.Image({ icon_name: "emote-love-symbolic", pixel_size: 16 }),
    );
    addressRow.add_suffix(
      new Gtk.Image({ icon_name: "edit-copy-symbolic", pixel_size: 16 }),
    );
    addressRow.connect("activated", () =>
      this._copyToClipboard(
        "https://buymeacoffee.com/sanjai",
        _("Donation address"),
      ),
    );

    const sponsorRow = new Adw.ActionRow({
      title: _("\u2615 Buy Me a Coffee"),
      subtitle: _("Support development with a small donation"),
      activatable: true,
    });
    sponsorRow.add_prefix(
      new Gtk.Image({ icon_name: "emblem-favorite-symbolic", pixel_size: 20 }),
    );
    sponsorRow.add_suffix(
      new Gtk.Image({
        icon_name: "adw-external-link-symbolic",
        pixel_size: 16,
      }),
    );
    sponsorRow.connect("activated", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(
          "https://buymeacoffee.com/sanjai",
          null,
        );
      } catch (e) {
        console.error("Could not open sponsor link:", e);
      }
    });

    const licenseGroup = new Adw.PreferencesGroup({
      title: _("License & Credits"),
      description: _("Open source software information"),
    });
    const licenseRow = new Adw.ActionRow({
      title: _("Open Source License"),
      subtitle: _("GPL-3.0 License - Free and open source software"),
      activatable: false,
    });
    licenseRow.add_prefix(
      new Gtk.Image({ icon_name: "security-high-symbolic", pixel_size: 16 }),
    );
    const creditsRow = new Adw.ActionRow({
      title: _("Media Data Sources"),
      subtitle: _(
        "MPRIS D-Bus interface - Standard media player remote interfacing",
      ),
      activatable: false,
    });
    creditsRow.add_prefix(
      new Gtk.Image({ icon_name: "network-server-symbolic", pixel_size: 16 }),
    );
    const featuresRow = new Adw.ActionRow({
      title: _("Key Features"),
      subtitle: _(
        "\u2022 Multi-instance browser support\n\u2022 Per-app rotating vinyl record album art\n" +
          "\u2022 Animated tonearm\n\u2022 Smooth animations\n\u2022 Double-click to toggle vinyl per app\n" +
          "\u2022 Triple-click album art to show synced lyrics\n" +
          "\u2022 Single-click lyrics panel to return to album art\n" +
          "\u2022 Lyrics synced to playback via lrclib.net\n" +
          "\u2022 Per-player lyrics toggle (each tab independent)\n" +
          "\u2022 All seen apps remembered \u2014 re-enable any time",
      ),
      activatable: false,
    });
    featuresRow.add_prefix(
      new Gtk.Image({ icon_name: "starred-symbolic", pixel_size: 16 }),
    );

    infoGroup.add(headerRow);
    linksGroup.add(githubRow);
    qrGroup.add(qrRow);
    addressGroup.add(addressRow);
    addressGroup.add(sponsorRow);
    licenseGroup.add(licenseRow);
    licenseGroup.add(creditsRow);
    licenseGroup.add(featuresRow);

    page.add(infoGroup);
    page.add(linksGroup);
    page.add(qrGroup);
    page.add(addressGroup);
    page.add(licenseGroup);

    return page;
  }

  _createGitHubIcon() {
    const svgPath = `${this.dir.get_path()}/icons/github.svg`;

    if (Gio.File.new_for_path(svgPath).query_exists(null)) {
      return new Gtk.Image({
        file: svgPath,
        pixel_size: 20,
      });
    }

    return new Gtk.Image({
      icon_name: "adw-external-link-symbolic",
      pixel_size: 20,
    });
  }

  _copyToClipboard(text, _label) {
    const display = Gdk.Display.get_default();
    if (display) {
      const clipboard = display.get_clipboard();
      if (clipboard) {
        clipboard.set(text);
        return;
      }
    }
    this._showCopyDialog(text);
  }

  _showCopyDialog(text) {
    const dialog = new Adw.AlertDialog({
      heading: _("Copy to Clipboard"),
      body: _(
        "Unable to copy automatically. Select the address below and press Ctrl+C:",
      ),
    });
    dialog.add_response("close", _("Close"));
    dialog.set_default_response("close");

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 12,
      margin_bottom: 12,
      margin_start: 12,
      margin_end: 12,
    });
    box.append(
      new Gtk.Entry({
        text,
        editable: false,
        can_focus: true,
        width_chars: 40,
      }),
    );
    dialog.set_extra_child(box);
    dialog.present(null);
  }
}