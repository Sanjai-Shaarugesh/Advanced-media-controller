import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * @param {string} extensionDirPath
 * @returns {Adw.PreferencesPage}
 */
export function createAboutPage(extensionDirPath) {
  const page = new Adw.PreferencesPage({
    title: _("About"),
    icon_name: "help-about-symbolic",
  });

  const _signalIds = [];
  const _trackConnect = (obj, signal, fn) => {
    _signalIds.push({ obj, id: obj.connect(signal, fn) });
  };

  //  Header
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

  const logoPath = `${extensionDirPath}/icons/media-logo.png`;
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

  //  Extension Links
  const linksGroup = new Adw.PreferencesGroup({
    title: _("Extension Links"),
    description: _("Source code, issues, and contributions"),
  });

  const githubRow = new Adw.ActionRow({
    title: _("View on GitHub"),
    subtitle: _("Source code, issues, and contributions"),
    activatable: true,
  });
  githubRow.add_prefix(_createGitHubIcon(extensionDirPath));
  githubRow.add_suffix(
    new Gtk.Image({
      icon_name: "adw-external-link-symbolic",
      pixel_size: 16,
    }),
  );
  _trackConnect(githubRow, "activated", () => {
    try {
      Gio.AppInfo.launch_default_for_uri(
        "https://github.com/Sanjai-Shaarugesh/Advance-media-controller",
        null,
      );
    } catch (e) {
      console.error("Could not open GitHub link:", e);
    }
  });

  //  Donation options
  const DONATION_OPTIONS = [
    {
      label: _("\u2615 Buy Me a Coffee"),
      subtitle: _("Support development with a small donation"),
      url: "https://buymeacoffee.com/sanjai",
      qrFile: "qr.png",
      createIcon: (size = 20) =>
        new Gtk.Image({
          icon_name: "emblem-favorite-symbolic",
          pixel_size: size,
        }),
      qrTitle: _(
        "\u2615 Support by buying me a coffee \u2013 just scan the QR code!",
      ),
      qrDesc: _("Scan QR code to open Buy Me a Coffee"),
    },
    {
      label: _("\u2764 GitHub Sponsors"),
      subtitle: _("Sponsor via GitHub — one-time or monthly"),
      url: "https://github.com/sponsors/Sanjai-Shaarugesh",
      qrFile: "qr-github.png",
      createIcon: (size = 20) => _createGitHubIcon(extensionDirPath, size),
      qrTitle: _(
        "\u2764 Support via GitHub Sponsors \u2013 just scan the QR code!",
      ),
      qrDesc: _("Scan QR code to open GitHub Sponsors"),
    },
  ];

  const qrGroup = new Adw.PreferencesGroup({
    title: DONATION_OPTIONS[0].qrTitle,
    description: DONATION_OPTIONS[0].qrDesc,
  });

  const qrPlatformModel = new Gtk.StringList();
  DONATION_OPTIONS.forEach((opt) => qrPlatformModel.append(opt.label));

  let qrSelectorIcon = DONATION_OPTIONS[0].createIcon(20);

  const qrPlatformRow = new Adw.ComboRow({
    title: _("Donation Platform"),
    subtitle: _("Switch to see the QR code for each platform"),
    model: qrPlatformModel,
    selected: 0,
  });
  qrPlatformRow.add_prefix(qrSelectorIcon);
  qrGroup.add(qrPlatformRow);

  const qrContainer = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 16,
    halign: Gtk.Align.CENTER,
    margin_top: 24,
    margin_bottom: 24,
    margin_start: 24,
    margin_end: 24,
  });

  const loadQr = (filename) => {
    const path = `${extensionDirPath}/icons/${filename}`;
    try {
      const img = Gtk.Image.new_from_file(path);
      img.set_pixel_size(200);
      return img;
    } catch (_e) {
      return new Gtk.Image({
        icon_name: "camera-web-symbolic",
        pixel_size: 200,
      });
    }
  };

  let qrImage = loadQr(DONATION_OPTIONS[0].qrFile);
  qrContainer.append(qrImage);

  const qrRow = new Adw.ActionRow({ title: "", activatable: false });
  qrRow.set_child(qrContainer);

  //  Address group
  const addressGroup = new Adw.PreferencesGroup({
    title: _("Donation Address"),
  });

  const addressRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[0].url,
    activatable: true,
  });
  addressRow.add_prefix(
    new Gtk.Image({ icon_name: "emote-love-symbolic", pixel_size: 16 }),
  );
  addressRow.add_suffix(
    new Gtk.Image({ icon_name: "edit-copy-symbolic", pixel_size: 16 }),
  );
  _trackConnect(addressRow, "activated", () =>
    _copyToClipboard(addressRow.title, _("Donation address")),
  );

  let activeDonation = 0;

  const switchDonation = (idx) => {
    if (idx === activeDonation) return;
    activeDonation = idx;
    const opt = DONATION_OPTIONS[idx];

    qrContainer.remove(qrImage);
    qrImage = loadQr(opt.qrFile);
    qrContainer.append(qrImage);

    qrPlatformRow.remove(qrSelectorIcon);
    qrSelectorIcon = opt.createIcon(20);
    qrPlatformRow.add_prefix(qrSelectorIcon);

    qrGroup.title = opt.qrTitle;
    qrGroup.description = opt.qrDesc;

    addressRow.title = opt.url;

    if (qrPlatformRow.selected !== idx) qrPlatformRow.selected = idx;
  };

  _trackConnect(qrPlatformRow, "notify::selected", () => {
    switchDonation(qrPlatformRow.selected);
  });

  const donationSelectorGroup = new Adw.PreferencesGroup({
    title: _("Support Development"),
    description: _("Choose your preferred donation platform"),
  });

  const sponsorRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[0].label,
    subtitle: DONATION_OPTIONS[0].subtitle,
    activatable: true,
  });
  sponsorRow.add_prefix(DONATION_OPTIONS[0].createIcon(20));
  sponsorRow.add_suffix(
    new Gtk.Image({
      icon_name: "adw-external-link-symbolic",
      pixel_size: 16,
    }),
  );
  _trackConnect(sponsorRow, "activated", () => {
    switchDonation(0);
    try {
      Gio.AppInfo.launch_default_for_uri(DONATION_OPTIONS[0].url, null);
    } catch (e) {
      console.error("Could not open Buy Me a Coffee link:", e);
    }
  });

  const githubSponsorRow = new Adw.ActionRow({
    title: DONATION_OPTIONS[1].label,
    subtitle: DONATION_OPTIONS[1].subtitle,
    activatable: true,
  });
  githubSponsorRow.add_prefix(DONATION_OPTIONS[1].createIcon(20));
  githubSponsorRow.add_suffix(
    new Gtk.Image({
      icon_name: "adw-external-link-symbolic",
      pixel_size: 16,
    }),
  );
  _trackConnect(githubSponsorRow, "activated", () => {
    switchDonation(1);
    try {
      Gio.AppInfo.launch_default_for_uri(DONATION_OPTIONS[1].url, null);
    } catch (e) {
      console.error("Could not open GitHub Sponsors link:", e);
    }
  });

  //  License & Credits
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
  donationSelectorGroup.add(sponsorRow);
  donationSelectorGroup.add(githubSponsorRow);
  qrGroup.add(qrRow);
  addressGroup.add(addressRow);
  licenseGroup.add(licenseRow);
  licenseGroup.add(creditsRow);
  licenseGroup.add(featuresRow);

  page.add(infoGroup);
  page.add(linksGroup);
  page.add(donationSelectorGroup);
  page.add(qrGroup);
  page.add(addressGroup);
  page.add(licenseGroup);

  page.connect("destroy", () => {
    for (const { obj, id } of _signalIds) {
      try {
        obj.disconnect(id);
      } catch (_) {}
    }
    _signalIds.length = 0;
  });

  return page;
}

/**
 * @param {string} extensionDirPath
 * @param {number} [pixel_size]
 * @returns {Gtk.Image}
 */
function _createGitHubIcon(extensionDirPath, pixel_size = 20) {
  const svgPath = `${extensionDirPath}/icons/github.svg`;
  if (Gio.File.new_for_path(svgPath).query_exists(null)) {
    return new Gtk.Image({ file: svgPath, pixel_size });
  }
  return new Gtk.Image({
    icon_name: "adw-external-link-symbolic",
    pixel_size,
  });
}

/**
 * @param {string} text
 * @param {string} _label
 */
function _copyToClipboard(text, _label) {
  const display = Gdk.Display.get_default();
  if (display) {
    const clipboard = display.get_clipboard();
    if (clipboard) {
      clipboard.set(text);
      return;
    }
  }
  _showCopyDialog(text);
}

/**
 * @param {string} text
 */
function _showCopyDialog(text) {
  if (typeof Adw.AlertDialog !== "undefined") {
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
  } else {
    const dialog = new Gtk.MessageDialog({
      modal: true,
      message_type: Gtk.MessageType.INFO,
      buttons: Gtk.ButtonsType.CLOSE,
      text: _("Copy to Clipboard"),
      secondary_text: _(
        "Unable to copy automatically. Select the address below and press Ctrl+C:",
      ),
    });
    const entry = new Gtk.Entry({
      text,
      editable: false,
      can_focus: true,
      width_chars: 40,
      margin_start: 12,
      margin_end: 12,
      margin_bottom: 12,
    });
    dialog.get_message_area().append(entry);
    dialog.connect("response", () => dialog.destroy());
    dialog.present();
  }
}
