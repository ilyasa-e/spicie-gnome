import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { SourceCredits } from './sourceCredits.js';
import { PlayerLyrics } from './playerLyrics.js';
import { DEFAULT_PALETTE, formatTime } from './playerTheme.js';

const ICONS = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('icons');
const heartIcon = filled => new Gio.FileIcon({
    file: ICONS.get_child(filled ? 'spicie-heart-filled-symbolic.svg' : 'spicie-heart-symbolic.svg')});

export class PlayerCard {
    /**
     * @param {object} options
     * @param {boolean} options.detachLyrics keep the lyric panel out of this.actor;
     *   the owner places this.lyricsActor itself (the pinned player does)
     * @param {Function} options.onLinkOpened called after a credit link opens
     * @param {Function} options.onToggleLike called when the like button is pressed
     */
    constructor(settings, mpris, onOpenPrefs, {detachLyrics = false, onLinkOpened = null, onToggleLike = null} = {}) {
        this._settings = settings;
        this._mpris = mpris;
        this._onOpenPrefs = onOpenPrefs;
        this._detachLyrics = detachLyrics;
        this._like = {available: false, liked: false, busy: false};
        this._duration = 0;
        this._palette = DEFAULT_PALETTE;
        this._signals = [];
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'spotify-player-stack', reactive: true });
        this._surface = new St.BoxLayout({vertical: true, style_class: 'spotify-player-card', reactive: true});
        this.actor.add_child(this._surface);
        this._body = new St.BoxLayout({ vertical: true, style_class: 'spotify-player-body' });
        this._surface.add_child(this._body);
        this.header = new St.BoxLayout({ style_class: 'spotify-player-header', reactive: true, x_expand: true });
        this._cover = new St.Icon({ icon_name: 'audio-x-generic-symbolic', style_class: 'spotify-player-cover', icon_size: 44 });
        this._title = new St.Label({ text: 'No song playing', style_class: 'spotify-player-title', x_expand: true });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({ text: 'Play a song in Spotify', style_class: 'spotify-player-artist', x_expand: true });
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const info = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        info.add_child(this._title);
        info.add_child(this._artist);
        this.header.add_child(this._cover);
        this.header.add_child(info);
        this._likeButton = this._button('', 'Like song', () => onToggleLike?.());
        this._likeButton.child.gicon = heartIcon(false);
        this._likeButton.add_style_class_name('spotify-player-like');
        this._likeButton.visible = false;
        this.header.add_child(this._likeButton);

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
        this._slider.track_hover = true;
        this._slider.connect('notify::hover', () => this._applySliderStyle());
        this._slider.connect('drag-begin', () => {
            if (this._seekTimeout) GLib.Source.remove(this._seekTimeout);
            this._seekTimeout = 0;
            this._dragging = true;
            this._seekTrack = this._trackKey;
            this._applySliderStyle();
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            this._applySliderStyle();
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
        this._times = new St.BoxLayout({ style_class: 'spotify-player-times' });
        this._elapsed = new St.Label({ text: '0:00', x_expand: true });
        this._total = new St.Label({ text: '0:00', x_align: Clutter.ActorAlign.END });
        this._times.add_child(this._elapsed);
        this._times.add_child(this._total);
        this._lyricPanel = new PlayerLyrics(settings, () => this._mpris.getPositionMs(), onLinkOpened);
        this._lyricBox = this._lyricPanel.actor;
        if (detachLyrics) this.lyricsActor = this._lyricBox;
        else this.actor.add_child(this._lyricBox);
        this._credits = new SourceCredits(onLinkOpened);
        this._credits.actor.add_style_class_name('spotify-player-source-credits');
        this._surface.add_child(this._credits.actor);
        this._footer = new St.BoxLayout({ style_class: 'spotify-player-footer' });
        this._lyrics = new St.Button({ label: 'Desktop lyrics', style_class: 'spotify-player-lyrics', can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.START });
        this._lyrics.connect('clicked', () => settings.set_boolean('show-floating', !settings.get_boolean('show-floating')));
        this._pin = this._button('view-pin-symbolic', 'Keep player on desktop', () => settings.set_boolean('player-pinned', !settings.get_boolean('player-pinned')));
        this._pin.add_style_class_name('spotify-player-utility');
        this._prefs = this._button('emblem-system-symbolic', 'Settings', () => this._onOpenPrefs());
        this._prefs.add_style_class_name('spotify-player-utility');
        this._footer.add_child(this._lyrics);
        this._footer.add_child(this._pin);
        this._footer.add_child(this._prefs);
        this._surface.add_child(this._footer);
        for (const key of ['player-layout', 'show-floating', 'player-pinned', 'show-player-lyrics', 'player-scale', 'player-lyric-lines', 'show-countdown', 'animate-lyrics',
            'player-lyrics-font-weight'])
            this._signals.push(settings.connect(`changed::${key}`, () => {
                if (key === 'show-countdown') this._lyricPanel.setLines(this._lines || []);
                this._applySettings();
            }));
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
        [this.header, this._controls, this._progress, this._times].forEach(actor => actor.get_parent()?.remove_child(actor));
        this._body.destroy_all_children();
        this.actor.set_style_class_name(`spotify-player-stack ${horizontal ? 'horizontal' : 'compact'}`);
        this._surface.set_style_class_name(`spotify-player-card ${horizontal ? 'horizontal' : 'compact'}`);
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
        this._cover.visible = true;
        this._cover.icon_size = horizontal ? 38 : 32;
        this._times.x_expand = true;
        this._elapsed.x_expand = true;
        this._progress.add_child(this._times);
        this._lyrics.x_expand = true;
        this._updateLyricsVisibility();
        const floating = this._settings.get_boolean('show-floating');
        this._lyrics.accessible_name = floating ? 'Hide desktop lyrics' : 'Show desktop lyrics';
        this._lyrics.set_label(horizontal ? (floating ? 'Desktop lyrics on' : 'Desktop lyrics') : 'Lyrics');
        this._lyrics.set_style_class_name(`spotify-player-lyrics${floating ? ' enabled' : ''}`);
        if (floating) this._lyrics.add_style_pseudo_class('checked');
        else this._lyrics.remove_style_pseudo_class('checked');
        const pinned = this._settings.get_boolean('player-pinned');
        this._pin.accessible_name = pinned ? 'Unpin player' : 'Keep player on desktop';
        if (pinned) this._pin.add_style_pseudo_class('checked');
        else this._pin.remove_style_pseudo_class('checked');
        this._applySize();
        this._applyPalette();
    }

    _applyPalette() {
        const p = this._palette;
        this._surface.style += `background-color: ${p.surface}; background-gradient-direction: vertical; background-gradient-start: ${p.top}; background-gradient-end: ${p.surface}; color: ${p.foreground};`;
        this._artist.style += `color: ${p.secondary};`;
        this._lyricPanel.setColors(`background-color: ${p.surface}; color: ${p.foreground};`);
        this._progress.style += `color: ${p.secondary};`;
        this._lyrics.style += `color: ${p.secondary};`;
        this._play.style += `background-color: ${p.accent}; color: ${p.surface};`;
        this._likeButton.style += `color: ${this._like.liked ? p.accent : p.secondary};`;
        this._applySliderStyle();
    }

    // Hovering or dragging the seek bar thickens it, reveals the handle and
    // switches to the cover accent, so it reads as something to grab.
    _applySliderStyle() {
        const horizontal = this._settings.get_string('player-layout') === 'horizontal';
        const f = this._settings.get_int('player-scale') / 100;
        const active = this._slider.hover || this._dragging;
        const p = this._palette;
        this._slider.style = `height: ${(horizontal ? 18 : 14) * f}px; ` +
            `-barlevel-height: ${(active ? 5 : 3) * f}px; -slider-handle-radius: ${(active ? 6 : 0) * f}px; ` +
            `color: ${p.foreground}; -barlevel-active-background-color: ${active ? p.accent : p.secondary};`;
    }

    _applySize() {
        const horizontal = this._settings.get_string('player-layout') === 'horizontal';
        const f = this._settings.get_int('player-scale') / 100;
        const px = value => `${value * f}px`;
        const width = (horizontal ? 320 : 144) * f;
        this.actor.style = `spacing: ${px(8)};`;
        this._surface.style = `width: ${width}px; padding: ${px(horizontal ? 12 : 10)}; border-radius: ${px(12)};`;
        this.header.style = `spacing: ${px(horizontal ? 10 : 8)};`;
        // The like button takes its room from the song details.
        const infoWidth = (horizontal ? 150 : 104) - (this._likeButton.visible ? (horizontal ? 30 : 26) : 0);
        this._title.style = `font-size: ${px(13)}; max-width: ${px(infoWidth)};`;
        this._artist.style = `font-size: ${px(11)}; max-width: ${px(infoWidth)}; margin-top: ${px(2)};`;
        this._cover.icon_size = Math.round((horizontal ? 38 : 32) * f);
        this._cover.style = `border-radius: ${px(horizontal ? 10 : 6)};`;
        this._controls.style = `spacing: ${px(horizontal ? 4 : 8)}; margin-top: ${px(horizontal ? 0 : 8)}; margin-bottom: ${px(horizontal ? 0 : 6)};`;
        this._body.get_first_child().style = horizontal ? `spacing: ${px(12)};` : this.header.style;
        for (const button of [this._prev, this._play, this._next, this._pin, this._prefs, this._likeButton]) {
            const utility = button === this._pin || button === this._prefs || button === this._likeButton;
            const size = utility ? (horizontal ? 26 : 24) : button === this._play ? (horizontal ? 30 : 28) : (horizontal ? 28 : 24);
            button.style = `width: ${px(size)}; height: ${px(size)}; border-radius: ${px(utility ? 7 : size / 2)};`;
            button.child.icon_size = Math.round((utility || !horizontal ? 14 : 18) * f);
            button.child.style = `icon-size: ${px(utility || !horizontal ? 14 : 18)};`;
        }
        this._progress.style = `spacing: ${px(2)}; margin-top: ${px(horizontal ? 6 : 0)};`;
        this._times.style = `font-size: ${px(horizontal ? 11 : 10)};`;
        this._footer.style = `spacing: ${px(horizontal ? 6 : 4)}; margin-top: ${px(4)};`;
        this._lyrics.style = `font-size: ${px(horizontal ? 11 : 10)}; padding: ${px(4)};`;
        this._credits.actor.style = `font-size: ${px(10)}; margin-top: ${px(6)};`;
        this._lyricPanel.applySize(f, width - (horizontal ? 0 : 4 * f));
    }

    _updateLyricsVisibility() {
        const show = this._settings.get_string('player-layout') === 'horizontal' &&
            this._settings.get_boolean('show-player-lyrics') && Boolean(this._lines?.length);
        this._lyricBox.visible = show;
        this._credits.actor.visible = this._credits.hasCredits && !show;
        if (show) this._lyricPanel.updatePosition(this._position ?? this._mpris.getPositionMs(), true);
    }

    setLyrics(lines) {
        this._lines = lines || [];
        this._lyricPanel.setLines(this._lines);
        this._updateLyricsVisibility();
    }

    setLyric(_text) { this._lyricPanel.updatePosition(this._position ?? this._mpris.getPositionMs()); }

    setAvailableHeight(height) {
        this._lyricPanel.setAvailableHeight(height - this._surface.get_preferred_height(-1)[1] - 8);
    }

    // Detached lyrics get the room beside the card, not the whole screen.
    setLyricsAvailableHeight(height) {
        this._lyricPanel.setAvailableHeight(height);
    }

    setLikeState(state) {
        this._like = {...this._like, ...state};
        const {available, liked, busy} = this._like;
        this._likeButton.visible = available;
        this._likeButton.child.gicon = heartIcon(liked);
        this._likeButton.accessible_name = liked ? 'Remove from Liked Songs' : 'Save to Liked Songs';
        this._likeButton.reactive = !busy;
        this._likeButton.opacity = busy ? 150 : 255;
        if (liked) this._likeButton.add_style_pseudo_class('checked');
        else this._likeButton.remove_style_pseudo_class('checked');
        // Palette styles are appended, so they are always rebuilt from the size.
        this._applySize();
        this._applyPalette();
    }

    // Draws attention to the pinned player when the top bar is clicked.
    pulse() {
        const surface = this._surface;
        surface.set_pivot_point(0.5, 0.5);
        surface.remove_all_transitions();
        surface.ease({scale_x: 1.04, scale_y: 1.04, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => surface.ease({scale_x: 1, scale_y: 1, duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_BACK})});
    }

    setLyricsAbove(above) {
        if (this._lyricsAbove === above) return;
        this._lyricsAbove = above;
        if (!this._detachLyrics) this.actor.set_child_at_index(this._lyricBox, above ? 0 : 1);
    }

    setAttribution(attribution) {
        this._attribution = attribution;
        this._credits.setAttribution(attribution);
        this._lyricPanel.setAttribution(attribution);
        this._updateLyricsVisibility();
    }

    setArtwork({ gicon, palette }) {
        this._cover.gicon = gicon;
        if (!gicon) this._cover.icon_name = 'audio-x-generic-symbolic';
        this._palette = palette;
        this._applySize();
        this._applyPalette();
    }

    updateMetadata(track, playing) {
        this._lyricPanel.setPlaying(playing);
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
        this._position = Number(position) || 0;
        this._lyricPanel.updatePosition(Number(position) || 0);
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
        this._lyricPanel.destroy();
        this.actor.destroy();
        this.lyricsActor = null;
    }
}
