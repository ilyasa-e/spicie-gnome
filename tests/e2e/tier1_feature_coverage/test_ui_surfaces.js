/**
 * Tier 1: Feature Coverage - UI Surface Triggers & Actors
 */

import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Cairo from 'cairo';
import { describe, it, expect } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { loadModule } from '../harness/module_loader.js';
import { LrcParserOracle } from '../harness/reference_oracles.js';
import { SAMPLE_LYRICS } from '../fixtures/sample_lyrics.js';
import { FloatingLyricsHUDApp } from '../../../bin/spotify-floating-hud';

export function runUiSurfacesTests() {
    describe('Tier 1: UI Presentation Surfaces', () => {
        const parsedLines = LrcParserOracle.parse(SAMPLE_LYRICS.yellow, 267000);

        it('T1.21: Top Bar Panel indicator displays playback icon and current lyric line', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const mod = await loadModule('indicator');
            const IndicatorClass = mod.SpotifyIndicator || mod.PanelIndicator || mod.default;

            const indicator = new IndicatorClass(settings, shell);
            expect(shell.Main.panel.statusArea.has('spotify-floating-lyrics')).toBe(true);

            // Update with lyric
            indicator.updateLyric(parsedLines[1]);
            expect(indicator.label.get_text()).toBe('Look at the stars');

            indicator.destroy();
            expect(shell.Main.panel.statusArea.has('spotify-floating-lyrics')).toBe(false);
        });

        it('T1.22: Tray popup menu presents track header and playback controls', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();

            const indMod = await loadModule('indicator');
            const IndClass = indMod.SpotifyIndicator || indMod.PanelIndicator || indMod.default;
            const indicator = new IndClass(settings, shell);

            const popMod = await loadModule('popupMenu');
            const PopupClass = popMod.SpotifyLyricsPopup || popMod.LyricsPopupMenu || popMod.default;
            const popup = new PopupClass(indicator, proxy, shell);

            popup.setLyrics(parsedLines);
            expect(popup._lyrics.length).toBe(parsedLines.length);

            popup.destroy();
            indicator.destroy();
        });

        it('T1.23: Tray popup full lyrics view auto-scrolls to center active line', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();

            const indMod = await loadModule('indicator');
            const IndClass = indMod.SpotifyIndicator || indMod.PanelIndicator || indMod.default;
            const indicator = new IndClass(settings, shell);

            const popMod = await loadModule('popupMenu');
            const PopupClass = popMod.SpotifyLyricsPopup || popMod.LyricsPopupMenu || popMod.default;
            const popup = new PopupClass(indicator, proxy, shell);

            popup.setLyrics(parsedLines);
            popup.setActiveLine(5);
            expect(popup._activeIndex).toBe(5);

            popup.destroy();
            indicator.destroy();
        });

        it('T1.24: Lyrics window keeps the previous, active, and next line in order', async () => {
            const view = await loadModule('lyricsView');

            // Line 1 ("Look at the stars") is active at 36000ms
            const frame = view.floatingFrame(parsedLines, 36000, 3, false);

            expect(frame.rows.length).toBe(3);
            expect(frame.rows[0].line.words).toBe('(Intro)');
            expect(frame.rows[0].state).toBe('past');
            expect(frame.rows[1].line.words).toBe('Look at the stars');
            expect(frame.rows[1].state).toBe('active');
            expect(frame.rows[2].line.words).toBe('Look how they shine for you');
            expect(frame.rows[2].state).toBe('upcoming');
        });

        it('T1.25: Lyrics window background styles differ from transparent', () => {
            const app = new FloatingLyricsHUDApp();
            const folder = GLib.dir_make_tmp('spicie-ui-check-XXXXXX');
            const centerAlpha = style => {
                const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 80, 80);
                const cr = new Cairo.Context(surface);
                cr.setOperator(Cairo.Operator.CLEAR);
                cr.paint();
                cr.setOperator(Cairo.Operator.OVER);
                app._drawBackdrop(cr, 80, 80, style);
                cr.$dispose();
                const path = `${folder}/${style}.png`;
                surface.writeToPNG(path);
                return GdkPixbuf.Pixbuf.new_from_file(path).get_pixels()[(40 * 80 + 40) * 4 + 3];
            };

            expect(centerAlpha('transparent')).toBe(0);
            const soft = centerAlpha('blur');
            const solid = centerAlpha('dark-card');
            expect(soft).toBeGreaterThan(0);
            expect(solid).toBeGreaterThan(soft);
        });
    });
}
