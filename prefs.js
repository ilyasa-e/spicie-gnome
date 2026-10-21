import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { createLyricsPreview } from './lyricsPreview.js';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotifyLyricsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 760);
        window.set_search_enabled(true);
        window.title = 'Spicie';
        const signals = [];
        const page = (title, icon) => {
            const result = new Adw.PreferencesPage({ title, name: title.toLowerCase(), icon_name: icon });
            window.add(result);
            return result;
        };
        const group = (parent, title, description = '') => {
            const result = new Adw.PreferencesGroup({ title, description });
            parent.add(result);
            return result;
        };
        const toggle = (parent, key, title, subtitle) => {
            const row = new Adw.SwitchRow({ title, subtitle });
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };
        const choice = (parent, key, title, subtitle, options) => {
            const row = new Adw.ComboRow({ title, subtitle,
                model: Gtk.StringList.new(options.map(option => option[1])) });
            const refresh = () => {
                row.selected = Math.max(0, options.findIndex(option => option[0] === settings.get_string(key)));
            };
            refresh();
            row.connect('notify::selected', () => {
                const option = options[row.selected];
                if (option && settings.get_string(key) !== option[0]) settings.set_string(key, option[0]);
            });
            signals.push(settings.connect(`changed::${key}`, refresh));
            parent.add(row);
            return row;
        };

        const lyricsPage = page('Lyrics', 'view-list-symbolic');
        const locations = group(lyricsPage, 'Show lyrics');
        toggle(locations, 'show-floating', 'Desktop lyrics', 'Show lyrics in a floating window.');
        toggle(locations, 'show-in-panel', 'Top bar lyrics', 'Show the current line while Spotify is open.');
        toggle(locations, 'show-player-lyrics', 'Player lyrics', 'Show the current line inside the player.');
        choice(locations, 'panel-position', 'Top bar position', '', [['left', 'Left'], ['right', 'Right']]);

        const placement = group(lyricsPage, 'Position and alignment', 'Position moves the window. Alignment arranges the words inside it.');
        settings.bind('show-floating', placement, 'sensitive', Gio.SettingsBindFlags.GET);
        const preview = createLyricsPreview(settings);
        placement.add(preview.widget);
        choice(placement, 'floating-position', 'Screen position', '', [
            ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right'],
            ['center', 'Center'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom center'],
            ['bottom-right', 'Bottom right'], ['custom', 'Custom'],
        ]);
        choice(placement, 'lyrics-alignment', 'Text alignment', 'By vocalist follows the source. Without vocalist positions, text stays centered.', [
            ['vocals', 'By vocalist'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
        ]);
        const resetLyrics = new Adw.ActionRow({ title: 'Reset placement', subtitle: 'Top center with automatic vocalist alignment.' });
        const resetLyricsButton = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
        resetLyricsButton.connect('clicked', () => {
            for (const key of ['floating-position', 'floating-x', 'floating-y', 'lyrics-alignment']) settings.reset(key);
        });
        resetLyrics.add_suffix(resetLyricsButton);resetLyrics.activatable_widget = resetLyricsButton;placement.add(resetLyrics);

        const text = group(lyricsPage, 'Text and background');
        settings.bind('show-floating', text, 'sensitive', Gio.SettingsBindFlags.GET);
        const fontRow = new Adw.ActionRow({ title: 'Font' });
        const fontButton = new Gtk.FontDialogButton({ dialog: new Gtk.FontDialog({ title: 'Choose a font' }),
            level: Gtk.FontLevel.FAMILY, font_desc: Pango.FontDescription.from_string(settings.get_string('font-family')),
            valign: Gtk.Align.CENTER });
        fontButton.connect('notify::font-desc', () => {
            const family = fontButton.font_desc?.get_family();
            if (family && settings.get_string('font-family') !== family) settings.set_string('font-family', family);
        });
        signals.push(settings.connect('changed::font-family', () => {
            if (fontButton.font_desc?.get_family() !== settings.get_string('font-family'))
                fontButton.font_desc = Pango.FontDescription.from_string(settings.get_string('font-family'));
        }));
        fontRow.add_suffix(fontButton);fontRow.activatable_widget = fontButton;text.add(fontRow);
        for (const [key, title, min, max] of [
            ['font-size', 'Text size', 10, 96], ['line-spacing', 'Line spacing', 0, 100],
        ]) {
            const row = new Adw.SpinRow({ title, subtitle: 'Pixels', digits: 0,
                adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: 1, page_increment: 4 }) });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);text.add(row);
        }
        choice(text, 'background-style', 'Background', '', [
            ['transparent', 'Transparent'], ['blur', 'Soft dark'], ['dark-card', 'Solid dark'],
        ]);
        toggle(text, 'enable-romanization', 'Show pronunciation', 'Add Latin text when available.');

        const behavior = group(lyricsPage, 'Playback and interaction');
        settings.bind('show-floating', behavior, 'sensitive', Gio.SettingsBindFlags.GET);
        toggle(behavior, 'animate-lyrics', 'Animate lyrics', 'Use character highlighting when the source has word timing.');
        toggle(behavior, 'floating-always-on-top', 'Keep above windows', 'Keep desktop lyrics visible over other apps.');
        toggle(behavior, 'floating-click-passthrough', 'Let clicks pass through', 'Turn off to drag the lyrics to a custom position.');
        const moveLyrics = new Adw.ActionRow({ title: 'Move desktop lyrics', subtitle: 'Allow dragging by turning off click-through.' });
        const moveButton = new Gtk.Button({ label: 'Move', valign: Gtk.Align.CENTER });
        moveButton.connect('clicked', () => {
            settings.set_boolean('show-floating', true);
            settings.set_boolean('floating-click-passthrough', false);
            window.add_toast(new Adw.Toast({ title: 'Drag the lyrics to move them.' }));
        });
        moveLyrics.add_suffix(moveButton);moveLyrics.activatable_widget = moveButton;behavior.add(moveLyrics);

        const playerPage = page('Player', 'multimedia-player-symbolic');
        const playerAppearance = group(playerPage, 'Appearance', 'The background follows the album cover.');
        choice(playerAppearance, 'player-layout', 'Layout', 'Compact uses a small cover and stacked controls.', [
            ['compact', 'Compact'], ['horizontal', 'Horizontal'],
        ]);
        const playerDesktop = group(playerPage, 'Desktop player', 'Keep your music controls within reach.');
        toggle(playerDesktop, 'player-pinned', 'Keep player on desktop', 'Drag the cover, title, or empty background to move it.');
        const resetPosition = new Adw.ActionRow({ title: 'Player position', subtitle: 'Move the player back to its starting position.' });
        const resetButton = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
        resetButton.connect('clicked', () => {
            settings.reset('player-x');
            settings.reset('player-y');
        });
        resetPosition.add_suffix(resetButton);
        resetPosition.activatable_widget = resetButton;
        playerDesktop.add(resetPosition);

        const sourcesPage = page('Sources', 'network-server-symbolic');
        const standard = group(sourcesPage, 'Default source');
        standard.add(new Adw.ActionRow({ title: 'LRCLIB', subtitle: 'Lyrics are fetched automatically. No sign-in needed.',
            icon_name: 'audio-x-generic-symbolic' }));
        const extra = group(sourcesPage, 'Word timing', 'Use Spicy Lyrics for word-by-word timing when available.');
        toggle(extra, 'enable-spicy-lyrics', 'Use Spicy Lyrics', 'Falls back to the default source when unavailable.');
        const token = new Adw.PasswordEntryRow({ title: 'Spicy Lyrics key',
            text: settings.get_string('spicy-lyrics-token') });
        token.connect('changed', () => settings.set_string('spicy-lyrics-token', token.text.trim()));
        settings.bind('enable-spicy-lyrics', token, 'sensitive', Gio.SettingsBindFlags.GET);
        extra.add(token);
        const keyHelp = new Adw.ActionRow({ title: 'Get a Spicy Lyrics key', subtitle: 'Keep your key private. Shared apps must use a client key.' });
        keyHelp.add_suffix(new Gtk.LinkButton({ label: 'Open', uri: 'https://developers.spicylyrics.org/docs/keys', valign: Gtk.Align.CENTER }));
        extra.add(keyHelp);
        window.connect('close-request', () => {
            preview.destroy();
            signals.forEach(id => settings.disconnect(id));
            signals.length = 0;
            return false;
        });
    }
}
