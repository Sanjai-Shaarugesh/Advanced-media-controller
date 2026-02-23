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

    // General page
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
    positionRow.selected = Math.max(
      0,
      positions.indexOf(settings.get_string("panel-position")),
    );
    positionRow.connect("notify::selected", (w) =>
      settings.set_string("panel-position", positions[w.selected]),
    );
    panelGroup.add(positionRow);

    const indexRow = new Adw.SpinRow({
      title: "Panel Index",
      subtitle: "Position within the panel area (-1 = automatic)",
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
      title: "Panel Label",
      description: "Track name shown in the top bar",
    });
    generalPage.add(labelGroup);

    const showTrackRow = new Adw.SwitchRow({
      title: "Show Track Name",
      subtitle: "Display the current track title in the panel",
    });
    settings.bind(
      "show-track-name",
      showTrackRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    labelGroup.add(showTrackRow);

    const showArtistRow = new Adw.SwitchRow({
      title: "Show Artist Name",
      subtitle: "Append the artist name to the track title",
    });
    settings.bind(
      "show-artist",
      showArtistRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
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
    settings.bind(
      "enable-panel-scroll",
      enablePanelScrollRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    panelScrollGroup.add(enablePanelScrollRow);

    const panelScrollSpeedRow = new Adw.SpinRow({
      title: "Panel Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
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

    // Popup Player page
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
    settings.bind(
      "enable-title-scroll",
      enableTitleScrollRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    titleScrollGroup.add(enableTitleScrollRow);

    const titleScrollSpeedRow = new Adw.SpinRow({
      title: "Title Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
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
    settings.bind(
      "enable-artist-scroll",
      enableArtistScrollRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    artistScrollGroup.add(enableArtistScrollRow);

    const artistScrollSpeedRow = new Adw.SpinRow({
      title: "Artist Scroll Speed",
      subtitle: "1 = slowest, 10 = fastest",
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

    // Album Art & Vinyl group
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
    settings.bind(
      "enable-album-art-rotation",
      enableRotationRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    albumArtGroup.add(enableRotationRow);

    const rotationSpeedRow = new Adw.SpinRow({
      title: "Rotation Speed (seconds per revolution)",
      subtitle: "5 = fastest, 60 = slowest. Recommended: 20–30",
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
        "- Per-app settings override the global default above\n" +
        "- All seen apps are stored; re-enable any time from Vinyl Apps page",
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

    // Vinyl Apps page
    const vinylPage = new Adw.PreferencesPage({
      title: "Vinyl Apps",
      icon_name: "media-optical-cd-audio-symbolic",
    });
    window.add(vinylPage);

    this._buildVinylAppsPage(vinylPage, settings);

    // About page
    window.add(this._createAboutPage(window));
  }

  _buildVinylAppsPage(page, settings) {
    // instructions banner
    const howtoGroup = new Adw.PreferencesGroup({
      title: "How to Enable Vinyl Style for an App",
    });
    page.add(howtoGroup);

    // Step-by-step instruction rows with icons
    const steps = [
      {
        icon: "media-playback-start-symbolic",
        title: "Start playing music",
        subtitle:
          "Open any media player or browser web app (YouTube, Spotify Web, SoundCloud, etc.) and play a track so it appears as a media source.",
      },
      {
        icon: "input-mouse-symbolic",
        title: "Open the extension popup",
        subtitle:
          "Click the media controller in the top panel to open the popup player.",
      },
      {
        icon: "go-jump-symbolic",
        title: "Double-click the album art",
        subtitle:
          "Double-click the album art image in the popup to toggle the vinyl record style for that specific app instance. The instance is saved here automatically.",
      },
      {
        icon: "media-optical-cd-audio-symbolic",
        title: "Manage saved instances below",
        subtitle:
          "All stored instances appear in the section below with their app icon and name. Toggle them on/off or remove them at any time.",
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

    // Stored instances group
    const instancesGroup = new Adw.PreferencesGroup({
      title: "Saved App Instances",
      description:
        "Instances stored by double-clicking the album art in the popup. " +
        "Icons are loaded from the system .desktop database. " +
        "Toggle the vinyl effect on/off or remove any entry.",
    });
    page.add(instancesGroup);

    this._instancesGroup = instancesGroup;
    this._instanceRows = new Map();
    this._vinylSettings = settings;

    this._refreshInstancesList(settings);

    // Add app manually & web app search
    const searchGroup = new Adw.PreferencesGroup({
      title: "Add an App Manually",
      description:
        "Search installed apps — including browsers — to manually add a vinyl entry. " +
        "Useful for browser web apps whose instance hasn't been captured yet via double-click.",
    });
    page.add(searchGroup);

    // Tip row for web apps
    const webTipRow = new Adw.ActionRow({
      title: "Browser web apps (YouTube, Spotify Web, etc.)",
      subtitle:
        "For web apps, add the browser itself (e.g. Google Chrome, Firefox). " +
        "Then double-click the album art when that browser is playing music — " +
        "the extension will capture the exact instance automatically.",
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
      title: "Search apps",
      activatable: false,
    });
    const searchEntry = new Gtk.SearchEntry({
      placeholder_text: "Type an app or browser name…",
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

    // Load only browsers & media apps
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

    // React to vinyl-app-ids OR vinyl-app-instances changes
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
  }

  _refreshInstancesList(settings) {
    // Remove old rows
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
        title: "No instances saved yet",
        subtitle:
          "Double-click the album art in the popup while music is playing to save an instance here.",
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

    const seen = new Set();
    for (const raw of rawInstances) {
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (_) {
        continue;
      }

      const id = obj.id ?? "";
      if (!id || seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());

      const normId = id.toLowerCase();

      const isEnabled = this._isAppEnabled(normId, enabledIds);

      let appName = obj.name || obj.desktopId || id;
      let appIcon = null;

      const desktopId = obj.desktopId || id;
      for (const candidate of [
        `${desktopId}.desktop`,
        desktopId,
        `${id}.desktop`,
        id,
        `${id.split(".").pop()}.desktop`,
      ]) {
        try {
          const info = Gio.DesktopAppInfo.new(candidate);
          if (info) {
            appName = info.get_name() || appName;
            appIcon = info.get_icon();
            break;
          }
        } catch (_) {}
      }

      const resolvedName = appName;
      const displayName = obj.customName?.trim() || resolvedName;

      const row = new Adw.ActionRow({
        title: displayName,

        subtitle: obj.customName?.trim()
          ? `${id}  ·  renamed from "${resolvedName}"`
          : id,
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

      // Rename button
      const renameBtn = new Gtk.Button({
        icon_name: "document-edit-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["flat"],
        tooltip_text: `Rename "${displayName}"`,
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
        this._setAppVinylState(settings, id, normId, state);

        this._updateInstanceEnabledField(settings, normId, state);
        return false;
      });
      row.add_suffix(sw);

      // Remove button — deletes the stored instance record entirely
      const removeBtn = new Gtk.Button({
        icon_name: "list-remove-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["destructive-action", "flat"],
        tooltip_text: `Remove ${appName} from saved instances`,
      });
      removeBtn.connect("clicked", () => {
        this._deleteInstance(settings, id, normId);
      });
      row.add_suffix(removeBtn);

      this._instancesGroup.add(row);
      this._instanceRows.set(id, row);
    }
  }

  /**
   * Show a rename dialog for a stored instance.
   */
  _showRenameDialog(settings, id, normId, currentDisplay, resolvedName) {
    // Dialog shell
    const dialog = new Adw.AlertDialog({
      heading: "Rename Instance",
      body: `Enter a custom display name for "${resolvedName}".\nLeave blank to reset to the default name.`,
      default_response: "rename",
      close_response: "cancel",
    });

    dialog.add_response("cancel", "Cancel");
    dialog.add_response("rename", "Rename");
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
      title: "Display name",
      text: currentDisplay !== resolvedName ? currentDisplay : "",
      show_apply_button: false,
    });
    listBox.append(entryRow);
    clamp.set_child(listBox);
    dialog.set_extra_child(clamp);

    entryRow.connect("entry-activated", () => {
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

  /**
   * Persist a custom name into the matching vinyl-app-instances JSON record.
   */
  _renameInstance(settings, normId, newName, resolvedName) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const updated = existing.map((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          if (lower === normId || lower.split(".").pop() === normId) {
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

  /**
   * Update the enabled field in a vinyl-app-instances JSON record.
   */
  _updateInstanceEnabledField(settings, normId, enabledValue) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const updated = existing.map((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          if (lower === normId || lower.split(".").pop() === normId) {
            return JSON.stringify({ ...obj, enabled: enabledValue });
          }
        } catch (_) {}
        return raw;
      });
      settings.set_strv("vinyl-app-instances", updated);
    } catch (_e) {}
  }

  /**
   * Completely delete an instance record from vinyl-app-instances,
   * and also disable it in vinyl-app-ids.
   */
  _deleteInstance(settings, id, normId) {
    try {
      const existing = settings.get_strv("vinyl-app-instances") ?? [];
      const filtered = existing.filter((raw) => {
        try {
          const obj = JSON.parse(raw);
          const lower = (obj.id ?? "").toLowerCase();
          return lower !== normId && lower.split(".").pop() !== normId;
        } catch (_) {
          return true;
        }
      });
      settings.set_strv("vinyl-app-instances", filtered);
    } catch (_e) {}
    // Also remove from vinyl-app-ids
    this._setAppVinylState(settings, id, normId, false);
  }

  /**
   * @deprecated
   */
  _removeInstance(settings, id, normId) {
    this._deleteInstance(settings, id, normId);
  }

  //App loading

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

    const parts = lower.split(".");
    if (parts.length > 1) ids.add(parts[parts.length - 1]);

    return ids;
  }

  _isAppEnabled(normId, vinylIds) {
    for (const stored of vinylIds) {
      const matchSet = this._buildMatchSet(stored);
      if (matchSet.has(normId)) return true;
      if (matchSet.has(normId.split(".").pop())) return true;
    }
    return false;
  }

  /**
   * Enable or disable vinyl for an app, persisting BOTH states.
   */
  _setAppVinylState(settings, appId, normId, enable) {
    const enabledIds = settings.get_strv("vinyl-app-ids");
    const disabledIds = settings.get_strv("vinyl-app-disabled-ids");

    if (enable) {
      if (!this._isAppEnabled(normId, enabledIds)) enabledIds.push(appId);
      const newDisabled = disabledIds.filter(
        (id) =>
          !this._buildMatchSet(id).has(normId) &&
          !this._buildMatchSet(id).has(normId.split(".").pop()),
      );
      settings.set_strv("vinyl-app-ids", enabledIds);
      settings.set_strv("vinyl-app-disabled-ids", newDisabled);
    } else {
      const newEnabled = enabledIds.filter(
        (id) =>
          !this._buildMatchSet(id).has(normId) &&
          !this._buildMatchSet(id).has(normId.split(".").pop()),
      );
      if (!this._isAppEnabled(normId, disabledIds)) disabledIds.push(appId);
      settings.set_strv("vinyl-app-ids", newEnabled);
      settings.set_strv("vinyl-app-disabled-ids", disabledIds);
    }
  }

  //Render search results

  _renderAppList(filteredSystemApps, settings) {
    // Clear list
    let child = this._appListBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._appListBox.remove(child);
      child = next;
    }

    const enabledIds = settings.get_strv("vinyl-app-ids");
    const query = this._currentSearchQuery ?? "";

    //Stored instances
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

      let resolvedName = obj.name || desktopId || id;

      let appIcon = null;
      for (const candidate of [
        `${desktopId}.desktop`,
        desktopId,
        `${id}.desktop`,
        id,
        `${id.split(".").pop()}.desktop`,
      ]) {
        try {
          const info = Gio.DesktopAppInfo.new(candidate);
          if (info) {
            resolvedName = info.get_name() || resolvedName;
            appIcon = info.get_icon();
            break;
          }
        } catch (_) {}
      }

      // customName always wins over the resolved .desktop name
      const customName = obj.customName?.trim() || "";
      const displayName = customName || resolvedName;

      // Filter by query => match against display name, resolved name, and raw id
      if (
        query &&
        !displayName.toLowerCase().includes(query) &&
        !resolvedName.toLowerCase().includes(query) &&
        !normId.includes(query)
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
          label: "Saved Instances",
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

        const row = new Adw.ActionRow({
          // Show custom name if set, otherwise the resolved .desktop name
          title: displayName,
          // Show id + a "renamed from" hint in subtitle when a custom name is active
          subtitle: customName
            ? `${id}  ·  renamed from "${resolvedName}"`
            : id,
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

    // System media/browser apps
    const sysApps = filteredSystemApps.filter((app) => {
      const rawId = app.get_id() || "";
      const normId = this._normalizeAppId(rawId)?.toLowerCase() ?? "";
      return !shownInstanceIds.has(normId);
    });

    if (sysApps.length > 0) {
      if (instanceRows.length > 0) {
        this._appListBox.append(
          new Gtk.Label({
            label: "Other Apps",
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
          label: "No matching apps found",
          css_classes: ["dim-label"],
          margin_top: 16,
          margin_bottom: 16,
        }),
      );
    }
  }

  _normalizeAppId(id) {
    if (!id) return null;
    return id.endsWith(".desktop") ? id.slice(0, -8) : id;
  }

  // About page

  _createAboutPage() {
    const page = new Adw.PreferencesPage({
      title: "About",
      icon_name: "help-about-symbolic",
    });

    const infoGroup = new Adw.PreferencesGroup({
      title: "Advanced Media Controller",
      description:
        "Beautiful and modern media controls with multi-instance support",
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
        label: "Advanced Media Controller",
        halign: Gtk.Align.START,
        css_classes: ["title-2"],
      }),
    );
    infoBox.append(
      new Gtk.Label({
        label: "Version 1.0",
        halign: Gtk.Align.START,
        css_classes: ["caption"],
      }),
    );
    infoBox.append(
      new Gtk.Label({
        label: "Modern media controls with native GNOME design",
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
      title: "Extension Links",
      description: "Source code, issues, and contributions",
    });

    const githubRow = new Adw.ActionRow({
      title: "View on GitHub",
      subtitle: "Source code, issues, and contributions",
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
      title: "☕ Support by buying me a coffee – just scan the QR code!",
      description: "Preferred Method - Scan QR code to support development",
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
      title: "Donation Address",
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
        "Donation address",
      ),
    );

    const sponsorRow = new Adw.ActionRow({
      title: "☕ Buy Me a Coffee",
      subtitle: "Support development with a small donation",
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
      title: "License & Credits",
      description: "Open source software information",
    });
    const licenseRow = new Adw.ActionRow({
      title: "Open Source License",
      subtitle: "GPL-3.0 License - Free and open source software",
      activatable: false,
    });
    licenseRow.add_prefix(
      new Gtk.Image({ icon_name: "security-high-symbolic", pixel_size: 16 }),
    );
    const creditsRow = new Adw.ActionRow({
      title: "Media Data Sources",
      subtitle:
        "MPRIS D-Bus interface - Standard media player remote interfacing",
      activatable: false,
    });
    creditsRow.add_prefix(
      new Gtk.Image({ icon_name: "network-server-symbolic", pixel_size: 16 }),
    );
    const featuresRow = new Adw.ActionRow({
      title: "Key Features",
      subtitle:
        "• Multi-instance browser support\n• Per-app rotating vinyl record album art\n" +
        "• Animated tonearm\n• Smooth animations\n• Double-click to toggle vinyl per app\n" +
        "• All seen apps remembered — re-enable any time",
      activatable: false,
    });
    featuresRow.add_prefix(
      new Gtk.Image({ icon_name: "starred-symbolic", pixel_size: 16 }),
    );

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

    if (Gio.File.new_for_path(svgPath).query_exists(null)) {
      return new Gtk.Image({
        file: svgPath,
        pixel_size: 20,
      });
    }

    // Fallback to a generic link icon if the SVG is not found
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
      heading: "Copy to Clipboard",
      body: "Unable to copy automatically. Select the address below and press Ctrl+C:",
    });
    dialog.add_response("close", "Close");
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
