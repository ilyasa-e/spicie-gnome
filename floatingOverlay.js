import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { floatingPosition, lineAlignment, activeVocalLines } from './lyricsPresentation.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SourceCredits } from './sourceCredits.js';

export class DesktopFloatingHUD {
    constructor(settings) {
        this._settings = settings;
        this._container = null;
        this._dragAction = null;
        this._activeLine = null;
        this._allLines = [];
        this._settingsSignals = [];

        this._buildHUD();
        this._bindSettings();
    }

    _buildHUD() {
        this._container = new St.Widget({
            name: 'SpotifyFloatingLyricsHUD',
            style_class: 'spotify-floating-hud',
            reactive: true,
            track_hover: true,
            can_focus: false,
        });

        // Box holding lyrics lines
        this._contentBox = new St.BoxLayout({
            vertical: true,
            style_class: 'spotify-floating-content',
        });
        this._container.add_child(this._contentBox);

        // Previous Line
        this._prevLabel = new St.Label({
            text: '',
            style_class: 'spotify-floating-line spotify-floating-prev',
        });
        // Active Line
        this._activeLabel = new St.Label({
            text: '♪ Spicie',
            style_class: 'spotify-floating-line spotify-floating-active',
        });
        // Romanization Label
        this._romajiLabel = new St.Label({
            text: '',
            style_class: 'spotify-floating-romaji',
            visible: false,
        });
        // Next Line
        this._nextLabel = new St.Label({
            text: '',
            style_class: 'spotify-floating-line spotify-floating-next',
        });

        this._contentBox.add_child(this._prevLabel);
        this._contentBox.add_child(this._activeLabel);
        this._voiceBox = new St.BoxLayout({ vertical: true });
        this._voiceLabels = [];
        this._contentBox.add_child(this._voiceBox);
        this._contentBox.add_child(this._romajiLabel);
        this._contentBox.add_child(this._nextLabel);
        this._credits = new SourceCredits();
        this._contentBox.add_child(this._credits.actor);

        // Drag action support
        this._setupDrag();

        // Add to GNOME TopChrome (stays above standard windows)
        Main.layoutManager.addTopChrome(this._container);

        this._container.connect('notify::width', () => this._queueReposition());
        this._container.connect('notify::height', () => this._queueReposition());
        this.applySettings();
    }

    _setupDrag() {
        this._isDragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._initialActorX = 0;
        this._initialActorY = 0;

        this._container.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) { // Left click
                const passthrough = this._settings ? this._settings.get_boolean('floating-click-passthrough') : false;
                if (passthrough) return Clutter.EVENT_PROPAGATE;

                this._isDragging = true;
                const [stageX, stageY] = event.get_coords();
                this._dragStartX = stageX;
                this._dragStartY = stageY;
                const [curX, curY] = this._container.get_position();
                this._initialActorX = curX;
                this._initialActorY = curY;
                this._container.add_style_pseudo_class('dragging');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._container.connect('motion-event', (actor, event) => {
            if (this._isDragging) {
                const [stageX, stageY] = event.get_coords();
                const deltaX = stageX - this._dragStartX;
                const deltaY = stageY - this._dragStartY;
                const newX = Math.round(this._initialActorX + deltaX);
                const newY = Math.round(this._initialActorY + deltaY);
                this._container.set_position(newX, newY);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._container.connect('button-release-event', (actor, event) => {
            if (this._isDragging && event.get_button() === 1) {
                this._isDragging = false;
                this._container.remove_style_pseudo_class('dragging');
                const [x, y] = this._container.get_position();
                if (this._settings) {
                    this._settings.set_string('floating-position', 'custom');
                    this._settings.set_int('floating-x', Math.round(x));
                    this._settings.set_int('floating-y', Math.round(y));
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _bindSettings() {
        if (!this._settings) return;

        const keys = [
            'show-floating',
            'floating-position',
            'floating-x',
            'floating-y',
            'floating-click-passthrough',
            'floating-always-on-top',
            'font-family',
            'font-size',
            'line-spacing',
            'background-style',
            'enable-romanization',
            'hud-renderer',
            'lyrics-alignment',
        ];

        keys.forEach(key => {
            const sid = this._settings.connect(`changed::${key}`, () => this.applySettings());
            this._settingsSignals.push(sid);
        });
    }

    applySettings() {
        if (!this._container || !this._settings) return;

        const showFloating = this._settings.get_boolean('show-floating');
        const renderer = this._settings.get_string('hud-renderer');
        this._container.visible = showFloating && renderer === 'clutter';
        if (!this._container.visible) return;

        // Passthrough click
        const passthrough = this._settings.get_boolean('floating-click-passthrough');
        this._container.reactive = !passthrough;

        // Background Style
        const bgStyle = this._settings.get_string('background-style'); // 'transparent', 'blur', 'dark-card'
        this._container.remove_style_class_name('bg-transparent');
        this._container.remove_style_class_name('bg-blur');
        this._container.remove_style_class_name('bg-dark-card');
        this._container.add_style_class_name(`bg-${bgStyle}`);

        // Typography & Spacing
        const fontFamily = this._settings.get_string('font-family') || 'Sans';
        const fontSize = this._settings.get_int('font-size') || 22;
        const lineSpacing = this._settings.get_int('line-spacing') || 14;

        this._activeLabel.style = `font-family: "${fontFamily}", sans-serif; font-size: ${fontSize}px; margin-bottom: ${Math.round(lineSpacing / 2)}px;`;
        this._prevLabel.style = `font-family: "${fontFamily}", sans-serif; font-size: ${Math.round(fontSize * 0.72)}px; margin-bottom: ${Math.round(lineSpacing / 2)}px;`;
        this._nextLabel.style = `font-family: "${fontFamily}", sans-serif; font-size: ${Math.round(fontSize * 0.72)}px; margin-top: ${Math.round(lineSpacing / 2)}px;`;
        this._romajiLabel.style = `font-family: "${fontFamily}", sans-serif; font-size: ${Math.round(fontSize * 0.58)}px;`;

        this.updatePosition(this._positionMs || 0);
        // Position
        this._reposition();
    }

    _queueReposition() {
        if (this._repositionId) return;
        this._repositionId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._repositionId = 0;
            this._reposition();
            return GLib.SOURCE_REMOVE;
        });
    }

    _reposition() {
        if (!this._container || !this._settings || !this._container.get_stage()) return;

        const index = Main.layoutManager.primaryIndex;
        if (index < 0) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(index);
        const { x, y } = floatingPosition(area, this._container.width || 420, this._container.height || 160,
            this._settings.get_string('floating-position'), this._settings.get_int('floating-x'), this._settings.get_int('floating-y'));
        if (this._container.x !== x || this._container.y !== y) this._container.set_position(x, y);
    }

    _alignLabel(label, line) {
        const alignment = lineAlignment(this._settings?.get_string('lyrics-alignment') || 'vocals', line);
        const style = (label.style || '').replace(/ text-align: [^;]+;/g, '') + ` text-align: ${alignment};`;
        if (label.style !== style) label.style = style;
        label.clutter_text.set_line_alignment(({left:Pango.Alignment.LEFT,center:Pango.Alignment.CENTER,right:Pango.Alignment.RIGHT})[alignment]);
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }

    updatePosition(positionMs) {
        this._positionMs = positionMs;
        const voices = activeVocalLines(this._allLines, positionMs);
        this._activeLine = voices[0] || null;
        this._credits.actor.visible = Boolean(this._attribution && voices.length);
        this._voiceBox.visible = voices.length > 1;
        if (voices.length > 1) { this._prevLabel.text = ''; this._nextLabel.text = ''; }
        this._voiceLabels.forEach((label, i) => { label.visible = i < voices.length - 1; });
        if (voices.length) {
            this._activeLabel.text = voices[0].words || voices[0].text || '';
            this._alignLabel(this._activeLabel, voices[0]);
            voices.slice(1).forEach((line, i) => {
                if (!this._voiceLabels[i]) {
                    this._voiceLabels[i] = new St.Label({ style_class: 'spotify-floating-line spotify-floating-active' });
                    this._voiceBox.add_child(this._voiceLabels[i]);
                }
                const label = this._voiceLabels[i];
                label.text = line.words || line.text || '';
                const style = (this._activeLabel.style || '').replace(/ text-align: [^;]+;/g, '');
                if (!(label.style || '').startsWith(style)) label.style = style;
                this._alignLabel(label, line);
                label.show();
            });
        }
    }

    updateLine(activeLine, activeIndex, allLines) {
        this._activeLine = activeLine;
        this._allLines = allLines || [];
        this._voiceBox.visible = false;
        this._credits.actor.visible = Boolean(this._attribution && activeLine && activeIndex >= 0);

        if (!activeLine || activeIndex < 0) {
            this._prevLabel.text = '';
            this._activeLabel.text = '♪';
            this._romajiLabel.text = '';
            this._romajiLabel.visible = false;
            this._nextLabel.text = '';
            return;
        }

        // Active Line text
        const text = (activeLine.words || '').trim();
        this._activeLabel.text = text || '♪';

        // Romanization
        const enableRomaji = this._settings ? this._settings.get_boolean('enable-romanization') : true;
        if (enableRomaji && activeLine.romanized && activeLine.romanized !== text) {
            this._romajiLabel.text = activeLine.romanized;
            this._romajiLabel.visible = true;
        } else {
            this._romajiLabel.visible = false;
        }

        // Adjacent Lines
        const prev = this._allLines[activeIndex - 1];
        this._prevLabel.text = prev ? (prev.words || '').trim() : '';

        const next = this._allLines[activeIndex + 1];
        this._nextLabel.text = next ? (next.words || '').trim() : '';
        this._alignLabel(this._prevLabel, prev);
        this._alignLabel(this._nextLabel, next);
        this._alignLabel(this._romajiLabel, activeLine);
        this.updatePosition(this._positionMs ?? activeLine.startTimeMs ?? activeLine.timeMs ?? 0);
    }

    setAttribution(attribution) {
        this._attribution = attribution;
        this._credits.setAttribution(attribution);
        this._credits.actor.visible = Boolean(attribution && this._activeLine);
    }

    destroy() {
        if (this._settings && this._settingsSignals.length > 0) {
            this._settingsSignals.forEach(sid => this._settings.disconnect(sid));
            this._settingsSignals = [];
        }

        if (this._repositionId) GLib.Source.remove(this._repositionId);
        this._repositionId = 0;
        if (this._container) {
            const container = this._container;
            this._container = null;
            Main.layoutManager.removeChrome(container);
            container.destroy();
        }
    }
}
