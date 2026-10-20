// Media-time TTML used by lyric catalogues. No external entities are loaded.
export function parseTime(value, frameRate = 30, tickRate = 1) {
    if (typeof value !== 'string') return null;
    const time = value.trim();
    const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(time);
    if (offset) return Number(offset[1]) * ({ h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / frameRate, t: 1000 / tickRate }[offset[2]]);
    const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+)|:(\d+))?$/.exec(time);
    if (!clock || Number(clock[2]) >= 60 || Number(clock[3]) >= 60) return null;
    return (Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000 +
        (clock[4] ? Number(`0.${clock[4]}`) * 1000 : 0) + (clock[5] ? Number(clock[5]) * 1000 / frameRate : 0);
}

function decode(text) {
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, entity) => {
        if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? original;
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    });
}

function documentTree(xml) {
    if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
    const root = { name: '', attributes: {}, children: [] };
    const stack = [root];
    const tokens = xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g) || [];
    for (const token of tokens) {
        const parent = stack[stack.length - 1];
        if (token.startsWith('<!--') || token.startsWith('<?')) continue;
        if (token.startsWith('<![CDATA[')) { parent.children.push(token.slice(9, -3)); continue; }
        if (!token.startsWith('<')) { parent.children.push(decode(token)); continue; }
        if (token.startsWith('</')) {
            const name = token.slice(2, -1).trim();
            if (stack.length === 1 || stack.pop().qualifiedName !== name) return null;
            continue;
        }
        const start = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(token);
        if (!start) return null;
        const attributes = {};
        for (const attr of start[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[attr[1]] = decode(attr[2] ?? attr[3]);
        const node = { name: start[1].split(':').pop(), qualifiedName: start[1], attributes, children: [] };
        parent.children.push(node);
        if (!/\/\s*>$/.test(token)) stack.push(node);
    }
    return stack.length === 1 ? root : null;
}

export function parseTtml(xml) {
    const document = documentTree(xml);
    if (!document) return [];
    const lines = [];
    const tt = document.children.find(child => child.name === 'tt');
    const rate = Number(tt?.attributes['ttp:frameRate']) || 30;
    const multiplier = (tt?.attributes['ttp:frameRateMultiplier'] || '1 1').split(/\s+/).map(Number);
    const frameRate = rate * (multiplier[0] || 1) / (multiplier[1] || 1);
    const time = value => parseTime(value, frameRate, Number(tt?.attributes['ttp:tickRate']) || 1);
    const ignored = node => /(?:^|\s)(?:x-bg|x-translation|x-roman|x-transliteration)(?:\s|$)/.test(node.attributes['ttm:role'] || '');
    function paragraph(node) {
        let text = '';
        const spans = [];
        const lineStart = time(node.attributes.begin);
        let lineEnd = time(node.attributes.end);
        const duration = time(node.attributes.dur);
        if (lineEnd === null && lineStart !== null && duration !== null) lineEnd = lineStart + duration;
        function collect(child, timing = null, preserve = node.attributes['xml:space'] === 'preserve') {
            if (typeof child === 'string') {
                const value = preserve ? child : child.replace(/\s+/g, ' ');
                const start = text.length;
                text += value;
                if (timing && value) {
                    const previous = spans[spans.length - 1];
                    if (previous?.owner === timing && previous.endOffset === start) previous.endOffset = text.length;
                    else spans.push({ owner: timing, startOffset: start, endOffset: text.length, startTimeMs: timing.start, endTimeMs: timing.end });
                }
                return;
            }
            if (ignored(child)) return;
            if (child.name === 'br') { text += '\n'; return; }
            const start = time(child.attributes.begin);
            const end = time(child.attributes.end);
            const dur = time(child.attributes.dur);
            const next = start !== null ? { start, end: end ?? (dur !== null ? start + dur : lineEnd) } : timing;
            const keepSpace = child.attributes['xml:space'] ? child.attributes['xml:space'] === 'preserve' : preserve;
            child.children.forEach(item => collect(item, next, keepSpace));
        }
        node.children.forEach(child => collect(child));
        const trimStart = text.length - text.trimStart().length;
        const words = text.trim();
        const syllables = spans.map(({ owner, ...span }) => {
            const startOffset = Math.max(0, span.startOffset - trimStart);
            const endOffset = Math.min(words.length, span.endOffset - trimStart);
            return { ...span, startOffset, endOffset, text: words.slice(startOffset, endOffset) };
        }).filter(span => span.text && Number.isFinite(span.startTimeMs) && Number.isFinite(span.endTimeMs) && span.endTimeMs >= span.startTimeMs);
        const start = lineStart ?? (syllables.length ? Math.min(...syllables.map(span => span.startTimeMs)) : null);
        const end = lineEnd ?? (syllables.length ? Math.max(...syllables.map(span => span.endTimeMs)) : null);
        if (start === null || end === null || end <= start) return;
        lines.push({ id: lines.length, timeMs: start, startTimeMs: start, endTimeMs: end,
            text: words, words, syllables: syllables.length ? syllables : null,
            timing: syllables.length ? 'syllable' : 'line', isInterlude: !words || words === '♪' });
    }
    function visit(node) {
        if (typeof node === 'string' || node.name === 'head' || ignored(node)) return;
        if (node.name === 'p') paragraph(node);
        else node.children.forEach(visit);
    }
    visit(document);
    return lines.sort((a, b) => a.timeMs - b.timeMs).map((line, id) => ({ ...line, id }));
}
