#!/usr/bin/env gjs -m

/**
 * Adversarial Stress & Edge-Case Test Suite for Milestone 2 (Lyrics & Romanization Engine)
 *
 * Subject under test:
 * - romanizer.js (Hangul decomposition, RR nasal assimilation, Kana Hepburn, Cyrillic, edge cases)
 * - lyricsProvider.js (LRC parsing variants, TTML syllable parsing, error tolerance, lifecycle)
 * - lyricsSync.js (Binary search accuracy, gap handling, boundary conditions, zero event flooding, performance)
 */

import System from 'system';
import GLib from 'gi://GLib';
import { Romanizer } from '../romanizer.js';
import { LyricsProvider } from '../lyricsProvider.js';
import { LyricsSync } from '../lyricsSync.js';

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

function describe(suiteName, fn) {
    totalSuites++;
    console.log(`\n${ANSI_BOLD}=== Adversarial Suite: ${suiteName} ===${ANSI_RESET}`);
    fn();
}

function test(testName, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✓${ANSI_RESET} ${testName}`);
    } catch (e) {
        failedTests++;
        console.error(`  ${ANSI_RED}✗ ${testName}${ANSI_RESET}`);
        console.error(`    ${ANSI_RED}Error: ${e.message}${ANSI_RESET}`);
        if (e.stack) {
            console.error(e.stack.split('\n').slice(0, 4).map(l => `      ${l}`).join('\n'));
        }
    }
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        const prefix = message ? `${message}: ` : '';
        throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// =============================================================================
// Suite 1: Romanizer Deep Algorithmic Stress Tests
// =============================================================================

describe('1. Romanizer Deep Algorithmic Stress Tests', () => {
    test('1.1 Boundary Hangul Unicode codepoints (0xAC00 and 0xD7A3)', () => {
        // 0xAC00: '가' (L=0, V=0, T=0) -> 'ga'
        assertEquals(Romanizer.romanizeHangul('\uAC00'), 'ga');
        // 0xD7A3: '힣' (L=18 h, V=20 i, T=27 h) -> 'hih'
        assertEquals(Romanizer.romanizeHangul('\uD7A3'), 'hih');
    });

    test('1.2 Codepoints immediately outside Hangul syllable block pass through without error', () => {
        // 0xABFF is right before 0xAC00
        assertEquals(Romanizer.romanizeHangul('\uABFF'), '\uABFF');
        // 0xD7A4 is right after 0xD7A3
        assertEquals(Romanizer.romanizeHangul('\uD7A4'), '\uD7A4');
        // Compatibility Jamo (0x3131: ㄱ)
        assertEquals(Romanizer.romanizeHangul('\u3131'), '\u3131');
    });

    test('1.3 Comprehensive Nasal Assimilation Rule 3-1 Verification', () => {
        // ㅂ/ㅄ/ㅍ before ㄴ/ㅁ -> m
        assertEquals(Romanizer.romanizeHangul('감사합니다'), 'gamsahamnida');
        assertEquals(Romanizer.romanizeHangul('밥맛'), 'bammat');     // 밥(ㅂ) + 맛(ㅁ) -> bammat
        assertEquals(Romanizer.romanizeHangul('없네요'), 'eomneyo');   // 없(ㅄ) + 네(ㄴ) -> eomneyo
        assertEquals(Romanizer.romanizeHangul('앞마당'), 'ammadang');   // 앞(ㅍ) + 마(ㅁ) -> ammadang

        // ㄱ/ㄲ/ㅋ before ㄴ/ㅁ -> ng
        assertEquals(Romanizer.romanizeHangul('국물'), 'gungmul');     // 국(ㄱ) + 물(ㅁ) -> gungmul
        assertEquals(Romanizer.romanizeHangul('깎는'), 'kkangneun');   // 깎(ㄲ) + 는(ㄴ) -> kkangneun
        assertEquals(Romanizer.romanizeHangul('부엌문'), 'bueongmun'); // 부엌(ㅋ) + 문(ㅁ) -> bueongmun

        // ㄷ/ㅅ/ㅆ/ㅈ/ㅊ/ㅌ before ㄴ/ㅁ -> n
        assertEquals(Romanizer.romanizeHangul('닫는'), 'danneun');     // 닫(ㄷ) + 는(ㄴ) -> danneun
        assertEquals(Romanizer.romanizeHangul('옛날'), 'yennal');       // 옛(ㅅ) + 날(ㄴ) -> yennal
        assertEquals(Romanizer.romanizeHangul('있는'), 'inneun');       // 있(ㅆ) + 는(ㄴ) -> inneun
        assertEquals(Romanizer.romanizeHangul('맞는'), 'manneun');     // 맞(ㅈ) + 는(ㄴ) -> manneun
        assertEquals(Romanizer.romanizeHangul('꽃망울'), 'kkonmangul'); // 꽃(ㅊ) + 망(ㅁ) -> kkonmangul
        assertEquals(Romanizer.romanizeHangul('끝물'), 'kkeunmul');     // 끝(ㅌ) + 물(ㅁ) -> kkeunmul
    });

    test('1.4 Japanese Kana Hepburn Gemination & Loanword Digraphs', () => {
        // Sokuon gemination: c -> t
        assertEquals(Romanizer.romanizeKana('まっちゃ'), 'matcha');
        assertEquals(Romanizer.romanizeKana('マッチ'), 'matchi');
        // Regular gemination
        assertEquals(Romanizer.romanizeKana('きっぷ'), 'kippu');
        assertEquals(Romanizer.romanizeKana('がっこう'), 'gakkou');
        assertEquals(Romanizer.romanizeKana('いっしょ'), 'issho');

        // Edge case: trailing sokuon
        assertEquals(Romanizer.romanizeKana('あっ'), "a'");
        assertEquals(Romanizer.romanizeKana('えっ?'), "e'?");

        // Loanword digraphs
        assertEquals(Romanizer.romanizeKana('パーティー'), 'paatii');
        assertEquals(Romanizer.romanizeKana('ファッション'), 'fasshon');
        assertEquals(Romanizer.romanizeKana('ヴァイオリン'), 'vaiorin');
        assertEquals(Romanizer.romanizeKana('ウィキペディア'), 'wikipedia');
    });

    test('1.5 Chōonpu (ー) with various vowels and positions', () => {
        assertEquals(Romanizer.romanizeKana('コーヒー'), 'koohii');
        assertEquals(Romanizer.romanizeKana('スーパー'), 'suupaa');
        assertEquals(Romanizer.romanizeKana('カレー'), 'karee');
        assertEquals(Romanizer.romanizeKana('スキー'), 'sukii');
        // Leading chōonpu
        assertEquals(Romanizer.romanizeKana('ー'), 'a');
    });

    test('1.6 Slavic Cyrillic case preservation and special character handling', () => {
        // Uppercase, lowercase, mixed
        assertEquals(Romanizer.romanizeCyrillic('КИНО'), 'KINO');
        assertEquals(Romanizer.romanizeCyrillic('Кино'), 'Kino');
        assertEquals(Romanizer.romanizeCyrillic('кино'), 'kino');

        // Russian uppercase with single-char map: 'Ё' maps to 'Yo' (e.g. ПОДЪЁМ -> PODYoM)
        assertEquals(Romanizer.romanizeCyrillic('ПОДЪЁМ'), 'PODYoM');
        assertEquals(Romanizer.romanizeCyrillic('Объект'), 'Obekt');
        assertEquals(Romanizer.romanizeCyrillic('День'), 'Den');

        // Ukrainian / Belarusian letters (context-free map: ї -> yi)
        assertEquals(Romanizer.romanizeCyrillic('Київ'), 'Kiyiv');
        assertEquals(Romanizer.romanizeCyrillic('Україна'), 'Ukrayina');
        assertEquals(Romanizer.romanizeCyrillic('Єдність'), 'Yednist');
    });

    test('1.7 Passthrough integrity for non-target scripts (Kanji, Chinese, Emojis, RTL)', () => {
        const complex = '夜に駆ける (YOASOBI) 🎵 [Live 2024] #1 💖 123';
        const romanized = Romanizer.romanize(complex);
        assertEquals(romanized, '夜ni駆keru (YOASOBI) 🎵 [Live 2024] #1 💖 123');

        // Chinese Hanzi passes through untouched
        const chinese = '月亮代表我的心';
        assertEquals(Romanizer.romanize(chinese), chinese);

        // Arabic passes through untouched
        const arabic = 'مرحبا بالعالم';
        assertEquals(Romanizer.romanize(arabic), arabic);
    });

    test('1.8 Defensive input handling for null, undefined, boolean, and numbers', () => {
        assertEquals(Romanizer.romanize(null), '');
        assertEquals(Romanizer.romanize(undefined), '');
        assertEquals(Romanizer.romanize(12345), '');
        assertEquals(Romanizer.romanize({}), '');
        assertEquals(Romanizer.hasRomanizableContent(null), false);
        assertEquals(Romanizer.hasRomanizableContent(undefined), false);
        assertEquals(Romanizer.hasRomanizableContent(''), false);
        assertEquals(Romanizer.hasRomanizableContent('Hello World 123!'), false);
    });

    test('1.9 High-volume string performance stress test (50,000 characters)', () => {
        const base = 'Stay in the middle! 말해줘 say it back, ちょっとまって, Привет мир! ';
        const massive = base.repeat(800); // 800 * 64 = 51,200 characters
        const start = GLib.get_monotonic_time();
        const res = Romanizer.romanize(massive);
        const elapsedMs = (GLib.get_monotonic_time() - start) / 1000;
        assert(res.length >= 50000, `Romanized length matches: ${res.length}`);
        assert(elapsedMs < 100, `Romanization of 50K chars took ${elapsedMs.toFixed(1)}ms (must be < 100ms)`);
    });
});

// =============================================================================
// Suite 2: LyricsProvider Parsing & Lifecycle Hardening
// =============================================================================

describe('2. LyricsProvider Parsing & Lifecycle Hardening', () => {
    test('2.1 Non-standard timestamp formats (1-digit, 2-digit, 3-digit milliseconds)', () => {
        const lrc = [
            '[00:01.5] Single digit fraction (500ms)',
            '[00:03.45] Two digit centiseconds (3450ms)',
            '[00:06.789] Three digit milliseconds (6789ms)',
            '[01:10.0] One minute ten seconds (70000ms)',
        ].join('\n');

        const lines = LyricsProvider.parseLRC(lrc);
        assertEquals(lines.length, 4);
        assertEquals(lines[0].timeMs, 1500);
        assertEquals(lines[1].timeMs, 3450);
        assertEquals(lines[2].timeMs, 6789);
        assertEquals(lines[3].timeMs, 70000);
    });

    test('2.2 Hours-format or large-minute timestamp handling', () => {
        const lrc = `[120:00.00] Two hours mark in long DJ set`;
        const lines = LyricsProvider.parseLRC(lrc);
        assertEquals(lines.length, 1);
        assertEquals(lines[0].timeMs, 120 * 60000);
    });

    test('2.3 Multiple metadata tags and comment lines are discarded safely', () => {
        const lrc = [
            '[ti:Song Title]',
            '[ar:Artist Name]',
            '[al:Album Title]',
            '[by:Transcriber]',
            '[offset:+500]',
            '# This is a comment line',
            '// Another comment',
            '[00:05.00] Actual first lyric',
        ].join('\n');

        const lines = LyricsProvider.parseLRC(lrc);
        assertEquals(lines.length, 1);
        assertEquals(lines[0].timeMs, 5000);
        assertEquals(lines[0].text, 'Actual first lyric');
    });

    test('2.4 Out-of-order and duplicated timestamps are sorted and indexed cleanly', () => {
        const lrc = [
            '[00:30.00] Line 3',
            '[00:10.00] Line 1',
            '[00:10.00] Duplicate Line 1',
            '[00:20.00] Line 2',
        ].join('\n');

        const lines = LyricsProvider.parseLRC(lrc);
        assertEquals(lines.length, 4);
        assertEquals(lines[0].timeMs, 10000);
        assertEquals(lines[1].timeMs, 10000);
        assertEquals(lines[2].timeMs, 20000);
        assertEquals(lines[3].timeMs, 30000);
        // All IDs must be sequential 0..3
        assertEquals(JSON.stringify(lines.map(l => l.id)), JSON.stringify([0, 1, 2, 3]));
    });

    test('2.5 Interlude marker variations detected accurately', () => {
        const lrc = [
            '[00:00.00] (Instrumental)',
            '[00:10.00] (instrumental)',
            '[00:20.00] ♪',
            '[00:30.00]    ', // whitespace only
            '[00:40.00] Real sung lyric',
        ].join('\n');

        const lines = LyricsProvider.parseLRC(lrc);
        assertEquals(lines.length, 5);
        assert(lines[0].isInterlude === true, '(Instrumental)');
        assert(lines[1].isInterlude === true, '(instrumental)');
        assert(lines[2].isInterlude === true, '♪');
        assert(lines[3].isInterlude === true, 'whitespace line');
        assert(lines[4].isInterlude === false, 'Real sung lyric');
    });

    test('2.6 Last line endTimeMs calculation with various duration bounds', () => {
        const lrc = `[00:10.00] Last lyric line`;

        // 1. durationMs > startTimeMs
        const lines1 = LyricsProvider.parseLRC(lrc, 45000);
        assertEquals(lines1[0].endTimeMs, 45000);

        // 2. durationMs <= startTimeMs (fallback: +6000ms)
        const lines2 = LyricsProvider.parseLRC(lrc, 5000);
        assertEquals(lines2[0].endTimeMs, 16000);

        // 3. durationMs is 0 (fallback: +6000ms)
        const lines3 = LyricsProvider.parseLRC(lrc, 0);
        assertEquals(lines3[0].endTimeMs, 16000);
    });

    test('2.7 TTML Syllable parsing handles missing spans and timestamps', () => {
        const provider = new LyricsProvider();
        try {
            const ttml = `
                <tt xmlns="http://www.w3.org/ns/ttml">
                    <body>
                        <div>
                            <p begin="00:00:10.500" end="00:00:14.200">
                                <span begin="00:00:10.500" end="00:00:11.200">Hello </span>
                                <span begin="00:00:11.200" end="00:00:14.200">World</span>
                            </p>
                            <p begin="00:00:15.000" end="00:00:20.000">Plain text without inner spans</p>
                            <p begin="00:00:20.000" end="00:00:25.000">♪</p>
                        </div>
                    </body>
                </tt>
            `;
            const lines = provider._parseTtml(ttml, true);
            assertEquals(lines.length, 3);
            assertEquals(lines[0].startTimeMs, 10500);
            assertEquals(lines[0].endTimeMs, 14200);
            assertEquals(lines[0].text, 'Hello World');
            assert(Array.isArray(lines[0].syllables) && lines[0].syllables.length === 2);

            assertEquals(lines[1].startTimeMs, 15000);
            assertEquals(lines[1].text, 'Plain text without inner spans');
            assertEquals(lines[1].syllables, null);

            assertEquals(lines[2].isInterlude, true);
        } finally {
            provider.destroy();
        }
    });

    test('2.8 Lifecycle safety: double cancel and call after destroy', async () => {
        const provider = new LyricsProvider();
        // Double cancel must not throw
        provider.cancel();
        provider.cancel();

        provider.destroy();
        // Calling destroy again must be idempotent
        provider.destroy();

        // Calling fetchLyrics after destroy returns safe fallback
        const res = await provider.fetchLyrics('Song', 'Artist', 'Album', 200);
        assertEquals(res.provider, 'none');
        assertEquals(res.lines.length, 0);
    });
});

// =============================================================================
// Suite 3: LyricsSync Synchronization & Binary Search Hardening
// =============================================================================

describe('3. LyricsSync Synchronization & Binary Search Hardening', () => {
    test('3.1 Binary search edge case: 0 lines and 1 line', () => {
        const sync = new LyricsSync();
        try {
            // 0 lines
            sync.setLyrics([]);
            assertEquals(sync.findActiveIndex(0), -1);
            assertEquals(sync.findActiveIndex(5000), -1);

            // 1 line: [5000..10000ms]
            sync.setLyrics([{ timeMs: 5000, endTimeMs: 10000, text: 'Solo' }]);
            assertEquals(sync.findActiveIndex(0), -1);     // Before start
            assertEquals(sync.findActiveIndex(4999), -1);  // Immediately before
            assertEquals(sync.findActiveIndex(5000), 0);   // Exactly on boundary
            assertEquals(sync.findActiveIndex(7500), 0);   // Mid-line
            assertEquals(sync.findActiveIndex(10000), 0);  // At/past last line clamps to 0
            assertEquals(sync.findActiveIndex(99999), 0);  // Past last line clamps to 0
        } finally {
            sync.destroy();
        }
    });

    test('3.2 Contiguous lines: exact millisecond boundary testing', () => {
        const sync = new LyricsSync();
        try {
            const lines = [
                { timeMs: 1000, endTimeMs: 3000, text: 'L0' },
                { timeMs: 3000, endTimeMs: 6000, text: 'L1' },
                { timeMs: 6000, endTimeMs: 9000, text: 'L2' },
            ];
            sync.setLyrics(lines);

            assertEquals(sync.findActiveIndex(999), -1);
            assertEquals(sync.findActiveIndex(1000), 0); // L0 starts
            assertEquals(sync.findActiveIndex(2999), 0); // L0 ends
            assertEquals(sync.findActiveIndex(3000), 1); // L1 starts exactly at 3000ms
            assertEquals(sync.findActiveIndex(5999), 1); // L1 ends
            assertEquals(sync.findActiveIndex(6000), 2); // L2 starts
            assertEquals(sync.findActiveIndex(9000), 2); // Clamped to last line
        } finally {
            sync.destroy();
        }
    });

    test('3.3 Gaps between non-contiguous lines correctly evaluate to -1', () => {
        const sync = new LyricsSync();
        try {
            const linesWithGaps = [
                { timeMs: 1000, endTimeMs: 2500, text: 'L0' },
                // Gap 1: 2500..5000ms
                { timeMs: 5000, endTimeMs: 7000, text: 'L1' },
                // Gap 2: 7000..10000ms
                { timeMs: 10000, endTimeMs: 12000, text: 'L2' },
            ];
            sync.setLyrics(linesWithGaps);

            assertEquals(sync.findActiveIndex(2000), 0);  // Inside L0
            assertEquals(sync.findActiveIndex(2500), -1); // Exactly at L0 end time (in gap 1)
            assertEquals(sync.findActiveIndex(3500), -1); // In gap 1
            assertEquals(sync.findActiveIndex(4999), -1); // Right before L1
            assertEquals(sync.findActiveIndex(5000), 1);  // L1 starts
            assertEquals(sync.findActiveIndex(7000), -1); // In gap 2
            assertEquals(sync.findActiveIndex(8500), -1); // In gap 2
            assertEquals(sync.findActiveIndex(10000), 2); // L2 starts
        } finally {
            sync.destroy();
        }
    });

    test('3.4 Duplicate timestamps resolve without loop or corruption', () => {
        const sync = new LyricsSync();
        try {
            const duplicates = [
                { timeMs: 1000, text: 'Dup A' },
                { timeMs: 1000, text: 'Dup B' },
                { timeMs: 2000, text: 'Next' },
            ];
            sync.setLyrics(duplicates);
            const idx = sync.findActiveIndex(1000);
            assert(idx === 0 || idx === 1, 'Resolves to either duplicate index safely');
        } finally {
            sync.destroy();
        }
    });

    test('3.5 Massive binary search workload (10,000 lines, 50,000 queries)', () => {
        const sync = new LyricsSync();
        try {
            const count = 10000;
            const bigLyrics = [];
            for (let i = 0; i < count; i++) {
                bigLyrics.push({
                    timeMs: i * 2000,
                    endTimeMs: (i + 1) * 2000,
                    text: `Line ${i}`
                });
            }
            sync.setLyrics(bigLyrics);

            const start = GLib.get_monotonic_time();
            // Perform 50,000 search queries
            for (let q = 0; q < 50000; q++) {
                const targetMs = (q * 397) % (count * 2000);
                const idx = sync.findActiveIndex(targetMs);
                const expected = Math.floor(targetMs / 2000);
                assertEquals(idx, expected);
            }
            const elapsedMs = (GLib.get_monotonic_time() - start) / 1000;
            assert(elapsedMs < 300, `50,000 binary searches took ${elapsedMs.toFixed(1)}ms (must be < 300ms)`);
        } finally {
            sync.destroy();
        }
    });

    test('3.6 Strict signal deduplication across 1,000 updates within same line', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, endTimeMs: 10000, text: 'Long line' },
            ]);
            let emissions = 0;
            sync.connect('line-changed', () => { emissions++; });

            for (let t = 1000; t < 10000; t += 9) {
                sync.updatePosition(t);
            }
            assertEquals(emissions, 1, 'Exactly one signal on transition; 0 duplicate signals');
        } finally {
            sync.destroy();
        }
    });

    test('3.7 Rapid track swapping (50 songs) leaves clean tracking state', () => {
        const sync = new LyricsSync();
        try {
            for (let s = 0; s < 50; s++) {
                sync.setLyrics([
                    { timeMs: 1000, text: `Song ${s} L1` },
                    { timeMs: 4000, text: `Song ${s} L2` },
                ]);
                sync.updatePosition(1500);
                assertEquals(sync.getCurrentIndex(), 0);
                assertEquals(sync.getCurrentLine().text, `Song ${s} L1`);
            }
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Summary & Process Exit
// =============================================================================

console.log('\n======================================================');
console.log(`${ANSI_BOLD}Adversarial Stress Test Summary (Milestone 2):${ANSI_RESET}`);
console.log(`  Total Suites:  ${totalSuites}`);
console.log(`  Total Tests:   ${totalTests}`);
console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed Tests:  ${failedTests}${ANSI_RESET}`);
console.log('======================================================\n');

if (failedTests > 0) {
    System.exit(1);
} else {
    System.exit(0);
}
