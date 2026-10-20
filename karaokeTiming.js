const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function graphemes(text) {
    if (segmenter) return [...segmenter.segment(text)].map(item => ({ text: item.segment, offset: item.index }));
    let offset = 0;
    return Array.from(text, value => { const item = { text: value, offset }; offset += value.length; return item; });
}

// Sources usually time words/syllables. Character times inside each segment
// are interpolated; gaps and segment boundaries retain the supplied timestamps.
export function characterTimeline(line) {
    if (!Array.isArray(line.syllables) || !line.syllables.length) return null;
    const text = line.words ?? line.text ?? '';
    const chars = graphemes(text);
    const encoder = new TextEncoder();
    let byteOffset = 0;
    chars.forEach(char => { char.byteOffset = byteOffset; byteOffset += encoder.encode(char.text).length; });
    let cursor = 0;
    const result = [];
    for (const span of line.syllables) {
        const start = Number(span.startTimeMs), end = Number(span.endTimeMs);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !span.text) continue;
        const offset = Number.isInteger(span.startOffset) ? span.startOffset : text.indexOf(span.text, cursor);
        if (offset < 0) continue;
        const stop = Number.isInteger(span.endOffset) ? span.endOffset : offset + span.text.length;
        const visible = chars.filter(char => char.offset >= offset && char.offset < stop && !/^\s+$/.test(char.text));
        visible.forEach((char, i) => result.push({ ...char,
            startTimeMs: start + (end - start) * i / visible.length,
            endTimeMs: start + (end - start) * (i + 1) / visible.length,
            segmentDurationMs: end - start,
        }));
        cursor = stop;
    }
    return result.length ? result : null;
}

export function characterProgress(char, positionMs) {
    if (positionMs < char.startTimeMs) return 0;
    if (positionMs >= char.endTimeMs) return 1;
    return Math.max(0, Math.min(1, (positionMs - char.startTimeMs) / (char.endTimeMs - char.startTimeMs)));
}

export function activeLineIndex(lines, positionMs) {
    let low = 0, high = lines.length - 1, index = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if ((lines[mid].timeMs ?? lines[mid].startTimeMs) <= positionMs) { index = mid; low = mid + 1; }
        else high = mid - 1;
    }
    if (index >= 0 && Number.isFinite(lines[index].endTimeMs) && positionMs >= lines[index].endTimeMs) return -1;
    return index;
}
