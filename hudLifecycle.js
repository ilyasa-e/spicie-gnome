/**
 * Supervision rules for the standalone lyrics window.
 *
 * The window is a separate GTK process, so the extension is the only thing
 * that can bring it back after a crash. These rules are kept pure so the
 * restart policy can be checked without a running shell.
 */

/**
 * @param {number} lifetimeUs how long the window lived before exiting
 * @param {number} rapidExits consecutive exits shorter than a second
 * @returns {number} delay before the next spawn attempt, in milliseconds
 */
export function recoveryDelayMs(lifetimeUs, rapidExits = 0) {
    if (lifetimeUs >= 1000000) return 400;
    // A broken installation fails immediately. Back off instead of fork
    // bombing the session with a new window every few hundred milliseconds.
    const attempt = Math.max(1, Math.min(5, Math.round(rapidExits) || 1));
    return Math.min(3000 * 2 ** (attempt - 1), 30000);
}

/**
 * Only a lyrics payload makes the extension the source of truth for what the
 * window shows. A clock sync alone means the extension has nothing yet, so the
 * window keeps its own fallback fetch instead of going blank.
 */
export function treatsMessageAsLyrics(msg) {
    return msg?.type === 'lyrics';
}
