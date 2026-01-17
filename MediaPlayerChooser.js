import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

/**
 * Dialog for selecting media player applications to show/hide
 */
class MediaPlayerChooser extends Adw.Window {
    /**
     * @private
     * @type {Gtk.ListBox}
     */
    listBox;
    
    /**
     * @private
     * @type {Gtk.Button}
     */
    saveBtn;
    
    /**
     * @private
     * @type {Gtk.Button}
     */
    cancelBtn;
    
    /**
     * @private
     * @type {Gtk.SearchEntry}
     */
    searchEntry;
    
    /**
     * @private
     * @type {Map<string, boolean>}
     */
    selectedPlayers;

    /**
     * @param {Object} params
     * @param {string[]} params.enabledPlayers - Currently enabled player IDs
     */
    constructor(params = {}) {
        super({
            title: "Select Media Players",
            modal: true,
            defaultWidth: 500,
            defaultHeight: 600,
        });

        this.selectedPlayers = new Map();
        const enabledPlayers = params.enabledPlayers || [];

        // Main container
        const toolbarView = new Adw.ToolbarView();
        this.set_content(toolbarView);

        // Header bar
        const headerBar = new Adw.HeaderBar();
        toolbarView.add_top_bar(headerBar);

        // Search entry in header
        this.searchEntry = new Gtk.SearchEntry({
            placeholderText: "Search players...",
            hexpand: true,
        });
        headerBar.set_title_widget(this.searchEntry);

        // Main content
        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });
        toolbarView.set_content(contentBox);

        // Scrolled window for list
        const scrolled = new Gtk.ScrolledWindow({
            vexpand: true,
            hexpand: true,
        });
        contentBox.append(scrolled);

        // List box
        this.listBox = new Gtk.ListBox({
            selectionMode: Gtk.SelectionMode.NONE,
        });
        this.listBox.add_css_class("boxed-list");
        scrolled.set_child(this.listBox);

        // Bottom action bar
        const actionBar = new Gtk.ActionBar();
        contentBox.append(actionBar);

        // Cancel button
        this.cancelBtn = new Gtk.Button({
            label: "Cancel",
        });
        actionBar.pack_start(this.cancelBtn);

        // Save button
        this.saveBtn = new Gtk.Button({
            label: "Save",
        });
        this.saveBtn.add_css_class("suggested-action");
        actionBar.pack_end(this.saveBtn);

        // Populate with media apps
        this._populateMediaApps(enabledPlayers);

        // Connect search
        this.searchEntry.connect("search-changed", () => {
            this.listBox.invalidate_filter();
        });

        this.listBox.set_filter_func((row) => {
            const searchText = this.searchEntry.get_text().toLowerCase();
            if (!searchText) return true;
            
            const appRow = /** @type {Adw.ActionRow} */ (row.get_child());
            const title = appRow.title.toLowerCase();
            const subtitle = appRow.subtitle?.toLowerCase() || "";
            
            return title.includes(searchText) || subtitle.includes(searchText);
        });

        this.cancelBtn.connect("clicked", () => {
            this.close();
        });
    }

    /**
     * @private
     * @param {string[]} enabledPlayers
     */
    _populateMediaApps(enabledPlayers) {
        const mediaApps = this._getMediaApps();
        
        if (mediaApps.length === 0) {
            const row = new Adw.ActionRow({
                title: "No media applications found",
                subtitle: "Install media players to use this extension",
            });
            const icon = new Gtk.Image({
                iconName: "audio-x-generic-symbolic",
                pixelSize: 32,
            });
            row.add_prefix(icon);
            this.listBox.append(row);
            return;
        }

        for (const app of mediaApps) {
            const appId = app.get_id();
            const isEnabled = enabledPlayers.includes(appId);
            this.selectedPlayers.set(appId, isEnabled);

            const row = new Adw.ActionRow({
                title: app.get_display_name(),
                subtitle: appId,
                activatable: true,
            });

            // App icon
            const icon = new Gtk.Image({
                gicon: app.get_icon(),
                pixelSize: 32,
            });
            row.add_prefix(icon);

            // Switch
            const switchWidget = new Gtk.Switch({
                active: isEnabled,
                valign: Gtk.Align.CENTER,
            });
            
            switchWidget.connect("notify::active", () => {
                this.selectedPlayers.set(appId, switchWidget.active);
            });

            row.add_suffix(switchWidget);
            row.set_activatable_widget(switchWidget);

            this.listBox.append(row);
        }
    }

    /**
     * @private
     * @returns {Gio.AppInfo[]}
     */
    _getMediaApps() {
        const mediaCategories = [
            "AudioVideo",
            "Audio",
            "Video",
            "Player",
        ];

        const mediaKeywords = [
            "music",
            "audio",
            "video",
            "player",
            "media",
            "mpris",
        ];

        const apps = Gio.AppInfo.get_all()
            .filter((app) => {
                if (!app.should_show()) return false;

                const appId = app.get_id().toLowerCase();
                const name = app.get_display_name().toLowerCase();
                const categories = app.get_categories()?.toLowerCase() || "";

                // Check if app has media-related categories
                const hasMediaCategory = mediaCategories.some(
                    (cat) => categories.includes(cat.toLowerCase())
                );

                // Check if app name or ID contains media keywords
                const hasMediaKeyword = mediaKeywords.some(
                    (keyword) => name.includes(keyword) || appId.includes(keyword)
                );

                return hasMediaCategory || hasMediaKeyword;
            })
            .sort((a, b) => {
                const nameA = a.get_display_name().toLowerCase();
                const nameB = b.get_display_name().toLowerCase();
                return nameA.localeCompare(nameB);
            });

        return apps;
    }

    /**
     * @public
     * @returns {Promise<string[]>}
     */
    showChooser() {
        return new Promise((resolve) => {
            const signalId = this.saveBtn.connect("clicked", () => {
                this.close();
                this.saveBtn.disconnect(signalId);
                
                const enabledPlayers = Array.from(this.selectedPlayers.entries())
                    .filter(([_, enabled]) => enabled)
                    .map(([appId, _]) => appId);
                
                resolve(enabledPlayers);
            });
            
            const cancelId = this.connect("close-request", () => {
                this.disconnect(cancelId);
                resolve([...this.selectedPlayers.entries()]
                    .filter(([_, enabled]) => enabled)
                    .map(([appId, _]) => appId));
            });

            this.present();
        });
    }
}

const GMediaPlayerChooser = GObject.registerClass(
    {
        GTypeName: "MediaPlayerChooser",
    },
    MediaPlayerChooser
);

export default GMediaPlayerChooser;