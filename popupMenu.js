import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class SpotifyLyricsPopup {
    constructor(menu, settings, mpris, onOpenPrefs) {
        this._menu = menu;
        this._settings = settings;
        this._mpris = mpris;
        this._onOpenPrefs = onOpenPrefs;

        this._lines = [];
        this._lineActors = [];
        this._activeIndex = -1;
        this._scrollTimeout = null;

        this._buildUI();
    }

    _buildUI() {
        // Container
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'spotify-popup-container',
        });

        // 1. Header: Track Info & Controls
        this._headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'spotify-popup-header',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const trackInfoBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'spotify-popup-track-info',
        });

        this._titleLabel = new St.Label({
            text: 'Spotify Not Playing',
            style_class: 'spotify-popup-title',
        });
        this._artistLabel = new St.Label({
            text: 'Start playback in Spotify',
            style_class: 'spotify-popup-artist',
        });

        trackInfoBox.add_child(this._titleLabel);
        trackInfoBox.add_child(this._artistLabel);
        this._headerBox.add_child(trackInfoBox);

        // Playback Buttons
        const controlsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'spotify-popup-controls',
        });

        this._btnPrev = new St.Button({
            style_class: 'button spotify-control-btn',
            child: new St.Icon({ icon_name: 'media-skip-backward-symbolic' }),
        });
        this._btnPrev.connect('clicked', () => this._mpris?.previous());

        this._btnPlay = new St.Button({
            style_class: 'button spotify-control-btn spotify-play-btn',
            child: new St.Icon({ icon_name: 'media-playback-start-symbolic' }),
        });
        this._btnPlay.connect('clicked', () => this._mpris?.playPause());

        this._btnNext = new St.Button({
            style_class: 'button spotify-control-btn',
            child: new St.Icon({ icon_name: 'media-skip-forward-symbolic' }),
        });
        this._btnNext.connect('clicked', () => this._mpris?.next());

        controlsBox.add_child(this._btnPrev);
        controlsBox.add_child(this._btnPlay);
        controlsBox.add_child(this._btnNext);
        this._headerBox.add_child(controlsBox);

        this._mainBox.add_child(this._headerBox);

        // Divider
        this._mainBox.add_child(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Lyrics Scroll View
        this._scrollView = new St.ScrollView({
            style_class: 'spotify-popup-lyrics-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_mouse_scrolling: true,
            y_expand: true,
        });

        this._lyricsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'spotify-popup-lyrics-list',
        });
        this._scrollView.add_child(this._lyricsBox);
        this._mainBox.add_child(this._scrollView);

        // Divider
        this._mainBox.add_child(new PopupMenu.PopupSeparatorMenuItem());

        // 3. Quick Toggles / Settings Footer
        this._footerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'spotify-popup-footer',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Floating HUD toggle button
        this._btnToggleFloating = new St.Button({
            style_class: 'button spotify-footer-btn',
            x_expand: true,
            label: 'Floating HUD',
        });
        this._btnToggleFloating.connect('clicked', () => {
            if (this._settings) {
                const cur = this._settings.get_boolean('show-floating');
                this._settings.set_boolean('show-floating', !cur);
                this._updateToggles();
            }
        });

        // Click passthrough toggle button
        this._btnTogglePassthrough = new St.Button({
            style_class: 'button spotify-footer-btn',
            x_expand: true,
            label: 'Passthrough',
        });
        this._btnTogglePassthrough.connect('clicked', () => {
            if (this._settings) {
                const cur = this._settings.get_boolean('floating-click-passthrough');
                this._settings.set_boolean('floating-click-passthrough', !cur);
                this._updateToggles();
            }
        });

        // Settings / Preferences icon button
        this._btnPrefs = new St.Button({
            style_class: 'button spotify-control-btn',
            child: new St.Icon({ icon_name: 'emblem-system-symbolic' }),
        });
        this._btnPrefs.connect('clicked', () => {
            this._menu?.close();
            if (typeof this._onOpenPrefs === 'function') {
                this._onOpenPrefs();
            }
        });

        this._footerBox.add_child(this._btnToggleFloating);
        this._footerBox.add_child(this._btnTogglePassthrough);
        this._footerBox.add_child(this._btnPrefs);
        this._mainBox.add_child(this._footerBox);

        // Attach to GNOME panel menu
        const menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
        });
        menuItem.add_child(this._mainBox);
        this._menu.addMenuItem(menuItem);

        this._updateToggles();
    }

    _updateToggles() {
        if (!this._settings) return;
        const floating = this._settings.get_boolean('show-floating');
        const passthrough = this._settings.get_boolean('floating-click-passthrough');

        this._btnToggleFloating.set_label(floating ? 'HUD: ON' : 'HUD: OFF');
        this._btnTogglePassthrough.set_label(passthrough ? 'Click: Pass' : 'Click: Grab');
    }

    updateMetadata(track, isPlaying) {
        if (!track || !track.title) {
            this._titleLabel.text = 'Spotify Not Playing';
            this._artistLabel.text = 'Waiting for track...';
            return;
        }

        this._titleLabel.text = track.title;
        this._artistLabel.text = track.artist || 'Unknown Artist';

        const playIcon = this._btnPlay?.get_child();
        if (playIcon) {
            playIcon.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        }
        this._updateToggles();
    }

    setLyrics(lines) {
        this._lines = lines || [];
        this._lineActors = [];
        this._lyricsBox.destroy_all_children();

        if (this._lines.length === 0) {
            const emptyLabel = new St.Label({
                text: 'Lyrics not available for this track',
                style_class: 'spotify-popup-empty-label',
            });
            this._lyricsBox.add_child(emptyLabel);
            return;
        }

        this._lines.forEach((item, idx) => {
            const lineButton = new St.Button({
                style_class: 'spotify-popup-lyric-item',
                reactive: true,
                x_expand: true,
            });

            const text = (item.words || '♪').trim();
            const label = new St.Label({
                text: text,
                style_class: 'spotify-popup-lyric-text',
            });
            lineButton.set_child(label);

            lineButton.connect('clicked', () => {
                if (this._mpris && typeof item.startTimeMs === 'number') {
                    this._mpris.setPosition(item.startTimeMs);
                }
            });

            this._lineActors.push(lineButton);
            this._lyricsBox.add_child(lineButton);
        });
    }

    setActiveLine(activeIndex) {
        if (activeIndex === this._activeIndex) return;
        this._activeIndex = activeIndex;

        this._lineActors.forEach((actor, idx) => {
            if (idx === activeIndex) {
                actor.add_style_pseudo_class('active');
                this._scrollToActor(actor);
            } else {
                actor.remove_style_pseudo_class('active');
            }
        });
    }

    _scrollToActor(actor) {
        if (!actor || !this._scrollView) return;
        const adj = this._scrollView.get_vscroll_bar()?.get_adjustment();
        if (!adj) return;

        const [, actorY] = actor.get_transformed_position();
        const [, scrollY] = this._scrollView.get_transformed_position();
        const offset = actorY - scrollY;
        const target = adj.get_value() + offset - (this._scrollView.get_height() / 2) + (actor.get_height() / 2);

        adj.set_value(Math.max(0, Math.min(adj.get_upper() - adj.get_page_size(), target)));
    }

    destroy() {
        if (this._scrollTimeout) {
            GLib.Source.remove(this._scrollTimeout);
            this._scrollTimeout = null;
        }
        this._mainBox?.destroy();
    }
}
