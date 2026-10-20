import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotifyLyricsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 660);
        window.title = 'Spicy Lyra';
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

        const playerPage = page('Player', 'multimedia-player-symbolic');
        const playerAppearance = group(playerPage, 'Appearance', 'The background follows the album cover.');
        choice(playerAppearance, 'player-layout', 'Layout', 'Choose how the player is arranged.', [
            ['compact', 'Compact'], ['horizontal', 'Horizontal'],
        ]);
        const playerDesktop = group(playerPage, 'Desktop player', 'Keep your music controls within reach.');
        toggle(playerDesktop, 'player-pinned', 'Keep player on desktop', 'Drag the cover or song title to move it.');
        const resetPosition = new Adw.ActionRow({ title: 'Player position', subtitle: 'Move the player back to its starting position.' });
        const resetButton = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
        resetButton.connect('clicked', () => {
            settings.reset('player-x');
            settings.reset('player-y');
        });
        resetPosition.add_suffix(resetButton);
        resetPosition.activatable_widget = resetButton;
        playerDesktop.add(resetPosition);

        const lyricsPage = page('Lyrics', 'view-list-symbolic');
        const locations = group(lyricsPage, 'Show lyrics', 'Use either location, or both.');
        toggle(locations, 'show-in-panel', 'Top bar', 'Show the current line in the top bar.');
        toggle(locations, 'show-floating', 'Desktop', 'Show floating lyrics above your windows.');

        const floating = group(lyricsPage, 'Desktop lyrics');
        settings.bind('show-floating', floating, 'sensitive', Gio.SettingsBindFlags.GET);
        toggle(floating, 'animate-lyrics', 'Animate lyrics', 'Highlight characters when word timing is available. Otherwise, show normal lyrics.');
        choice(floating, 'hud-renderer', 'Display mode', 'Smooth supports character highlighting. Classic shows normal lines.', [
            ['smooth-gtk', 'Smooth'], ['clutter', 'Classic'],
        ]);
        choice(floating, 'floating-position', 'Position', 'Choose where desktop lyrics appear.', [
            ['top-right', 'Top right'], ['top-left', 'Top left'],
            ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'],
            ['center', 'Center'], ['custom', 'Custom'],
        ]);
        toggle(floating, 'floating-always-on-top', 'Keep above windows', 'Keep desktop lyrics visible while using other apps.');
        toggle(floating, 'floating-click-passthrough', 'Let clicks pass through', 'Click the windows behind the lyrics. Turn off to move the lyrics.');

        const text = group(lyricsPage, 'Text and background');
        choice(text, 'background-style', 'Background', '', [
            ['transparent', 'None'], ['blur', 'Soft dark'], ['dark-card', 'Solid dark'],
        ]);
        const font = new Adw.EntryRow({ title: 'Font', text: settings.get_string('font-family') });
        font.connect('changed', () => settings.set_string('font-family', font.text.trim() || 'Sans'));
        text.add(font);
        for (const [key, title, min, max] of [
            ['font-size', 'Text size', 10, 96], ['line-spacing', 'Line spacing', 0, 100],
        ]) {
            const row = new Adw.SpinRow({ title,
                adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: 1, page_increment: 4 }) });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            text.add(row);
        }
        toggle(text, 'enable-romanization', 'Show pronunciation', 'Add Latin text for supported non-Latin lyrics.');

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
        const keyHelp = new Adw.ActionRow({ title: 'Get a Spicy Lyrics key', subtitle: 'Spotify access tokens cannot be used here.' });
        keyHelp.add_suffix(new Gtk.LinkButton({ label: 'Open', uri: 'https://developers.spicylyrics.org/docs/keys', valign: Gtk.Align.CENTER }));
        extra.add(keyHelp);
        window.connect('close-request', () => {
            signals.forEach(id => settings.disconnect(id));
            signals.length = 0;
            return false;
        });
    }
}
