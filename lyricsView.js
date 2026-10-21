import { lyricStartTime } from './karaokeTiming.js';

export function panelText(track, lyric, {artist = false, title = false, lyrics = true} = {}) {
    return [artist ? track?.artist : '', title ? track?.title : '', lyrics ? lyric : '']
        .map(value => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ');
}

// Fillers belong to the same chronological sequence as the source vocals.
// Overlapping voices share a gap only after every earlier voice has ended.
export function lyricEntries(lines, countdown = true) {
    const result = [];
    let end = 0;
    for (const [index, line] of lines.entries()) {
        if (line.isInterlude || !(line.words || line.text || '').trim()) continue;
        const start = lyricStartTime(line);
        if (countdown && start - end >= 2500) {
            const startTimeMs = Math.max(end, start - 4000);
            result.push({id: `gap:${index}`, kind: 'filler', index, line,
                start: startTimeMs, startTimeMs, endTimeMs: start});
        }
        result.push({id: `line:${index}`, kind: 'lyric', index, line, start});
        end = Math.max(end, Number.isFinite(line.endTimeMs) ? line.endTimeMs :
            lyricStartTime(lines.slice(index + 1).find(next => !next.isInterlude) || {timeMs: Infinity}));
    }
    return result;
}

export function floatingFrame(lines, positionMs, count = 2, countdown = true) {
    count = Math.max(1, Math.min(8, Math.round(count) || 2));
    const entries = lyricEntries(lines, countdown);
    const vocals = entries.filter(item => item.kind === 'lyric');
    const active = vocals.filter(item => item.start <= positionMs &&
        (!Number.isFinite(item.line.endTimeMs) || positionMs < item.line.endTimeMs));
    const started = vocals.filter(item => item.start <= positionMs);
    const next = vocals.find(item => item.start > positionMs);
    const previous = started.at(-1);
    const filler = !active.length ? entries.find(item => item.kind === 'filler' &&
        item.startTimeMs <= positionMs && positionMs < item.endTimeMs) || null : null;
    const finished = Boolean(vocals.length && !next && !active.length &&
        vocals.every(item => Number.isFinite(item.line.endTimeMs) && positionMs >= item.line.endTimeMs));
    const ending = Boolean(vocals.length && positionMs >= vocals.at(-1).start);
    if (!vocals.length || finished) return {rows: [], filler: null, finished, ending, activeIndex: -1};
    const focus = filler ? next : active[0] || previous || vocals[0];
    const focusIndex = vocals.indexOf(focus);
    const start = Math.max(0, focusIndex - (count >= 3 ? 1 : 0));
    const selected = vocals.slice(start, start + count);
    for (const item of active) if (!selected.includes(item)) selected.push(item);
    const rows = selected.map(item => ({...item,
        state: active.includes(item) ? 'active' : item.start > positionMs ? 'upcoming' : 'past'}));
    if (filler) rows.push({...filler, state: 'countdown'});
    rows.sort((a, b) => entries.indexOf(entries.find(item => item.id === a.id)) -
        entries.indexOf(entries.find(item => item.id === b.id)));
    return {rows, filler, finished, ending, activeIndex: active[0]?.index ?? previous?.index ?? -1};
}

export function countdownDots(filler, positionMs, animate = true) {
    if (!filler) return [];
    const progress = Math.max(0, Math.min(1, (positionMs - filler.startTimeMs) /
        Math.max(1, filler.endTimeMs - filler.startTimeMs)));
    return [0, 1, 2].map(index => {
        const phase = Math.max(0, Math.min(1, progress * 3 - index));
        return {lift: animate ? Math.sin(Math.PI * phase) : 0,
            alpha: progress * 3 >= index && phase < 1 ? 1 : phase >= 1 ? 0.75 : 0.3};
    });
}

// Stable row identities let the viewport move existing text instead of
// clearing it when the focus advances. Seeking can explicitly snap the view.
export class LyricRowMotion {
    constructor() { this._targets = []; this._from = []; this._start = 0; this.duration = 300; }
    setRows(rows, now, snap = false) {
        const signature = rows.map(row => `${row.id}:${row.y}:${row.height}:${row.opacity}`).join('|');
        if (signature === this._signature) return;
        const current = this.sample(now);
        this._signature = signature;
        this._start = now;
        const common = rows.find(row => current.some(old => old.id === row.id));
        const shift = common ? current.find(old => old.id === common.id).y - common.y : rows[0]?.height || 40;
        this._targets = rows.map(row => ({...row}));
        this._from = rows.map(row => ({...row, ...(current.find(old => old.id === row.id) ||
            {y: row.y + shift, opacity: 0})}));
        for (const old of current) if (!rows.some(row => row.id === old.id)) {
            this._from.push(old);
            this._targets.push({...old, y: old.y - shift, opacity: 0});
        }
        if (snap || !current.length) this._start = now - this.duration;
    }
    running(now) { return now - this._start < this.duration; }
    sample(now) {
        const t = Math.min(1, Math.max(0, (now - this._start) / this.duration));
        const ease = 1 - (1 - t) ** 4;
        return this._targets.map((row, index) => ({...row,
            y: this._from[index].y + (row.y - this._from[index].y) * ease,
            opacity: this._from[index].opacity + (row.opacity - this._from[index].opacity) * ease,
        })).filter(row => row.opacity > 0.001);
    }
}
