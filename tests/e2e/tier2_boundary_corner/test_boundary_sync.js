/**
 * Tier 2: Boundary & Corner Cases - Lyrics Sync Engine
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { loadModule } from '../harness/module_loader.js';
import { LrcParserOracle } from '../harness/reference_oracles.js';
import { SAMPLE_LYRICS } from '../fixtures/sample_lyrics.js';

export function runBoundarySyncTests() {
    describe('Tier 2: Boundary Cases - Sync Engine', () => {
        const parsedLines = LrcParserOracle.parse(SAMPLE_LYRICS.yellow, 267000);

        it('T2.16: Position before track starts (negative ms) returns -1', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            sync.updatePosition(-1000);
            expect(sync.getCurrentIndex()).toBe(-1);

            sync.destroy();
        });

        it('T2.17: Position far beyond track duration clamps to last line index', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            sync.updatePosition(99999999);
            expect(sync.getCurrentIndex()).toBe(parsedLines.length - 1);

            sync.destroy();
        });

        it('T2.18: Timestamps exactly matching interval boundary transition immediately', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // Exact timestamp of line 1 is 35660ms
            sync.updatePosition(35659);
            expect(sync.getCurrentIndex()).toBe(0);

            sync.updatePosition(35660);
            expect(sync.getCurrentIndex()).toBe(1);

            sync.destroy();
        });

        it('T2.19: Rapid seek oscillation does not corrupt internal state', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics(parsedLines);

            // Back and forth scrub
            for (let i = 0; i < 50; i++) {
                const target = i % 2 === 0 ? 36000 : 70000;
                sync.updatePosition(target);
            }

            // Settle on 36000ms
            sync.updatePosition(36000);
            expect(sync.getCurrentIndex()).toBe(1);

            sync.destroy();
        });

        it('T2.20: Synchronizer with 0 lines does not throw or emit errors on position updates', async () => {
            const mod = await loadModule('lyricsSync');
            const SyncClass = mod.LyricsSync || mod.LyricsSyncManager || mod.default;
            const sync = new SyncClass();
            sync.setLyrics([]);

            expect(() => {
                sync.updatePosition(0);
                sync.updatePosition(15000);
                sync.updatePosition(50000);
            }).not.toThrow();

            expect(sync.getCurrentIndex()).toBe(-1);

            sync.destroy();
        });
    });
}
