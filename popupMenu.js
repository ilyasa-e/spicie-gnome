import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PlayerCard } from './playerCard.js';
import { PlayerArtwork } from './playerArtwork.js';

export class SpotifyLyricsPopup {
    constructor(menu, settings, mpris, onOpenPrefs) {
        this._menu = menu;
        this._settings = settings;
        this._mpris = mpris;
        this._openPrefs = () => { menu.close(); onOpenPrefs(); };
        this._card = new PlayerCard(settings, mpris, this._openPrefs);
        menu.actor.add_style_class_name('spotify-player-popup');
        this._item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false, style_class: 'spotify-player-menu-item' });
        this._item.add_child(this._card.actor);
        menu.addMenuItem(this._item);
        this._artwork = new PlayerArtwork(value => {
            this._card.setArtwork(value);
            this._pinned?.setArtwork(value);
        });
        this._signals = ['player-pinned', 'player-layout', 'player-x', 'player-y'].map(key =>
            settings.connect(`changed::${key}`, () => this._syncPinned()));
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._positionPinned());
        this._syncPinned();
    }

    updateMetadata(track, playing) {
        this._track = track;
        this._playing = playing;
        this._card.updateMetadata(track, playing);
        this._pinned?.updateMetadata(track, playing);
        this._artwork.update(track?.artUrl || '');
    }

    updatePosition(position) {
        this._card.updatePosition(position);
        this._pinned?.updatePosition(position);
    }

    // Lyrics remain on the top bar and the dedicated floating surface.
    setLyrics(_lines) {}
    setActiveLine(_index) {}

    _syncPinned() {
        if (!this._settings.get_boolean('player-pinned')) {
            this._grab?.dismiss();
            this._grab = null;
            this._dragging = false;
            if (this._pinned) {
                Main.layoutManager.removeChrome(this._pinned.actor);
                this._pinned.destroy();
                this._pinned = null;
            }
            return;
        }
        if (!this._pinned) {
            this._pinned = new PlayerCard(this._settings, this._mpris, this._openPrefs);
            this._pinned.setArtwork(this._artwork.value);
            this._pinned.updateMetadata(this._track, this._playing);
            Main.layoutManager.addChrome(this._pinned.actor, { trackFullscreen: true });
            this._setupDrag();
            this._pinned.actor.connect('notify::allocation', () => this._positionPinned());
        }
        this._positionPinned();
    }

    _positionPinned() {
        if (!this._pinned || this._dragging) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const actor = this._pinned.actor;
        const width = actor.width || (this._settings.get_string('player-layout') === 'horizontal' ? 470 : 352);
        const height = actor.height || 260;
        const x = this._settings.get_int('player-x');
        const y = this._settings.get_int('player-y');
        actor.set_position(Math.max(area.x, Math.min(area.x + area.width - width, x)),
            Math.max(area.y, Math.min(area.y + area.height - height, y)));
    }

    _setupDrag() {
        const card = this._pinned;
        card.header.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this._dragOffset = [x - card.actor.x, y - card.actor.y];
            this._dragging = true;
            this._grab = global.stage.grab(card.header);
            return Clutter.EVENT_STOP;
        });
        card.header.connect('motion-event', (_actor, event) => {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            card.actor.set_position(x - this._dragOffset[0], y - this._dragOffset[1]);
            return Clutter.EVENT_STOP;
        });
        card.header.connect('button-release-event', () => {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            this._dragging = false;
            this._grab?.dismiss();
            this._grab = null;
            this._settings.set_int('player-x', Math.round(card.actor.x));
            this._settings.set_int('player-y', Math.round(card.actor.y));
            this._positionPinned();
            return Clutter.EVENT_STOP;
        });
    }

    destroy() {
        this._grab?.dismiss();
        this._artwork.destroy();
        this._signals.forEach(id => this._settings.disconnect(id));
        Main.layoutManager.disconnect(this._monitorSignal);
        if (this._pinned) {
            Main.layoutManager.removeChrome(this._pinned.actor);
            this._pinned.destroy();
        }
        this._card.destroy();
        this._item.destroy();
        this._menu.actor.remove_style_class_name('spotify-player-popup');
    }
}
