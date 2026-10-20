import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import { characterTimeline, characterProgress } from './karaokeTiming.js';

export class KaraokeLayout {
    constructor(cr, line, font, width) {
        this.layout = PangoCairo.create_layout(cr);
        this.layout.set_font_description(Pango.FontDescription.from_string(font));
        this.layout.set_text(line.words ?? line.text ?? '', -1);
        this.layout.set_width(Math.max(1, Math.floor(width)) * Pango.SCALE);
        this.layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        this.characters = characterTimeline(line)?.map(char => {
            const rect = this.layout.index_to_pos(char.byteOffset);
            return { ...char, x: rect.x / Pango.SCALE, y: rect.y / Pango.SCALE,
                width: rect.width / Pango.SCALE, height: rect.height / Pango.SCALE };
        }) ?? null;
        [this.width, this.height] = this.layout.get_pixel_size();
    }

    draw(cr, positionMs, x, y) {
        cr.moveTo(x, y);
        cr.setSourceRGBA(1, 1, 1, this.characters ? 0.35 : 1);
        PangoCairo.show_layout(cr, this.layout);
        if (!this.characters) return this.height;
        cr.save();
        cr.newPath();
        let any = false;
        for (const char of this.characters) {
            const progress = characterProgress(char, positionMs);
            if (!progress) continue;
            const end = char.x + char.width * progress;
            cr.rectangle(x + Math.min(char.x, end), y + char.y - 1,
                Math.abs(char.width) * progress, char.height + 2);
            any = true;
        }
        if (any) {
            cr.clip();
            cr.moveTo(x, y);
            cr.setSourceRGBA(1, 1, 1, 1);
            PangoCairo.show_layout(cr, this.layout);
        }
        cr.restore();
        return this.height;
    }
}
