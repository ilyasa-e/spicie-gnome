import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const SpotifyIndicator = GObject.registerClass(
class SpotifyIndicator extends PanelMenu.Button {
    _init(settings, onToggleFloating, onOpenPrefs) {
        super._init(0.5, 'Spotify Floating Lyrics Indicator', false);

        this._settings = settings;
        this._onToggleFloating = onToggleFloating;
        this._onOpenPrefs = onOpenPrefs;

        // Main horizontal box in panel
        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box spotify-indicator-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._box);

        // Spotify Icon
        this._icon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'system-status-icon spotify-indicator-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._icon);

        // Current Lyric Label in Top Bar
        this._lyricLabel = new St.Label({
            text: '',
            style_class: 'panel-lyric-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: this._settings ? this._settings.get_boolean('show-in-panel') : true,
        });
        this._box.add_child(this._lyricLabel);

        // Listen for GSettings changes on show-in-panel
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed::show-in-panel', () => {
                this._lyricLabel.visible = this._settings.get_boolean('show-in-panel');
            });
        }
    }

    updateLyric(text) {
        if (!this._lyricLabel) return;
        const cleanText = (text || '').trim();
        this._lyricLabel.text = cleanText ? `  ${cleanText}` : '';
    }

    updatePlayback(isPlaying, track) {
        if (!this._icon) return;
        if (isPlaying) {
            this._icon.icon_name = 'media-playback-start-symbolic';
            this._icon.remove_style_pseudo_class('paused');
        } else {
            this._icon.icon_name = 'media-playback-pause-symbolic';
            this._icon.add_style_pseudo_class('paused');
        }

        if (track && track.title) {
            this.set_accessible_name(`Spotify: ${track.title} - ${track.artist || ''}`);
        }
    }

    destroy() {
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});
