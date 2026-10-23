/**
 * Tier 2: Boundary & Corner Cases - UI Presentation Surfaces
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { loadModule } from '../harness/module_loader.js';
import { FloatingLyricsHUDApp } from '../../../bin/spotify-floating-hud';

export function runBoundaryUiTests() {
    describe('Tier 2: Boundary Cases - UI Surfaces', () => {
        it('T2.21: Super-long lyric line (500+ characters) stays one complete row', async () => {
            const view = await loadModule('lyricsView');

            const longWords = 'Very long word '.repeat(50).trim();
            const line = { id: 0, timeMs: 0, startTimeMs: 0, endTimeMs: 60000, words: longWords, text: longWords };
            const frame = view.floatingFrame([line], 1000, 1, false);

            expect(frame.rows.length).toBe(1);
            expect(frame.rows[0].line.words.length).toBe(longWords.length);
            expect(frame.rows[0].line.words.length).toBeGreaterThan(500);
        });

        it('T2.22: Screen geometry change re-evaluates the work area for a preset position', async () => {
            const presentation = await loadModule('lyricsPresentation');

            const fullHd = presentation.floatingPosition(
                { x: 0, y: 0, width: 1920, height: 1080 }, 480, 120, 'top-right');
            expect(fullHd.x).toBe(1920 - 480 - 24);
            expect(fullHd.y).toBe(24);

            const ultraHd = presentation.floatingPosition(
                { x: 0, y: 0, width: 3840, height: 2160 }, 480, 120, 'top-right');
            expect(ultraHd.x).toBe(3840 - 480 - 24);
            expect(ultraHd.y).toBe(24);
        });

        it('T2.23: Custom coordinates are applied and clamped to the work area', async () => {
            const presentation = await loadModule('lyricsPresentation');
            const area = { x: 0, y: 0, width: 1920, height: 1080 };

            expect(presentation.floatingPosition(area, 480, 120, 'custom', 350, 450)).toEqual({ x: 350, y: 450 });
            expect(presentation.floatingPosition(area, 480, 120, 'custom', 5000, 5000))
                .toEqual({ x: 1920 - 480, y: 1080 - 120 });
        });

        it('T2.24: Click passthrough toggles the lyrics window input region', () => {
            const settings = new MockSettings();
            let region = 'untouched';
            const surface = { set_input_region: value => { region = value; } };
            const fakeWindow = { _settings: settings, _win: { get_surface: () => surface } };

            // GDK rejects a null region from JavaScript, so full input is an
            // explicit rectangle and pass-through is an empty region.
            FloatingLyricsHUDApp.prototype._applyClickPassthrough.call(fakeWindow);
            expect(region !== null && region.numRectangles() === 1).toBe(true);

            settings.set_boolean('floating-click-passthrough', true);
            FloatingLyricsHUDApp.prototype._applyClickPassthrough.call(fakeWindow);
            expect(region !== null && region.numRectangles() === 0).toBe(true);

            settings.set_boolean('floating-click-passthrough', false);
            FloatingLyricsHUDApp.prototype._applyClickPassthrough.call(fakeWindow);
            expect(region.numRectangles() === 1).toBe(true);
        });

        it('T2.25: Zero-height or empty lyrics view handles active line without throwing', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();

            const indMod = await loadModule('indicator');
            const IndClass = indMod.SpotifyIndicator || indMod.PanelIndicator || indMod.default;
            const indicator = new IndClass(settings, shell);

            const popMod = await loadModule('popupMenu');
            const PopupClass = popMod.SpotifyLyricsPopup || popMod.LyricsPopupMenu || popMod.default;
            const popup = new PopupClass(indicator, null, shell);

            popup.setLyrics([]);
            expect(() => {
                popup.setActiveLine(-1);
                popup.setActiveLine(0);
            }).not.toThrow();

            popup.destroy();
            indicator.destroy();
        });
    });
}
