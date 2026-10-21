const PROVIDERS = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify',
    lrclib: 'LRCLIB', lrclib_search: 'LRCLIB' };

export function lyricAttribution(result) {
    if (!result?.lines?.length) return null;
    const source = result.provider === 'spicy_lyrics' ? result.source : result.provider;
    const attribution = { provider: PROVIDERS[source] || source || 'Unknown source', contributors: [],
        alwaysVisible: result.provider === 'spicy_lyrics' };
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

export function requiresVisibleAttribution(attribution) {
    if (!attribution) return false;
    // Older helper messages lack the flag. Keep their commercial/community
    // credits visible rather than silently dropping a required attribution.
    return attribution.alwaysVisible ?? attribution.provider !== 'LRCLIB';
}

// Keep source metadata intact; presentation uses compact contributor names.
export function creditItems(attribution) {
    if (!attribution) return [];
    const provider = String(attribution.provider || '').trim();
    const items = provider && !/^spicy[ _-]?lyrics$/i.test(provider)
        ? [{name: provider, url: null, role: ''}] : [];
    for (const person of attribution.contributors || []) {
        const name = String(person.name || '').trim();
        if (name) items.push({name, role: person.role || '',
            url: /^https?:\/\/[^\s]+$/i.test(person.url || '') ? person.url : null});
    }
    return items;
}

export function attributionMarkup(attribution) {
    const escape = text => String(text).replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    return creditItems(attribution).map(person => {
        const name = escape(person.name);
        return person.url ? `<a href="${escape(person.url)}"><u>${name}</u></a>` : name;
    }).join(' · ');
}
