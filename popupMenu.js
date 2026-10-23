import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PlayerCard } from './playerCard.js';
import { PlayerArtwork } from './playerArtwork.js';
import { spotifyTrackId } from './spotifyLibrary.js';

const LYRICS_GAP = 8;

// Keeps the detached lyric panel against the card's top or bottom edge at its
// own size. Clutter.SnapConstraint moves a single edge, which stretches the
// panel instead of moving it.
const StickToCard = GObject.registerClass(class SpicieStickToCard extends Clutter.Constraint {
    _init(card) {
        super._init();
        this._card = card;
        this.above = false;
    }

    vfunc_update_allocation(_actor, box) {
        const card = this._card.get_allocation_box();
        const [width, height] = [box.get_width(), box.get_height()];
        box.init_rect(card.x1, this.above ? card.y1 - LYRICS_GAP - height : card.y2 + LYRICS_GAP, width, height);
    }
});

export class SpotifyLyricsPopup {
    constructor(menu, settings, mpris, onOpenPrefs, library = null) {
        this._menu = menu;
        this._settings = settings;
        this._mpris = mpris;
        this._library = library;
        this._like = {available: false, liked: false, busy: false};
        this._openPrefs = () => { menu.close(); onOpenPrefs(); };
        this._card = new PlayerCard(settings, mpris, this._openPrefs, {
            onLinkOpened: () => menu.close(), onToggleLike: () => this._toggleLike()});
        menu.actor.add_style_class_name('spotify-player-popup');
        this._item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false, style_class: 'spotify-player-menu-item' });
        this._item.add_child(this._card.actor);
        menu.addMenuItem(this._item);
        this._artwork = new PlayerArtwork(value => {
            this._card.setArtwork(value);
            this._pinned?.setArtwork(value);
        });
        this._signals = ['player-pinned', 'player-layout', 'player-x', 'player-y', 'player-scale', 'show-player-lyrics', 'player-lyric-lines'].map(key =>
            settings.connect(`changed::${key}`, () => this._syncPinned()));
        for (const key of ['spotify-client-id', 'spotify-refresh-token'])
            this._signals.push(settings.connect(`changed::${key}`, () => this._refreshLike(true)));
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._positionPinned());
        this._syncPinned();
    }

    updateMetadata(track, playing) {
        this._track = track;
        this._playing = playing;
        this._card.updateMetadata(track, playing);
        this._pinned?.updateMetadata(track, playing);
        this._artwork.update(track?.artUrl || '');
        this._refreshLike();
    }

    updatePosition(position) {
        this._card.updatePosition(position);
        this._pinned?.updatePosition(position);
    }

    setAvailable(available) {
        this._available = available;
        this._syncPinned();
        if (!available) this._menu.close();
    }

    setLyrics(lines) {
        this._lines = lines || [];
        this._card.setLyrics(this._lines);this._pinned?.setLyrics(this._lines);
        this.setActiveLine(-1);
    }
    setActiveLine(index) {
        this._lyric = this._lines?.[index]?.words || this._lines?.[index]?.text || '';
        this._card.setLyric(this._lyric);this._pinned?.setLyric(this._lyric);
    }
    setAttribution(attribution) {
        this._attribution = attribution;
        this._card.setAttribution(attribution);this._pinned?.setAttribution(attribution);
    }

    /**
     * The top bar button and the pinned player show the same thing. While the
     * pinned player is on screen, a click brings it forward instead of opening
     * a second copy in a menu.
     *
     * @returns {boolean} true when the click was handled here
     */
    focusPinned() {
        if (!this._pinned?.actor.visible || !this._pinned.actor.mapped) return false;
        this._menu.close();
        const parent = this._pinned.actor.get_parent();
        parent?.set_child_above_sibling(this._pinned.actor, null);
        if (this._pinned.lyricsActor?.get_parent() === parent) parent.set_child_above_sibling(this._pinned.lyricsActor, null);
        this._pinned.pulse();
        return true;
    }

    _setLike(state) {
        this._like = {...this._like, ...state};
        this._card.setLikeState(this._like);
        this._pinned?.setLikeState(this._like);
    }

    _refreshLike(force = false) {
        const id = spotifyTrackId(this._track?.trackId);
        const available = Boolean(this._library?.connected && id);
        if (!force && id === this._likeTrack && available === this._like.available) return;
        this._likeTrack = id;
        const request = (this._likeRequest || 0) + 1;
        this._likeRequest = request;
        this._setLike({available, liked: false, busy: available});
        if (!available) return;
        this._library.isSaved(id).then(liked => {
            if (request === this._likeRequest) this._setLike({liked, busy: false});
        }).catch(e => {
            if (request !== this._likeRequest) return;
            console.warn(`[Spotify player] Could not read Liked Songs: ${e.message}`);
            this._setLike({available: this._library?.connected ?? false, busy: false});
        });
    }

    _toggleLike() {
        const id = this._likeTrack;
        if (!id || this._like.busy || !this._library) return;
        const liked = !this._like.liked;
        const request = (this._likeRequest || 0) + 1;
        this._likeRequest = request;
        // Answer the click immediately; Spotify confirms or the heart reverts.
        this._setLike({liked, busy: true});
        this._library.setSaved(id, liked).then(() => {
            if (request === this._likeRequest) this._setLike({busy: false});
        }).catch(e => {
            if (request !== this._likeRequest) return;
            console.warn(`[Spotify player] Could not update Liked Songs: ${e.message}`);
            this._setLike({liked: !liked, busy: false});
        });
    }

    _syncPinned() {
        if (Main.layoutManager.primaryMonitor) {
            const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
            this._card.setAvailableHeight(area.height - 24);
        }
        if (!this._settings.get_boolean('player-pinned') || this._available === false) {
            this._finishDrag(false);
            if (this._pinned) {
                Main.layoutManager.removeChrome(this._pinned.lyricsActor);
                Main.layoutManager.removeChrome(this._pinned.actor);
                this._pinned.destroy();
                this._pinned = null;
            }
            return;
        }
        if (!this._pinned) {
            // The two copies are never shown together.
            this._menu.close();
            this._pinned = new PlayerCard(this._settings, this._mpris, this._openPrefs, {
                detachLyrics: true, onToggleLike: () => this._toggleLike()});
            this._pinned.setArtwork(this._artwork.value);
            this._pinned.updateMetadata(this._track, this._playing);
            this._pinned.setLyrics(this._lines);
            this._pinned.setLyric(this._lyric);this._pinned.setAttribution(this._attribution);
            this._pinned.setLikeState(this._like);
            // The card is the anchor. Lyrics are a separate actor that sticks
            // to its top or bottom edge, so lyrics appearing, shrinking or
            // disappearing between songs never move the controls.
            Main.layoutManager.addChrome(this._pinned.actor, { trackFullscreen: true });
            Main.layoutManager.addChrome(this._pinned.lyricsActor, { trackFullscreen: true });
            this._lyricsStick = new StickToCard(this._pinned.actor);
            this._pinned.lyricsActor.add_constraint(this._lyricsStick);
            this._lyricsAbove = null;
            this._setupDrag();
            this._pinned.actor.connect('notify::allocation', () => {
                // The constraint only runs when the panel is laid out.
                this._pinned.lyricsActor.queue_relayout();
                this._positionPinned();
            });
        }
        this._positionPinned();
    }

    _placeLyrics(above) {
        if (this._lyricsAbove === above) return;
        this._lyricsAbove = above;
        this._lyricsStick.above = above;
        this._pinned.lyricsActor.queue_relayout();
        this._pinned.setLyricsAbove(above);
    }

    _positionPinned() {
        if (this._dragging) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        this._card.setAvailableHeight(area.height - 24);
        if (!this._pinned) return;
        const actor = this._pinned.actor;
        const width = actor.width || actor.get_preferred_width(-1)[1];
        const height = actor.height || actor.get_preferred_height(width)[1];
        const x = Math.max(area.x, Math.min(area.x + area.width - width, this._settings.get_int('player-x')));
        const y = Math.max(area.y, Math.min(area.y + area.height - height, this._settings.get_int('player-y')));
        if (actor.x !== x || actor.y !== y) actor.set_position(x, y);
        // Lyrics go where there is more room: below a card in the top half,
        // above one in the bottom half.
        const above = y + height / 2 > area.y + area.height / 2;
        this._placeLyrics(above);
        this._pinned.setLyricsAvailableHeight(above ? y - area.y - LYRICS_GAP
            : area.y + area.height - (y + height) - LYRICS_GAP);
    }

    _setupDrag() {
        const card = this._pinned;
        card.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1 || this._dragging) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            let source = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            while (source && source !== card.actor) {
                if (source instanceof St.Button || source === card._slider) return Clutter.EVENT_PROPAGATE;
                source = source.get_parent();
            }
            this._dragOffset = [x - card.actor.x, y - card.actor.y];
            this._dragging = true;
            this._grab = global.stage.grab(card.actor);
            return Clutter.EVENT_STOP;
        });
        card.actor.connect('motion-event', (_actor, event) => {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            card.actor.set_position(x - this._dragOffset[0], y - this._dragOffset[1]);
            return Clutter.EVENT_STOP;
        });
        card.actor.connect('button-release-event', () => {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            this._finishDrag(true);
            return Clutter.EVENT_STOP;
        });
    }

    _finishDrag(save) {
        // Keep the guard set while both settings change. Each write triggers a position refresh.
        if (save && this._pinned) {
            const [x, y] = this._pinned.actor.get_position();
            this._settings.set_int('player-x', Math.round(x));
            this._settings.set_int('player-y', Math.round(y));
        }
        this._dragging = false;
        this._grab?.dismiss();this._grab = null;
        if (save) this._positionPinned();
    }

    destroy() {
        this._likeRequest = (this._likeRequest || 0) + 1;
        this._finishDrag(false);
        this._artwork.destroy();
        this._signals.forEach(id => this._settings.disconnect(id));
        Main.layoutManager.disconnect(this._monitorSignal);
        if (this._pinned) {
            Main.layoutManager.removeChrome(this._pinned.lyricsActor);
            Main.layoutManager.removeChrome(this._pinned.actor);
            this._pinned.destroy();
        }
        this._card.destroy();
        this._item.destroy();
        this._menu.actor.remove_style_class_name('spotify-player-popup');
    }
}
