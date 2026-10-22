/**
 * Tier 1: Feature Coverage - Lyrics Synchronization Engine
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { loadModule } from '../harness/module_loader.js';
import { LrcParserOracle } from '../harness/reference_oracles.js';
import { SAMPLE_LYRICS } from '../fixtures/sample_lyrics.js';

export function runSyncEngineTests() {
    describe('Tier 1: Lyrics Synchronization Engine', () => {
        const parsedLines = LrcParserOracle.parse(SAMPLE_LYRICS.yellow, 267000);

        it('T1.16: Accurately identifies active line index for playback timestamps within intervals', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // Intro: 0ms -> line 0
            sync.updatePosition(10000);
            expect(sync.getCurrentIndex()).toBe(0);

            // Line 1: Starts at 35660ms ("Look at the stars")
            sync.updatePosition(36000);
            expect(sync.getCurrentIndex()).toBe(1);

            // Line 2: Starts at 38460ms ("Look how they shine for you")
            sync.updatePosition(39000);
            expect(sync.getCurrentIndex()).toBe(2);

            sync.destroy();
        });

        it('T1.17: Emits line transition signals only when line index changes (no event flooding)', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            let emitCount = 0;
            sync.onLineChanged(() => {
                emitCount++;
            });

            // Simulate high frequency tick loop within same line (36000ms to 37000ms)
            for (let t = 36000; t <= 37000; t += 100) {
                sync.updatePosition(t);
            }

            // Emitted once for entering line 1, not on every 100ms tick
            expect(emitCount).toBe(1);

            // Transition to line 2 at 38500ms
            sync.updatePosition(38500);
            expect(emitCount).toBe(2);

            sync.destroy();
        });

        it('T1.18: Skips instrumental interludes and holds the last sung line through the gap', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // In "Yellow", line 3 (index 3) is a blank interlude line starting at 40360ms
            let currentLine = null;
            sync.onLineChanged((line) => {
                currentLine = line;
            });

            sync.updatePosition(41000);
            expect(sync.getCurrentIndex()).toBe(2);
            expect(currentLine.isInterlude).toBe(false);
            expect(currentLine.words).toBe('Look how they shine for you');

            // The interlude itself never becomes the displayed line
            sync.updatePosition(40360);
            expect(sync.getCurrentIndex()).toBe(2);

            sync.destroy();
        });

        it('T1.19: Recalibrates instantly upon seek jumps to the matching time index', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // Start near beginning
            sync.updatePosition(15000);
            expect(sync.getCurrentIndex()).toBe(0);

            // Sudden forward seek to 01:05.00 (65000ms: "And it was called Yellow", starts at 62100ms)
            sync.updatePosition(65000);
            expect(sync.getCurrentIndex()).toBe(9);

            // Seek backwards to line 1 (36000ms)
            sync.updatePosition(36000);
            expect(sync.getCurrentIndex()).toBe(1);

            sync.destroy();
        });

        it('T1.20: Clamps position to track bounds and handles end of track', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // Position before 0ms
            sync.updatePosition(-5000);
            expect(sync.getCurrentIndex()).toBe(-1);

            // Position after last line
            sync.updatePosition(300000); // 300s > duration
            expect(sync.getCurrentIndex()).toBe(parsedLines.length - 1);

            sync.destroy();
        });
    });
}
