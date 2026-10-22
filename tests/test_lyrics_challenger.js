#!/usr/bin/env gjs -m

/**
 * Challenger Stress & Fuzz Harness for Romanizer & Lyrics Engine (Milestone 2)
 * Authored by Challenger 1 (critic, specialist)
 *
 * Empirical verification of:
 * 1. Romanization Fuzzing:
 *    - Mixed Korean Hangul + Japanese Kana + Russian Cyrillic + English + Emojis + Numbers
 *    - Standalone Jamo, Unicode boundaries, nullish and primitive edge cases
 * 2. Phonetic Combinations & Complex Assimilations:
 *    - Sokuon (っ / ッ) with basic consonants, yōon, loanword digraphs, trailing, and isolated
 *    - Chōonpu (ー) with vowel chaining, start-of-line, non-kana
 *    - Hangul Nasal Assimilation across syllable boundaries (Rule 3-1: ㅂ, ㄱ, ㄷ families before ㄴ/ㅁ)
 * 3. Malformed LRC Parsing & Stress:
 *    - Negative timestamps, invalid brackets, missing brackets, malformed tokens
 *    - Out-of-order timestamps and duplicate timestamp collisions
 *    - Null / undefined / invalid options and duration edge cases
 *    - Massive LRC files (10,000+ lines) performance and memory scaling
 * 4. API Error & Payload Fuzzing:
 *    - HTTP 404, 500, 503, 401, 418, 502 mock responses
 *    - Corrupted JSON, HTML error pages (e.g. Cloudflare / Nginx 502/503), null payloads, non-object JSON
 *    - Spicy Lyrics failover to LRCLIB on errors
 *    - Network timeouts, socket errors, and cancellation mid-flight
 * 5. LyricsSync Engine Stress & Adversarial Interaction:
 *    - Malformed lines (null text, missing timeMs)
 *    - Extreme timestamps and 10,000-line sync lookups
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import { Romanizer } from '../romanizer.js';
import { LyricsProvider } from '../lyricsProvider.js';
import { LyricsSync } from '../lyricsSync.js';

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const defectsFound = [];

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

async function test(testName, testFn) {
    totalTests++;
    try {
        await testFn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✓${ANSI_RESET} ${testName}`);
    } catch (e) {
        failedTests++;
        console.error(`  ${ANSI_RED}✗ ${testName}${ANSI_RESET}`);
        console.error(`    ${ANSI_RED}Error: ${e.message}${ANSI_RESET}`);
        defectsFound.push({ test: testName, error: e.message, stack: e.stack });
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

// Mock Network Session for API Fuzzing
class MockFuzzSession {
    constructor(handler) {
        this.handler = handler;
        this.requests = [];
    }

    async sendAsync(url, options = {}) {
        this.requests.push({ url, options });
        if (options.cancellable && options.cancellable.is_cancelled && options.cancellable.is_cancelled()) {
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
        }
        return await this.handler(url, options);
    }
}

console.log(`${ANSI_BOLD}Starting Empirical Challenger Suite for Milestone 2...${ANSI_RESET}`);

// =============================================================================
// Run all suites sequentially with top-level await
// =============================================================================

async function runChallengerSuite() {
    // -------------------------------------------------------------------------
    // Suite 1: Multilingual Romanization Fuzzing
    // -------------------------------------------------------------------------
    totalSuites++;
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}=== Suite: 1. Multilingual Romanization Fuzzing ===${ANSI_RESET}`);

    await test('1.1 Mixed Korean + Japanese + Cyrillic + English + Emojis + Numbers', () => {
        const complex = '🔥 1. BTS (방탄소년단) & YOASOBI (夜に駆ける / アイドル) & КИНО (Группа крови) - 100% Hits! 🚀';
        const result = Romanizer.romanize(complex);
        
        // Korean transliteration
        assert(result.includes('bangtansonyeondan'), `Expected 'bangtansonyeondan' in: ${result}`);
        // Japanese transliteration: Kana transliterated, Kanji preserved
        assert(result.includes('夜ni駆keru'), `Expected '夜ni駆keru' in: ${result}`);
        assert(result.includes('aidoru'), `Expected 'aidoru' in: ${result}`);
        // Cyrillic transliteration
        assert(result.includes('KINO'), `Expected 'KINO' in: ${result}`);
        assert(result.includes('Gruppa krovi'), `Expected 'Gruppa krovi' in: ${result}`);
        // Latin, emojis, numbers, and symbols preserved verbatim
        assert(result.includes('🔥 1. BTS'), `Expected '🔥 1. BTS' preserved`);
        assert(result.includes('YOASOBI'), `Expected 'YOASOBI' preserved`);
        assert(result.includes('- 100% Hits! 🚀'), `Expected '- 100% Hits! 🚀' preserved`);
    });

    await test('1.2 Robustness against non-string and nullish primitives', () => {
        const nullishCases = [null, undefined, 0, 42, -99.9, NaN, Infinity, true, false, {}, [], () => {}];
        for (const val of nullishCases) {
            try {
                const res = Romanizer.romanize(val);
                assertEquals(res, '', `romanize(${typeof val}) should return empty string`);
                const hasRom = Romanizer.hasRomanizableContent(val);
                assertEquals(hasRom, false, `hasRomanizableContent(${typeof val}) should return false`);
            } catch (e) {
                throw new Error(`Crashed on primitive ${String(val)}: ${e.message}`);
            }
        }
    });

    await test('1.3 Boundary Unicode characters and Standalone Jamo', () => {
        const jamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ';
        const jamoRes = Romanizer.romanize(jamo);
        assertEquals(jamoRes, jamo, 'Standalone Jamo should pass through untouched');

        const charBeforeHangul = String.fromCharCode(0xABFF);
        const hangulFirst = String.fromCharCode(0xAC00); // 가 -> ga
        const hangulLast = String.fromCharCode(0xD7A3);  // 힣 -> hih
        const charAfterHangul = String.fromCharCode(0xD7A4);

        assertEquals(Romanizer.romanize(charBeforeHangul), charBeforeHangul);
        assertEquals(Romanizer.romanize(hangulFirst), 'ga');
        assertEquals(Romanizer.romanize(hangulLast), 'hih');
        assertEquals(Romanizer.romanize(charAfterHangul), charAfterHangul);
    });

    await test('1.4 Emojis with surrogate pairs and zero-width joiners', () => {
        const emojiStr = '🎶 🎵 🎧 🎤 🎸 👨‍🎤 👩‍🎤';
        const res = Romanizer.romanize(emojiStr);
        assertEquals(res, emojiStr, 'Emojis and ZWJ sequences must pass through without corruption');
    });

    await test('1.5 Right-to-Left (RTL) Arabic & Hebrew script passthrough', () => {
        const rtl = 'مرحبا بالعالم - שלום עולם';
        const res = Romanizer.romanize(rtl);
        assertEquals(res, rtl, 'RTL text must pass through intact');
    });

    // -------------------------------------------------------------------------
    // Suite 2: Phonetic Edge Cases & Assimilations
    // -------------------------------------------------------------------------
    totalSuites++;
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}=== Suite: 2. Phonetic Edge Cases & Assimilations ===${ANSI_RESET}`);

    await test('2.1 Sokuon (っ / ッ) before Yōon digraphs and loanwords', () => {
        assertEquals(Romanizer.romanizeKana('まっちゃ'), 'matcha');
        assertEquals(Romanizer.romanizeKana('っちゃ'), 'tcha');
        assertEquals(Romanizer.romanizeKana('っきゃ'), 'kkya');
        assertEquals(Romanizer.romanizeKana('っしゃ'), 'ssha');
        assertEquals(Romanizer.romanizeKana('っちょ'), 'tcho');
        assertEquals(Romanizer.romanizeKana('っちゅ'), 'tchu');

        // ッ + Katakana loanwords
        assertEquals(Romanizer.romanizeKana('マッチェ'), 'matche');
        assertEquals(Romanizer.romanizeKana('バッファ'), 'baffa');
        assertEquals(Romanizer.romanizeKana('パッフォ'), 'paffo');
        assertEquals(Romanizer.romanizeKana('バッヂャ'), 'bajja');
    });

    await test('2.2 Sokuon boundary conditions (trailing, isolated, before non-kana)', () => {
        assertEquals(Romanizer.romanizeKana('あっ'), "a'");
        assertEquals(Romanizer.romanizeKana('えっ'), "e'");
        assertEquals(Romanizer.romanizeKana('あっ！'), "a'！");
        assertEquals(Romanizer.romanizeKana('あっ ほ'), "a' ho");

        assertEquals(Romanizer.romanizeKana('っっ'), "''");
        assertEquals(Romanizer.romanizeKana('っっっ'), "'''");
        assertEquals(Romanizer.romanizeKana('っか'), 'kka');
        assertEquals(Romanizer.romanizeKana('っち'), 'tchi');
    });

    await test('2.3 Chōonpu (ー) vowel prolongation edge cases', () => {
        assertEquals(Romanizer.romanizeKana('あーーー'), 'aaaa');
        assertEquals(Romanizer.romanizeKana('スーパーー'), 'suupaaa');
        assertEquals(Romanizer.romanizeKana('ーテスト'), 'atesuto');
        assertEquals(Romanizer.romanizeKana('abcー'), 'abca');
        assertEquals(Romanizer.romanizeKana('パーティー'), 'paatii');
        assertEquals(Romanizer.romanizeKana('フィーバー'), 'fiibaa');
        assertEquals(Romanizer.romanizeKana('ヴォーカル'), 'vookaru');
    });

    await test('2.4 Korean Revised Romanization Rule 3-1 Nasal Assimilation', () => {
        // ㅂ, ㅄ, ㅍ before ㄴ/ㅁ -> m
        assertEquals(Romanizer.romanizeHangul('감사합니다'), 'gamsahamnida');
        assertEquals(Romanizer.romanizeHangul('입마개'), 'immagae');
        assertEquals(Romanizer.romanizeHangul('없는'), 'eomneun');
        assertEquals(Romanizer.romanizeHangul('앞문'), 'ammun');

        // ㄱ, ㄲ, ㅋ before ㄴ/ㅁ -> ng
        assertEquals(Romanizer.romanizeHangul('백마'), 'baengma');
        assertEquals(Romanizer.romanizeHangul('국내'), 'gungnae');
        assertEquals(Romanizer.romanizeHangul('깎는'), 'kkangneun');
        assertEquals(Romanizer.romanizeHangul('부엌문'), 'bueongmun');

        // ㄷ, ㅅ, ㅆ, ㅈ, ㅊ, ㅌ before ㄴ/ㅁ -> n
        assertEquals(Romanizer.romanizeHangul('닫는'), 'danneun');
        assertEquals(Romanizer.romanizeHangul('옛날'), 'yennal');
        assertEquals(Romanizer.romanizeHangul('있네요'), 'inneyo');
        assertEquals(Romanizer.romanizeHangul('맞는'), 'manneun');
        assertEquals(Romanizer.romanizeHangul('쫓는'), 'jjonneun');
        assertEquals(Romanizer.romanizeHangul('붙는'), 'bunneun');
    });

    await test('2.5 Non-assimilation across whitespace boundaries', () => {
        assertEquals(Romanizer.romanizeHangul('밥맛'), 'bammat');
        assertEquals(Romanizer.romanizeHangul('밥 맛'), 'bap mat');
    });

    // -------------------------------------------------------------------------
    // Suite 3: Malformed LRC Parsing & Robustness
    // -------------------------------------------------------------------------
    totalSuites++;
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}=== Suite: 3. Malformed LRC Parsing & Robustness ===${ANSI_RESET}`);

    await test('3.1 Negative timestamps and non-matching formats', () => {
        const malformed = `
            [-01:23.45] Negative time
            [00:-10.00] Negative second
            [00:10.00] Valid lyric line
            [-00:05.00] Another negative
        `;
        const lines = LyricsProvider.parseLRC(malformed);
        assertEquals(lines.length, 1, 'Only valid positive timestamps must be parsed');
        assertEquals(lines[0].text, 'Valid lyric line');
        assertEquals(lines[0].timeMs, 10000);
    });

    await test('3.2 Malformed brackets, unclosed tags, and metadata lines', () => {
        const malformed = `
            [ti:Song Title]
            [ar:Artist Name]
            [offset:+500]
            00:12.34] Missing opening bracket
            [00:15.50 Missing closing bracket
            [[00:20.00]] Double brackets
            [00;25.00] Semicolon instead of colon
            [::] Empty colons
            [99:99.999] High minute/second line
            [00:30.00] Proper line
        `;
        const lines = LyricsProvider.parseLRC(malformed);
        assert(lines.length >= 2, `Parsed ${lines.length} lines without crashing`);
        const properLine = lines.find(l => l.text === 'Proper line');
        assert(properLine !== undefined, 'Proper line parsed correctly');
        assertEquals(properLine.timeMs, 30000);
    });

    await test('3.3 Out-of-order timestamps and duplicate timestamp collisions', () => {
        const disordered = `
            [02:00.00] Line 3
            [00:10.00] Line 1
            [00:10.00] Line 1 duplicate collision
            [01:00.00] Line 2
        `;
        const lines = LyricsProvider.parseLRC(disordered);
        assertEquals(lines.length, 4, 'All 4 lines parsed');
        assertEquals(lines[0].timeMs, 10000);
        assertEquals(lines[1].timeMs, 10000);
        assertEquals(lines[2].timeMs, 60000);
        assertEquals(lines[3].timeMs, 120000);

        assertEquals(lines[0].id, 0);
        assertEquals(lines[1].id, 1);
        assertEquals(lines[2].id, 2);
        assertEquals(lines[3].id, 3);

        assertEquals(lines[0].endTimeMs, 10000);
        assertEquals(lines[1].endTimeMs, 60000);
    });

    await test('3.4 Options null pointer check (Defect Detection)', () => {
        try {
            const res = LyricsProvider.parseLRC('[00:05.00] Hello', 0, null);
            assert(Array.isArray(res), 'Must return array');
        } catch (e) {
            throw new Error(`CRITICAL DEFECT: parseLRC crashed when options=null: ${e.message}`);
        }
    });

    await test('3.5 Massive LRC File Scale & Memory Test (10,000 lines)', () => {
        const lineCount = 10000;
        const chunks = [];

        for (let i = 0; i < lineCount; i++) {
            const min = String(Math.floor(i / 60)).padStart(2, '0');
            const sec = String(i % 60).padStart(2, '0');
            const text = (i % 3 === 0) ? `사랑해 ${i}` : (i % 3 === 1) ? `アイドル ${i}` : `Line ${i}`;
            chunks.push(`[${min}:${sec}.00] ${text}`);
        }
        const massiveLrc = chunks.join('\n');

        const parseStart = GLib.get_monotonic_time();
        const parsed = LyricsProvider.parseLRC(massiveLrc, lineCount * 1000);
        const parseElapsedMs = (GLib.get_monotonic_time() - parseStart) / 1000;

        assertEquals(parsed.length, lineCount, `Must parse all ${lineCount} lines`);
        console.log(`    ${ANSI_CYAN}ℹ Scaled: Parsed 10,000 lines in ${parseElapsedMs.toFixed(1)}ms${ANSI_RESET}`);
        assert(parseElapsedMs < 5000, `Parsing 10,000 lines took too long: ${parseElapsedMs}ms`);

        const sync = new LyricsSync();
        sync.setLyrics(parsed);

        const syncStart = GLib.get_monotonic_time();
        for (let t = 0; t < 1000; t++) {
            const testPos = t * 9500;
            const activeIdx = sync.findActiveIndex(testPos);
            assert(activeIdx >= 0 && activeIdx < lineCount, `Index ${activeIdx} valid for pos ${testPos}`);
        }
        const syncElapsedMs = (GLib.get_monotonic_time() - syncStart) / 1000;
        console.log(`    ${ANSI_CYAN}ℹ Scaled: 1,000 binary searches across 10,000 lines in ${syncElapsedMs.toFixed(1)}ms${ANSI_RESET}`);
        assert(syncElapsedMs < 1000, `Binary search too slow: ${syncElapsedMs}ms`);

        sync.destroy();
    });

    // -------------------------------------------------------------------------
    // Suite 4: API Error Fuzzing & Network Resilience
    // -------------------------------------------------------------------------
    totalSuites++;
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}=== Suite: 4. API Error Fuzzing & Resilience ===${ANSI_RESET}`);

    await test('4.1 HTTP 404, 500, 503 error status code handling', async () => {
        const errorCodes = [404, 500, 502, 503, 401, 403, 418];

        for (const code of errorCodes) {
            const mockSession = new MockFuzzSession(async () => {
                return {
                    status: code,
                    status_code: code,
                    body: `Error ${code}`,
                    get_response_body: () => ({ get_data: () => `Error ${code}` })
                };
            });

            const provider = new LyricsProvider({ session: mockSession });
            try {
                const res = await provider.fetchLyrics('Song', 'Artist', 'Album', 180);
                assertEquals(res.provider, 'none', `Status ${code} should gracefully yield provider 'none'`);
                assertEquals(res.lines.length, 0, `Status ${code} should yield 0 lines`);
            } catch (e) {
                throw new Error(`fetchLyrics crashed on HTTP ${code}: ${e.message}`);
            } finally {
                provider.destroy();
            }
        }
    });

    await test('4.2 Malformed JSON and HTML Error Pages (e.g. Cloudflare 502/503)', async () => {
        const weirdBodies = [
            '<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>',
            '<!DOCTYPE html><html><body>Error</body></html>',
            '{"unclosed_json": true, "corrupted":',
            '',
            '   \n\t   ',
            'null',
            '12345',
            '"plain string response"',
            '[null, undefined, 42]',
            '{"instrumental": false, "syncedLyrics": null, "plainLyrics": null}'
        ];

        for (const body of weirdBodies) {
            const mockSession = new MockFuzzSession(async () => {
                return {
                    status: 200,
                    status_code: 200,
                    body,
                    get_response_body: () => ({ get_data: () => body })
                };
            });

            const provider = new LyricsProvider({ session: mockSession });
            try {
                const res = await provider.fetchLyrics('Song', 'Artist', 'Album', 180);
                assert(res !== null && typeof res === 'object', 'Must return an object');
                assert(Array.isArray(res.lines), 'Must return lines array');
            } catch (e) {
                throw new Error(`fetchLyrics crashed on malformed body '${body.slice(0, 30)}...': ${e.message}`);
            } finally {
                provider.destroy();
            }
        }
    });

    await test('4.3 Spicy Lyrics failover to LRCLIB on token rejection & 418', async () => {
        let spicyCalled = false;
        let lrclibCalled = false;

        const mockSession = new MockFuzzSession(async (url) => {
            if (url.includes('spicylyrics.org')) {
                spicyCalled = true;
                return {
                    status: 418,
                    status_code: 418,
                    body: JSON.stringify({ error: "I'm a teapot", message: 'Invalid token' })
                };
            }
            if (url.includes('lrclib.net/api/get')) {
                lrclibCalled = true;
                return {
                    status: 200,
                    status_code: 200,
                    body: JSON.stringify({
                        syncedLyrics: '[00:01.00] LRCLIB Failover Success'
                    })
                };
            }
            return { status: 404, status_code: 404, body: '' };
        });

        const provider = new LyricsProvider({ session: mockSession });
        const res = await provider.fetchLyrics('Song', 'Artist', 'Album', 180, 'test_track_id', {
            enableSpicy: true,
            spicyToken: 'bad_token'
        });

        assert(spicyCalled, 'Spicy lyrics must have been queried first');
        assert(lrclibCalled, 'LRCLIB must have been queried as fallback');
        assertEquals(res.provider, 'lrclib');
        assertEquals(res.lines.length, 1);
        assertEquals(res.lines[0].text, 'LRCLIB Failover Success');
        provider.destroy();
    });

    await test('4.4 Network Exception / Connection Reset handling', async () => {
        const mockSession = new MockFuzzSession(async () => {
            throw new Error('Connection reset by peer');
        });

        const provider = new LyricsProvider({ session: mockSession });
        try {
            const res = await provider.fetchLyrics('Song', 'Artist', 'Album', 180);
            assertEquals(res.provider, 'none');
            assertEquals(res.lines.length, 0);
        } catch (e) {
            throw new Error(`Unhandled network exception: ${e.message}`);
        } finally {
            provider.destroy();
        }
    });

    await test('4.5 Mid-flight cancellation via cancel()', async () => {
        let timerId = 0;
        const mockSession = new MockFuzzSession(async (_url, opts) => {
            return new Promise((resolve, reject) => {
                timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    timerId = 0;
                    if (opts.cancellable && opts.cancellable.is_cancelled && opts.cancellable.is_cancelled()) {
                        reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Cancelled'));
                    } else {
                        resolve({
                            status: 200,
                            status_code: 200,
                            body: JSON.stringify({ syncedLyrics: '[00:01.00] Late' })
                        });
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });
        });

        const provider = new LyricsProvider({ session: mockSession });
        const promise = provider.fetchLyrics('Song', 'Artist', 'Album', 180);
        provider.cancel(); // Cancel immediately
        const res = await promise;

        if (timerId !== 0) GLib.source_remove(timerId);

        assertEquals(res.provider, 'none', 'Cancelled request must return empty result');
        assertEquals(res.lines.length, 0);
        provider.destroy();
    });

    // -------------------------------------------------------------------------
    // Suite 5: Sync Engine Adversarial Interaction
    // -------------------------------------------------------------------------
    totalSuites++;
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}=== Suite: 5. LyricsSync Adversarial Stress & Edge Cases ===${ANSI_RESET}`);

    await test('5.1 Malformed line objects (null text / missing fields)', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, text: 'Valid' },
                { timeMs: 2000, text: null },
                { timeMs: 3000 }
            ]);
            assert(sync.getLines().length === 3, 'Must handle 3 lines');
        } catch (e) {
            throw new Error(`CRITICAL DEFECT: setLyrics crashed on line with text=null: ${e.message}`);
        } finally {
            sync.destroy();
        }
    });

    await test('5.2 Extreme position values & non-numeric types', () => {
        const sync = new LyricsSync([
            { timeMs: 1000, text: 'First' },
            { timeMs: 5000, text: 'Second' }
        ]);

        const badPositions = [-999999999, 9999999999, NaN, Infinity, -Infinity, null, undefined, '1000', {}, []];
        for (const pos of badPositions) {
            try {
                sync.updatePosition(pos);
            } catch (e) {
                throw new Error(`updatePosition crashed on ${String(pos)}: ${e.message}`);
            }
        }
        sync.destroy();
    });

    await test('5.3 Rapid bouncing between duplicate-timestamp lines', () => {
        const sync = new LyricsSync([
            { timeMs: 1000, endTimeMs: 1000, text: 'A' },
            { timeMs: 1000, endTimeMs: 2000, text: 'B' }
        ]);

        let emissions = 0;
        sync.onLineChanged(() => emissions++);

        sync.updatePosition(500); // index -1
        sync.updatePosition(1000); // active
        sync.updatePosition(1500); // active
        sync.updatePosition(2500); // past

        assert(emissions <= 3, `Emissions (${emissions}) within expected bounds`);
        sync.destroy();
    });

    // -------------------------------------------------------------------------
    // Final Summary & Process Exit
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log(`${ANSI_BOLD}Challenger Empirical Execution Summary:${ANSI_RESET}`);
    console.log(`  Total Suites:  ${totalSuites}`);
    console.log(`  Total Tests:   ${totalTests}`);
    console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
    console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed Tests:  ${failedTests}${ANSI_RESET}`);
    console.log('======================================================');

    if (defectsFound.length > 0) {
        console.log(`\n${ANSI_BOLD}${ANSI_RED}Defects Detected Empirically:${ANSI_RESET}`);
        for (const d of defectsFound) {
            console.log(`  - ${ANSI_YELLOW}${d.test}${ANSI_RESET}: ${d.error}`);
        }
        System.exit(1);
    } else {
        console.log(`\n${ANSI_BOLD}${ANSI_GREEN}All adversarial stress and fuzzing challenges PASSED!${ANSI_RESET}\n`);
        System.exit(0);
    }
}

await runChallengerSuite();
