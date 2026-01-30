<div align="center">

<img src="icons/media-logo.png" alt="Advanced Media Controller Icon" width="128">

# Advanced Media Controller

### GNOME Shell Extension

*A beautiful, modern media controller for GNOME Shell with MPRIS-compatible player integration*

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Made with GJS](https://img.shields.io/badge/Made%20with-GJS-orange.svg)](https://gjs.guide/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Screenshots](#-screenshots) • [Contributing](#-contributing)

</div>

---

## ✨ Features

### 🎨 Modern & Beautiful UI

- **Sleek album art display** — View your album covers in stunning detail
- **Smooth animations** — Buttery smooth transitions and interactions
- **Native GNOME design** — Perfectly integrated with your desktop theme
- **Dark mode friendly** — Looks gorgeous in both light and dark themes

<div align="center">
<img src="icons/img1.png" alt="Media Controller UI" width="600">
<br>
<em>Beautiful media controls integrated seamlessly into GNOME Shell</em>
</div>

### 🎛️ Rich Media Controls

- ▶️ **Play/Pause** — Quick playback control
- ⏭️ **Next/Previous** — Skip through your tracks
- 🔀 **Shuffle** — Randomize your playlist
- 🔁 **Repeat** — Loop your favorite songs (None/Track/Playlist)
- 📊 **Progress slider** — Seek to any position in your track
- 🎵 **Track information** — Display artist, title, and album

<div align="center">
<img src="icons/img5.png" alt="Panel Controls" width="600">
<br>
<em>Quick controls right in your top panel</em>
</div>

### 🌐 Multi-Instance Browser Support

Works flawlessly with **multiple browser tabs** playing media simultaneously!

- 🦊 **Firefox** — Multiple tabs with different videos
- 🌐 **Chrome/Chromium** — Each tab appears as a separate player
- 🦁 **Brave** — Full multi-instance support
- 🔵 **Edge** — Seamlessly manages multiple media sources

<div align="center">
<img src="icons/img2.png" alt="Multi-Instance Support 1" width="600">
<br>
<img src="icons/img3.png" alt="Multi-Instance Support 2" width="600">
<br>
<em>Switch between multiple media sources effortlessly</em>
</div>

### ⚙️ Highly Customizable

#### Panel Position & Layout

- Choose between **Left**, **Center**, or **Right** panel position
- Customize panel index (position within the area)
- Show/hide individual components

#### Label Customization

- 📝 **Custom label format** — Arrange artist, title, album, track number
- 📏 **Adjustable length** — Fixed or dynamic title length
- 🌊 **Smooth scrolling** — For long track names
- ⚡ **Adjustable scroll speed** — Control animation speed
- ⏸️ **Scroll pause time** — Configure pause between scrolls

<div align="center">
<img src="icons/img4.png" alt="Settings Panel" width="600">
<br>
<em>Customize exactly how it appears in your panel</em>
</div>

### 🎮 Available Actions

- Play/Pause/Stop
- Next/Previous track
- Volume up/down
- Toggle shuffle/repeat
- Show popup menu
- Raise/Quit player
- Open preferences

---

## 📦 Installation

### Method 1: GNOME Extensions Website (Recommended)

1. Visit [GNOME Extensions](https://extensions.gnome.org/) (coming soon)
2. Search for "Advanced Media Controller"
3. Click the toggle switch to install
4. Enjoy!

### Method 2: Manual Installation

```bash
# Clone the repository
git clone https://github.com/Sanjai-Shaarugesh/Advance-media-controller.git
cd Advanced-media-controller

# Copy to extensions directory
cp -r . ~/.local/share/gnome-shell/extensions/Advanced-media-controller/

# Restart GNOME Shell
# X11: Alt+F2, type 'r', press Enter
# Wayland: Log out and log back in

# Enable the extension
gnome-extensions enable Advanced-media-controller.com
```

### Method 3: From Release Package

```bash
# Download the latest release
wget https://github.com/Sanjai-Shaarugesh/advanced-media-controller/releases/latest/download/Advanced-media-controller.github.com.zip

# Install
gnome-extensions install Advanced-media-controller.github.com.zip

# Enable
gnome-extensions enable Advanced-media-controller.github.com
```

---

## 🎮 Usage

### Quick Start

1. Install the extension
2. Open any media player (Rhythmbox, VLC, Firefox with YouTube, etc.)
3. The media controller appears automatically in your panel
4. Click to see full controls!

### Basic Controls

- **Click the play button** in the panel for quick play/pause
- **Click the extension** to open the full control popup
- **Use the slider** to seek through your track
- **Click player icons** to switch between multiple media sources

---

## 🎨 Screenshots

<div align="center">

### Main Interface
<img src="icons/img1.png" alt="Main Interface" width="600">
<br>
<em>Clean, modern interface with album art</em>

### Panel Integration
<img src="icons/img5.png" alt="Panel Integration" width="600">
<br>
<em>Perfectly integrated into GNOME's top panel</em>

### Multiple Players
<img src="icons/img2.png" alt="Multiple Players 1" width="600">
<br>
<img src="icons/img3.png" alt="Multiple Players 2" width="600">
<br>
<em>Easy switching between multiple media sources</em>

### Settings Panel
<img src="icons/img4.png" alt="Settings" width="600">
<br>
<em>Extensive customization options</em>

</div>

---

## 🔧 Supported Players

This extension works with **any MPRIS-compatible media player**, including:

- 🎵 Rhythmbox
- 🎬 VLC
- 🎧 Spotify
- 🌐 Web browsers (Firefox, Chrome, Brave, Edge)
- 🎼 Lollypop
- 📻 Gapless
- And many more!

---

## 🐛 Troubleshooting

### Extension doesn't appear

1. Make sure the extension is enabled: `gnome-extensions list`
2. Check if you have media playing
3. Restart GNOME Shell (Alt+F2, type 'r', Enter on X11)
4. Check system logs: `journalctl -f -o cat /usr/bin/gnome-shell`

### Controls not responding

- Ensure your media player supports MPRIS (most modern players do)
- Try restarting the media player
- Check extension settings for conflicts

---

## 🤝 Contributing

We love contributions! Whether it's:

- 🐛 Bug reports
- 💡 Feature requests
- 📝 Documentation improvements
- 🎨 UI/UX enhancements
- 🌍 Translations
- 💻 Code contributions

Please read our [CONTRIBUTING.md](CONTRIBUTING.md) guide to get started!

---

## 📜 License

This project is licensed under the **GPL-3.0 License** — see the [LICENSE](LICENSE) file for details.

---

## 💖 Support

If you find this extension useful, consider:

- ⭐ **Starring** the repository
- 🐛 **Reporting** bugs
- 💡 **Suggesting** features
- 🌍 **Translating** to your language
- ☕ **Buying me a coffee**

<div align="center">

### ☕ Support Development

<a href="https://buymeacoffee.com/sanjai">
<img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" height="41" width="174">
</a>

<br><br>

<a href="https://buymeacoffee.com/sanjai">
<img src="icons/qr.png" alt="Buy Me A Coffee QR Code" height="300" style="border-radius: 12px;">
</a>

<br>

*Your support helps maintain and improve this extension!* 💙

</div>

---

## 🏆 Credits

### Data Sources

- **MPRIS D-Bus Interface** — Standard media player remote interfacing specification
- **GNOME Shell** — For the amazing desktop environment

### Built With

- JavaScript (GJS)
- GNOME Shell API
- D-Bus
- GTK4/Libadwaita (preferences)
- Love and coffee ☕

<div align="center">

<a href="https://extensions.gnome.org/extension/9184/advanced-media-controller/">
<img src="https://github.com/Sanjai-Shaarugesh/Advanced-Weather-Companion/raw/main/images/gnome.png" alt="Get it on GNOME Extensions" height="100">
</a>

</div>

### Special Thanks

- The GNOME community
- All contributors and testers
- Everyone who reported bugs and suggested features

---

## 📮 Contact

- **Issues**: [GitHub Issues](https://github.com/Sanjai-Shaarugesh/Advance-media-controller/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Sanjai-Shaarugesh/Advance-media-controller/discussions)
- **Email**: your.email@example.com

---

## 🗺️ Roadmap

### Planned Features

- [ ] 🌍 More translations
- [ ] 🎛️ Advanced EQ controls
- [ ] 🔊 Per-player volume control
- [ ] 📊 Playback statistics
- [ ] 🎨 Custom themes
- [ ] ⌨️ Keyboard shortcuts

---

<div align="center">

## ⭐ Star History

**Star ⭐ this repository if you find it useful!**

---

Made with ❤️ by [Sanjai Shaarugesh](https://github.com/Sanjai-Shaarugesh)

</div>
