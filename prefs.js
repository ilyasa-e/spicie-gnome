import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { createLyricsPreview } from './lyricsPreview.js';
import { panelText } from './lyricsView.js';
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
        const group = (parent, title) => {
            const result = new Adw.PreferencesGroup({ title });
            parent.add(result);
            return result;
        };
        const toggle = (parent, key, title) => {
            const row = new Adw.SwitchRow({ title });
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };
        const choice = (parent, key, title, options) => {
            const row = new Adw.ComboRow({ title,
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
        toggle(locations, 'show-floating', 'Desktop lyrics');

        const context = group(lyricsPage, 'Visible lines');
        settings.bind('show-floating', context, 'sensitive', Gio.SettingsBindFlags.GET);
        const lines = new Adw.SpinRow({title: 'Lyric lines', digits: 0,
            adjustment: new Gtk.Adjustment({lower: 1, upper: 8, step_increment: 1, page_increment: 1})});
        settings.bind('floating-line-count', lines, 'value', Gio.SettingsBindFlags.DEFAULT);context.add(lines);
        toggle(context, 'show-countdown', 'Countdown dots');

        const placement = group(lyricsPage, 'Position and alignment');
        settings.bind('show-floating', placement, 'sensitive', Gio.SettingsBindFlags.GET);
        const preview = createLyricsPreview(settings);
        placement.add(preview.widget);
        choice(placement, 'floating-position', 'Screen position', [
            ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right'],
            ['center', 'Center'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom center'],
            ['bottom-right', 'Bottom right'], ['custom', 'Custom'],
        ]);
        choice(placement, 'lyrics-alignment', 'Text alignment', [
            ['vocals', 'By vocalist'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
        ]);
        const resetLyrics = new Adw.ActionRow({ title: 'Reset placement' });
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
            const row = new Adw.SpinRow({ title, digits: 0,
                adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: 1, page_increment: 4 }) });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);text.add(row);
        }
        choice(text, 'background-style', 'Background', [
            ['transparent', 'Transparent'], ['blur', 'Soft dark'], ['dark-card', 'Solid dark'],
        ]);
        toggle(text, 'enable-romanization', 'Show pronunciation');

        const behavior = group(lyricsPage, 'Playback and interaction');
        settings.bind('show-floating', behavior, 'sensitive', Gio.SettingsBindFlags.GET);
        toggle(behavior, 'animate-lyrics', 'Animate lyrics');
        toggle(behavior, 'floating-always-on-top', 'Keep above windows');
        toggle(behavior, 'floating-click-passthrough', 'Let clicks pass through');
        const moveLyrics = new Adw.ActionRow({ title: 'Move desktop lyrics' });
        const moveButton = new Gtk.Button({ label: 'Move', valign: Gtk.Align.CENTER });
        moveButton.connect('clicked', () => {
            settings.set_boolean('show-floating', true);
            settings.set_boolean('floating-click-passthrough', false);
            window.add_toast(new Adw.Toast({ title: 'Drag the lyrics to move them.' }));
        });
        moveLyrics.add_suffix(moveButton);moveLyrics.activatable_widget = moveButton;behavior.add(moveLyrics);

        const playerPage = page('Player', 'multimedia-player-symbolic');
        const playerAppearance = group(playerPage, 'Appearance');
        choice(playerAppearance, 'player-layout', 'Layout', [
            ['compact', 'Compact'], ['horizontal', 'Horizontal'],
        ]);
        const size = new Adw.SpinRow({title: 'Player size (%)', digits: 0,
            adjustment: new Gtk.Adjustment({lower: 70, upper: 150, step_increment: 5, page_increment: 10})});
        settings.bind('player-scale', size, 'value', Gio.SettingsBindFlags.DEFAULT);playerAppearance.add(size);
        const playerLyrics = group(playerPage, 'Horizontal lyrics');
        toggle(playerLyrics, 'show-player-lyrics', 'Show lyrics');
        const playerLines = new Adw.SpinRow({title: 'Visible lyric lines', digits: 0,
            adjustment: new Gtk.Adjustment({lower: 1, upper: 8, step_increment: 1, page_increment: 1})});
        settings.bind('player-lyric-lines', playerLines, 'value', Gio.SettingsBindFlags.DEFAULT);playerLyrics.add(playerLines);
        const refreshPlayerLyrics = () => {
            playerLyrics.sensitive = settings.get_string('player-layout') === 'horizontal';
            playerLines.sensitive = settings.get_boolean('show-player-lyrics');
        };
        refreshPlayerLyrics();
        for (const key of ['player-layout', 'show-player-lyrics'])
            signals.push(settings.connect(`changed::${key}`, refreshPlayerLyrics));
        const topBar = group(playerPage, 'Top bar');
        choice(topBar, 'panel-position', 'Top bar position', [['left', 'Left'], ['right', 'Right']]);
        toggle(topBar, 'panel-show-artist', 'Artist');
        toggle(topBar, 'panel-show-title', 'Song title');
        toggle(topBar, 'show-in-panel', 'Lyrics');
        const panelPreview = new Adw.ActionRow({title: 'Preview'});topBar.add(panelPreview);
        const refreshPanelPreview = () => {
            panelPreview.subtitle = panelText({artist: 'Artist', title: 'Song'}, 'Current lyric', {
                artist: settings.get_boolean('panel-show-artist'), title: settings.get_boolean('panel-show-title'),
                lyrics: settings.get_boolean('show-in-panel'),
            }) || 'Playback button only';
        };
        refreshPanelPreview();
        for (const key of ['panel-show-artist', 'panel-show-title', 'show-in-panel'])
            signals.push(settings.connect(`changed::${key}`, refreshPanelPreview));
        const playerDesktop = group(playerPage, 'Desktop player');
        toggle(playerDesktop, 'player-pinned', 'Keep player on desktop');
        const resetPosition = new Adw.ActionRow({ title: 'Player position' });
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
        standard.add(new Adw.ActionRow({ title: 'LRCLIB',
            icon_name: 'audio-x-generic-symbolic' }));
        const extra = group(sourcesPage, 'Synced sources');
        toggle(extra, 'enable-spicy-lyrics', 'Use Spicy Lyrics');
        const clientKey = new Adw.EntryRow({ title: 'Spicy Lyrics client key',
            text: settings.get_string('spicy-lyrics-client-key') });
        clientKey.connect('changed', () => settings.set_string('spicy-lyrics-client-key', clientKey.text.trim()));
        settings.bind('enable-spicy-lyrics', clientKey, 'sensitive', Gio.SettingsBindFlags.GET);
        extra.add(clientKey);
        const keyHelp = new Adw.ActionRow({ title: 'Get a client key' });
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
