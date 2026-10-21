const PROVIDERS = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify',
    lrclib: 'LRCLIB', lrclib_search: 'LRCLIB' };

export function lyricAttribution(result) {
    if (!result?.lines?.length) return null;
    const source = result.provider === 'spicy_lyrics' ? result.source : result.provider;
    const attribution = { provider: PROVIDERS[source] || source || 'Unknown source', contributors: [] };
    if (source === 'spicy_lyrics') {
        for (const role of ['Uploader', 'Maker']) {
            const person = result.uploadAttribution?.[role];
            const name = String(person?.username || person?.id || '').trim();
            if (!name) continue;
            const url = /^https?:\/\/[^\s]+$/i.test(person.url || '') ? person.url : null;
            attribution.contributors.push({ role, name, url });
        }
    }
    return attribution;
}

export function attributionMarkup(attribution) {
    if (!attribution) return '';
    const escape = text => String(text).replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    return [escape(attribution.provider), ...(attribution.contributors || []).map(person => {
        const name = escape(person.name);
        return `${escape(person.role)}: ${person.url && /^https?:\/\/[^\s]+$/i.test(person.url)
            ? `<a href="${escape(person.url)}">${name}</a>` : name}`;
    })].join(' · ');
}
