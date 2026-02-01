import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";

export const AlbumArt = GObject.registerClass(
  class AlbumArt extends St.BoxLayout {
    _init() {
      super._init({
        x_align: Clutter.ActorAlign.CENTER,
        style: "margin-bottom: 24px;",
      });

      this._coverCache = new Map();
      this._currentArtUrl = null;
      this._buildUI();
    }

    _buildUI() {
      this._coverArt = new St.Bin({
        style_class: "media-album-art",
        style: `
          width: 340px;
          height: 340px;
          border-radius: 16px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
        `,
      });

      this._coverImage = new St.Widget({
        style_class: "cover-art-image",
        width: 340,
        height: 340,
        style: `
          border-radius: 16px;
          background-size: contain;
          background-position: center;
          background-repeat: no-repeat;
        `,
      });

      this._coverArt.set_child(this._coverImage);
      this.add_child(this._coverArt);
    }

    loadCover(url, forceRefresh = false) {
      if (!forceRefresh && this._currentArtUrl === url) {
        return;
      }

      this._currentArtUrl = url;

      if (!forceRefresh) {
        const cached = this._coverCache.get(url);
        if (cached) {
          this._coverImage.style = cached;
          return;
        }
      }

      let imageUrl = url;

      if (url.startsWith("file://")) {
        imageUrl = url;
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        this._downloadCover(url);
        return;
      } else {
        imageUrl = `file://${url}`;
      }

      const coverStyle = `
        width: 340px;
        height: 340px;
        border-radius: 16px;
        background-image: url('${imageUrl}');
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
      `;

      this._coverImage.style = coverStyle;
      this._coverCache.set(url, coverStyle);
    }

    _downloadCover(url) {
      const hash = GLib.compute_checksum_for_string(
        GLib.ChecksumType.MD5,
        url,
        -1,
      );
      const cacheDir = GLib.build_filenamev([
        GLib.get_user_cache_dir(),
        "mpris-covers",
      ]);
      GLib.mkdir_with_parents(cacheDir, 0o755);
      const cachePath = GLib.build_filenamev([cacheDir, hash]);
      const cacheFile = Gio.File.new_for_path(cachePath);

      if (cacheFile.query_exists(null)) {
        const coverStyle = `
          width: 340px;
          height: 340px;
          border-radius: 16px;
          background-image: url('file://${cachePath}');
          background-size: contain;
          background-position: center;
          background-repeat: no-repeat;
        `;
        this._coverImage.style = coverStyle;
        this._coverCache.set(url, coverStyle);
        return;
      }

      this.setDefaultCover();

      const source = Gio.File.new_for_uri(url);
      source.copy_async(
        cacheFile,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_LOW,
        null,
        null,
        (src, res) => {
          try {
            src.copy_finish(res);
            const coverStyle = `
              width: 340px;
              height: 340px;
              border-radius: 16px;
              background-image: url('file://${cachePath}');
              background-size: contain;
              background-position: center;
              background-repeat: no-repeat;
            `;
            this._coverImage.style = coverStyle;
            this._coverCache.set(url, coverStyle);
          } catch (e) {
            console.error("Failed to download cover:", e);
          }
        },
      );
    }

    setDefaultCover() {
      this._currentArtUrl = null;
      const defaultStyle = `
        width: 340px;
        height: 340px;
        border-radius: 16px;
        background-size: 128px;
        background-position: center;
        background-repeat: no-repeat;
        background-image: url('resource:///org/gnome/shell/theme/process-working.svg');
        opacity: 0.3;
      `;
      this._coverImage.style = defaultStyle;
    }

    destroy() {
      this._coverCache.clear();
      this._currentArtUrl = null;
      super.destroy();
    }
  },
);
