import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
        this._contentBox.add_child(this._romajiLabel);
        this._contentBox.add_child(this._nextLabel);

        // Drag action support
        this._setupDrag();

        // Add to GNOME TopChrome (stays above standard windows)
        Main.layoutManager.addTopChrome(this._container);

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

        // Position
        this._reposition();
    }

    _reposition() {
        if (!this._container || !this._settings) return;

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const posMode = this._settings.get_string('floating-position');
        const width = this._container.width || 420;
        const height = this._container.height || 160;

        let targetX = monitor.x + monitor.width - width - 60;
        let targetY = monitor.y + 80;

        switch (posMode) {
            case 'top-left':
                targetX = monitor.x + 60;
                targetY = monitor.y + 80;
                break;
            case 'bottom-left':
                targetX = monitor.x + 60;
                targetY = monitor.y + monitor.height - height - 80;
                break;
            case 'bottom-right':
                targetX = monitor.x + monitor.width - width - 60;
                targetY = monitor.y + monitor.height - height - 80;
                break;
            case 'center':
                targetX = monitor.x + Math.round((monitor.width - width) / 2);
                targetY = monitor.y + Math.round((monitor.height - height) / 2);
                break;
            case 'custom':
                targetX = this._settings.get_int('floating-x');
                targetY = this._settings.get_int('floating-y');
                // Boundary clamp
                targetX = Math.max(monitor.x, Math.min(monitor.x + monitor.width - 100, targetX));
                targetY = Math.max(monitor.y, Math.min(monitor.y + monitor.height - 60, targetY));
                break;
            case 'top-right':
            default:
                targetX = monitor.x + monitor.width - width - 60;
                targetY = monitor.y + 80;
                break;
        }

        this._container.set_position(targetX, targetY);
    }

    updateLine(activeLine, activeIndex, allLines) {
        this._activeLine = activeLine;
        this._allLines = allLines || [];

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
    }

    destroy() {
        if (this._settings && this._settingsSignals.length > 0) {
            this._settingsSignals.forEach(sid => this._settings.disconnect(sid));
            this._settingsSignals = [];
        }

        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
        }
    }
}
