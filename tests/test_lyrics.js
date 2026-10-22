#!/usr/bin/env gjs -m

/**
 * Unit Test Suite for Lyrics Parser & Romanizer Engine (Milestone 2)
 * Validates LRC timestamp parsing, millisecond range resolution, multi-tag expansion,
 * interlude detection, and transliteration of Hangul, Kana, and Cyrillic.
 *
 * Can be run headlessly:
 *   gjs -m tests/test_lyrics.js
 */

import System from 'system';
import { Romanizer } from '../romanizer.js';
import { LyricsProvider } from '../lyricsProvider.js';

// =============================================================================
// Micro Test Runner & Assertion Harness
// =============================================================================

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

function describe(suiteName, suiteFn) {
    totalSuites++;
    console.log(`\n${ANSI_BOLD}=== Suite: ${suiteName} ===${ANSI_RESET}`);
    suiteFn();
}

function test(testName, testFn) {
    totalTests++;
    try {
        testFn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✓${ANSI_RESET} ${testName}`);
    } catch (e) {
        failedTests++;
        console.error(`  ${ANSI_RED}✗ ${testName}${ANSI_RESET}`);
        console.error(`    ${ANSI_RED}Error: ${e.message}${ANSI_RESET}`);
        if (e.stack) {
            const cleanStack = e.stack.split('\n').slice(0, 4).map(l => `      ${l}`).join('\n');
            console.error(cleanStack);
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

function assertDeepEquals(actual, expected, message = '') {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
        const prefix = message ? `${message}: ` : '';
        throw new Error(`${prefix}Expected ${expectedStr}, got ${actualStr}`);
    }
}

// Duck-typing helper to call parseLRC as static or instance
function parseLRC(text, durationMs = 0) {
    if (typeof LyricsProvider.parseLRC === 'function') {
        return LyricsProvider.parseLRC(text, durationMs);
    }
    const provider = new LyricsProvider();
    try {
        return provider.parseLRC(text, durationMs);
    } finally {
        if (typeof provider.destroy === 'function') provider.destroy();
    }
}

// =============================================================================
// Suite 1: LRC Timestamp Parsing (Centiseconds, Milliseconds, Multi-Tag)
// =============================================================================

describe('1. LRC Timestamp Parsing', () => {
    test('1.1 Standard centisecond timestamps [mm:ss.xx]', () => {
        const lrc = `[00:00.00] Intro\n[00:12.34] Look at the stars\n[01:05.50] Yeah they were yellow`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 3, 'Must parse 3 lines');
        assertEquals(lines[0].timeMs, 0, 'Line 0 timestamp');
        assertEquals(lines[0].text, 'Intro');
        assertEquals(lines[1].timeMs, 12340, 'Line 1 timestamp (12.34s = 12340ms)');
        assertEquals(lines[1].text, 'Look at the stars');
        assertEquals(lines[2].timeMs, 65500, 'Line 2 timestamp (1m 5.50s = 65500ms)');
        assertEquals(lines[2].text, 'Yeah they were yellow');
    });

    test('1.2 High-precision millisecond timestamps [mm:ss.xxx]', () => {
        const lrc = `[00:12.345] Millisecond line\n[02:15.890] Another precise line`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 2, 'Must parse 2 lines');
        assertEquals(lines[0].timeMs, 12345, '12.345s = 12345ms');
        assertEquals(lines[1].timeMs, 135890, '2m 15.890s = 135890ms');
    });

    test('1.3 Multi-timestamp line expansion & chronological ordering', () => {
        const lrc = `[00:15.20][01:30.40] Repeated chorus line\n[00:30.00] Middle verse`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 3, 'Multi-timestamp line must expand to 2 lines + 1 verse');
        assertEquals(lines[0].timeMs, 15200, 'First chorus instance at 15200ms');
        assertEquals(lines[0].text, 'Repeated chorus line');
        assertEquals(lines[1].timeMs, 30000, 'Middle verse at 30000ms');
        assertEquals(lines[1].text, 'Middle verse');
        assertEquals(lines[2].timeMs, 90400, 'Second chorus instance at 90400ms');
        assertEquals(lines[2].text, 'Repeated chorus line');
    });

    test('1.4 Non-standard single digit fraction [mm:ss.s]', () => {
        const lrc = `[00:05.5] Five point five seconds`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 1);
        assertEquals(lines[0].timeMs, 5500, '00:05.5 should parse as 5500ms');
    });

    test('1.5 ID and metadata tags [ti:], [ar:], [al:] safely ignored', () => {
        const lrc = `[ti:Yellow]\n[ar:Coldplay]\n[al:Parachutes]\n[by:Author]\n[00:01.00] First lyric`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 1, 'Only timestamped lyric lines must be retained');
        assertEquals(lines[0].text, 'First lyric');
        assertEquals(lines[0].timeMs, 1000);
    });

    test('1.6 Brackets inside lyric text preserved verbatim', () => {
        const lrc = `[00:10.00] Live in Tokyo [Acoustic version] (feat. NewJeans)`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 1);
        assertEquals(lines[0].text, 'Live in Tokyo [Acoustic version] (feat. NewJeans)');
    });
});

// =============================================================================
// Suite 2: End-Time Resolution & Interludes
// =============================================================================

describe('2. End-Time Resolution & Interludes', () => {
    test('2.1 Line endTimeMs equals next line timeMs', () => {
        const lrc = `[00:10.00] Line 1\n[00:15.00] Line 2\n[00:22.00] Line 3`;
        const lines = parseLRC(lrc);
        assertEquals(lines[0].endTimeMs, 15000, 'Line 1 ends when Line 2 begins');
        assertEquals(lines[1].endTimeMs, 22000, 'Line 2 ends when Line 3 begins');
    });

    test('2.2 Last line end time capped by track duration', () => {
        const lrc = `[00:10.00] Line 1\n[00:20.00] Outro`;
        const durationMs = 35000;
        const lines = parseLRC(lrc, durationMs);
        assertEquals(lines[1].endTimeMs, 35000, 'Last line ends at track duration');
    });

    test('2.3 Blank lines parsed as interlude markers', () => {
        const lrc = `[00:10.00] Singing\n[00:15.00] \n[00:20.00] Singing again`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 3);
        assertEquals(lines[1].timeMs, 15000);
        assertEquals(lines[1].text, '');
        assert(lines[1].isInterlude === true, 'Blank line must have isInterlude === true');
    });

    test('2.4 Instrumental indicator tokens flagged as interlude', () => {
        const lrc = `[00:00.00] (Instrumental)\n[00:30.00] ♪\n[01:00.00] Actual lyrics`;
        const lines = parseLRC(lrc);
        assert(lines[0].isInterlude === true, '(Instrumental) must be an interlude');
        assert(lines[1].isInterlude === true, '♪ must be an interlude');
        assert(lines[2].isInterlude === false, 'Actual lyrics must not be an interlude');
    });

    test('2.5 Chronological sorting guaranteed when LRC lines are disordered', () => {
        const lrc = `[00:30.00] Line 3\n[00:10.00] Line 1\n[00:20.00] Line 2`;
        const lines = parseLRC(lrc);
        assertEquals(lines[0].text, 'Line 1');
        assertEquals(lines[1].text, 'Line 2');
        assertEquals(lines[2].text, 'Line 3');
    });
});

// =============================================================================
// Suite 3: Korean Hangul Romanization (Revised Romanization)
// =============================================================================

describe('3. Korean Hangul Romanization', () => {
    test('3.1 Basic syllable decomposition (Choseong, Jungseong, Jongseong)', () => {
        assertEquals(Romanizer.romanizeHangul('가'), 'ga');
        assertEquals(Romanizer.romanizeHangul('나'), 'na');
        assertEquals(Romanizer.romanizeHangul('다'), 'da');
        assertEquals(Romanizer.romanizeHangul('한'), 'han');
        assertEquals(Romanizer.romanizeHangul('글'), 'geul');
        assertEquals(Romanizer.romanizeHangul('한국'), 'hanguk');
    });

    test('3.2 Complex syllables with compound finals and double consonants', () => {
        assertEquals(Romanizer.romanizeHangul('말해줘'), 'malhaejwo');
        assertEquals(Romanizer.romanizeHangul('침묵'), 'chimmuk');
        assertEquals(Romanizer.romanizeHangul('너를'), 'neoreul');
    });

    test('3.3 Standard Korean phrases and song lyrics', () => {
        assertEquals(Romanizer.romanizeHangul('안녕하세요'), 'annyeonghaseyo');
        assertEquals(Romanizer.romanizeHangul('감사합니다'), 'gamsahamnida');
        assertEquals(Romanizer.romanizeHangul('사랑해'), 'saranghae');
    });

    test('3.4 Mixed Hangul and English phrase transliteration', () => {
        const mixed = 'Stay in the middle! 말해줘 say it back';
        const result = Romanizer.romanize(mixed);
        assert(result.includes('Stay in the middle!'), 'Latin text preserved');
        assert(result.includes('malhaejwo'), 'Hangul transliterated');
        assert(result.includes('say it back'), 'Trailing Latin preserved');
    });
});

// =============================================================================
// Suite 4: Japanese Kana Romanization (Hepburn)
// =============================================================================

describe('4. Japanese Kana Romanization', () => {
    test('4.1 Basic Hiragana words', () => {
        assertEquals(Romanizer.romanizeKana('ありがとう'), 'arigatou');
        assertEquals(Romanizer.romanizeKana('さようなら'), 'sayounara');
    });

    test('4.2 Basic Katakana words', () => {
        assertEquals(Romanizer.romanizeKana('メディア'), 'media');
        assertEquals(Romanizer.romanizeKana('エリア'), 'eria');
        assertEquals(Romanizer.romanizeKana('アイドル'), 'aidoru');
    });

    test('4.3 Yōon digraphs with small ya, yu, yo', () => {
        assertEquals(Romanizer.romanizeKana('とうきょう'), 'toukyou'); // きょ -> kyo
        assertEquals(Romanizer.romanizeKana('しゃしん'), 'shashin');   // しゃ -> sha
        assertEquals(Romanizer.romanizeKana('きょう'), 'kyou');       // きょ -> kyo
    });

    test('4.4 Sokuon geminate consonants with small tsu (っ / ッ)', () => {
        assertEquals(Romanizer.romanizeKana('ちょっと'), 'chotto');   // ちょ -> cho + っと -> tto
        assertEquals(Romanizer.romanizeKana('きっと'), 'kitto');
        assertEquals(Romanizer.romanizeKana('がっこう'), 'gakkou');
    });

    test('4.5 Chōonpu (ー) vowel prolongation', () => {
        assertEquals(Romanizer.romanizeKana('ラーメン'), 'raamen');
        assertEquals(Romanizer.romanizeKana('スーパー'), 'suupaa');
        assertEquals(Romanizer.romanizeKana('コーヒー'), 'koohii');
    });

    test('4.6 Katakana loanword digraphs (ティ, ディ, ファ, フィ, etc.)', () => {
        assertEquals(Romanizer.romanizeKana('パーティー'), 'paatii');
        assertEquals(Romanizer.romanizeKana('ミステリアス'), 'misuteriasu');
    });
});

// =============================================================================
// Suite 5: Slavic Cyrillic Transliteration
// =============================================================================

describe('5. Slavic Cyrillic Transliteration', () => {
    test('5.1 Case preservation across uppercase and lowercase', () => {
        assertEquals(Romanizer.romanizeCyrillic('Привет'), 'Privet');
        assertEquals(Romanizer.romanizeCyrillic('КИНО'), 'KINO');
        assertEquals(Romanizer.romanizeCyrillic('Привет мир'), 'Privet mir');
    });

    test('5.2 Classic Russian rock song lyrics', () => {
        assertEquals(Romanizer.romanizeCyrillic('Группа крови'), 'Gruppa krovi');
        assertEquals(Romanizer.romanizeCyrillic('Теплое место'), 'Teploe mesto');
    });

    test('5.3 Complex Cyrillic consonants (Ж, Х, Ц, Ч, Ш, Щ)', () => {
        assertEquals(Romanizer.romanizeCyrillic('Жизнь'), 'Zhizn');
        assertEquals(Romanizer.romanizeCyrillic('Чайка'), 'Chayka');
        assertEquals(Romanizer.romanizeCyrillic('Щелкунчик'), 'Shchelkunchik');
    });
});

// =============================================================================
// Suite 6: Mixed Script & Passthrough Integrity
// =============================================================================

describe('6. Mixed Script & Passthrough Integrity', () => {
    test('6.1 Pure Latin, numbers, and ASCII punctuation pass through unmodified', () => {
        const text = 'Coldplay - Yellow (2000) #1 Album Track!';
        assertEquals(Romanizer.romanize(text), text);
    });

    test('6.2 Japanese Kanji passes through untouched without corruption', () => {
        // Kanji (夜, 駆) must pass through, Kana (に, ける) transliterates to ni, keru
        const text = '夜に駆ける';
        const res = Romanizer.romanize(text);
        assertEquals(res, '夜ni駆keru');

        const tokyo = '東京タワー';
        assertEquals(Romanizer.romanize(tokyo), '東京tawaa');
    });

    test('6.3 Null, undefined, and empty string handled defensively', () => {
        assertEquals(Romanizer.romanize(''), '');
        assertEquals(Romanizer.romanize(null), '');
        assertEquals(Romanizer.romanize(undefined), '');
    });
});

// =============================================================================
// Suite 7: Full Fixture & Romanization Integration
// =============================================================================

describe('7. Full Fixture & Romanization Integration', () => {
    test('7.1 English track (Yellow): parsed correctly, romanized is null', () => {
        const lrc = `[00:00.00] (Intro)\n[00:35.66] Look at the stars\n[00:38.46] Look how they shine for you`;
        const lines = parseLRC(lrc, 267000);
        assertEquals(lines.length, 3);
        assertEquals(lines[1].romanized, null, 'English lyric line has null romanized');
    });

    test('7.2 Korean track: lines with Hangul have romanized populated', () => {
        const lrc = `[00:13.10] 말해줘 say it back\n[00:16.80] 침묵은 no way`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 2);
        assert(lines[0].romanized !== null, 'Line 0 romanized must be populated');
        assert(lines[0].romanized.includes('malhaejwo'), 'Contains malhaejwo');
        assert(lines[1].romanized.includes('chimmuk'), 'Contains chimmuk');
    });

    test('7.3 Japanese track: lines with Kana have romanized populated', () => {
        const lrc = `[00:00.00] むてきのえがおであらすメディア\n[00:04.50] しりたいそのひみつミステリアス`;
        const lines = parseLRC(lrc);
        assertEquals(lines.length, 2);
        assert(lines[0].romanized !== null);
        assert(lines[0].romanized.includes('media'));
        assert(lines[1].romanized.includes('misuteriasu'));
    });

    test('7.4 Empty or invalid payload returns empty array without throwing', () => {
        assertDeepEquals(parseLRC(''), []);
        assertDeepEquals(parseLRC(null), []);
        assertDeepEquals(parseLRC(undefined), []);
    });
});

// =============================================================================
// Summary & Process Exit
// =============================================================================

console.log('\n======================================================');
console.log(`${ANSI_BOLD}Test Execution Summary (test_lyrics.js):${ANSI_RESET}`);
console.log(`  Total Suites:  ${totalSuites}`);
console.log(`  Total Tests:   ${totalTests}`);
console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed Tests:  ${failedTests}${ANSI_RESET}`);
console.log(`  ${ANSI_YELLOW}Skipped Tests: ${skippedTests}${ANSI_RESET}`);
console.log('======================================================\n');

if (failedTests > 0) {
    System.exit(1);
} else {
    System.exit(0);
}
