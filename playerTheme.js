export const DEFAULT_PALETTE = {
    surface: '#302c29', top: '#4b3b30', foreground: '#fff6ee',
    secondary: '#dfcfc2', accent: '#efc9a0',
};
const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, amount) => a.map((v, i) => v * (1 - amount) + b[i] * amount);

export function paletteFromPixels(pixels, width, height, rowstride, channels) {
    // Select a populated colour cluster, ignoring transparent pixels, black
    // borders and white lettering. Row padding is not part of the image.
    const buckets = new Map();
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && pixels[i + 3] < 128) continue;
            const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
            const high = Math.max(...rgb), low = Math.min(...rgb);
            if (high < 28 || low > 235) continue;
            const key = rgb.map(v => v >> 5).join(',');
            const bucket = buckets.get(key) || { sum: [0, 0, 0], weight: 0 };
            const weight = 1 + (high - low) / 128;
            bucket.sum = bucket.sum.map((v, n) => v + rgb[n] * weight);
            bucket.weight += weight;
            buckets.set(key, bucket);
        }
    }
    const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
    if (!best) return { ...DEFAULT_PALETTE };
    const color = best.sum.map(v => v / best.weight);
    return {
        surface: hex(mix(color, [20, 21, 23], 0.76)),
        top: hex(mix(color, [26, 25, 25], 0.57)),
        foreground: '#fff8f2',
        secondary: hex(mix(color, [239, 232, 225], 0.83)),
        accent: hex(mix(color, [255, 242, 223], 0.75)),
    };
}

export function formatTime(milliseconds) {
    const seconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
    if (!Number.isFinite(seconds)) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
