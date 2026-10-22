#!/usr/bin/env gjs -m

/**
 * Adversarial Stress & Edge-Case Test Suite for Milestone 2 (Lyrics & Romanization)
 * Tested by Reviewer 2
 */

import System from 'system';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Romanizer } from '../romanizer.js';
import { LyricsProvider } from '../lyricsProvider.js';
import { LyricsSync } from '../lyricsSync.js';

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

async function describe(suiteName, suiteFn) {
    totalSuites++;
    console.log(`\n${ANSI_BOLD}=== Adversarial Suite: ${suiteName} ===${ANSI_RESET}`);
    await suiteFn();
}

async function testAsync(testName, testFn) {
    totalTests++;
    try {
        await testFn();
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

function testSync(testName, testFn) {
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

// Mock Network Session for testing async cancellation, errors, and delays
class MockDelayedSession {
    constructor(handler) {
        this._handler = handler;
        this.activeRequests = 0;
        this.cancelledRequests = 0;
    }

    async sendAsync(url, options = {}) {
        this.activeRequests++;
        const cancellable = options.cancellable;

        if (cancellable && cancellable.is_cancelled && cancellable.is_cancelled()) {
            this.cancelledRequests++;
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
        }

        return new Promise((resolve, reject) => {
            let cancellableId = 0;
            let timerSource = null;

            if (cancellable && cancellable.connect) {
                cancellableId = cancellable.connect(() => {
                    this.cancelledRequests++;
                    if (timerSource) GLib.source_remove(timerSource);
                    reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled'));
                });
            }

            const responseSpec = this._handler(url, options);
            const delayMs = responseSpec.delayMs || 5;

            timerSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                if (cancellableId && cancellable && cancellable.disconnect) {
                    cancellable.disconnect(cancellableId);
                }
                if (responseSpec.error) {
                    reject(new Error(responseSpec.error));
                } else {
                    resolve({
                        status: responseSpec.status || 200,
                        status_code: responseSpec.status || 200,
                        body: responseSpec.body !== undefined ? responseSpec.body : '{}',
                        get_response_body: () => ({
                            get_data: () => typeof responseSpec.body === 'string' ? responseSpec.body : JSON.stringify(responseSpec.body)
                        })
                    });
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }
}

async function runAll() {
    // =========================================================================
    // Suite 1: Request Cancellation & Race Condition Resistance
    // =========================================================================
    await describe('1. Libsoup / Network Request Cancellation & Concurrency', async () => {
        await testAsync('1.1 Rapid track switching cancels previous in-flight requests cleanly', async () => {
            const mock = new MockDelayedSession((url) => {
                if (url.includes('Track1')) {
                    return { delayMs: 40, status: 200, body: JSON.stringify({ syncedLyrics: '[00:01.00] Track 1 Lyrics' }) };
                }
                if (url.includes('Track2')) {
                    return { delayMs: 40, status: 200, body: JSON.stringify({ syncedLyrics: '[00:01.00] Track 2 Lyrics' }) };
                }
                return { delayMs: 10, status: 200, body: JSON.stringify({ syncedLyrics: '[00:01.00] Track 3 Final' }) };
            });

            const provider = new LyricsProvider(mock);
            try {
                // Fire track 1
                const p1 = provider.fetchLyrics('Track1', 'Artist1', 'Album', 180);
                // Immediately switch to track 2
                const p2 = provider.fetchLyrics('Track2', 'Artist2', 'Album', 180);
                // Immediately switch to track 3
                const p3 = provider.fetchLyrics('Track3', 'Artist3', 'Album', 180);

                const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

                // Track 1 and 2 were cancelled and return empty fallback
                assertEquals(r1.lines.length, 0, 'Track 1 was cancelled');
                assertEquals(r2.lines.length, 0, 'Track 2 was cancelled');
                // Track 3 completes successfully
                assertEquals(r3.lines.length, 1, 'Track 3 resolves successfully');
                assertEquals(r3.lines[0].text, 'Track 3 Final');
                assert(mock.cancelledRequests >= 2, 'At least 2 requests were formally cancelled');
            } finally {
                provider.destroy();
            }
        });

        await testAsync('1.2 Calling cancel() aborts in-flight request and returns empty result', async () => {
            const mock = new MockDelayedSession(() => {
                return { delayMs: 50, status: 200, body: JSON.stringify({ syncedLyrics: '[00:01.00] In-flight line' }) };
            });

            const provider = new LyricsProvider(mock);
            try {
                const fetchPromise = provider.fetchLyrics('LongTrack', 'Artist', 'Album', 200);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                    provider.cancel();
                    return GLib.SOURCE_REMOVE;
                });

                const result = await fetchPromise;
                assertEquals(result.lines.length, 0, 'Cancelled request returns empty lines');
                assertEquals(result.provider, 'none');
            } finally {
                provider.destroy();
            }
        });

        await testAsync('1.3 Calling destroy() during active network request does not throw unhandled exception', async () => {
            const mock = new MockDelayedSession(() => {
                return { delayMs: 50, status: 200, body: JSON.stringify({ syncedLyrics: '[00:01.00] In-flight line' }) };
            });

            const provider = new LyricsProvider(mock);
            const fetchPromise = provider.fetchLyrics('Song', 'Artist', 'Album', 200);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                provider.destroy();
                return GLib.SOURCE_REMOVE;
            });

            const result = await fetchPromise;
            assertEquals(result.lines.length, 0);

            // Fetching after destroy returns empty safely
            const postDestroy = await provider.fetchLyrics('Another', 'Artist', 'Album', 200);
            assertEquals(postDestroy.lines.length, 0);
            assertEquals(postDestroy.provider, 'none');
        });
    });

    // =========================================================================
    // Suite 2: Spicy Lyrics Failover & Resiliency
    // =========================================================================
    await describe('2. Spicy Lyrics Failover to LRCLIB without User-Visible Exceptions', async () => {
        await testAsync('2.1 HTTP 418 Teapot (bot/rate detection) transparently falls back to LRCLIB', async () => {
            const mock = new MockDelayedSession((url) => {
                if (url.includes('spicylyrics.org')) {
                    return { status: 418, body: 'I\'m a teapot' };
                }
                if (url.includes('lrclib.net/api/get')) {
                    return { status: 200, body: JSON.stringify({ syncedLyrics: '[00:02.00] LRCLIB Fallback Line' }) };
                }
                return { status: 404, body: '{}' };
            });

            const provider = new LyricsProvider(mock);
            try {
                const result = await provider.fetchLyrics('Track', 'Artist', 'Album', 180, '12345', {
                    enableSpicy: true,
                    spicyToken: 'secret_token_abc'
                });

                assertEquals(result.provider, 'lrclib', 'Must fail over to lrclib');
                assertEquals(result.lines.length, 1);
                assertEquals(result.lines[0].text, 'LRCLIB Fallback Line');
            } finally {
                provider.destroy();
            }
        });

        await testAsync('2.2 HTTP 401 Unauthorized (expired/bad token) transparently falls back to LRCLIB', async () => {
            const mock = new MockDelayedSession((url) => {
                if (url.includes('spicylyrics.org')) {
                    return { status: 401, body: '{"error": "Unauthorized"}' };
                }
                if (url.includes('lrclib.net/api/get')) {
                    return { status: 200, body: JSON.stringify({ syncedLyrics: '[00:05.00] LRCLIB Line' }) };
                }
                return { status: 404, body: '{}' };
            });

            const provider = new LyricsProvider(mock);
            try {
                const result = await provider.fetchLyrics('Song', 'Artist', 'Album', 180, '54321', {
                    enableSpicy: true,
                    spicyToken: 'invalid_token'
                });

                assertEquals(result.provider, 'lrclib');
                assertEquals(result.lines.length, 1);
            } finally {
                provider.destroy();
            }
        });

        await testAsync('2.3 Spicy 500 Server Error + LRCLIB exact 404 + LRCLIB search 200', async () => {
            const mock = new MockDelayedSession((url) => {
                if (url.includes('spicylyrics.org')) {
                    return { status: 500, body: 'Internal Server Error' };
                }
                if (url.includes('lrclib.net/api/get')) {
                    return { status: 404, body: '{"error": "Not Found"}' };
                }
                if (url.includes('lrclib.net/api/search')) {
                    return {
                        status: 200,
                        body: JSON.stringify([
                            { duration: 180, syncedLyrics: '[00:10.00] Search match lyric' }
                        ])
                    };
                }
                return { status: 404, body: '{}' };
            });

            const provider = new LyricsProvider(mock);
            try {
                const result = await provider.fetchLyrics('SearchSong', 'SearchArtist', 'Album', 180, '999', {
                    enableSpicy: true,
                    spicyToken: 'token'
                });

                assertEquals(result.provider, 'lrclib_search', 'Fell back to lrclib search');
                assertEquals(result.lines.length, 1);
                assertEquals(result.lines[0].text, 'Search match lyric');
            } finally {
                provider.destroy();
            }
        });

        await testAsync('2.4 Corrupted/Malformed TTML payload in Spicy Lyrics falls back without crash', async () => {
            const mock = new MockDelayedSession((url) => {
                if (url.includes('spicylyrics.org')) {
                    return {
                        status: 200,
                        body: JSON.stringify({
                            type: 'syllable_ttml',
                            ttml: '<tt><broken><p begin="invalid" end="nonsense">No end tag'
                        })
                    };
                }
                if (url.includes('lrclib.net/api/get')) {
                    return { status: 200, body: JSON.stringify({ syncedLyrics: '[00:03.00] Resilient recovery' }) };
                }
                return { status: 404, body: '{}' };
            });

            const provider = new LyricsProvider(mock);
            try {
                const result = await provider.fetchLyrics('Song', 'Artist', 'Album', 180, '888', {
                    enableSpicy: true,
                    spicyToken: 'token'
                });

                assertEquals(result.provider, 'lrclib');
                assertEquals(result.lines[0].text, 'Resilient recovery');
            } finally {
                provider.destroy();
            }
        });

        await testAsync('2.5 Complete network failure across all endpoints returns empty result cleanly', async () => {
            const mock = new MockDelayedSession(() => {
                return { error: 'Network is unreachable' };
            });

            const provider = new LyricsProvider(mock);
            try {
                const result = await provider.fetchLyrics('Offline', 'Artist', 'Album', 180);
                assertEquals(result.provider, 'none');
                assertEquals(result.lines.length, 0);
            } finally {
                provider.destroy();
            }
        });
    });

    // =========================================================================
    // Suite 3: Romanization Boundaries, Corner Cases & Language Stresses
    // =========================================================================
    await describe('3. Romanization Edge Cases & Corner Cases', () => {
        testSync('3.1 Standalone uncombined Hangul Jamo pass through without throwing', () => {
            const jamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ ㅋㅋㅋ ㅎㅎㅎ';
            const romanized = Romanizer.romanize(jamo);
            assertEquals(romanized, jamo, 'Standalone jamo must pass through untouched');
        });

        testSync('3.2 Hangul Unicode boundary syllable codepoints (0xAC00 and 0xD7A3)', () => {
            // 0xAC00 is '가' (ga)
            assertEquals(Romanizer.romanizeHangul('\uAC00'), 'ga');
            // 0xD7A3 is '힣' (hih)
            assertEquals(Romanizer.romanizeHangul('\uD7A3'), 'hih');
        });

        testSync('3.3 Complex Korean nasal assimilation across boundaries', () => {
            // ㅂ before ㄴ: 합니다 -> hamnida
            assertEquals(Romanizer.romanizeHangul('합니다'), 'hamnida');
            // ㄱ before ㅁ: 국물 -> gungmul
            assertEquals(Romanizer.romanizeHangul('국물'), 'gungmul');
            // ㅂ before ㅁ: 밥물 -> bammul
            assertEquals(Romanizer.romanizeHangul('밥물'), 'bammul');
            // ㄷ before ㄴ: 닫는 -> danneun
            assertEquals(Romanizer.romanizeHangul('닫는'), 'danneun');
        });

        testSync('3.4 Japanese Kana: sokuon geminate edge cases and trailing small tsu', () => {
            // Trailing sokuon: あっ! -> a'!
            assertEquals(Romanizer.romanizeKana('あっ!'), "a'!");
            // Consecutive sokuon: っっ -> ''
            assertEquals(Romanizer.romanizeKana('っっ'), "''");
            // Sokuon before 'ch': まっちゃ -> matcha
            assertEquals(Romanizer.romanizeKana('まっちゃ'), 'matcha');
            // Sokuon before non-kana: っ123 -> '123
            assertEquals(Romanizer.romanizeKana('っ123'), "'123");
        });

        testSync('3.5 Japanese Kana: Chōonpu (ー) vowel prolongation variations', () => {
            assertEquals(Romanizer.romanizeKana('あーいーうーえーおー'), 'aaiiuueeoo');
            // Chōonpu at start of line defaults to 'a'
            assertEquals(Romanizer.romanizeKana('ー'), 'a');
        });

        testSync('3.6 Katakana rare digraphs and loanwords', () => {
            assertEquals(Romanizer.romanizeKana('クァルテット'), 'kwarutetto');
            assertEquals(Romanizer.romanizeKana('ウィキペディア'), 'wikipedia');
            assertEquals(Romanizer.romanizeKana('ヴァイオリン'), 'vaiorin');
        });

        testSync('3.7 Slavic Cyrillic case preservation and sign omission', () => {
            // Hard sign omitted: подъезд -> podezd
            assertEquals(Romanizer.romanizeCyrillic('подъезд'), 'podezd');
            // Soft sign omitted: пыль -> pyl
            assertEquals(Romanizer.romanizeCyrillic('пыль'), 'pyl');
            // Mixed case: СъЕзД -> SEzD
            assertEquals(Romanizer.romanizeCyrillic('СъЕзД'), 'SEzD');
            // Ukrainian specific: Їжак -> Yizhak, Ґанок -> Ganok
            assertEquals(Romanizer.romanizeCyrillic('Їжак'), 'Yizhak');
            assertEquals(Romanizer.romanizeCyrillic('Ґанок'), 'Ganok');
        });

        testSync('3.8 Defensive inputs: non-strings, symbols, emojis, and massive payloads', () => {
            assertEquals(Romanizer.romanize(null), '');
            assertEquals(Romanizer.romanize(undefined), '');
            assertEquals(Romanizer.romanize(12345), '');
            assertEquals(Romanizer.romanize({}), '');
            assertEquals(Romanizer.romanize('   '), '   ');
            assertEquals(Romanizer.romanize('🎵 🎶 🔥'), '🎵 🎶 🔥');

            // 10,000-character mixed stress
            const chunk = 'Stay in the middle! 말해줘 (say it back) ありがとう ラーメン Привет! ';
            const largeText = chunk.repeat(150); // ~10,500 chars
            const start = GLib.get_monotonic_time();
            const result = Romanizer.romanize(largeText);
            const elapsedMs = (GLib.get_monotonic_time() - start) / 1000;
            assert(result.length > 0, 'Large romanization produced result');
            assert(elapsedMs < 500, `Large romanization was fast (${elapsedMs.toFixed(1)}ms)`);
        });
    });

    // =========================================================================
    // Suite 4: Zero-Event-Flooding Deduplication in LyricsSync
    // =========================================================================
    await describe('4. Zero-Event-Flooding Deduplication in LyricsSync', () => {
        testSync('4.1 10,000 rapid steady-state ticks produce zero redundant emissions', () => {
            const sync = new LyricsSync();
            try {
                sync.setLyrics([
                    { timeMs: 1000, endTimeMs: 4000, text: 'Line 1' },
                    { timeMs: 4000, endTimeMs: 8000, text: 'Line 2' },
                    { timeMs: 8000, endTimeMs: 12000, text: 'Line 3' },
                ]);

                let emitCount = 0;
                sync.connect('line-changed', () => {
                    emitCount++;
                });

                // 10,000 ticks within Line 1 (1000ms to 3999ms, stepping by 0.3ms)
                for (let i = 0; i < 10000; i++) {
                    const pos = 1000 + (i * 0.29);
                    sync.updatePosition(pos);
                }

                assertEquals(emitCount, 1, 'Only one emission on entry into Line 1; zero ticks afterwards');
                assertEquals(sync.getCurrentIndex(), 0);
            } finally {
                sync.destroy();
            }
        });

        testSync('4.2 High-frequency oscillation across line boundary emits correctly without desync', () => {
            const sync = new LyricsSync();
            try {
                sync.setLyrics([
                    { timeMs: 1000, endTimeMs: 3000, text: 'Line 1' },
                    { timeMs: 3000, endTimeMs: 5000, text: 'Line 2' },
                ]);

                let emitCount = 0;
                sync.connect('line-changed', () => { emitCount++; });

                // Oscillate around boundary 3000ms: 2990 <-> 3010 (50 times)
                for (let i = 0; i < 50; i++) {
                    sync.updatePosition(2990);
                    sync.updatePosition(3010);
                }

                // Should have flipped 100 times cleanly
                assertEquals(emitCount, 100);
                assertEquals(sync.getCurrentIndex(), 1);
            } finally {
                sync.destroy();
            }
        });

        testSync('4.3 Non-numeric and extreme position inputs are ignored safely', () => {
            const sync = new LyricsSync();
            try {
                sync.setLyrics([
                    { timeMs: 1000, text: 'Line 1' }
                ]);

                let emitCount = 0;
                sync.connect('line-changed', () => { emitCount++; });

                sync.updatePosition(NaN);
                sync.updatePosition('1000');
                sync.updatePosition(null);
                sync.updatePosition(undefined);
                sync.updatePosition({});

                assertEquals(emitCount, 0, 'No emissions for corrupt position inputs');
                assertEquals(sync.getCurrentIndex(), -1);
            } finally {
                sync.destroy();
            }
        });

        testSync('4.4 Binary search performance with 1,000 lyric lines', () => {
            const sync = new LyricsSync();
            try {
                const lines = [];
                for (let i = 0; i < 1000; i++) {
                    lines.push({ timeMs: i * 1000, endTimeMs: (i + 1) * 1000, text: `Line ${i}` });
                }
                sync.setLyrics(lines);

                const start = GLib.get_monotonic_time();
                for (let i = 0; i < 10000; i++) {
                    const randomPos = Math.floor(Math.random() * 1000000);
                    sync.findActiveIndex(randomPos);
                }
                const elapsedMs = (GLib.get_monotonic_time() - start) / 1000;
                assert(elapsedMs < 100, `10,000 binary searches took ${elapsedMs.toFixed(1)}ms (< 100ms)`);
            } finally {
                sync.destroy();
            }
        });
    });

    // =========================================================================
    // Suite 5: Lifecycle & Destruction Memory Leak Checks
    // =========================================================================
    await describe('5. Clean destroy() and Lifecycle Resilience', () => {
        testSync('5.1 500 rapid create-populate-destroy cycles execute cleanly', () => {
            for (let i = 0; i < 500; i++) {
                const sync = new LyricsSync();
                sync.setLyrics([
                    { timeMs: 100, text: 'A' },
                    { timeMs: 200, text: 'B' }
                ]);
                sync.updatePosition(150);
                sync.destroy();
                assertEquals(sync.getCurrentIndex(), -1);
                assertEquals(sync.getLines().length, 0);

                const provider = new LyricsProvider();
                provider.destroy();
            }
        });

        testSync('5.2 Multiple calls to destroy() are idempotent', () => {
            const sync = new LyricsSync();
            sync.destroy();
            sync.destroy();
            sync.destroy();

            const provider = new LyricsProvider();
            provider.destroy();
            provider.destroy();
            provider.destroy();
        });

        testSync('5.3 Signal emission after destroy is suppressed', () => {
            const sync = new LyricsSync();
            let emitted = false;
            sync.connect('line-changed', () => { emitted = true; });
            sync.destroy();
            sync.updatePosition(500);
            assert(!emitted, 'No emission after destroy');
        });
    });

    // =========================================================================
    // Summary & Exit
    // =========================================================================
    console.log('\n======================================================');
    console.log(`${ANSI_BOLD}Reviewer 2 Adversarial Stress Test Summary:${ANSI_RESET}`);
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
}

runAll().catch(e => {
    console.error('Fatal runner error:', e);
    System.exit(1);
});
