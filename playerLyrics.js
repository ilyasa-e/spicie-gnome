import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { SourceCredits } from './sourceCredits.js';
import { lyricEntries, floatingFrame, countdownDots } from './lyricsView.js';
import { fontWeightValue } from './fontWeight.js';

export class PlayerLyrics {
    constructor(settings, getPosition = null, onLinkOpened = null) {
        this._settings = settings;
        this._getPosition = getPosition;
        this._lines = [];
        this._rows = [];
        this._following = true;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'spotify-lyrics-panel', reactive: true, visible: false});
        this._header = new St.BoxLayout({style_class: 'spotify-lyrics-panel-header'});
        this._heading = new St.Label({text: 'Lyrics', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const followContent = new St.BoxLayout({style_class: 'spotify-lyrics-follow-content'});
        this._followIcon = new St.Icon({icon_name: 'find-location-symbolic', icon_size: 12});
        followContent.add_child(this._followIcon);
        this._followLabel = new St.Label({text: 'Follow song'});
        followContent.add_child(this._followLabel);
        this._follow = new St.Button({child: followContent, style_class: 'spotify-lyrics-follow', can_focus: true,
            accessible_name: 'Follow the current lyric'});
        this._follow.connect('clicked', () => {
            this._following = true;
            this._follow.remove_style_pseudo_class('checked');
            this._scheduleFollow();
        });
        this._header.add_child(this._heading);this._header.add_child(this._follow);
        this.actor.add_child(this._header);
        this._scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true,
            style_class: 'spotify-lyrics-scroll'});
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        this._scroll.set_child(this._list);
        const stopFollowing = () => {
            this._following = false;
            this._follow.add_style_pseudo_class('checked');
            return Clutter.EVENT_PROPAGATE;
        };
        this._scroll.connect('scroll-event', stopFollowing);
        this._scroll.connect('button-press-event', stopFollowing);
        this.actor.add_child(this._scroll);
        this._credits = new SourceCredits(onLinkOpened);
        this._credits.actor.add_style_class_name('spotify-player-source-credits');
        this.actor.add_child(this._credits.actor);
        this.actor.connect('notify::mapped', () => {
            this._syncDotAnimation();
            if (this.actor.mapped) this._scheduleFollow();
        });
        this._list.connect('notify::allocation', () => this._scheduleFollow());
    }

    setLines(lines) {
        this._lines = lines || [];
        this._entries = lyricEntries(this._lines, this._settings.get_boolean('show-countdown'));
        this._list.destroy_all_children();
        this._following = true;
        this._focusId = null;
        this._rows = this._entries.map(entry => {
            const actor = entry.kind === 'filler' ? new St.DrawingArea({x_expand: true, visible: false}) :
                new St.Label({text: entry.line.words || entry.line.text, x_expand: true});
            if (entry.kind === 'lyric') {
                actor.clutter_text.set_line_wrap(true);
                actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            } else actor.connect('repaint', () => this._paintDots(actor, entry));
            this._list.add_child(actor);
            return {entry, actor};
        });
        this.applySize(this._scale || 1, this._width || 320);
        this.updatePosition(this._position || 0, true);
    }

    // The card's cover colours. Kept here because every resize rebuilds the
    // inline style, and new lyrics resize the panel.
    setColors(style) {
        this._colors = style;
        this.applySize(this._scale || 1, this._width || 320);
    }

    applySize(scale, width) {
        this._scale = scale;this._width = width;
        this.actor.style = `padding: ${12 * scale}px; border-radius: ${12 * scale}px; width: ${width}px; spacing: ${8 * scale}px; ${this._colors || ''}`;
        this._header.style = `font-size: ${11 * scale}px;`;
        this._follow.style = `padding: ${3 * scale}px; font-size: ${10 * scale}px; border-radius: ${4 * scale}px;`;
        this._followIcon.icon_size = Math.round(12 * scale);
        this._credits.actor.style = `font-size: ${10 * scale}px; margin-top: ${4 * scale}px;`;
        const weight = fontWeightValue(this._settings.get_string('player-lyrics-font-weight'));
        for (const {entry, actor} of this._rows) {
            if (entry.kind === 'filler') {
                // St.DrawingArea draws inside its content box, so label padding
                // would shrink the canvas and clip the dots. Size the drawing
                // surface itself instead.
                actor.style = '';
                actor.height = Math.round(40 * scale);
                continue;
            }
            actor.style = `font-size: ${16 * scale}px; font-weight: ${weight}; padding: ${10 * scale}px 0;`;
        }
        this._scheduleFollow();
    }

    setAttribution(value) { this._credits.setAttribution(value); }

    setPlaying(playing) { this._playing = playing;this._syncDotAnimation(); }

    _syncDotAnimation() {
        const run = this.actor.mapped && this._playing && this._filler && this._settings.get_boolean('animate-lyrics');
        if (!run) { this._dotsTimeline?.stop();this._dotsTimeline = null;return; }
        if (this._dotsTimeline) return;
        this._dotsTimeline = new Clutter.Timeline({duration: 4000, repeat_count: -1, actor: this.actor});
        this._dotsTimeline.connect('new-frame', () => {
            this._rows.find(row => row.entry.id === this._filler?.id)?.actor.queue_repaint();
        });
        this._dotsTimeline.start();
    }

    setAvailableHeight(height) {
        const chrome = this._header.get_preferred_height(this._width)[1] +
            (this._credits.actor.visible ? this._credits.actor.get_preferred_height(this._width)[1] : 0) + 48 * this._scale;
        const available = Math.max(32 * this._scale, height - chrome);
        if (this._maxHeight !== available) { this._maxHeight = available;this._scheduleFollow(); }
    }

    updatePosition(position, immediate = false) {
        this._position = position;
        const frame = floatingFrame(this._lines, position, 1, this._settings.get_boolean('show-countdown'));
        this._filler = frame.filler;
        this._syncDotAnimation();
        const focusId = frame.filler?.id || `line:${Math.max(0, frame.activeIndex)}`;
        for (const {entry, actor} of this._rows) {
            if (entry.kind === 'filler') {
                actor.visible = frame.filler?.id === entry.id;
                if (actor.visible && this.actor.mapped) actor.queue_repaint();
            } else {
                const active = frame.rows.some(row => row.id === entry.id && row.state === 'active');
                const opacity = active ? 255 : 155;
                if (actor._lyricOpacity !== opacity) {
                    actor._lyricOpacity = opacity;
                    actor.ease({opacity, duration: immediate ? 0 : 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                }
            }
        }
        if (focusId !== this._focusId || immediate) {
            this._focusId = focusId;
            this._snapFollow = immediate || Math.abs(position - (this._lastPosition ?? position)) > 1500;
            this._scheduleFollow();
        }
        this._lastPosition = position;
    }

    _scheduleFollow() {
        if (this._idle || !this.actor.visible || !this.actor.mapped) return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._followCurrent();
            return GLib.SOURCE_REMOVE;
        });
    }

    _followCurrent() {
        if (!this.actor.mapped) return;
        const visible = this._rows.filter(row => row.actor.visible);
        const count = this._settings.get_int('player-lyric-lines');
        const focus = Math.max(0, visible.findIndex(row => row.entry.id === this._focusId));
        const start = Math.max(0, focus - (count >= 3 ? 1 : 0));
        // The countdown row is extra: it must not take the place of a lyric
        // line, otherwise enabling it silently drops a visible line.
        const chosen = [];
        let lyrics = 0;
        for (const row of visible.slice(start)) {
            if (row.entry.kind === 'lyric' && lyrics++ >= count) break;
            chosen.push(row);
        }
        const height = chosen.reduce((total, row) => total +
            row.actor.get_preferred_height(this._list.width || this._width)[1], 0);
        // Reserve the chosen number of source rows; wrapped words keep their full height.
        this._scroll.height = Math.min(this._maxHeight || Infinity, Math.max(32 * this._scale, Math.ceil(height)));
        if (!this._following || !visible.length) return;
        const target = visible[start].actor;
        const adjustment = this._scroll.vadjustment;
        const value = Math.max(0, Math.min(target.y, adjustment.upper - adjustment.page_size));
        if (Math.abs(adjustment.value - value) > 0.5) {
            adjustment.ease(value, {duration: this._snapFollow ? 0 : 320, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        this._snapFollow = false;
    }

    _paintDots(actor, entry) {
        const cr = actor.get_context();
        const scale = this._scale || 1;
        const radius = 7 * scale;
        const step = 24 * scale;
        // The canvas is the drawing area's content box. Derive the geometry
        // from it so the dots stay inside and share the lyric text origin.
        const height = actor.height || Math.round(40 * scale);
        const centerY = height / 2;
        countdownDots(entry, this._getPosition?.() ?? this._position, this._settings.get_boolean('animate-lyrics')).forEach((dot, index) => {
            cr.arc(radius + index * step, centerY - dot.lift * radius, radius, 0, Math.PI * 2);
            cr.setSourceRGBA(1, 1, 1, dot.alpha);cr.fill();
        });
        cr.$dispose();
    }

    destroy() {
        if (this._idle) GLib.Source.remove(this._idle);
        this._dotsTimeline?.stop();this._dotsTimeline = null;
        this.actor.destroy();
    }
}
