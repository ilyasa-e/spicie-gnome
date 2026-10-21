import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Cairo from 'cairo';
import { segmentTimeline, segmentMotion, characterTimeline, characterProgress, characterLift } from './karaokeTiming.js';

// Fragments follow logical reading order, keeping wraps and direction changes
// inside a source span. Animation never re-shapes individual syllable strings.
function fragments(characters) {
    const result = [];
    for (const char of characters) {
        if (!char.width) continue;
        const left = Math.min(char.x, char.x + char.width);
        const right = Math.max(char.x, char.x + char.width);
        const direction = char.width < 0 ? -1 : 1;
        const previous = result.at(-1);
        if (previous && previous.y === char.y && previous.direction === direction) {
            const end = Math.max(previous.x + previous.width, right);
            previous.x = Math.min(previous.x, left);
            previous.width = end - previous.x;
            previous.characters.push(char);
        } else result.push({x: left, y: char.y, width: right - left, height: char.height,
            direction, characters: [char]});
    }
    let advance = 0;
    for (const part of result) { part.advance = advance; advance += part.width; }
    return {parts: result, advance};
}

// Merge holes before clipping the dim base. Adjacent or overlapping glyph cells
// must not cancel each other under the even-odd clipping rule (e.g. ligatures).
function mergedCells(segments) {
    const rows = new Map();
    for (const span of segments) for (const part of span.parts) {
        const key = `${part.y}:${part.height}`;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({...part});
    }
    const cells = [];
    for (const row of rows.values()) {
        row.sort((a, b) => a.x - b.x);
        let previous = null;
        for (const cell of row) {
            if (previous && cell.x <= previous.x + previous.width) {
                previous.width = Math.max(previous.x + previous.width, cell.x + cell.width) - previous.x;
            } else { cells.push(cell); previous = cell; }
        }
    }
    return cells;
}

export class KaraokeLayout {
    constructor(cr, line, font, width, alignment = 'left') {
        this.layout = PangoCairo.create_layout(cr);
        this.layout.set_font_description(Pango.FontDescription.from_string(font));
        this.layout.set_text(line.words ?? line.text ?? '', -1);
        this.layout.set_width(Math.max(1, Math.floor(width)) * Pango.SCALE);
        this.layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        this.layout.set_auto_dir(false);
        this.layout.set_alignment(({left: Pango.Alignment.LEFT, center: Pango.Alignment.CENTER,
            right: Pango.Alignment.RIGHT})[alignment] ?? Pango.Alignment.LEFT);
        this.characters = characterTimeline(line)?.map(char => {
            const rect = this.layout.index_to_pos(char.byteOffset);
            return {...char, x: rect.x / Pango.SCALE, y: rect.y / Pango.SCALE,
                width: rect.width / Pango.SCALE, height: rect.height / Pango.SCALE};
        }) ?? null;
        this.segments = segmentTimeline(line)?.map(span => {
            const characters = this.characters.filter(char => char.segmentOffset === span.startOffset);
            const motionSafe = /^[\p{Script=Latin}\p{M}\p{P}\s]+$/u.test(span.text) &&
                characters.every(char => char.width > 0);
            const emphasized = motionSafe && span.durationMs >= 1000 && characters.length > 1;
            characters.forEach(char => { char.emphasized = emphasized; });
            return {...span, ...fragments(characters), characters, motionSafe,
                mode: emphasized ? 'letters' : 'segment'};
        }) ?? null;
        this._cells = mergedCells(this.segments || []);
        [this.width, this.height] = this.layout.get_pixel_size();
        this._paintWidth = Math.max(this.width, Math.ceil(width));
    }

    draw(cr, positionMs, x, y) {
        if (!this.segments) { this._paint(cr, x, y, 1); return this.height; }
        // Untimed punctuation stays visible. Timed spans are drawn independently
        // as whole words/syllables, with optional letters nested within them.
        cr.save();
        cr.newPath();
        cr.rectangle(x - 8, y - 8, this._paintWidth + 16, this.height + 16);
        for (const cell of this._cells) cr.rectangle(x + cell.x, y + cell.y, cell.width, cell.height);
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        cr.clip(); this._paint(cr, x, y, 0.35); cr.restore();

        for (const span of this.segments) {
            const state = segmentMotion(span, positionMs);
            for (const part of span.parts) {
                cr.save();
                if (span.motionSafe) {
                    const centerX = x + part.x + part.width / 2;
                    const centerY = y + part.y + part.height * 0.7;
                    cr.translate(centerX, centerY - state.lift * Math.min(1.8, part.height * 0.045));
                    cr.scale(state.scale, state.scale);
                    cr.translate(-centerX, -centerY);
                }
                if (span.mode === 'letters') {
                    for (const char of part.characters) {
                        const lift = characterLift(char, positionMs) * Math.min(2.5, char.height * 0.06);
                        cr.save(); cr.translate(0, -lift);
                        this._drawPart(cr, x, y, {x: char.x, y: char.y, width: char.width,
                            height: char.height, direction: 1, advance: 0},
                        characterProgress(char, positionMs), char.width);
                        cr.restore();
                    }
                } else this._drawPart(cr, x, y, part, state.progress, span.advance);
                cr.restore();
            }
        }
        return this.height;
    }

    _drawPart(cr, x, y, part, progress, advance) {
        cr.save(); cr.newPath();
        cr.rectangle(x + part.x, y + part.y, part.width, part.height);
        cr.clip(); this._paint(cr, x, y, 0.35);
        if (progress >= 1) this._paint(cr, x, y, 1);
        else if (progress > 0) {
            // One soft edge sweeps through the complete source segment,
            // including wrapped fragments. Fast words have no letter clock.
            const fade = Math.min(10, part.height * 0.2, advance * 0.2);
            const edge = -fade + progress * (advance + 2 * fade) - part.advance;
            const origin = x + part.x + (part.direction < 0 ? part.width : 0);
            const gradient = new Cairo.LinearGradient(origin + (edge - fade) * part.direction, 0,
                origin + (edge + fade) * part.direction, 0);
            gradient.addColorStopRGBA(0, 1, 1, 1, 1);
            gradient.addColorStopRGBA(1, 1, 1, 1, 0);
            cr.setSource(gradient); cr.moveTo(x, y); PangoCairo.show_layout(cr, this.layout);
        }
        cr.restore();
    }

    _paint(cr, x, y, opacity) {
        cr.moveTo(x, y); cr.setSourceRGBA(1, 1, 1, opacity);
        PangoCairo.show_layout(cr, this.layout);
    }
}
