/**
 * Tier 2: Boundary & Corner Cases - Preferences & GSettings
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockSettings } from '../harness/mock_settings.js';

export function runBoundaryPreferencesTests() {
    describe('Tier 2: Boundary Cases - Preferences & Schema Bounds', () => {
        it('T2.26: Boundary value analysis for font-size: 12 and 48 pass, 11 and 49 reject', () => {
            const settings = new MockSettings();

            // Lower boundary
            settings.set_int('font-size', 12);
            expect(settings.get_int('font-size')).toBe(12);
            expect(() => settings.set_int('font-size', 11)).toThrow('out of range');

            // Upper boundary
            settings.set_int('font-size', 48);
            expect(settings.get_int('font-size')).toBe(48);
            expect(() => settings.set_int('font-size', 49)).toThrow('out of range');
        });

        it('T2.27: Boundary value analysis for line-spacing: 4 and 32 pass, 3 and 33 reject', () => {
            const settings = new MockSettings();

            // Lower boundary
            settings.set_int('line-spacing', 4);
            expect(settings.get_int('line-spacing')).toBe(4);
            expect(() => settings.set_int('line-spacing', 3)).toThrow('out of range');

            // Upper boundary
            settings.set_int('line-spacing', 32);
            expect(settings.get_int('line-spacing')).toBe(32);
            expect(() => settings.set_int('line-spacing', 33)).toThrow('out of range');
        });

        it('T2.28: Setting floating position to unsupported enum value throws choice error', () => {
            const settings = new MockSettings();

            expect(() => settings.set_string('floating-position', 'invalid-pos')).toThrow('not in choices');
            expect(() => settings.set_string('floating-position', '')).toThrow('not in choices');
        });

        it('T2.29: Setting integer key with floating-point number rejects non-integer', () => {
            const settings = new MockSettings();

            expect(() => settings.set_int('font-size', 22.5)).toThrow('expected integer');
            expect(() => settings.set_int('line-spacing', 14.8)).toThrow('expected integer');
        });

        it('T2.30: spicy-lyrics-token accepts empty string and arbitrary string length', () => {
            const settings = new MockSettings();

            settings.set_string('spicy-lyrics-token', '');
            expect(settings.get_string('spicy-lyrics-token')).toBe('');

            const longToken = 'token_'.repeat(100);
            settings.set_string('spicy-lyrics-token', longToken);
            expect(settings.get_string('spicy-lyrics-token')).toBe(longToken);
        });
    });
}
