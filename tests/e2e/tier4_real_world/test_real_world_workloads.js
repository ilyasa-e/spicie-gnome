/**
 * Tier 4: Real-World Workload Scenarios
 */

import { describe, it, expect, sleep } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { MockNetworkSession } from '../harness/mock_network.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_MPRIS_DATA } from '../fixtures/sample_mpris_data.js';

export function runRealWorldWorkloadTests() {
    describe('Tier 4: Real-World Workload Scenarios', () => {
        it('T4.1: Full song playback simulation with pause, resume, and seek', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.standardTrack });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            const lyrics = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'full_song_1');
            ext._sync.setLyrics(lyrics.lines);

            // 1. Play intro (0s - 35s)
            ext._sync.updatePosition(10000);
            expect(ext._sync.getCurrentIndex()).toBe(0);

            // 2. Sung line 1 (36s)
            ext._sync.updatePosition(36000);
            expect(ext._sync.getCurrentIndex()).toBe(1);
            expect(ext._indicator.label.get_text()).toBe('Look at the stars');

            // 3. Pause at 45s
            proxy.setPlaybackStatus('Paused');
            ext._sync.updatePosition(45000);
            const pausedIndex = ext._sync.getCurrentIndex();

            // While paused, position stays frozen
            await sleep(20);
            expect(ext._sync.getCurrentIndex()).toBe(pausedIndex);

            // 4. Resume playback
            proxy.setPlaybackStatus('Playing');

            // 5. User seeks to 70s
            proxy.simulateSeek(70000);
            ext._sync.updatePosition(70000);
            expect(ext._sync.getCurrentIndex()).toBe(10); // "So then I took my turn"

            // 6. Track completes (267s)
            ext._sync.updatePosition(267000);
            expect(ext._sync.getCurrentIndex()).toBe(lyrics.lines.length - 1);

            ext.disable();
        });

        it('T4.2: Multilingual playlist queue progression (English -> Korean -> Japanese -> Cyrillic -> Instrumental)', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings({ 'enable-romanization': true });
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            const playlist = [
                { meta: SAMPLE_MPRIS_DATA.standardTrack, title: 'Yellow', artist: 'Coldplay', dur: 267, sampleCheck: 'Look at the stars' },
                { meta: SAMPLE_MPRIS_DATA.koreanTrack, title: 'Ditto', artist: 'NewJeans', dur: 185, sampleCheck: 'malhaejwo' },
                { meta: SAMPLE_MPRIS_DATA.japaneseTrack, title: 'アイドル', artist: 'YOASOBI', dur: 213, sampleCheck: 'media' },
                { meta: SAMPLE_MPRIS_DATA.cyrillicTrack, title: 'Группа крови', artist: 'КИНО', dur: 285, sampleCheck: 'Teploe' },
                { meta: { 'mpris:trackid': '/track/inst', 'xesam:title': 'YYZ', 'xesam:artist': ['Rush'], 'mpris:length': 266000000 }, title: 'YYZ', artist: 'Rush', dur: 266, isInst: true }
            ];

            for (const item of playlist) {
                proxy.setMetadata(item.meta);
                const l = await ext._provider.fetchLyrics(item.title, item.artist, 'Album', item.dur, item.meta['mpris:trackid']);

                if (item.isInst) {
                    expect(l.instrumental).toBe(true);
                } else {
                    ext._sync.setLyrics(l.lines);
                    expect(l.lines.length).toBeGreaterThan(0);
                    // Verify romanized or original content matches expectation
                    const allText = l.lines.map(line => (line.words + ' ' + (line.romanized || ''))).join(' ');
                    expect(allText).toContain(item.sampleCheck);
                }
            }

            ext.disable();
        });

        it('T4.3: Network disconnect and resilience recovery across songs', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Track 1: Online
            const t1 = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Album', 267, 't1');
            expect(t1.lines.length).toBeGreaterThan(0);

            // Network drops offline
            net.isOffline = true;
            const t2 = await ext._provider.fetchLyrics('Ditto', 'NewJeans', 'Album', 185, 't2');
            expect(t2.lines.length).toBe(0); // Graceful fallback to 0 lines, no crash

            // Network restores
            net.isOffline = false;
            const t3 = await ext._provider.fetchLyrics('アイドル', 'YOASOBI', 'Album', 213, 't3');
            expect(t3.lines.length).toBeGreaterThan(0);

            ext.disable();
        });

        it('T4.4: Dynamic live preference customization during ongoing playback', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.standardTrack });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            const lyrics = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'pref_song');
            ext._sync.setLyrics(lyrics.lines);
            ext._sync.updatePosition(36000);

            // Active line is playing
            expect(ext._indicator.label.get_text()).toBe('Look at the stars');

            // 1. User changes HUD background
            settings.set_string('background-style', 'dark-card');
            expect(ext._hud._actor.style_class).toContain('background-dark-card');

            // 2. User changes position to bottom-right
            settings.set_string('floating-position', 'bottom-right');
            expect(ext._hud._actor.x).toBe(1480);

            // 3. User enables click passthrough
            settings.set_boolean('floating-click-passthrough', true);
            expect(ext._hud._actor.reactive).toBe(false);

            // 4. Position tick continues without interruption
            ext._sync.updatePosition(39000);
            expect(ext._sync.getCurrentIndex()).toBe(2);
            expect(ext._hud._activeLabel.get_text()).toBe('Look how they shine for you');

            ext.disable();
        });

        it('T4.5: Late extension enablement during active mid-song playback', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            // Spotify is already at 50,000ms (50s) when extension starts
            const proxy = new MockSpotifyDBusProxy({
                playbackStatus: 'Playing',
                positionUs: 50000000,
                metadata: SAMPLE_MPRIS_DATA.standardTrack
            });
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            // Enable extension
            ext.enable();

            const lyrics = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'late_start');
            ext._sync.setLyrics(lyrics.lines);

            // Current position from MPRIS is ~50,000ms
            const currentPos = ext._mpris.getPositionMs();
            expect(currentPos).toBeGreaterThanOrEqual(50000);

            ext._sync.updatePosition(currentPos);
            // At 50s, line 5 ("Yeah, they were all yellow", starts at 47880ms) should be active
            expect(ext._sync.getCurrentIndex()).toBe(5);
            expect(ext._hud._activeLabel.get_text()).toBe('Yeah, they were all yellow');

            ext.disable();
        });

        it('T4.6: Rapid skip marathon stress test (10 tracks in rapid succession)', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);
            ext.enable();

            // Rapid skipping 10 times
            for (let i = 0; i < 10; i++) {
                const trackData = {
                    'mpris:trackid': `/com/spotify/track/rapid_${i}`,
                    'xesam:title': `Rapid Song ${i}`,
                    'xesam:artist': [`Rapid Artist ${i}`],
                    'mpris:length': 180000000
                };
                proxy.setMetadata(trackData);
                await ext._mpris.next();
            }

            expect(proxy.methodCalls.filter(c => c.method === 'Next').length).toBe(10);

            // Settle on final track
            proxy.setMetadata(SAMPLE_MPRIS_DATA.standardTrack);
            const finalLyrics = await ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'final_rapid');
            ext._sync.setLyrics(finalLyrics.lines);
            ext._sync.updatePosition(36000);

            expect(ext._hud._activeLabel.get_text()).toBe('Look at the stars');

            ext.disable();
        });
    });
}
