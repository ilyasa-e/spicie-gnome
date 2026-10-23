/**
 * Font weights shared by every lyric surface.
 *
 * Settings store a name so the preferences can offer a short list, while the
 * shell (CSS) and the lyrics window (Pango) both need the numeric weight.
 */

export const FONT_WEIGHTS = [
    ['light', 'Light', 300],
    ['regular', 'Regular', 400],
    ['medium', 'Medium', 500],
    ['semibold', 'Semibold', 600],
    ['bold', 'Bold', 700],
    ['heavy', 'Heavy', 800],
];

export function fontWeightValue(name, fallback = 400) {
    return FONT_WEIGHTS.find(([key]) => key === name)?.[2] ?? fallback;
}

/**
 * Pango keeps the family, weight and size apart, so a family name that
 * happens to contain a style word cannot override the chosen weight.
 *
 * @param {object} Pango the Pango namespace
 * @returns {string} a description accepted by Pango.FontDescription.from_string
 */
export function pangoFont(Pango, family, weight, size, style = null) {
    const description = new Pango.FontDescription();
    description.set_family(family || 'Sans');
    description.set_weight(fontWeightValue(weight, 700));
    if (style) description.set_style(style);
    description.set_size(Math.max(1, Math.round(size)) * Pango.SCALE);
    return description.to_string();
}
