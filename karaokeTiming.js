const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function graphemes(text) {
    if (segmenter) return [...segmenter.segment(text)].map(item => ({ text: item.segment, offset: item.index }));
    let offset = 0;
    return Array.from(text, value => { const item = { text: value, offset }; offset += value.length; return item; });
}

// One source span remains one animation unit: either a word or one of its
// syllables. Never join spans or infer syllables from spelling.
export function segmentTimeline(line) {
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
        if (visible.length) result.push({text: span.text, startOffset: offset, endOffset: stop,
            startTimeMs: start, endTimeMs: end, durationMs: end - start,
            isPartOfWord: typeof span.isPartOfWord === 'boolean' ? span.isPartOfWord : null,
            characters: visible});
        cursor = stop;
    }
    let wordIndex = -1;
    result.forEach((span, index) => {
        const previous = result[index - 1];
        const adjacent = previous && !/\s/.test(text.slice(previous.endOffset, span.startOffset));
        const continuation = adjacent && (previous.isPartOfWord === true ||
            (previous.isPartOfWord === null && previous.endOffset === span.startOffset));
        if (!continuation) wordIndex++;
        span.wordIndex = wordIndex;
    });
    const counts = new Map();
    result.forEach(span => counts.set(span.wordIndex, (counts.get(span.wordIndex) || 0) + 1));
    result.forEach(span => { span.kind = counts.get(span.wordIndex) > 1 ? 'syllable' : 'word'; });
    return result.length ? result : null;
}

// Only the sustained-letter effect needs interpolated character times.
export function characterTimeline(line) {
    return segmentTimeline(line)?.flatMap(span => span.characters.map((char, i, chars) => ({...char,
        startTimeMs: span.startTimeMs + span.durationMs * i / chars.length,
        endTimeMs: span.startTimeMs + span.durationMs * (i + 1) / chars.length,
        segmentDurationMs: span.durationMs, segmentStartTimeMs: span.startTimeMs,
        segmentEndTimeMs: span.endTimeMs, segmentOffset: span.startOffset, segmentText: span.text,
    }))) ?? null;
}

export function segmentProgress(span, positionMs) {
    if (positionMs < span.startTimeMs) return 0;
    if (positionMs >= span.endTimeMs) return 1;
    return (positionMs - span.startTimeMs) / (span.endTimeMs - span.startTimeMs);
}

// Whole words and syllables move together. Letter emphasis is a second layer,
// not the animation used for every source span. All motion is seekable.
export function segmentMotion(span, positionMs) {
    const progress = segmentProgress(span, positionMs);
    const strength = Math.min(1, (span.endTimeMs - span.startTimeMs) / 250);
    const amount = progress > 0 && progress < 1 ? Math.sin(Math.PI * progress) * strength : 0;
    return {progress, lift: amount, scale: 1 + 0.045 * amount};
}

export function characterProgress(char, positionMs) {
    if (positionMs < char.startTimeMs) return 0;
    if (positionMs >= char.endTimeMs) return 1;
    return Math.max(0, Math.min(1, (positionMs - char.startTimeMs) / (char.endTimeMs - char.startTimeMs)));
}

// Decoration follows the clock directly, so pause and seek need no animation state.
// Only sustained segments move; timing never waits for the visual easing.
export function characterLift(char, positionMs) {
    if (!char.emphasized || positionMs <= char.startTimeMs || positionMs >= char.segmentEndTimeMs) return 0;
    const attackMs = Math.min(160, (char.endTimeMs - char.startTimeMs) * 0.6);
    const attack = Math.min(1, (positionMs - char.startTimeMs) / Math.max(1, attackMs));
    const release = Math.min(1, (char.segmentEndTimeMs - positionMs) / 180);
    return Math.min(1 - (1 - attack) ** 3, release * release * (3 - 2 * release));
}

export function activeLineIndex(lines, positionMs) {
    let low = 0, high = lines.length - 1, index = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if ((lines[mid].timeMs ?? lines[mid].startTimeMs) <= positionMs) { index = mid; low = mid + 1; }
        else high = mid - 1;
    }
    while (index >= 0 && Number.isFinite(lines[index].endTimeMs) && positionMs >= lines[index].endTimeMs) index--;
    return index;
}

// Hold a started line between phrases, but never expose a future first line.
export function lyricStartTime(line) {
    const start = line?.timeMs ?? line?.startTimeMs ?? Infinity;
    const words = (line?.syllables || []).map(span => Number(span.startTimeMs)).filter(Number.isFinite);
    return words.length ? Math.max(start, Math.min(...words)) : start;
}

export function displayLineIndex(lines, positionMs) {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lyricStartTime(lines[i]) <= positionMs && !lines[i].isInterlude && (lines[i].words || lines[i].text || '').trim()) return i;
    }
    return -1;
}
