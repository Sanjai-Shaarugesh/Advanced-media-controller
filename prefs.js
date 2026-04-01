import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { parseBrowserSourceId, labelForId } from "./lib/utils.js";
import { buildGeneralPage } from "./ui/generalPage.js";
import { buildPopupPage } from "./ui/popupPage.js";
import { buildPlayerFilterPage } from "./ui/playerFilterPage.js";
import { buildLyricsPage } from "./ui/lyricsPage.js";
import { buildVinylAppsPage } from "./ui/vinylAppsPage.js";
import { createAboutPage } from "./ui/aboutPage.js";

export default class MediaControlsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    window.set_title(_("Advanced Media Controller"));
    window.set_default_size(700, 760);
    window.set_resizable(true);

    // General page
    window.add(buildGeneralPage(settings));

    //  Popup Player page
    window.add(buildPopupPage(settings));

    //  Vinyl Apps page
    const vinylPage = new Adw.PreferencesPage({
      title: _("Vinyl Apps"),
      icon_name: "media-optical-cd-audio-symbolic",
    });
    window.add(vinylPage);

    const vinylHelpers = {
      findAppInfo: (desktopId, fallbackId) =>
        this._findAppInfo(desktopId, fallbackId),
      normalizeAppId: (id) => this._normalizeAppId(id),
      buildMatchSet: (appId) => this._buildMatchSet(appId),
      isAppEnabled: (normId, vinylIds) => this._isAppEnabled(normId, vinylIds),
      setAppVinylState: (s, appId, normId, enable) =>
        this._setAppVinylState(s, appId, normId, enable),
      updateInstanceEnabledField: (s, normId, value) =>
        this._updateInstanceEnabledField(s, normId, value),
      deleteInstance: (s, id, normId) => this._deleteInstance(s, id, normId),
      loadMediaAndBrowserApps: () => this._loadMediaAndBrowserApps(),
      renderAppList: (filteredApps, s) => this._renderAppList(filteredApps, s),
      refreshInstancesList: (s) => this._refreshInstancesList(s),
      showRenameDialog: (s, id, normId, currentDisplay, resolvedName) =>
        this._showRenameDialog(s, id, normId, currentDisplay, resolvedName),

      instancesGroup: null,
      instanceRows: null,
      appListBox: null,
      allApps: null,
      currentSearchQuery: "",
    };

    this._vinylHelpers = vinylHelpers;

    buildVinylAppsPage(vinylPage, settings, vinylHelpers);

    //  Player Filter page
    const filterPage = new Adw.PreferencesPage({
      title: _("Player Filter"),
      icon_name: "view-list-symbolic",
    });
    window.add(filterPage);
    buildPlayerFilterPage(filterPage, settings, (desktopId, fallbackId) =>
      this._findAppInfo(desktopId, fallbackId),
    );

    //  Lyrics page
    const lyricsPage = new Adw.PreferencesPage({
      title: _("Lyrics"),
      icon_name: "audio-x-generic-symbolic",
    });
    window.add(lyricsPage);
    buildLyricsPage(lyricsPage, settings);

    // About page
    window.add(createAboutPage(this.dir.get_path()));
  }

  //  Vinyl App Helpers

  _refreshInstancesList(settings) {
    const { instancesGroup, instanceRows } = this._vinylHelpers;

    for (const row of instanceRows.values()) {
      try {
        instancesGroup.remove(row);
      } catch (_e) {}
    }
    instanceRows.clear();

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
      instanceRows.set("__placeholder__", ph);
      instancesGroup.add(ph);
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

      const parsedComposite = parseBrowserSourceId(normId);
      const isBrowserInstance = parsedComposite !== null;

      let appName = obj.name || obj.desktopId || id;
      let appIcon = null;

      if (isBrowserInstance) {
        appName = labelForId(normId);
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

      instancesGroup.add(row);
      instanceRows.set(id, row);
    }
  }

  _showRenameDialog(settings, id, normId, currentDisplay, resolvedName) {
    const isComposite = normId.includes("--");
    const displayedSource = isComposite ? labelForId(normId) : resolvedName;

    const dialog = new Adw.AlertDialog({
      heading: _("Rename Instance"),
      body: _(
        'Enter a custom display name for "%s".\nLeave blank to reset to the default.',
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

    let parent = this._vinylHelpers.instancesGroup?.get_root?.();
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
          const parsed1 = parseBrowserSourceId(normId);
          const parsed2 = parseBrowserSourceId(storedLower);
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
        const p1 = parseBrowserSourceId(normId);
        const p2 = parseBrowserSourceId(idLower);
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

  //  Render search results

  _renderAppList(filteredSystemApps, settings) {
    const { appListBox, currentSearchQuery } = this._vinylHelpers;
    const query = currentSearchQuery ?? "";

    let child = appListBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      appListBox.remove(child);
      child = next;
    }

    const enabledIds = settings.get_strv("vinyl-app-ids");

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

      const parsedComp = parseBrowserSourceId(normId);
      const isCompBrowser = parsedComp !== null;

      let resolvedName = obj.name || desktopId || id;
      let appIcon = null;

      if (isCompBrowser) {
        resolvedName = labelForId(normId);
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
      appListBox.append(
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

        const pbc = parseBrowserSourceId(normId);
        const subtitleBase = pbc
          ? _("Browser: %s · Source: %s").format(
              pbc.browser,
              pbc.source.replace(/-/g, " "),
            )
          : id;
        const row = new Adw.ActionRow({
          title: displayName,
          subtitle: customName
            ? `${subtitleBase}  ·  ${_("renamed from")} "${resolvedName}"`
            : subtitleBase,
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
        appListBox.append(row);
      }
    }

    const sysApps = filteredSystemApps.filter((app) => {
      const rawId = app.get_id() || "";
      const normId = this._normalizeAppId(rawId)?.toLowerCase() ?? "";
      return !shownInstanceIds.has(normId);
    });

    if (sysApps.length > 0) {
      if (instanceRows.length > 0) {
        appListBox.append(
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
        appListBox.append(row);
      });
    }

    if (instanceRows.length === 0 && sysApps.length === 0) {
      appListBox.append(
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
}
