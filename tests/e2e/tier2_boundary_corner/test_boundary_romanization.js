/**
 * Tier 2: Boundary & Corner Cases - Romanization Engine
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { loadModule } from '../harness/module_loader.js';

export function runBoundaryRomanizationTests() {
    describe('Tier 2: Boundary Cases - Romanizer', () => {
        it('T2.11: Empty string, null, or undefined returns empty string safely', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            expect(Romanizer.romanize('')).toBe('');
            expect(Romanizer.romanize(null)).toBe('');
            expect(Romanizer.romanize(undefined)).toBe('');
        });

        it('T2.12: Standalone uncombined Jamo (ㄱ, ㅏ) does not crash decomposition formula', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // Standalone Jamo outside U+AC00 - U+D7A3 syllable block
            const jamo = 'ㅋㅋㅋ ㅎㅎㅎ ㅠㅠ';
            expect(Romanizer.romanizeHangul(jamo)).toBe('ㅋㅋㅋ ㅎㅎㅎ ㅠㅠ');
        });

        it('T2.13: Trailing Japanese sokuon (あっ!) appends apostrophe rather than crashing on lookahead', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // Sokuon at end of string
            expect(Romanizer.romanizeKana('あっ')).toBe("a'");
            expect(Romanizer.romanizeKana('えっ！')).toBe("e'！");
        });

        it('T2.14: Japanese chōonpu prolongation repeats preceding vowel in Latin', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            expect(Romanizer.romanizeKana('ラーメン')).toBe('raamen');
            expect(Romanizer.romanizeKana('コーヒー')).toBe('koohii');
            expect(Romanizer.romanizeKana('スーパー')).toBe('suupaa');
        });

        it('T2.15: Cyrillic soft sign (ь) and hard sign (ъ) omit cleanly without corruption', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // "Объект" -> "Obekt" (ъ omitted), "День" -> "Den", "Пять" -> "Pyat"
            expect(Romanizer.romanizeCyrillic('День')).toBe('Den');
            expect(Romanizer.romanizeCyrillic('Пять')).toBe('Pyat');
            expect(Romanizer.romanizeCyrillic('Объект')).toBe('Obekt');
        });
    });
}
