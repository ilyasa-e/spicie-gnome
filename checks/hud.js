import { recoveryDelayMs, treatsMessageAsLyrics } from '../hudLifecycle.js';

let count = 0;
const check = (name, value) => { if (!value) throw Error(name); print(`PASS ${name}`); count++; };

check('A window that lived normally is respawned promptly', recoveryDelayMs(5000000, 0) === 400);
check('The first rapid crash backs off instead of looping', recoveryDelayMs(200000, 1) === 3000);
check('Repeated rapid crashes double the delay', recoveryDelayMs(200000, 2) === 6000 && recoveryDelayMs(200000, 3) === 12000);
check('Crash backoff is capped', recoveryDelayMs(200000, 9) === 30000);
check('Zero rapid exits still resolves to a usable delay', recoveryDelayMs(900000, 0) === 3000);
check('Lyrics make the extension authoritative for the window', treatsMessageAsLyrics({ type: 'lyrics', lines: [] }));
check('A clock sync alone keeps the window fallback alive', !treatsMessageAsLyrics({ type: 'sync', positionMs: 10 }));
check('Unknown payloads are not treated as lyrics', !treatsMessageAsLyrics(null) && !treatsMessageAsLyrics({}));
print(`${count} lyrics window checks passed`);
