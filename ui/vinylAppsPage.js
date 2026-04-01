import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { parseBrowserSourceId, labelForId } from "../lib/utils.js";

/**
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} settings
 * @param {object} helpers
 * @param {function} helpers.findAppInfo
 * @param {function} helpers.normalizeAppId
 * @param {function} helpers.buildMatchSet
 * @param {function} helpers.isAppEnabled
 * @param {function} helpers.setAppVinylState
 * @param {function} helpers.updateInstanceEnabledField
 * @param {function} helpers.deleteInstance
 * @param {function} helpers.loadMediaAndBrowserApps
 * @param {function} helpers.renderAppList       - bound render function
 * @param {function} helpers.refreshInstancesList
 * @param {function} helpers.showRenameDialog
 */
export function buildVinylAppsPage(page, settings, helpers) {
  const _connIds = [];
  const _settingsConnect = (signal, fn) => {
    _connIds.push(settings.connect(signal, fn));
  };

  page.connect("destroy", () => {
    for (const id of _connIds) {
      try {
        settings.disconnect(id);
      } catch (_) {}
    }
    _connIds.length = 0;
  });

  const {
    findAppInfo,
    normalizeAppId,
    isAppEnabled,
    setAppVinylState,
    updateInstanceEnabledField,
    deleteInstance,
    loadMediaAndBrowserApps,
    renderAppList,
    refreshInstancesList,
    showRenameDialog,
  } = helpers;

  // How-to steps
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

  //  Saved App Instances
  const instancesGroup = new Adw.PreferencesGroup({
    title: _("Saved App Instances"),
    description: _(
      "Instances stored by double-clicking the album art in the popup. " +
        "Icons are loaded from the system .desktop database. " +
        "Toggle the vinyl effect on/off or remove any entry.",
    ),
  });
  page.add(instancesGroup);

  // Store on helpers so refreshInstancesList can access them
  helpers.instancesGroup = instancesGroup;
  helpers.instanceRows = new Map();

  refreshInstancesList(settings);

  // Add an App Manually
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

  const appListBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    css_classes: ["boxed-list"],
    margin_top: 4,
  });
  scrolled.set_child(appListBox);

  const scrollRow = new Adw.ActionRow({ activatable: false });
  scrollRow.set_child(scrolled);
  searchGroup.add(scrollRow);

  // Expose appListBox on helpers so renderAppList can reference it
  helpers.appListBox = appListBox;

  const allApps = loadMediaAndBrowserApps();
  helpers.allApps = allApps;
  helpers.currentSearchQuery = "";
  renderAppList(allApps, settings);

  const doFilter = () => {
    const query = searchEntry.text.toLowerCase().trim();
    helpers.currentSearchQuery = query;
    const filtered =
      query.length === 0
        ? allApps
        : allApps.filter(
            (app) =>
              app.get_name().toLowerCase().includes(query) ||
              (app.get_id() || "").toLowerCase().includes(query),
          );
    renderAppList(filtered, settings);
  };

  searchEntry.connect("search-changed", doFilter);

  _settingsConnect("changed::vinyl-app-ids", () => {
    refreshInstancesList(settings);
    renderAppList(allApps, settings);
  });
  _settingsConnect("changed::vinyl-app-instances", () => {
    refreshInstancesList(settings);
    renderAppList(allApps, settings);
  });
  _settingsConnect("changed::vinyl-app-disabled-ids", () => {
    refreshInstancesList(settings);
    renderAppList(allApps, settings);
  });

  //  Live Player Detector
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

  let vinylLiveRows = [];

  const clearVinylLiveRows = () => {
    for (const r of vinylLiveRows) {
      try {
        livePlayerGroup.remove(r);
      } catch (_e) {}
    }
    vinylLiveRows = [];
  };

  const scanVinylPlayers = () => {
    clearVinylLiveRows();

    Gio.DBus.session.call(
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
            vinylLiveRows.push(noneRow);
            return;
          }

          const seenShort = new Set();
          for (const fullBus of mprisNames) {
            let short = fullBus.replace("org.mpris.MediaPlayer2.", "");
            short = short
              .replace(/\.instance[_\d]+$/i, "")
              .replace(/\.\d+$/, "");

            if (seenShort.has(short)) continue;
            seenShort.add(short);

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
                  lower.replace(/\.instance[_\d]+$/i, "") ===
                    short.toLowerCase()
                );
              } catch (_) {
                return false;
              }
            });

            if (alreadySaved) continue;

            const appInfo = findAppInfo(short, short);
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
                desktopId: appInfo
                  ? normalizeAppId(appInfo.get_id() ?? short)
                  : short,
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
              setAppVinylState(settings, short, short.toLowerCase(), true);
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                scanVinylPlayers();
                return GLib.SOURCE_REMOVE;
              });
            });

            row.add_suffix(useBtn);
            livePlayerGroup.add(row);
            vinylLiveRows.push(row);
          }

          if (vinylLiveRows.length === 0) {
            const allSavedRow = new Adw.ActionRow({
              title: _("All running players are already saved"),
              subtitle: _(
                "Manage them in the Saved App Instances section above",
              ),
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
            vinylLiveRows.push(allSavedRow);
          }
        } catch (e) {
          console.error("AMC prefs: error scanning vinyl players:", e);
        }
      },
    );
  };

  liveRefreshBtn.connect("clicked", scanVinylPlayers);

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    scanVinylPlayers();
    return GLib.SOURCE_REMOVE;
  });

  _settingsConnect("changed::vinyl-app-instances", () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      scanVinylPlayers();
      return GLib.SOURCE_REMOVE;
    });
  });
}
