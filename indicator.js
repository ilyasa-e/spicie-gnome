import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { panelText } from './lyricsView.js';
import { fontWeightValue } from './fontWeight.js';

export const SpotifyIndicator = GObject.registerClass(
class SpotifyIndicator extends PanelMenu.Button {
    _init(settings, onToggleFloating, onOpenPrefs) {
        super._init(0.5, 'Spicie Indicator', false);

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
            visible: true,
        });
        this._lyricLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._lyricBox = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-lyric-stack' });
        this._box.add_child(this._lyricBox);
        this._lyricBox.add_child(this._lyricLabel);
        // Listen for GSettings changes on show-in-panel
        if (this._settings) {
            this._settingsChangedIds = ['show-in-panel', 'panel-show-artist', 'panel-show-title'].map(key =>
                this._settings.connect(`changed::${key}`, () => this._updateText()));
            this._settingsChangedIds.push(this._settings.connect('changed::panel-font-weight', () => this._applyWeight()));
        }
        this._applyWeight();
    }

    /**
     * @param {Function|null} handler returns true when it handled the click,
     *   in which case the menu is not opened
     */
    setActivateHandler(handler) {
        this._activateHandler = handler;
    }

    vfunc_event(event) {
        const type = event.type();
        if ((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
            !this.menu.isOpen && this._activateHandler?.())
            return Clutter.EVENT_STOP;
        return super.vfunc_event(event);
    }

    _applyWeight() {
        this._lyricLabel.style = `font-weight: ${fontWeightValue(this._settings?.get_string('panel-font-weight'), 600)};`;
    }

    updateLyric(text) {
        if (!this._lyricLabel) return;
        this._lyric = (text || '').trim();
        this._updateText();
    }

    _updateText() {
        this._lyricLabel.text = panelText(this._track, this._lyric, {
            artist: this._settings?.get_boolean('panel-show-artist') ?? false,
            title: this._settings?.get_boolean('panel-show-title') ?? false,
            lyrics: this._settings?.get_boolean('show-in-panel') ?? true,
        });
        this._lyricLabel.visible = Boolean(this._lyricLabel.text);
        this._lyricBox.visible = this._lyricLabel.visible;
    }

    updatePlayback(isPlaying, track) {
        if (!this._icon) return;
        this._track = track;
        this._updateText();
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
        for (const id of this._settingsChangedIds || []) this._settings.disconnect(id);
        super.destroy();
    }
});
