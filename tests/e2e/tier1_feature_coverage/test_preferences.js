/**
 * Tier 1: Feature Coverage - Preferences & GSettings
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockSettings, SCHEMA_DEFAULTS, SCHEMA_CHOICES, SCHEMA_RANGES } from '../harness/mock_settings.js';

export function runPreferencesTests() {
    describe('Tier 1: Preferences & GSettings Schema', () => {
        it('T1.26: Declares and validates all 14 schema keys with strict types', () => {
            const settings = new MockSettings();
            const expectedKeys = [
                'show-in-panel',
                'show-floating',
                'floating-always-on-top',
                'floating-click-passthrough',
                'floating-position',
                'floating-x',
                'floating-y',
                'font-family',
                'font-size',
                'line-spacing',
                'background-style',
                'enable-spicy-lyrics',
                'spicy-lyrics-token',
                'enable-romanization'
            ];

            expect(expectedKeys.length).toBe(14);
            for (const key of expectedKeys) {
                expect(key in SCHEMA_DEFAULTS).toBe(true);
            }

            // Defaults verification
            expect(settings.get_boolean('show-in-panel')).toBe(true);
            expect(settings.get_boolean('show-floating')).toBe(true);
            expect(settings.get_boolean('floating-always-on-top')).toBe(true);
            expect(settings.get_boolean('floating-click-passthrough')).toBe(false);
            expect(settings.get_string('floating-position')).toBe('top-right');
            expect(settings.get_int('font-size')).toBe(22);
            expect(settings.get_int('line-spacing')).toBe(14);
            expect(settings.get_string('background-style')).toBe('transparent');
            expect(settings.get_boolean('enable-spicy-lyrics')).toBe(false);
            expect(settings.get_string('spicy-lyrics-token')).toBe('');
            expect(settings.get_boolean('enable-romanization')).toBe(true);
        });

        it('T1.27: Enforces numerical bounds for font-size [12, 48] and line-spacing [4, 32]', () => {
            const settings = new MockSettings();

            // Valid values
            settings.set_int('font-size', 12);
            expect(settings.get_int('font-size')).toBe(12);
            settings.set_int('font-size', 48);
            expect(settings.get_int('font-size')).toBe(48);

            // Out-of-bound values must throw
            expect(() => settings.set_int('font-size', 11)).toThrow('out of range');
            expect(() => settings.set_int('font-size', 49)).toThrow('out of range');

            // Line spacing
            settings.set_int('line-spacing', 4);
            expect(settings.get_int('line-spacing')).toBe(4);
            settings.set_int('line-spacing', 32);
            expect(settings.get_int('line-spacing')).toBe(32);

            expect(() => settings.set_int('line-spacing', 3)).toThrow('out of range');
            expect(() => settings.set_int('line-spacing', 33)).toThrow('out of range');
        });

        it('T1.28: Enforces choice validation for floating-position and background-style', () => {
            const settings = new MockSettings();

            // Valid position choices
            for (const pos of SCHEMA_CHOICES['floating-position']) {
                settings.set_string('floating-position', pos);
                expect(settings.get_string('floating-position')).toBe(pos);
            }
            // Invalid position
            expect(() => settings.set_string('floating-position', 'top-middle')).toThrow('not in choices');

            // Valid background styles
            for (const style of SCHEMA_CHOICES['background-style']) {
                settings.set_string('background-style', style);
                expect(settings.get_string('background-style')).toBe(style);
            }
            // Invalid background style
            expect(() => settings.set_string('background-style', 'neon-glow')).toThrow('not in choices');
        });

        it('T1.29: Live GSettings changes trigger real-time signal notifications', () => {
            const settings = new MockSettings();
            let changedKey = null;

            settings.connect('changed::floating-click-passthrough', (s, key) => {
                changedKey = key;
            });

            settings.set_boolean('floating-click-passthrough', true);
            expect(changedKey).toBe('floating-click-passthrough');
            expect(settings.get_boolean('floating-click-passthrough')).toBe(true);
        });

        it('T1.30: Unknown schema keys are strictly rejected with exceptions', () => {
            const settings = new MockSettings();
            expect(() => settings.get_string('non_existent_key')).toThrow('Unknown key');
            expect(() => settings.set_string('non_existent_key', 'val')).toThrow('Unknown key');
        });
    });
}
