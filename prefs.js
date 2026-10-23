import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { createLyricsPreview } from './lyricsPreview.js';
import { panelText } from './lyricsView.js';
import { FONT_WEIGHTS } from './fontWeight.js';
import { SPOTIFY_REDIRECT_URI, LIKE_SONGS_ENABLED } from './spotifyLibrary.js';
import { connectSpotify } from './spotifyAuth.js';
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
        const resetRow = (parent, title, keys) => {
            const row = new Adw.ActionRow({ title });
            const button = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'] });
            button.connect('clicked', () => keys.forEach(key => settings.reset(key)));
            row.add_suffix(button);
            row.activatable_widget = button;
            parent.add(row);
            return row;
        };
        const spin = (parent, key, title, lower, upper) => {
            const row = new Adw.SpinRow({ title, digits: 0,
                adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1, page_increment: 4 }) });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };

        // --- General: everything that applies to every lyric surface ---
        const generalPage = page('General', 'emblem-system-symbolic');

        const sources = group(generalPage, 'Lyrics source');
        sources.add(new Adw.ActionRow({ title: 'LRCLIB',
            subtitle: 'Line-synced lyrics, no account needed',
            icon_name: 'audio-x-generic-symbolic' }));
        toggle(sources, 'enable-spicy-lyrics', 'Use Spicy Lyrics');
        const clientKey = new Adw.EntryRow({ title: 'Spicy Lyrics client key',
            text: settings.get_string('spicy-lyrics-client-key') });
        clientKey.connect('changed', () => settings.set_string('spicy-lyrics-client-key', clientKey.text.trim()));
        settings.bind('enable-spicy-lyrics', clientKey, 'sensitive', Gio.SettingsBindFlags.GET);
        sources.add(clientKey);
        const keyHelp = new Adw.ActionRow({ title: 'Get a client key' });
        keyHelp.add_suffix(new Gtk.LinkButton({ label: 'Open', uri: 'https://developers.spicylyrics.org/docs/keys', valign: Gtk.Align.CENTER }));
        sources.add(keyHelp);

        const shared = group(generalPage, 'Text');
        toggle(shared, 'enable-romanization', 'Romanize Korean, Japanese and Cyrillic');
        toggle(shared, 'show-countdown', 'Countdown dots before the next lyric');
        toggle(shared, 'animate-lyrics', 'Animate lyrics');

        // --- Desktop lyrics: only the floating overlay ---
        const lyricsPage = page('Desktop lyrics', 'view-list-symbolic');

        const overlay = group(lyricsPage, 'Overlay');
        toggle(overlay, 'show-floating', 'Show desktop lyrics');
        // Lines only describes the overlay, but the toggle above must stay
        // clickable, so the gate is per row rather than per group.
        settings.bind('show-floating', spin(overlay, 'floating-line-count', 'Lines', 1, 8),
            'sensitive', Gio.SettingsBindFlags.GET);

        const placement = group(lyricsPage, 'Position and alignment');
        settings.bind('show-floating', placement, 'sensitive', Gio.SettingsBindFlags.GET);
        const preview = createLyricsPreview(settings);
        placement.add(preview.widget);
        choice(placement, 'floating-position', 'Screen position', [
            ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right'],
            ['center', 'Center'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom center'],
            ['bottom-right', 'Bottom right'], ['custom', 'Custom'],
        ]);
        choice(placement, 'lyrics-alignment', 'Desktop text alignment', [
            ['vocals', 'By vocalist'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
        ]);
        // Moving the window is a placement action, so the command lives here.
        const moveLyrics = new Adw.ActionRow({ title: 'Move lyrics' });
        const moveButton = new Gtk.Button({ valign: Gtk.Align.CENTER });
        const refreshMove = () => {
            const moving = settings.get_boolean('floating-moving');
            moveButton.label = moving ? 'Done' : 'Move';
            moveButton.css_classes = moving ? ['suggested-action'] : [];
            moveLyrics.subtitle = moving ? 'Drag the outlined lyrics on the desktop, then click Done' : '';
        };
        moveButton.connect('clicked', () => {
            const moving = !settings.get_boolean('floating-moving');
            if (moving) settings.set_boolean('show-floating', true);
            settings.set_boolean('floating-moving', moving);
        });
        signals.push(settings.connect('changed::floating-moving', refreshMove));
        refreshMove();
        moveLyrics.add_suffix(moveButton);moveLyrics.activatable_widget = moveButton;placement.add(moveLyrics);
        resetRow(placement, 'Reset placement', ['floating-position', 'floating-x', 'floating-y', 'lyrics-alignment']);

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
        const weights = FONT_WEIGHTS.map(([value, label]) => [value, label]);
        choice(text, 'font-weight', 'Font weight', weights);
        spin(text, 'font-size', 'Text size', 10, 96);
        spin(text, 'line-spacing', 'Line spacing', 0, 100);
        choice(text, 'background-style', 'Background', [
            ['transparent', 'Transparent'], ['blur', 'Soft dark'], ['dark-card', 'Solid dark'],
        ]);

        const behavior = group(lyricsPage, 'Window behavior');
        settings.bind('show-floating', behavior, 'sensitive', Gio.SettingsBindFlags.GET);
        toggle(behavior, 'floating-always-on-top', 'Keep above windows');
        toggle(behavior, 'floating-click-passthrough', 'Let clicks pass through');

        // --- Player: popup card, pinned card, and the top bar indicator ---
        const playerPage = page('Player', 'multimedia-player-symbolic');
        const playerAppearance = group(playerPage, 'Layout');
        choice(playerAppearance, 'player-layout', 'Layout', [
            ['compact', 'Compact'], ['horizontal', 'Horizontal'],
        ]);
        spin(playerAppearance, 'player-scale', 'Player size (%)', 70, 150);

        const playerLyrics = group(playerPage, 'Lyrics in the player');
        toggle(playerLyrics, 'show-player-lyrics', 'Show lyrics');
        const playerLines = spin(playerLyrics, 'player-lyric-lines', 'Lines', 1, 8);
        const playerWeight = choice(playerLyrics, 'player-lyrics-font-weight', 'Font weight', weights);
        const refreshPlayerLyrics = () => {
            // The card renders its lyrics list beside the controls, so the rows
            // only apply to that layout.
            playerLyrics.sensitive = settings.get_string('player-layout') === 'horizontal';
            playerLines.sensitive = settings.get_boolean('show-player-lyrics');
            playerWeight.sensitive = playerLines.sensitive;
        };
        refreshPlayerLyrics();
        for (const key of ['player-layout', 'show-player-lyrics'])
            signals.push(settings.connect(`changed::${key}`, refreshPlayerLyrics));

        // Liking needs the user's own Spotify app: Spotify's media interface
        // has no library calls, and a shared client ID would be capped.
        let stopSignIn = null;
        if (LIKE_SONGS_ENABLED) {
            const likes = group(playerPage, 'Like songs');
            likes.description = 'Shows a heart in the player. Create a Spotify app, add the redirect URI below to it, then paste its client ID.';
            const spotifyId = new Adw.EntryRow({ title: 'Spotify client ID', text: settings.get_string('spotify-client-id') });
            spotifyId.connect('changed', () => {
                const value = spotifyId.text.trim();
                if (value === settings.get_string('spotify-client-id')) return;
                settings.set_string('spotify-client-id', value);
                // A token belongs to the app that issued it.
                settings.set_string('spotify-refresh-token', '');
            });
            likes.add(spotifyId);
            const redirect = new Adw.ActionRow({ title: 'Redirect URI', subtitle: SPOTIFY_REDIRECT_URI, subtitle_selectable: true });
            const copy = new Gtk.Button({ icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER,
                tooltip_text: 'Copy', css_classes: ['flat'] });
            copy.connect('clicked', () => {
                copy.get_clipboard().set(SPOTIFY_REDIRECT_URI);
                window.add_toast(new Adw.Toast({ title: 'Redirect URI copied' }));
            });
            redirect.add_suffix(copy);
            likes.add(redirect);
            const dashboard = new Adw.ActionRow({ title: 'Spotify app dashboard' });
            dashboard.add_suffix(new Gtk.LinkButton({ label: 'Open', uri: 'https://developer.spotify.com/dashboard', valign: Gtk.Align.CENTER }));
            likes.add(dashboard);
            const account = new Adw.ActionRow({ title: 'Spotify account' });
            const accountButton = new Gtk.Button({ valign: Gtk.Align.CENTER });
            account.add_suffix(accountButton);
            likes.add(account);
            const refreshAccount = (waiting = false) => {
                const connected = Boolean(settings.get_string('spotify-refresh-token'));
                account.subtitle = waiting ? 'Waiting for the browser…' : connected ? 'Connected' : 'Not connected';
                accountButton.label = waiting ? 'Cancel' : connected ? 'Disconnect' : 'Connect';
                accountButton.css_classes = connected && !waiting ? ['destructive-action'] : ['suggested-action'];
                accountButton.sensitive = waiting || connected || Boolean(settings.get_string('spotify-client-id'));
            };
            accountButton.connect('clicked', () => {
                if (stopSignIn) { stopSignIn(); stopSignIn = null; refreshAccount(); return; }
                if (settings.get_string('spotify-refresh-token')) { settings.set_string('spotify-refresh-token', ''); return; }
                stopSignIn = connectSpotify(settings, {
                    onDone: () => { stopSignIn = null; refreshAccount(); window.add_toast(new Adw.Toast({ title: 'Spotify connected' })); },
                    onError: e => { stopSignIn = null; refreshAccount(); window.add_toast(new Adw.Toast({ title: e.message })); },
                });
                refreshAccount(Boolean(stopSignIn));
            });
            refreshAccount();
            for (const key of ['spotify-client-id', 'spotify-refresh-token'])
                signals.push(settings.connect(`changed::${key}`, () => refreshAccount(Boolean(stopSignIn))));
        }

        const playerDesktop = group(playerPage, 'Desktop player');
        toggle(playerDesktop, 'player-pinned', 'Keep player on desktop');
        resetRow(playerDesktop, 'Player position', ['player-x', 'player-y']);

        const topBar = group(playerPage, 'Top bar');
        choice(topBar, 'panel-position', 'Position', [['left', 'Left'], ['right', 'Right']]);
        toggle(topBar, 'show-in-panel', 'Lyric line');
        toggle(topBar, 'panel-show-artist', 'Artist');
        toggle(topBar, 'panel-show-title', 'Song title');
        choice(topBar, 'panel-font-weight', 'Font weight', weights);
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

        window.connect('close-request', () => {
            // Moving is a temporary mode of this window, never a saved state.
            settings.set_boolean('floating-moving', false);
            stopSignIn?.();
            preview.destroy();
            signals.forEach(id => settings.disconnect(id));
            signals.length = 0;
            return false;
        });
    }
}
