import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { DEFAULT_PALETTE, formatTime } from './playerTheme.js';

export class PlayerCard {
    constructor(settings, mpris, onOpenPrefs) {
        this._settings = settings;
        this._mpris = mpris;
        this._onOpenPrefs = onOpenPrefs;
        this._duration = 0;
        this._palette = DEFAULT_PALETTE;
        this._signals = [];
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'spotify-player-card', reactive: true });
        this._body = new St.BoxLayout({ vertical: true, style_class: 'spotify-player-body' });
        this.actor.add_child(this._body);
        this.header = new St.BoxLayout({ style_class: 'spotify-player-header', reactive: true, x_expand: true });
        this._cover = new St.Icon({ icon_name: 'audio-x-generic-symbolic', style_class: 'spotify-player-cover', icon_size: 66 });
        this._title = new St.Label({ text: 'No song playing', style_class: 'spotify-player-title', x_expand: true });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({ text: 'Play a song in Spotify', style_class: 'spotify-player-artist', x_expand: true });
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const info = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        info.add_child(this._title);
        info.add_child(this._artist);
        this.header.add_child(this._cover);
        this.header.add_child(info);

        this._controls = new St.BoxLayout({ style_class: 'spotify-player-controls', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this._prev = this._button('media-skip-backward-symbolic', 'Previous song', () => this._call('previous'));
        this._play = this._button('media-playback-start-symbolic', 'Play', () => this._call('playPause'));
        this._play.add_style_class_name('spotify-player-play');
        this._next = this._button('media-skip-forward-symbolic', 'Next song', () => this._call('next'));
        [this._prev, this._play, this._next].forEach(b => this._controls.add_child(b));

        this._progress = new St.BoxLayout({ vertical: true, style_class: 'spotify-player-progress', x_expand: true });
        this._slider = new Slider.Slider(0);
        this._slider.add_style_class_name('spotify-player-slider');
        this._slider.accessible_name = 'Song position';
        this._slider.connect('drag-begin', () => {
            if (this._seekTimeout) GLib.Source.remove(this._seekTimeout);
            this._seekTimeout = 0;
            this._dragging = true;
            this._seekTrack = this._trackKey;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            if (this._seekTrack === this._trackKey) this._seek();
            else this.updatePosition(this._mpris.getPositionMs());
        });
        this._slider.connect('notify::value', () => {
            if (this._updating) return;
            if (this._dragging && this._seekTrack !== this._trackKey) return;
            this._elapsed.text = formatTime(this._slider.value * this._duration);
            if (this._dragging) return;
            if (this._seekTimeout) GLib.Source.remove(this._seekTimeout);
            this._seekTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._seekTimeout = 0;
                this._seek();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._progress.add_child(this._slider);
        const times = new St.BoxLayout({ style_class: 'spotify-player-times' });
        this._elapsed = new St.Label({ text: '0:00', x_expand: true });
        this._total = new St.Label({ text: '0:00', x_align: Clutter.ActorAlign.END });
        times.add_child(this._elapsed);
        times.add_child(this._total);
        this._progress.add_child(times);
        const footer = new St.BoxLayout({ style_class: 'spotify-player-footer' });
        this._lyrics = new St.Button({ label: 'Desktop lyrics', style_class: 'spotify-player-lyrics', can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.START });
        this._lyrics.connect('clicked', () => settings.set_boolean('show-floating', !settings.get_boolean('show-floating')));
        this._pin = this._button('view-pin-symbolic', 'Keep player on desktop', () => settings.set_boolean('player-pinned', !settings.get_boolean('player-pinned')));
        this._pin.add_style_class_name('spotify-player-utility');
        this._prefs = this._button('emblem-system-symbolic', 'Settings', () => this._onOpenPrefs());
        this._prefs.add_style_class_name('spotify-player-utility');
        footer.add_child(this._lyrics);
        footer.add_child(this._pin);
        footer.add_child(this._prefs);
        this.actor.add_child(footer);
        for (const key of ['player-layout', 'show-floating', 'player-pinned'])
            this._signals.push(settings.connect(`changed::${key}`, () => this._applySettings()));
        this._applySettings();
        this.updateMetadata(null, false);
    }

    _button(iconName, label, callback) {
        const button = new St.Button({ style_class: 'spotify-player-button', can_focus: true,
            accessible_name: label, child: new St.Icon({ icon_name: iconName, icon_size: 18 }),
            y_align: Clutter.ActorAlign.CENTER });
        button.connect('clicked', callback);
        return button;
    }

    _applySettings() {
        const horizontal = this._settings.get_string('player-layout') === 'horizontal';
        [this.header, this._controls, this._progress].forEach(actor => actor.get_parent()?.remove_child(actor));
        this._body.destroy_all_children();
        this.actor.set_style_class_name(`spotify-player-card${horizontal ? ' horizontal' : ''}`);
        if (horizontal) {
            const row = new St.BoxLayout({ style_class: 'spotify-player-top-row' });
            row.add_child(this.header);
            row.add_child(this._controls);
            this._body.add_child(row);
        } else {
            this._body.add_child(this.header);
            this._body.add_child(this._controls);
        }
        this._body.add_child(this._progress);
        this._cover.icon_size = horizontal ? 58 : 66;
        const floating = this._settings.get_boolean('show-floating');
        this._lyrics.accessible_name = floating ? 'Hide desktop lyrics' : 'Show desktop lyrics';
        this._lyrics.set_label(floating ? 'Desktop lyrics on' : 'Desktop lyrics');
        this._lyrics.set_style_class_name(`spotify-player-lyrics${floating ? ' enabled' : ''}`);
        const pinned = this._settings.get_boolean('player-pinned');
        this._pin.accessible_name = pinned ? 'Unpin player' : 'Keep player on desktop';
        if (pinned) this._pin.add_style_pseudo_class('checked');
        else this._pin.remove_style_pseudo_class('checked');
        this._applyPalette();
    }

    _applyPalette() {
        const p = this._palette;
        this.actor.style = `background-color: ${p.surface}; background-gradient-direction: diagonal; background-gradient-start: ${p.top}; background-gradient-end: ${p.surface}; color: ${p.foreground};`;
        this._artist.style = `color: ${p.secondary};`;
        this._progress.style = `color: ${p.secondary};`;
        this._lyrics.style = `color: ${p.secondary};`;
        this._play.style = `background-color: ${p.accent}; color: ${p.surface};`;
        this._slider.style = `color: ${p.foreground}; -barlevel-active-background-color: ${p.accent};`;
    }

    setArtwork({ gicon, palette }) {
        this._cover.gicon = gicon;
        if (!gicon) this._cover.icon_name = 'audio-x-generic-symbolic';
        this._palette = palette;
        this._applyPalette();
    }

    updateMetadata(track, playing) {
        const trackKey = track ? track.trackId || `${track.title}\n${track.artist}` : '';
        if (trackKey !== this._trackKey) {
            if (this._seekTimeout) GLib.Source.remove(this._seekTimeout);
            this._seekTimeout = 0;
            this._trackKey = trackKey;
        }
        const available = Boolean(track?.title);
        this._title.text = available ? track.title : 'No song playing';
        this._artist.text = available ? track.artist || 'Unknown artist' : 'Play a song in Spotify';
        this._duration = Math.max(0, Number(track?.durationMs) || 0);
        this._total.text = formatTime(this._duration);
        this._play.child.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.accessible_name = playing ? 'Pause' : 'Play';
        [this._prev, this._play, this._next].forEach(b => { b.reactive = available; b.can_focus = available; b.opacity = available ? 255 : 100; });
        this._slider.reactive = available && this._duration > 0;
        this._slider.can_focus = this._slider.reactive;
        this.updatePosition(available ? this._mpris.getPositionMs() : 0);
    }

    updatePosition(position) {
        if (this._dragging || this._seekTimeout) return;
        this._updating = true;
        const bounded = Math.max(0, Math.min(this._duration, Number(position) || 0));
        this._slider.value = this._duration ? bounded / this._duration : 0;
        this._elapsed.text = formatTime(bounded);
        this._updating = false;
    }

    _seek() {
        if (this._duration > 0) this._call('setPosition', this._slider.value * this._duration);
    }

    _call(method, ...args) {
        Promise.resolve().then(() => this._mpris?.[method](...args)).catch(e => {
            if (!this._destroyed) console.warn(`[Spotify player] ${e.message}`);
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._seekTimeout) GLib.Source.remove(this._seekTimeout);
        this._signals.forEach(id => this._settings.disconnect(id));
        this.actor.destroy();
    }
}
