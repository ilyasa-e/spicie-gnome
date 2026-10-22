/**
 * Tier 1: Feature Coverage - Romanization Engine
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { loadModule } from '../harness/module_loader.js';

export function runRomanizationTests() {
    describe('Tier 1: Romanization Engine', () => {
        it('T1.11: Transliterates Korean Hangul syllables using Revised Romanization decomposition', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // Simple syllables
            expect(Romanizer.romanizeHangul('가')).toBe('ga');
            expect(Romanizer.romanizeHangul('나')).toBe('na');
            expect(Romanizer.romanizeHangul('다')).toBe('da');
            expect(Romanizer.romanizeHangul('한')).toBe('han');
            expect(Romanizer.romanizeHangul('글')).toBe('geul');
            expect(Romanizer.romanizeHangul('한국')).toBe('hanguk');

            // Complex syllables with final consonants
            expect(Romanizer.romanizeHangul('말해줘')).toBe('malhaejwo');
        });

        it('T1.12: Transliterates Japanese Hiragana and Katakana using Hepburn romanization', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // Hiragana
            expect(Romanizer.romanizeKana('ありがとう')).toBe('arigatou');
            expect(Romanizer.romanizeKana('さようなら')).toBe('sayounara');

            // Katakana
            expect(Romanizer.romanizeKana('メディア')).toBe('media');
            expect(Romanizer.romanizeKana('エリア')).toBe('eria');
            expect(Romanizer.romanizeKana('アイドル')).toBe('aidoru');
        });

        it('T1.13: Transliterates Japanese yōon digraphs and geminate sokuon', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            // Yōon digraphs
            expect(Romanizer.romanizeKana('とうきょう')).toBe('toukyou'); // きょ -> kyo
            expect(Romanizer.romanizeKana('しゃしん')).toBe('shashin');   // しゃ -> sha
            expect(Romanizer.romanizeKana('ちょっと')).toBe('chotto');   // ちょ -> cho + っと -> tto

            // Sokuon gemination (っ)
            expect(Romanizer.romanizeKana('きっと')).toBe('kitto');
            expect(Romanizer.romanizeKana('がっこう')).toBe('gakkou');
        });

        it('T1.14: Transliterates Slavic Cyrillic alphabets to Latin with case preservation', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            expect(Romanizer.romanizeCyrillic('Привет')).toBe('Privet');
            expect(Romanizer.romanizeCyrillic('КИНО')).toBe('KINO');
            expect(Romanizer.romanizeCyrillic('Группа крови')).toBe('Gruppa krovi');
            expect(Romanizer.romanizeCyrillic('Теплое место')).toBe('Teploe mesto');
        });

        it('T1.15: Preserves mixed English, ASCII punctuation, and non-target characters verbatim', async () => {
            const mod = await loadModule('romanizer');
            const Romanizer = mod.Romanizer || mod.default;

            const mixedHangul = 'Stay in the middle! 말해줘 (Say it back)';
            const romanized = Romanizer.romanize(mixedHangul);

            expect(romanized).toContain('Stay in the middle!');
            expect(romanized).toContain('malhaejwo');
            expect(romanized).toContain('(Say it back)');

            const kanaPunctuation = 'きょうなにたべた？「すきなほんは？」';
            const kanaRom = Romanizer.romanize(kanaPunctuation);
            expect(kanaRom).toContain('kyounanitabeta？');
        });
    });
}
