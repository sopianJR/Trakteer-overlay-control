/**
 * Key icon files.
 *
 * static/icons/<Name>.png are rendered by tools/make-key-icons.js from Phosphor icons and
 * committed, so the plugin only reads them. They go to the host as a PNG data URI through
 * setImage; an SVG data URI is not used because it is reported to render black on hardware
 * (see docs/device-compatibility.md).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// lib/ → plugin/ → <name>.sdPlugin/ → static/icons
const ICON_DIR = path.resolve(__dirname, '..', '..', 'static', 'icons');

/** A Phosphor icon name. The settings are user-editable, so this also keeps a name from walking out of ICON_DIR. */
const NAME_PATTERN = /^[A-Za-z0-9]+$/;

/** @type {Map<string, string|null>} */
const cache = new Map();

/**
 * @param {unknown} name Phosphor icon name, e.g. "Play"
 * @returns {string|null} `data:image/png;base64,…`, or null when the name is not valid
 *   or no such file ships with the plugin
 */
function iconDataUri(name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return null;
    if (cache.has(name)) return cache.get(name);

    let uri = null;
    try {
        const png = fs.readFileSync(path.join(ICON_DIR, `${name}.png`));
        uri = `data:image/png;base64,${png.toString('base64')}`;
    } catch {
        // missing file: leave null so the key keeps its manifest image
    }
    cache.set(name, uri);
    return uri;
}

module.exports = { ICON_DIR, NAME_PATTERN, iconDataUri };
