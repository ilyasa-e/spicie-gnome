import { lyricStartTime } from './karaokeTiming.js';

export function floatingPosition(area, width, height, position, customX = 0, customY = 0) {
    const gap = 24;
    const right = area.x + Math.max(0, area.width - width);
    const bottom = area.y + Math.max(0, area.height - height);
    const centerX = area.x + (area.width - width) / 2;
    const centerY = area.y + (area.height - height) / 2;
    let x = position.includes('left') ? area.x + gap : position.includes('right') ? right - gap : centerX;
    let y = position.startsWith('bottom') ? bottom - gap : position.startsWith('top') ? area.y + gap : centerY;
    if (position === 'custom') { x = customX; y = customY; }
    return { x: Math.round(Math.max(area.x, Math.min(right, x))),
        y: Math.round(Math.max(area.y, Math.min(bottom, y))) };
}

export function lineAlignment(setting, line) {
    if (['left', 'center', 'right'].includes(setting)) return setting;
    if (typeof line?.oppositeAligned === 'boolean') return line.oppositeAligned ? 'right' : 'left';
    return 'center';
}

export function activeVocalLines(lines, positionMs) {
    return lines.filter(line => lyricStartTime(line) <= positionMs &&
        (!Number.isFinite(line.endTimeMs) || positionMs < line.endTimeMs) && !line.isInterlude);
}

export function isLyricsWindow(window) {
    const appId = window.get_gtk_application_id?.() || '';
    const wmClass = window.get_wm_class?.() || '';
    return appId === 'dev.norang.SpotifyFloatingLyricsHUD' || wmClass === 'dev.norang.SpotifyFloatingLyricsHUD';
}

export function hideLyricsWindowFromLists(window, waylandClient = null) {
    if (!isLyricsWindow(window)) return false;
    if (typeof window.hide_from_window_list === 'function') {
        window.hide_from_window_list();
        return true;
    }
    // GNOME 46–49 exposes the operation on the client that launched the window.
    if (waylandClient?.owns_window(window) && typeof waylandClient.hide_from_window_list === 'function') {
        waylandClient.hide_from_window_list(window);
        return true;
    }
    return false;
}
