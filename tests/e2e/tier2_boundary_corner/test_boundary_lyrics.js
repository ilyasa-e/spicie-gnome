/**
 * Tier 2: Boundary & Corner Cases - Lyrics Fetching & LRC Parsing
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_LYRICS } from '../fixtures/sample_lyrics.js';

export function runBoundaryLyricsTests() {
    describe('Tier 2: Boundary Cases - Lyrics & LRC Parsing', () => {
        it('T2.6: Empty LRC string or whitespace returns empty array without throwing', async () => {
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass();

            expect(provider.parseLRC('', 10000)).toEqual([]);
            expect(provider.parseLRC('   \n\n   ', 10000)).toEqual([]);
            expect(provider.parseLRC(null, 10000)).toEqual([]);
        });

        it('T2.7: Extreme length LRC (1,000+ lines) parses cleanly in < 100ms without stack overflow', async () => {
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass();

            const bigLrc = SAMPLE_LYRICS.generateExtremeLyrics(1000);
            const start = Date.now();
            const lines = provider.parseLRC(bigLrc, 1000 * 1000);
            const duration = Date.now() - start;

            expect(lines.length).toBe(1000);
            expect(duration).toBeLessThan(150);
            expect(lines[0].startTimeMs).toBe(0);
            expect(lines[999].words).toContain('number 1000');
        });

        it('T2.8: Single lyric line with multiple timestamps expands into sorted distinct entries', async () => {
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass();

            const parsed = provider.parseLRC(SAMPLE_LYRICS.multiTimestamp, 180000);
            // 3 tags on line 1 + 2 tags on line 2 = 5 entries
            expect(parsed.length).toBe(5);

            // Chronological verification
            for (let i = 0; i < parsed.length - 1; i++) {
                expect(parsed[i].startTimeMs).toBeLessThanOrEqual(parsed[i + 1].startTimeMs);
            }

            expect(parsed[0].startTimeMs).toBe(15200);
            expect(parsed[1].startTimeMs).toBe(22500);
            expect(parsed[2].startTimeMs).toBe(90400); // 01:30.40
        });

        it('T2.9: 3-decimal sub-centisecond timestamps parse with exact millisecond precision', async () => {
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass();

            const parsed = provider.parseLRC(SAMPLE_LYRICS.threeDecimals, 30000);
            expect(parsed.length).toBe(2);
            // [00:12.345] -> 12,345 ms
            expect(parsed[0].startTimeMs).toBe(12345);
            // [00:18.890] -> 18,890 ms
            expect(parsed[1].startTimeMs).toBe(18890);
        });

        it('T2.10: Zero duration or missing duration defaults to safe 6000ms end clamp', async () => {
            const mod = await loadModule('lyricsProvider');
            const ProviderClass = mod.LyricsProvider || mod.default;
            const provider = new ProviderClass();

            const singleLine = `[00:10.00] Lonely Solo Line`;
            const parsed = provider.parseLRC(singleLine, 0);

            expect(parsed.length).toBe(1);
            expect(parsed[0].startTimeMs).toBe(10000);
            expect(parsed[0].endTimeMs).toBe(16000); // 10000 + 6000
        });
    });
}
