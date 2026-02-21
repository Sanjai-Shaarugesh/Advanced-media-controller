import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class MediaControlsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    window.set_title("Advanced Media Controller");
    window.set_default_size(700, 760);
    window.set_resizable(true);

    // ── General page ──────────────────────────────────────────────────────────
    const generalPage = new Adw.PreferencesPage({
      title: "General",
      icon_name: "preferences-system-symbolic",
    });
    window.add(generalPage);

    const panelGroup = new Adw.PreferencesGroup({
      title: "Panel Placement",
      description: "Where the indicator sits in the top bar",
    });
    generalPage.add(panelGroup);

    const positionRow = new Adw.ComboRow({ title: "Panel Position" });
    const positionModel = new Gtk.StringList();
    ["Left", "Center", "Right"].forEach((l) => positionModel.append(l));
    positionRow.model = positionModel;
    const positions = ["left", "center", "right"];
    positionRow.selected = Math.max(0, positions.indexOf(settings.get_string("panel-position")));
    positionRow.connect("notify::selected", (w) =>
      settings.set_string("panel-position", positions[w.selected]),
    );
    panelGroup.add(positionRow);

    const indexRow = new Adw.SpinRow({
      title: "Panel Index",
      subtitle: "Position within the panel area (-1 = automatic)",
      adjustment: new Gtk.Adjustment({
        lower: -1, upper: 20, step_increment: 1, page_increment: 5,
        value: settings.get_int("panel-index"),
      }),
    });
    settings.bind("panel-index", indexRow, "value", Gio.SettingsBindFlags.DEFAULT);
    panelGroup.add(indexRow);

    const labelGroup = new Adw.PreferencesGroup({
      title: "Panel Label",
      description: "Track name shown in the top bar",
    });
    generalPage.add(labelGroup);

    const showTrackRow = new Adw.SwitchRow({
      title: "Show Track Name",
      subtitle: "Display the current track title in the panel",
    });
    settings.bind("show-track-name", showTrackRow, "active", Gio.SettingsBindFlags.DEFAULT);
    labelGroup.add(showTrackRow);

    const showArtistRow = new Adw.SwitchRow({
      title: "Show Artist Name",
      subtitle: "Append the artist name to the track title",
    });
    settings.bind("show-artist", showArtistRow, "active", Gio.SettingsBindFlags.DEFAULT);
    labelGroup.add(showArtistRow);

    const separatorRow = new Adw.EntryRow({
      title: "Title / Artist Separator",
      text: settings.get_string("separator-text"),
      show_apply_button: true,
    });
    separatorRow.connect("apply", () =>
      settings.set_string("separator-text", separatorRow.text),
    );
    labelGroup.add(separatorRow);

    const panelScrollGroup = new Adw.PreferencesGroup({
      title: "Panel Scrolling",
      description: "Marquee scroll of the track label in the top bar",
    });
    generalPage.add(panelScrollGroup);

    const enablePanelScrollRow = new Adw.SwitchRow({
      title: "Enable Panel Label Scrolling",
      subtitle:
        "Scroll the track/artist text one full loop then pause before repeating. " +
        "When off, the text is truncated with an ellipsis.",
    });
    settings.bind("enable-panel-scroll", enablePanelScrollRow, "active", Gio.SettingsBindFlags.DEFAULT);
    panelScrollGroup.add(enablePanelScrollRow);

    const panelScrollSpeedRow = new Adw.SpinRow({
      title: "Panel Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
      adjustment: new Gtk.Adjustment({
        lower: 1, upper: 10, step_increment: 1, page_increment: 2,
        value: settings.get_int("scroll-speed"),
      }),
    });
    settings.bind("scroll-speed", panelScrollSpeedRow, "value", Gio.SettingsBindFlags.DEFAULT);
    panelScrollGroup.add(panelScrollSpeedRow);

    // ── Popup Player page ─────────────────────────────────────────────────────
    const popupPage = new Adw.PreferencesPage({
      title: "Popup Player",
      icon_name: "media-playback-start-symbolic",
    });
    window.add(popupPage);

    const titleScrollGroup = new Adw.PreferencesGroup({
      title: "Title Scrolling",
      description: "Marquee behaviour for the track title inside the popup",
    });
    popupPage.add(titleScrollGroup);

    const enableTitleScrollRow = new Adw.SwitchRow({
      title: "Enable Title Scrolling",
      subtitle:
        "Scroll long track titles from start to end, pause, then repeat. " +
        "When off, the text is truncated with an ellipsis.",
    });
    settings.bind("enable-title-scroll", enableTitleScrollRow, "active", Gio.SettingsBindFlags.DEFAULT);
    titleScrollGroup.add(enableTitleScrollRow);

    const titleScrollSpeedRow = new Adw.SpinRow({
      title: "Title Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
      adjustment: new Gtk.Adjustment({
        lower: 1, upper: 10, step_increment: 1, page_increment: 2,
        value: settings.get_int("title-scroll-speed"),
      }),
    });
    settings.bind("title-scroll-speed", titleScrollSpeedRow, "value", Gio.SettingsBindFlags.DEFAULT);
    titleScrollGroup.add(titleScrollSpeedRow);

    const artistScrollGroup = new Adw.PreferencesGroup({
      title: "Artist Scrolling",
      description: "Marquee behaviour for the artist name inside the popup",
    });
    popupPage.add(artistScrollGroup);

    const enableArtistScrollRow = new Adw.SwitchRow({
      title: "Enable Artist Scrolling",
      subtitle:
        "Scroll long artist names from start to end, pause, then repeat. " +
        "When off, the text is truncated with an ellipsis.",
    });
    settings.bind("enable-artist-scroll", enableArtistScrollRow, "active", Gio.SettingsBindFlags.DEFAULT);
    artistScrollGroup.add(enableArtistScrollRow);

    const artistScrollSpeedRow = new Adw.SpinRow({
      title: "Artist Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
      adjustment: new Gtk.Adjustment({
        lower: 1, upper: 10, step_increment: 1, page_increment: 2,
        value: settings.get_int("artist-scroll-speed"),
      }),
    });
    settings.bind("artist-scroll-speed", artistScrollSpeedRow, "value", Gio.SettingsBindFlags.DEFAULT);
    artistScrollGroup.add(artistScrollSpeedRow);

    // ── Album Art / Vinyl group ───────────────────────────────────────────────
    const albumArtGroup = new Adw.PreferencesGroup({
      title: "Album Art",
      description: "Vinyl-record rotation animation",
    });
    popupPage.add(albumArtGroup);

    const enableRotationRow = new Adw.SwitchRow({
      title: "Enable Vinyl Record Rotation (Global Default)",
      subtitle:
        "Global default when no per-app setting exists. " +
        "Per-app overrides in the 'Vinyl Apps' section take priority.",
      icon_name: "media-optical-cd-audio-symbolic",
    });
    settings.bind("enable-album-art-rotation", enableRotationRow, "active", Gio.SettingsBindFlags.DEFAULT);
    albumArtGroup.add(enableRotationRow);

    const rotationSpeedRow = new Adw.SpinRow({
      title: "Rotation Speed (seconds per revolution)",
      subtitle: "5 = fastest, 60 = slowest. Recommended: 20–30",
      adjustment: new Gtk.Adjustment({
        lower: 5, upper: 60, step_increment: 1, page_increment: 5,
        value: settings.get_int("album-art-rotation-speed"),
      }),
    });
    settings.bind("album-art-rotation-speed", rotationSpeedRow, "value", Gio.SettingsBindFlags.DEFAULT);
    albumArtGroup.add(rotationSpeedRow);

    const rotationInfoRow = new Adw.ExpanderRow({
      title: "Vinyl Effect Details",
      subtitle: "How the animated vinyl record works",
      icon_name: "dialog-information-symbolic",
    });
    const infoLabel = new Gtk.Label({
      label:
        "- Album cover appears on a spinning vinyl disc\n" +
        "- Black vinyl grooves are visible around the edges\n" +
        "- Animated tonearm moves in and out with playback state\n" +
        "- Rotation pauses smoothly when music pauses\n" +
        "  (disc angle is preserved and resumes from the same position)\n" +
        "- Disc resets to 0° only on a genuine Stop\n" +
        "- Double-click album art to toggle vinyl for THAT player's app only\n" +
        "- Per-app settings override the global default above",
      wrap: true, xalign: 0,
      margin_top: 12, margin_bottom: 12,
      margin_start: 12, margin_end: 12,
      css_classes: ["dim-label"],
    });
    const infoBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    infoBox.append(infoLabel);
    rotationInfoRow.add_row(infoBox);
    albumArtGroup.add(rotationInfoRow);

    // ── Vinyl Apps page ───────────────────────────────────────────────────────
    const vinylPage = new Adw.PreferencesPage({
      title: "Vinyl Apps",
      icon_name: "media-optical-cd-audio-symbolic",
    });
    window.add(vinylPage);

    this._buildVinylAppsPage(vinylPage, settings);

    // ── About page ────────────────────────────────────────────────────────────
    window.add(this._createAboutPage(window));
  }

  // ── Vinyl Apps page builder ───────────────────────────────────────────────

  _buildVinylAppsPage(page, settings) {
    // ── Enabled apps group ──────────────────────────────────────────────────
    const enabledGroup = new Adw.PreferencesGroup({
      title: "Apps with Vinyl Effect Enabled",
      description:
        "Only these apps will show the rotating vinyl record. " +
        "Double-clicking the album art in the popup also adds/removes the " +
        "current player here automatically.",
    });
    page.add(enabledGroup);

    // Container for the dynamic list of enabled-app rows
    this._enabledAppsGroup = enabledGroup;
    this._enabledAppRows   = new Map(); // appId → ActionRow
    this._vinylSettings    = settings;

    this._refreshEnabledAppsList(settings);

    // ── App search group ────────────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup({
      title: "Add an App",
      description: "Search installed apps and toggle the vinyl effect for each one.",
    });
    page.add(searchGroup);

    // Search entry
    const searchRow = new Adw.ActionRow({
      title: "Search apps",
      activatable: false,
    });

    const searchEntry = new Gtk.SearchEntry({
      placeholder_text: "Type an app name…",
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    searchRow.add_suffix(searchEntry);
    searchGroup.add(searchRow);

    // Results list box inside a scrolled window
    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      min_content_height: 200,
      max_content_height: 380,
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

    // Populate all media-capable apps
    this._allApps = this._loadMediaApps();
    this._renderAppList(this._allApps, settings);

    // Live filter on search
    searchEntry.connect("search-changed", () => {
      const query = searchEntry.text.toLowerCase().trim();
      const filtered = query.length === 0
        ? this._allApps
        : this._allApps.filter(
            (app) =>
              app.get_name().toLowerCase().includes(query) ||
              (app.get_id() || "").toLowerCase().includes(query),
          );
      this._renderAppList(filtered, settings);
    });

    // Keep the results in sync when vinyl-app-ids changes elsewhere.
    this._vinylAppsChangedId = settings.connect("changed::vinyl-app-ids", () => {
      this._refreshEnabledAppsList(settings);
      const query = searchEntry.text.toLowerCase().trim();
      const filtered = query.length === 0
        ? this._allApps
        : this._allApps.filter(
            (app) =>
              app.get_name().toLowerCase().includes(query) ||
              (app.get_id() || "").toLowerCase().includes(query),
          );
      this._renderAppList(filtered, settings);
    });
  }

  /** Load all installed apps that might be media players. */
  _loadMediaApps() {
    const allApps = Gio.AppInfo.get_all();

    // Prefer apps with audio/media categories; also include those with
    // StartupWMClass or that expose MPRIS-like names.
    const mediaCategories = [
      "audio", "music", "video", "player", "multimedia", "media",
    ];

    return allApps
      .filter((app) => {
        if (!app.should_show()) return false;
        const cats = (app.get_categories() || "").toLowerCase();
        return mediaCategories.some((c) => cats.includes(c));
      })
      .sort((a, b) => a.get_name().localeCompare(b.get_name()));
  }

  /** Render (or re-render) the search results list. */
  _renderAppList(apps, settings) {
    // Remove all existing rows
    let child = this._appListBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._appListBox.remove(child);
      child = next;
    }

    if (apps.length === 0) {
      const empty = new Gtk.Label({
        label: "No matching apps found",
        css_classes: ["dim-label"],
        margin_top: 16,
        margin_bottom: 16,
      });
      this._appListBox.append(empty);
      return;
    }

    const vinylIds = settings.get_strv("vinyl-app-ids");

    apps.forEach((app) => {
      const appId = this._normalizeAppId(app.get_id());
      if (!appId) return;

      const isEnabled = vinylIds.some(
        (id) => id.toLowerCase() === appId.toLowerCase(),
      );

      const row = new Adw.ActionRow({
        title: app.get_name(),
        subtitle: appId,
        activatable: false,
      });

      // App icon
      const icon = app.get_icon();
      if (icon) {
        row.add_prefix(
          new Gtk.Image({ gicon: icon, pixel_size: 24, valign: Gtk.Align.CENTER }),
        );
      }

      // Toggle switch
      const sw = new Gtk.Switch({
        active: isEnabled,
        valign: Gtk.Align.CENTER,
      });
      sw.connect("state-set", (_widget, state) => {
        const current = settings.get_strv("vinyl-app-ids");
        const idx = current.findIndex(
          (id) => id.toLowerCase() === appId.toLowerCase(),
        );

        if (state && idx < 0)
          current.push(appId);
        else if (!state && idx >= 0)
          current.splice(idx, 1);

        settings.set_strv("vinyl-app-ids", current);
        return false; // let the switch update its own visual state
      });
      row.add_suffix(sw);

      this._appListBox.append(row);
    });
  }

  /** Rebuild the "currently enabled" rows at the top of the Vinyl Apps page. */
  _refreshEnabledAppsList(settings) {
    // Clear old rows
    for (const row of this._enabledAppRows.values()) {
      try { this._enabledAppsGroup.remove(row); } catch (_e) {}
    }
    this._enabledAppRows.clear();

    const vinylIds = settings.get_strv("vinyl-app-ids");

    if (vinylIds.length === 0) {
      const placeholder = new Adw.ActionRow({
        title: "No apps selected yet",
        subtitle: "Use the search below or double-click the album art in the popup",
        activatable: false,
        css_classes: ["dim-label"],
      });
      this._enabledAppRows.set("__placeholder__", placeholder);
      this._enabledAppsGroup.add(placeholder);
      return;
    }

    for (const appId of vinylIds) {
      // Try to resolve a friendly name + icon via GAppInfo.
      let appName = appId;
      let appIcon = null;

      try {
        const info = Gio.DesktopAppInfo.new(`${appId}.desktop`)
          ?? Gio.DesktopAppInfo.new(appId);
        if (info) {
          appName = info.get_name() ?? appId;
          appIcon = info.get_icon();
        }
      } catch (_e) {}

      const row = new Adw.ActionRow({
        title: appName,
        subtitle: appId,
        activatable: false,
      });

      if (appIcon) {
        row.add_prefix(
          new Gtk.Image({ gicon: appIcon, pixel_size: 24, valign: Gtk.Align.CENTER }),
        );
      } else {
        row.add_prefix(
          new Gtk.Image({
            icon_name: "media-optical-cd-audio-symbolic",
            pixel_size: 24,
            valign: Gtk.Align.CENTER,
          }),
        );
      }

      // Remove button
      const removeBtn = new Gtk.Button({
        icon_name: "list-remove-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["destructive-action", "flat"],
        tooltip_text: `Remove vinyl effect from ${appName}`,
      });
      removeBtn.connect("clicked", () => {
        const current = settings.get_strv("vinyl-app-ids");
        const idx = current.findIndex(
          (id) => id.toLowerCase() === appId.toLowerCase(),
        );
        if (idx >= 0) current.splice(idx, 1);
        settings.set_strv("vinyl-app-ids", current);
      });
      row.add_suffix(removeBtn);

      this._enabledAppsGroup.add(row);
      this._enabledAppRows.set(appId, row);
    }
  }

  /** Strip .desktop suffix so IDs are consistent with MPRIS desktop entries. */
  _normalizeAppId(id) {
    if (!id) return null;
    return id.endsWith(".desktop") ? id.slice(0, -".desktop".length) : id;
  }

  // ── About page ────────────────────────────────────────────────────────────

  _createAboutPage() {
    const page = new Adw.PreferencesPage({
      title: "About",
      icon_name: "help-about-symbolic",
    });

    const infoGroup = new Adw.PreferencesGroup({
      title: "Advanced Media Controller",
      description: "Beautiful and modern media controls with multi-instance support",
    });

    const headerBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 20,
      margin_top: 20, margin_bottom: 20,
      halign: Gtk.Align.CENTER,
    });

    const logoPath = `${this.dir.get_path()}/icons/media-logo.png`;
    let logoImage;
    try {
      logoImage = Gtk.Image.new_from_file(logoPath);
      logoImage.set_pixel_size(72);
    } catch (_e) {
      logoImage = new Gtk.Image({ icon_name: "multimedia-player-symbolic", pixel_size: 72 });
    }

    const infoBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6, valign: Gtk.Align.CENTER,
    });
    infoBox.append(new Gtk.Label({ label: "Advanced Media Controller", halign: Gtk.Align.START, css_classes: ["title-2"] }));
    infoBox.append(new Gtk.Label({ label: "Version 1.0", halign: Gtk.Align.START, css_classes: ["caption"] }));
    infoBox.append(new Gtk.Label({
      label: "Modern media controls with native GNOME design",
      halign: Gtk.Align.START, wrap: true, max_width_chars: 40, css_classes: ["body"],
    }));

    headerBox.append(logoImage);
    headerBox.append(infoBox);
    const headerRow = new Adw.ActionRow({ title: "", activatable: false });
    headerRow.add_suffix(headerBox);

    const linksGroup = new Adw.PreferencesGroup({
      title: "Extension Links",
      description: "Source code, issues, and contributions",
    });

    const githubRow = new Adw.ActionRow({
      title: "View on GitHub",
      subtitle: "Source code, issues, and contributions",
      activatable: true,
    });
    githubRow.add_prefix(this._createGitHubIcon());
    githubRow.add_suffix(new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }));
    githubRow.connect("activated", () => {
      try {
        Gio.AppInfo.launch_default_for_uri(
          "https://github.com/Sanjai-Shaarugesh/Advance-media-controller",
          null,
        );
      } catch (e) { console.error("Could not open GitHub link:", e); }
    });

    const qrGroup = new Adw.PreferencesGroup({
      title: "☕ Support by buying me a coffee – just scan the QR code!",
      description: "Preferred Method - Scan QR code to support development",
    });
    const qrContainer = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 16, halign: Gtk.Align.CENTER,
      margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
    });
    const qrPath = `${this.dir.get_path()}/icons/qr.png`;
    let qrImage;
    try {
      qrImage = Gtk.Image.new_from_file(qrPath);
      qrImage.set_pixel_size(200);
    } catch (_e) {
      qrImage = new Gtk.Image({ icon_name: "camera-web-symbolic", pixel_size: 200 });
    }
    qrContainer.append(qrImage);
    const qrRow = new Adw.ActionRow({ title: "", activatable: false });
    qrRow.set_child(qrContainer);

    const addressGroup = new Adw.PreferencesGroup({ title: "Donation Address" });
    const addressRow = new Adw.ActionRow({
      title: "https://buymeacoffee.com/sanjai",
      activatable: true,
    });
    addressRow.add_prefix(new Gtk.Image({ icon_name: "emote-love-symbolic", pixel_size: 16 }));
    addressRow.add_suffix(new Gtk.Image({ icon_name: "edit-copy-symbolic", pixel_size: 16 }));
    addressRow.connect("activated", () =>
      this._copyToClipboard("https://buymeacoffee.com/sanjai", "Donation address"),
    );

    const sponsorRow = new Adw.ActionRow({
      title: "☕ Buy Me a Coffee",
      subtitle: "Support development with a small donation",
      activatable: true,
    });
    sponsorRow.add_prefix(new Gtk.Image({ icon_name: "emblem-favorite-symbolic", pixel_size: 20 }));
    sponsorRow.add_suffix(new Gtk.Image({ icon_name: "adw-external-link-symbolic", pixel_size: 16 }));
    sponsorRow.connect("activated", () => {
      try { Gio.AppInfo.launch_default_for_uri("https://buymeacoffee.com/sanjai", null); }
      catch (e) { console.error("Could not open sponsor link:", e); }
    });

    const licenseGroup = new Adw.PreferencesGroup({ title: "License & Credits", description: "Open source software information" });
    const licenseRow = new Adw.ActionRow({ title: "Open Source License", subtitle: "GPL-3.0 License - Free and open source software", activatable: false });
    licenseRow.add_prefix(new Gtk.Image({ icon_name: "security-high-symbolic", pixel_size: 16 }));
    const creditsRow = new Adw.ActionRow({ title: "Media Data Sources", subtitle: "MPRIS D-Bus interface - Standard media player remote interfacing", activatable: false });
    creditsRow.add_prefix(new Gtk.Image({ icon_name: "network-server-symbolic", pixel_size: 16 }));
    const featuresRow = new Adw.ActionRow({
      title: "Key Features",
      subtitle:
        "• Multi-instance browser support\n• Per-app rotating vinyl record album art\n" +
        "• Animated tonearm\n• Smooth animations\n• Double-click to toggle vinyl per app",
      activatable: false,
    });
    featuresRow.add_prefix(new Gtk.Image({ icon_name: "starred-symbolic", pixel_size: 16 }));

    infoGroup.add(headerRow);
    linksGroup.add(githubRow);
    qrGroup.add(qrRow);
    addressGroup.add(addressRow);
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
    if (Gio.File.new_for_path(svgPath).query_exists(null))
      return new Gtk.Image({ file: svgPath, pixel_size: 20 });

    const img = new Gtk.Image({ icon_name: "software-properties-symbolic", pixel_size: 20 });
    const svg =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234' +
      'c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729' +
      ' 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604' +
      '-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176' +
      ' 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404' +
      ' 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221' +
      ' 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576' +
      ' 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>';

    const tmpPath = `${GLib.get_tmp_dir()}/amc-github-icon.svg`;
    const tmpFile = Gio.File.new_for_path(tmpPath);
    const bytes   = GLib.Bytes.new(new TextEncoder().encode(svg));
    tmpFile.replace_contents_bytes_async(
      bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
      (_f, result) => {
        try { tmpFile.replace_contents_finish(result); img.set_from_file(tmpPath); }
        catch (e) { console.warn("MediaControls prefs: could not write GitHub icon SVG:", e.message); }
      },
    );
    return img;
  }

  _copyToClipboard(text, _label) {
    const display = Gdk.Display.get_default();
    if (display) {
      const clipboard = display.get_clipboard();
      if (clipboard) { clipboard.set(text); return; }
    }
    this._showCopyDialog(text);
  }

  _showCopyDialog(text) {
    const dialog = new Adw.AlertDialog({
      heading: "Copy to Clipboard",
      body: "Unable to copy automatically. Select the address below and press Ctrl+C:",
    });
    dialog.add_response("close", "Close");
    dialog.set_default_response("close");

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12,
    });
    box.append(new Gtk.Entry({ text, editable: false, can_focus: true, width_chars: 40 }));
    dialog.set_extra_child(box);
    dialog.present(null);
  }
}