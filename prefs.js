import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotifyLyricsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ==========================================
        // PAGE 1: Display & Behavior
        // ==========================================
        const displayPage = new Adw.PreferencesPage({
            title: 'Display & Behavior',
            icon_name: 'video-display-symbolic',
        });
        window.add(displayPage);

        // Group 1: Presentation Surfaces
        const surfacesGroup = new Adw.PreferencesGroup({
            title: 'Presentation Surfaces',
            description: 'Choose where Spotify lyrics appear on your desktop',
        });
        displayPage.add(surfacesGroup);

        // Switch: Top Bar Panel
        const panelRow = new Adw.SwitchRow({
            title: 'Show Lyric in Top Bar Panel',
            subtitle: 'Displays current sung line directly in the GNOME status bar',
        });
        settings.bind('show-in-panel', panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        surfacesGroup.add(panelRow);

        // Switch: Desktop Floating Overlay
        const floatingRow = new Adw.SwitchRow({
            title: 'Show Desktop Floating HUD',
            subtitle: 'Floating synchronized multi-line lyrics overlay across windows',
        });
        settings.bind('show-floating', floatingRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        surfacesGroup.add(floatingRow);

        // ComboRow: Renderer Engine
        const rendererRow = new Adw.ComboRow({
            title: 'Floating Renderer Engine',
            subtitle: 'Choose between 60 FPS smooth sweep GTK4 or native GNOME Clutter',
        });
        const rendererModel = new Gtk.StringList();
        rendererModel.append('Smooth GTK4 (60 FPS Karaoke)');
        rendererModel.append('In-Shell Clutter Actor');
        rendererRow.model = rendererModel;
        const currentRenderer = settings.get_string('hud-renderer');
        rendererRow.selected = currentRenderer === 'clutter' ? 1 : 0;
        rendererRow.connect('notify::selected', () => {
            settings.set_string('hud-renderer', rendererRow.selected === 1 ? 'clutter' : 'smooth-gtk');
        });
        surfacesGroup.add(rendererRow);

        // ComboRow: Position Preset
        const positionRow = new Adw.ComboRow({
            title: 'Floating Position',
            subtitle: 'Screen corner anchor for the desktop lyrics HUD',
        });
        const posModel = new Gtk.StringList();
        const positions = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center', 'custom'];
        const positionLabels = ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left', 'Center', 'Custom Drag'];
        positionLabels.forEach(p => posModel.append(p));
        positionRow.model = posModel;

        const currentPos = settings.get_string('floating-position');
        const posIndex = positions.indexOf(currentPos);
        positionRow.selected = posIndex >= 0 ? posIndex : 0;
        positionRow.connect('notify::selected', () => {
            settings.set_string('floating-position', positions[positionRow.selected]);
        });
        surfacesGroup.add(positionRow);

        // Switch: Always on Top
        const aotRow = new Adw.SwitchRow({
            title: 'Always on Top',
            subtitle: 'Keep floating lyrics pinned above all application windows',
        });
        settings.bind('floating-always-on-top', aotRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        surfacesGroup.add(aotRow);

        // Switch: Click Passthrough
        const passRow = new Adw.SwitchRow({
            title: 'Click Passthrough',
            subtitle: 'Allow mouse clicks to pass through lyrics directly to windows below',
        });
        settings.bind('floating-click-passthrough', passRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        surfacesGroup.add(passRow);


        // ==========================================
        // PAGE 2: Appearance & Providers
        // ==========================================
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance & Providers',
            icon_name: 'preferences-desktop-font-symbolic',
        });
        window.add(appearancePage);

        // Group 2: Typography & Styling
        const stylingGroup = new Adw.PreferencesGroup({
            title: 'Typography & Backdrop',
            description: 'Customize typography and glassmorphism styling',
        });
        appearancePage.add(stylingGroup);

        // Background Style
        const bgRow = new Adw.ComboRow({
            title: 'Background Backdrop',
            subtitle: 'Visual treatment behind floating lyrics',
        });
        const bgModel = new Gtk.StringList();
        const bgStyles = ['transparent', 'blur', 'dark-card'];
        const bgLabels = ['100% Invisible Transparent', 'Frosted Glass Blur', 'Subtle Dark Pill Card'];
        bgLabels.forEach(l => bgModel.append(l));
        bgRow.model = bgModel;

        const currentBg = settings.get_string('background-style');
        const bgIdx = bgStyles.indexOf(currentBg);
        bgRow.selected = bgIdx >= 0 ? bgIdx : 0;
        bgRow.connect('notify::selected', () => {
            settings.set_string('background-style', bgStyles[bgRow.selected]);
        });
        stylingGroup.add(bgRow);

        // Font Family
        const fontRow = new Adw.EntryRow({
            title: 'Font Family',
            text: settings.get_string('font-family') || 'Sans',
        });
        fontRow.connect('changed', () => {
            settings.set_string('font-family', fontRow.text.trim() || 'Sans');
        });
        stylingGroup.add(fontRow);

        // Font Size
        const fontSizeRow = new Adw.SpinRow({
            title: 'Font Size (px)',
            adjustment: new Gtk.Adjustment({
                lower: 12,
                upper: 48,
                step_increment: 1,
                page_increment: 4,
                value: settings.get_int('font-size') || 22,
            }),
        });
        settings.bind('font-size', fontSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        stylingGroup.add(fontSizeRow);

        // Line Spacing
        const spacingRow = new Adw.SpinRow({
            title: 'Line Spacing (px)',
            adjustment: new Gtk.Adjustment({
                lower: 4,
                upper: 36,
                step_increment: 1,
                page_increment: 2,
                value: settings.get_int('line-spacing') || 14,
            }),
        });
        settings.bind('line-spacing', spacingRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        stylingGroup.add(spacingRow);

        // Romanization Switch
        const romajiRow = new Adw.SwitchRow({
            title: 'Transliterate Asian & Cyrillic Scripts',
            subtitle: 'Show Romaji/Pinyin/Latin pronunciation for Korean (Hangul), Japanese (Kana), and Cyrillic',
        });
        settings.bind('enable-romanization', romajiRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        stylingGroup.add(romajiRow);

        // Group 3: Spicy Lyrics API (Apple Music Syllables)
        const spicyGroup = new Adw.PreferencesGroup({
            title: 'Apple Music Syllable Lyrics (Spicy Lyrics)',
            description: 'Optional Apple Music TTML syllable karaoke integration',
        });
        appearancePage.add(spicyGroup);

        const spicyToggleRow = new Adw.SwitchRow({
            title: 'Enable Spicy Lyrics Provider',
            subtitle: 'Attempts to fetch word-by-word Apple Music TTML lyrics when available',
        });
        settings.bind('enable-spicy-lyrics', spicyToggleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        spicyGroup.add(spicyToggleRow);

        const tokenRow = new Adw.PasswordEntryRow({
            title: 'Spotify Web Access Token',
            text: settings.get_string('spicy-lyrics-token') || '',
        });
        tokenRow.connect('changed', () => {
            settings.set_string('spicy-lyrics-token', tokenRow.text.trim());
        });
        spicyGroup.add(tokenRow);
    }
}
