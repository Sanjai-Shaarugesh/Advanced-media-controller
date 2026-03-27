import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * @param {Adw.PreferencesPage} page
 * @param {Gio.Settings} settings
 * @param {function(string, string): Gio.AppInfo|null} findAppInfo
 */
export function buildPlayerFilterPage(page, settings, findAppInfo) {
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

  const serializeList = (entries) => {
    const str = entries
      .map((e) => (e.enabled ? e.name : `~${e.name}`))
      .join(", ");
    settings.set_string("player-filter-list", str);
  };

  // Helper to get short MPRIS name from a full bus name
  const toShort = (busName) =>
    busName
      .replace("org.mpris.MediaPlayer2.", "")
      .replace(/\.instance[_\d]+$/i, "")
      .replace(/\.\d+$/, "");

  //  Filter Mode
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
  [_("Off"), _("Blacklist"), _("Whitelist")].forEach((l) =>
    filterModel.append(l),
  );

  const filterModeDescriptions = [
    _("Show all media players — filtering is disabled"),
    _("Hide only the players you add to the list below"),
    _("Show only the players you add to the list below"),
  ];

  const filterModeRow = new Adw.ComboRow({
    title: _("Filter Mode"),
    subtitle: filterModeDescriptions[settings.get_int("player-filter-mode")],
    model: filterModel,
    selected: settings.get_int("player-filter-mode"),
  });
  filterModeRow.connect("notify::selected", () => {
    const idx = filterModeRow.selected;
    settings.set_int("player-filter-mode", idx);
    filterModeRow.subtitle = filterModeDescriptions[idx];
  });
  settings.connect("changed::player-filter-mode", () => {
    const v = settings.get_int("player-filter-mode");
    if (filterModeRow.selected !== v) {
      filterModeRow.selected = v;
      filterModeRow.subtitle = filterModeDescriptions[v];
    }
  });
  modeGroup.add(filterModeRow);

  // Saved Players
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

  let savedFilterRows = [];

  const rebuildSavedList = () => {
    for (const r of savedFilterRows) {
      try {
        savedGroup.remove(r);
      } catch (_e) {}
    }
    savedFilterRows = [];

    const entries = parseList();

    if (entries.length === 0) {
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
      savedFilterRows.push(ph);
      return;
    }

    for (const entry of entries) {
      const { name, enabled } = entry;

      const appInfo = findAppInfo(name, name);
      const appIcon = appInfo ? appInfo.get_icon() : null;

      const row = new Adw.ActionRow({
        title: appInfo
          ? appInfo.get_display_name() || appInfo.get_name() || name
          : name,
        subtitle: name,
        activatable: false,
      });

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

      const toggle = new Gtk.Switch({
        active: enabled,
        valign: Gtk.Align.CENTER,
        tooltip_text: enabled
          ? _(
              "Filter rule active for \u201c%s\u201d \u2014 click to disable",
            ).format(name)
          : _(
              "Filter rule disabled for \u201c%s\u201d \u2014 click to enable",
            ).format(name),
      });

      toggle.connect("state-set", (_sw, state) => {
        const current = parseList();
        const idx = current.findIndex((e) => e.name === name);
        if (idx !== -1) {
          current[idx].enabled = state;
          serializeList(current);
        }
        return false;
      });

      row.add_suffix(toggle);

      const removeBtn = new Gtk.Button({
        icon_name: "user-trash-symbolic",
        valign: Gtk.Align.CENTER,
        css_classes: ["flat", "destructive-action"],
        tooltip_text: _("Remove \u201c%s\u201d from the filter list").format(
          name,
        ),
      });

      removeBtn.connect("clicked", () => {
        const current = parseList();
        const updated = current.filter((e) => e.name !== name);
        serializeList(updated);
      });

      row.add_suffix(removeBtn);

      savedGroup.add(row);
      savedFilterRows.push(row);
    }
  };

  settings.connect("changed::player-filter-list", () => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      rebuildSavedList();
      return GLib.SOURCE_REMOVE;
    });
  });

  rebuildSavedList();

  // Detected Players
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

  const liveGroup = new Adw.PreferencesGroup();
  page.add(liveGroup);

  let filterLiveRows = [];

  const clearLiveRows = () => {
    for (const r of filterLiveRows) {
      try {
        liveGroup.remove(r);
      } catch (_e) {}
    }
    filterLiveRows = [];
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
      filterLiveRows.push(errRow);
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
            filterLiveRows.push(noneRow);
            return;
          }

          const seen = new Set();

          for (const fullBus of mprisNames) {
            const short = toShort(fullBus);
            if (seen.has(short)) continue;
            seen.add(short);

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

            const isAlreadySaved = () =>
              parseList().some((e) => e.name === short);

            const addBtn = new Gtk.Button({
              label: isAlreadySaved() ? _("Saved \u2713") : _("Add to Filter"),
              valign: Gtk.Align.CENTER,
              css_classes: isAlreadySaved() ? ["flat"] : ["suggested-action"],
              tooltip_text: isAlreadySaved()
                ? _("\u201c%s\u201d is already in the filter list").format(
                    short,
                  )
                : _(
                    "Add \u201c%s\u201d to the filter list (enabled by default)",
                  ).format(short),
            });

            addBtn.connect("clicked", () => {
              if (isAlreadySaved()) return;

              const current = parseList();
              current.push({ name: short, enabled: true });
              serializeList(current);

              addBtn.label = _("Saved \u2713");
              addBtn.css_classes = ["flat"];
              addBtn.tooltip_text = _(
                "\u201c%s\u201d is already in the filter list",
              ).format(short);
            });

            settings.connect("changed::player-filter-list", () => {
              const saved = isAlreadySaved();
              addBtn.label = saved ? _("Saved \u2713") : _("Add to Filter");
              addBtn.css_classes = saved ? ["flat"] : ["suggested-action"];
            });

            row.add_suffix(addBtn);
            liveGroup.add(row);
            filterLiveRows.push(row);
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
