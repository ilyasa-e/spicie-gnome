import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { SourceCredits } from './sourceCredits.js';
import { PlayerLyrics } from './playerLyrics.js';
import { DEFAULT_PALETTE, formatTime } from './playerTheme.js';

const ICONS = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('icons');
const heartIcon = filled => new Gio.FileIcon({
    file: ICONS.get_child(filled ? 'spicie-heart-filled-symbolic.svg' : 'spicie-heart-symbolic.svg')});

// Sizes at 100%. Style 1 (vertical) stacks a large cover over the song
// details and controls; Style 2 (horizontal) puts the controls beside them.
const STYLES = {
    vertical: {width: 200, padding: 14, radius: 16, cover: 172, coverRadius: 10, headerSpacing: 8,
        title: 14, artist: 12, controlSpacing: 14, controlMargin: [6, 2], step: 34, play: 46,
        mainIcon: 18, playIcon: 22, utility: 24, slider: 16, progressMargin: 10, times: 10,
        footerSpacing: 4, lyricsLabel: 11, lyricsWidth: 280},
    horizontal: {width: 320, padding: 12, radius: 12, cover: 38, coverRadius: 8, headerSpacing: 10,
        title: 13, artist: 11, controlSpacing: 4, controlMargin: [0, 0], step: 28, play: 30,
        mainIcon: 18, playIcon: 18, utility: 26, slider: 18, progressMargin: 6, times: 11,
        footerSpacing: 6, lyricsLabel: 11, lyricsWidth: 320},
};
const CLICK_SLOP = 6;

export const playerLayout = settings => settings.get_string('player-layout') === 'horizontal' ? 'horizontal' : 'vertical';

export class PlayerCard {
    /**
     * @param {object} options
     * @param {boolean} options.detachLyrics keep the lyric panel out of this.actor;
     *   the owner places this.lyricsActor itself (the pinned player does)
     * @param {Function} options.onLinkOpened called after a credit link opens
     * @param {Function} options.onToggleLike called when the like button is pressed
     * @param {Function} options.onOpenSpotify called when the cover is clicked
     */
    constructor(settings, mpris, onOpenPrefs, {detachLyrics = false, onLinkOpened = null, onToggleLike = null,
        onOpenSpotify = null} = {}) {
        this._settings = settings;
        this._mpris = mpris;
        this._onOpenPrefs = onOpenPrefs;
        this._detachLyrics = detachLyrics;
        this._onOpenSpotify = onOpenSpotify;
        this._lyricsSide = 'below';
        this._artworkUri = null;
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
        this._coverIcon = new St.Icon({ icon_name: 'audio-x-generic-symbolic', icon_size: 20,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        // A plain reactive box rather than a button: on the pinned player a
        // press here may start a drag, and only a press that stays put opens
        // Spotify.
        this._cover = new St.Bin({ style_class: 'spotify-player-cover', child: this._coverIcon, reactive: true,
            can_focus: true, track_hover: true, accessible_name: 'Show Spotify',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this._setupCover();
        this._title = new St.Label({ text: 'No song playing', style_class: 'spotify-player-title', x_expand: true });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({ text: 'Play a song in Spotify', style_class: 'spotify-player-artist', x_expand: true });
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._info = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this._info.add_child(this._title);
        this._info.add_child(this._artist);
        this._likeButton = this._button('', 'Like song', () => onToggleLike?.());
        this._likeButton.child.gicon = heartIcon(false);
        this._likeButton.add_style_class_name('spotify-player-like');
        this._likeButton.visible = false;

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
        // Chrome that tracks fullscreen has its visibility set by the shell, so
        // a detached panel lives in a holder and hides itself inside it.
        if (detachLyrics) this.lyricsActor = new St.Bin({child: this._lyricBox});
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

    _setupCover() {
        const cover = this._cover;
        cover.connect('notify::hover', () => {
            global.display.set_cursor(cover.hover ? Meta.Cursor.POINTING_HAND : Meta.Cursor.DEFAULT);
            cover.opacity = cover.hover ? 225 : 255;
        });
        cover.connect('destroy', () => {
            if (cover.hover) global.display.set_cursor(Meta.Cursor.DEFAULT);
        });
        // Events keep propagating so the pinned player can still be dragged
        // by its cover.
        cover.connect('button-press-event', (_actor, event) => {
            this._coverPress = event.get_button() === 1 ? event.get_coords() : null;
            return Clutter.EVENT_PROPAGATE;
        });
        cover.connect('button-release-event', (_actor, event) => {
            const press = this._coverPress;
            this._coverPress = null;
            const [x, y] = event.get_coords();
            if (press && event.get_button() === 1 && Math.hypot(x - press[0], y - press[1]) < CLICK_SLOP)
                this._openSpotify();
            return Clutter.EVENT_PROPAGATE;
        });
        cover.connect('key-press-event', (_actor, event) => {
            if (![Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(event.get_key_symbol()))
                return Clutter.EVENT_PROPAGATE;
            this._openSpotify();
            return Clutter.EVENT_STOP;
        });
    }

    _openSpotify() {
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this._onOpenSpotify?.();
    }

    _applySettings() {
        const layout = playerLayout(this._settings);
        const horizontal = layout === 'horizontal';
        [this._cover, this._info, this._likeButton, this.header, this._controls, this._progress, this._times]
            .forEach(actor => actor.get_parent()?.remove_child(actor));
        this._body.destroy_all_children();
        this._topRow = null;
        this.actor.set_style_class_name(`spotify-player-stack ${layout}`);
        this._surface.set_style_class_name(`spotify-player-card ${layout}`);
        if (horizontal) {
            [this._cover, this._info, this._likeButton].forEach(actor => this.header.add_child(actor));
            this._topRow = new St.BoxLayout({ style_class: 'spotify-player-top-row' });
            this._topRow.add_child(this.header);
            this._topRow.add_child(this._controls);
            this._body.add_child(this._topRow);
            this._body.add_child(this._progress);
        } else {
            // Cover, song details, seek bar, then the controls under them.
            [this._info, this._likeButton].forEach(actor => this.header.add_child(actor));
            this._body.add_child(this._cover);
            this._body.add_child(this.header);
            this._body.add_child(this._progress);
            this._body.add_child(this._controls);
        }
        this._progress.add_child(this._times);
        this._updateLyricsVisibility();
        const floating = this._settings.get_boolean('show-floating');
        this._lyrics.accessible_name = floating ? 'Hide desktop lyrics' : 'Show desktop lyrics';
        this._lyrics.set_label(floating ? 'Desktop lyrics on' : 'Desktop lyrics');
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
        const style = STYLES[playerLayout(this._settings)];
        const f = this._settings.get_int('player-scale') / 100;
        const active = this._slider.hover || this._dragging;
        const p = this._palette;
        this._slider.style = `height: ${style.slider * f}px; ` +
            `-barlevel-height: ${(active ? 5 : 3) * f}px; -slider-handle-radius: ${(active ? 6 : 0) * f}px; ` +
            `color: ${p.foreground}; -barlevel-active-background-color: ${active ? p.accent : p.secondary};`;
    }

    _applySize() {
        const layout = playerLayout(this._settings);
        const horizontal = layout === 'horizontal';
        const style = STYLES[layout];
        const f = this._settings.get_int('player-scale') / 100;
        const px = value => `${value * f}px`;
        const width = style.width * f;
        this.actor.style = `spacing: ${px(8)};`;
        this._surface.style = `width: ${width}px; padding: ${px(style.padding)}; border-radius: ${px(style.radius)};`;
        this.header.style = `spacing: ${px(style.headerSpacing)};` + (horizontal ? '' : ` margin-top: ${px(12)};`);
        if (this._topRow) this._topRow.style = `spacing: ${px(12)};`;
        // The like button takes its room from the song details.
        const infoWidth = (horizontal ? 150 : style.cover) - (this._likeButton.visible ? style.utility + style.headerSpacing : 0);
        this._title.style = `font-size: ${px(style.title)}; max-width: ${px(infoWidth)};` + (horizontal ? '' : ' font-weight: bold;');
        this._artist.style = `font-size: ${px(style.artist)}; max-width: ${px(infoWidth)}; margin-top: ${px(2)};`;
        this._applyCover(style.cover * f, style.coverRadius * f);
        const [above, below] = style.controlMargin;
        this._controls.style = `spacing: ${px(style.controlSpacing)}; margin-top: ${px(above)}; margin-bottom: ${px(below)};`;
        for (const button of [this._prev, this._play, this._next, this._pin, this._prefs, this._likeButton]) {
            const utility = button === this._pin || button === this._prefs || button === this._likeButton;
            const size = utility ? style.utility : button === this._play ? style.play : style.step;
            const icon = utility ? 14 : button === this._play ? style.playIcon : style.mainIcon;
            button.style = `width: ${px(size)}; height: ${px(size)}; border-radius: ${px(utility ? 7 : size / 2)};`;
            button.child.icon_size = Math.round(icon * f);
            button.child.style = `icon-size: ${px(icon)};`;
        }
        this._progress.style = `spacing: ${px(2)}; margin-top: ${px(style.progressMargin)};`;
        this._times.style = `font-size: ${px(style.times)};`;
        this._footer.style = `spacing: ${px(style.footerSpacing)}; margin-top: ${px(horizontal ? 4 : 6)};`;
        this._lyrics.style = `font-size: ${px(style.lyricsLabel)}; padding: ${px(4)};`;
        this._credits.actor.style = `font-size: ${px(10)}; margin-top: ${px(horizontal ? 6 : 8)};`;
        this._lyricPanel.applySize(f, style.lyricsWidth * f);
    }

    // The cover is a rounded background picture when one is on disk, and an
    // icon otherwise.
    _applyCover(size, radius) {
        const image = this._artworkUri ? `background-image: url("${this._artworkUri}"); background-size: cover;` : '';
        this._cover.style = `width: ${size}px; height: ${size}px; border-radius: ${radius}px; ` +
            `background-color: rgba(255,255,255,0.08); ${image}`;
        this._coverIcon.visible = !this._artworkUri;
        this._coverIcon.icon_size = Math.round(this._coverGicon ? size : Math.min(size * 0.45, 48));
        this._coverIcon.style = `icon-size: ${this._coverIcon.icon_size}px;`;
    }

    _updateLyricsVisibility() {
        const show = this._settings.get_boolean('show-player-lyrics') && Boolean(this._lines?.length);
        this._lyricBox.visible = show;
        // Credits follow the lyrics: in their panel while it shows, and in
        // the player when it does not.
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
        const beside = this._lyricsSide === 'left' || this._lyricsSide === 'right';
        this._lyricPanel.setAvailableHeight(beside ? height : height - this._surface.get_preferred_height(-1)[1] - 8);
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

    /** @param {string} side 'above', 'below', 'left' or 'right' of the card */
    setLyricsSide(side) {
        if (this._lyricsSide === side) return;
        this._lyricsSide = side;
        if (this._detachLyrics) return;
        const beside = side === 'left' || side === 'right';
        this.actor.vertical = !beside;
        // Side by side, both start at the top instead of stretching to the
        // taller one.
        for (const actor of [this._surface, this._lyricBox])
            actor.y_align = beside ? Clutter.ActorAlign.START : Clutter.ActorAlign.FILL;
        this.actor.set_child_at_index(this._lyricBox, side === 'above' || side === 'left' ? 0 : 1);
    }

    setAttribution(attribution) {
        this._attribution = attribution;
        this._credits.setAttribution(attribution);
        this._lyricPanel.setAttribution(attribution);
        this._updateLyricsVisibility();
    }

    setArtwork({ gicon, palette, uri = null }) {
        this._artworkUri = uri;
        this._coverGicon = gicon;
        this._coverIcon.gicon = gicon;
        if (!gicon) this._coverIcon.icon_name = 'audio-x-generic-symbolic';
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
        this.lyricsActor?.destroy();
        this.lyricsActor = null;
    }
}
