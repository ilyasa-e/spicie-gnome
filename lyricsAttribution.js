const PROVIDERS = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify',
    lrclib: 'LRCLIB', lrclib_search: 'LRCLIB' };
// Only open, community-run sources get a link; commercial catalogues do not
// have a page for the song that the extension could honestly point to.
const PROVIDER_URLS = { lrclib: 'https://lrclib.net', lrclib_search: 'https://lrclib.net' };
const webUrl = value => /^https?:\/\/[^\s]+$/i.test(String(value || '')) ? String(value) : null;

export function lyricAttribution(result) {
    if (!result?.lines?.length) return null;
    const source = result.provider === 'spicy_lyrics' ? result.source : result.provider;
    const attribution = { provider: PROVIDERS[source] || source || 'Unknown source', contributors: [],
        providerUrl: PROVIDER_URLS[source] || null, alwaysVisible: result.provider === 'spicy_lyrics' };
    if (source === 'spicy_lyrics') {
        for (const role of ['Uploader', 'Maker']) {
            const person = result.uploadAttribution?.[role];
            // Accept the field spellings the service has used for profiles.
            const name = String(person?.username || person?.displayName || person?.name || person?.id || '').trim();
            if (!name) continue;
            const url = webUrl(person.url) || webUrl(person.profileUrl) || webUrl(person.link);
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
        ? [{name: provider, url: webUrl(attribution.providerUrl), role: ''}] : [];
    for (const person of attribution.contributors || []) {
        const name = String(person.name || '').trim();
        if (name) items.push({name, role: person.role || '', url: webUrl(person.url)});
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
