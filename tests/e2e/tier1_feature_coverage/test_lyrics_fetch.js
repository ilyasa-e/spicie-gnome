/**
 * Tier 1: Feature Coverage - Lyrics Fetching & Multi-source API
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockNetworkSession } from '../harness/mock_network.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_LYRICS } from '../fixtures/sample_lyrics.js';

export function runLyricsFetchTests() {
    describe('Tier 1: Multi-Source Lyrics Fetching', () => {
        it('T1.6: LRCLIB exact match fetch succeeds and returns parsed lines', async () => {
            const net = new MockNetworkSession();
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass(net);

            const result = await provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, '5JESuE80fvausWHjcT9QVh');
            expect(result.provider).toBe('lrclib');
            expect(result.lines.length).toBeGreaterThan(5);
            expect(result.lines[1].words).toBe('Look at the stars');
            expect(result.lines[1].startTimeMs).toBe(35660);

            provider.destroy();
        });

        it('T1.7: LRCLIB search fallback triggers when exact match returns 404', async () => {
            const net = new MockNetworkSession();
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass(net);

            // Title that will miss exact lookup but match search query
            const result = await provider.fetchLyrics('Yellow (Remastered)', 'Coldplay', 'Album', 267, 'search123');
            expect(result.provider).toBe('lrclib_search');
            expect(result.lines.length).toBeGreaterThan(5);

            provider.destroy();
        });

        it('T1.8: Spicy Lyrics provider fetches syllable-level lyrics when enabled with a client key', async () => {
            const net = new MockNetworkSession();
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass(net);

            const result = await provider.fetchLyrics(
                'Yellow',
                'Coldplay',
                'Parachutes',
                267,
                '5JESuE80fvausWHjcT9QVh',
                { enableSpicy: true, spicyClientKey: 'sl_pk_test_client_key' }
            );

            expect(result.provider).toBe('spicy_lyrics');
            expect(result.lines.length).toBeGreaterThan(0);
            expect(result.lines[0].words).toBe('Look at the stars');
            expect(result.lines[0].syllables.length).toBeGreaterThan(1);

            provider.destroy();
        });

        it('T1.9: Parses standard [mm:ss.xx] and centisecond timestamps into millisecond intervals', async () => {
            const net = new MockNetworkSession();
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass(net);

            const sample = `[00:10.50] First Line\n[00:15.00] Second Line\n[00:20.75] Third Line`;
            const parsed = provider.parseLRC(sample, 30000);

            expect(parsed.length).toBe(3);
            expect(parsed[0].startTimeMs).toBe(10500);
            expect(parsed[0].endTimeMs).toBe(15000);
            expect(parsed[1].startTimeMs).toBe(15000);
            expect(parsed[1].endTimeMs).toBe(20750);
            expect(parsed[2].startTimeMs).toBe(20750);
            expect(parsed[2].endTimeMs).toBe(30000); // Clamped to duration

            provider.destroy();
        });

        it('T1.10: In-memory cache returns cached lyrics on subsequent track queries', async () => {
            const net = new MockNetworkSession();
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass(net);

            // Initial fetch
            await provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'cache_track_1');
            const initialReqCount = net.requests.length;

            // Second fetch for identical track
            const cachedResult = await provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'cache_track_1');
            expect(net.requests.length).toBe(initialReqCount); // Zero new network requests
            expect(cachedResult.lines.length).toBeGreaterThan(0);

            provider.destroy();
        });
    });
}
