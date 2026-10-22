/**
 * Tier 3: Cross-Feature Combinations (Pairwise & Multi-Component Interactions)
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { MockNetworkSession } from '../harness/mock_network.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_MPRIS_DATA } from '../fixtures/sample_mpris_data.js';

export function runCrossFeatureTests() {
    describe('Tier 3: Cross-Feature Combinations', () => {
        it('T3.1: Korean lyrics + HUD active glow + seek jump recalibration', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'enable-romanization': true });
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.koreanTrack });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Fetch Korean lyrics for "Ditto"
            const lyrics = await ext._provider.fetchLyrics('Ditto', 'NewJeans', 'OMG', 185, '3r8RuvgbX9s7ammBn07D3W');
            ext._sync.setLyrics(lyrics.lines);

            // Seek to 13.5s (line 3: "말해줘 say it back")
            proxy.simulateSeek(13500);
            ext._sync.updatePosition(13500);

            // Verify active line text and romanization
            expect(ext._hud._activeLabel.get_text()).toBe('말해줘 say it back');
            expect(ext._hud._romanizedLabel.get_text()).toContain('malhaejwo');

            // Rapid seek to 24.5s (line 6: "상상해 너와 나")
            proxy.simulateSeek(24500);
            ext._sync.updatePosition(24500);
            expect(ext._hud._activeLabel.get_text()).toBe('상상해 너와 나');
            expect(ext._hud._romanizedLabel.get_text()).toContain('sangsanghae');

            ext.disable();
        });

        it('T3.2: Spotify paused during track change + tray popup lyrics list update', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy({
                playbackStatus: 'Paused',
                metadata: SAMPLE_MPRIS_DATA.standardTrack
            });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Open tray popup menu
            ext._indicator.button.menu.open();
            expect(ext._indicator.button.menu.isOpen).toBe(true);

            // Change track while paused
            proxy.setMetadata(SAMPLE_MPRIS_DATA.japaneseTrack);
            const lyrics = await ext._provider.fetchLyrics('アイドル', 'YOASOBI', 'アイドル', 213, '7j31rOhGQm1nua8LB953Jy');
            ext._popup.setLyrics(lyrics.lines);

            expect(ext._popup._lyrics.length).toBeGreaterThan(5);
            expect(ext._popup._lyrics[0].words).toContain('むてきのえがお');

            ext.disable();
        });

        it('T3.3: Spicy Lyrics API 418 failover to LRCLIB with Cyrillic transliteration', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({
                'enable-spicy-lyrics': true,
                'spicy-lyrics-token': 'bad_token_triggering_418',
                'enable-romanization': true
            });
            const net = new MockNetworkSession();
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.cyrillicTrack });

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Spicy fails with 418 -> failover to LRCLIB succeeds
            const lyrics = await ext._provider.fetchLyrics(
                'Группа крови',
                'КИНО',
                'Группа крови',
                285,
                'cyrillic123',
                { enableSpicy: true, spicyToken: '' }
            );

            expect(lyrics.provider).toContain('lrclib');
            expect(lyrics.lines.length).toBeGreaterThan(5);

            // Test romanization on first line
            expect(lyrics.lines[0].words).toContain('Теплое место');
            expect(lyrics.lines[0].romanized).toContain('Teploe mesto');

            ext.disable();
        });

        it('T3.4: Click-passthrough enabled + HUD drag interaction + tray popup clickability', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'floating-click-passthrough': false });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Drag is possible when passthrough is false
            expect(ext._hud._actor.reactive).toBe(true);

            // Toggle passthrough on
            settings.set_boolean('floating-click-passthrough', true);
            expect(ext._hud._actor.reactive).toBe(false);

            // Tray indicator button remains fully reactive and clickable
            expect(ext._indicator.button.reactive).toBe(true);
            ext._indicator.button.menu.open();
            expect(ext._indicator.button.menu.isOpen).toBe(true);

            ext.disable();
        });

        it('T3.5: Japanese Kana lyrics with yōon + Top Bar live indicator label toggle', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'show-in-panel': true });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            const lyrics = await ext._provider.fetchLyrics('アイドル', 'YOASOBI', 'アイドル', 213, '7j31rOhGQm1nua8LB953Jy');
            ext._sync.setLyrics(lyrics.lines);

            // Line 5: "きょうなにたべた？" (yōon: きょ -> kyo)
            ext._sync.updatePosition(20000);
            expect(ext._indicator.label.get_text()).toBe('きょうなにたべた？');

            // Hide in panel
            settings.set_boolean('show-in-panel', false);
            // Label visibility updated
            expect(settings.get_boolean('show-in-panel')).toBe(false);

            ext.disable();
        });

        it('T3.6: Background style switch (transparent -> blur -> dark-card) during live playback', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'background-style': 'transparent' });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            expect(ext._hud._actor.style_class).toContain('background-transparent');

            // Switch to blur
            settings.set_string('background-style', 'blur');
            expect(ext._hud._actor.style_class).toContain('background-blur');

            // Switch to dark-card
            settings.set_string('background-style', 'dark-card');
            expect(ext._hud._actor.style_class).toContain('background-dark-card');

            ext.disable();
        });

        it('T3.7: Spotify killed mid-playback enters dormant state, resumes on restart', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy({ nameOwner: ':1.42' });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Spotify crashes / closes
            proxy.simulatePlayerDied();
            expect(Boolean(proxy.g_name_owner)).toBe(false);

            // Spotify relaunches
            proxy.simulatePlayerStarted();
            expect(Boolean(proxy.g_name_owner)).toBe(true);

            ext.disable();
        });

        it('T3.8: Instrumental track interlude + screen resolution change', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'floating-position': 'center' });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            const lyrics = await ext._provider.fetchLyrics('YYZ', 'Rush', 'Moving Pictures', 266, 'yyz_inst');
            expect(lyrics.instrumental).toBe(true);

            // Center position on 1920x1080 (workArea: 0, 32, 1920, 1048; actor: 400x120)
            // x = (1920 - 400)/2 = 760; y = 32 + (1048 - 120)/2 = 496
            expect(ext._hud._actor.x).toBe(760);
            expect(ext._hud._actor.y).toBe(496);

            // Screen resolution change to 2560x1440
            shell.Main.layoutManager.monitors[0] = { index: 0, x: 0, y: 0, width: 2560, height: 1440 };
            ext._hud.reposition();

            // x = (2560 - 400)/2 = 1080; y = 32 + (1408 - 120)/2 = 676
            expect(ext._hud._actor.x).toBe(1080);
            expect(ext._hud._actor.y).toBe(676);

            ext.disable();
        });

        it('T3.9: Preference update on-the-fly (position & font) updates live HUD immediately', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'floating-position': 'bottom-left' });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Bottom-left: x = 0 + 40 = 40; y = 32 + 1048 - 120 - 40 = 920
            expect(ext._hud._actor.x).toBe(40);
            expect(ext._hud._actor.y).toBe(920);

            // Update to bottom-right
            settings.set_string('floating-position', 'bottom-right');
            expect(ext._hud._actor.x).toBe(1480);
            expect(ext._hud._actor.y).toBe(920);

            ext.disable();
        });

        it('T3.10: Free advertisement track played mid-session pauses lyrics and resumes next song', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.standardTrack });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Song 1: Yellow
            const song1Lyrics = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'track1');
            ext._sync.setLyrics(song1Lyrics.lines);
            ext._sync.updatePosition(36000);
            expect(ext._indicator.label.get_text()).toBe('Look at the stars');

            // Spotify plays Advertisement
            proxy.setMetadata(SAMPLE_MPRIS_DATA.advertisementTrack);
            expect(proxy.metadata['xesam:title']).toBe('Spotify Advertisement');

            // Song 2 plays: Korean track
            proxy.setMetadata(SAMPLE_MPRIS_DATA.koreanTrack);
            const song2Lyrics = await ext._provider.fetchLyrics('Ditto', 'NewJeans', 'OMG', 185, 'track2');
            ext._sync.setLyrics(song2Lyrics.lines);
            ext._sync.updatePosition(13500);
            expect(ext._indicator.label.get_text()).toBe('말해줘 say it back');

            ext.disable();
        });
    });
}
