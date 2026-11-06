/**
 * Generate the plugin's own PNG icons: the plugin and action icons shown in the
 * Stream Dock action list (the Trakteer logo, scaled) and key.png (a plain tile in the
 * logo's red gradient, drawn here with no image library: valid PNGs from zlib + CRC).
 *
 * Usage: node tools/make-icons.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'id.trakteer.streamdock.sdPlugin', 'static');

/** Build a PNG buffer from an RGBA pixel callback. */
function png(width, height, pixel) {
    const raw = Buffer.alloc(height * (1 + width * 4));
    let offset = 0;
    for (let y = 0; y < height; y++) {
        raw[offset++] = 0; // filter: none
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixel(x, y);
            raw[offset++] = r;
            raw[offset++] = g;
            raw[offset++] = b;
            raw[offset++] = a;
        }
    }

    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // colour type: RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c;
        }
    }
    let crc = -1;
    for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

/** Tile filled with the Trakteer logo gradient, running diagonally from `from` to `to`. */
function tile(size, from, to) {
    return png(size, size, (x, y) => {
        const t = (x + y) / (2 * (size - 1));
        return from.map((channel, i) => Math.round(channel + (to[i] - channel) * t));
    });
}

// Sampled from the Trakteer logo PNG: #be1e2d top-left to #db2935 bottom-right.
const RED_FROM = [0xbe, 0x1e, 0x2d, 0xff];
const RED_TO = [0xdb, 0x29, 0x35, 0xff];

/**
 * The Trakteer logo (tools/assets/trakteer-logo.png, 150x150, rounded corners) scaled to
 * `size`. Scaling needs a real resampler, so this uses @resvg/resvg-js, a devDependency
 * that tools/make-key-icons.js already needs.
 */
function logo(size) {
    let Resvg;
    try {
        ({ Resvg } = require('@resvg/resvg-js'));
    } catch {
        console.error('make-icons: @resvg/resvg-js is not installed; run "npm install" at the repo root first');
        process.exit(1);
    }
    const source = fs.readFileSync(path.join(__dirname, 'assets', 'trakteer-logo.png')).toString('base64');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + `<image width="${size}" height="${size}" href="data:image/png;base64,${source}"/></svg>`;
    return new Resvg(svg).render().asPng();
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Sizes follow the SDK style guide: plugin icon 128, action icon 40 (the host scales the
// plugin icon down for the category list). key.png is only the fallback key image.
const files = {
    'icon-plugin.png': logo(128),
    'icon-action.png': logo(40),
    'key.png': tile(144, RED_FROM, RED_TO),
};

for (const [name, buffer] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), buffer);
    console.log(`wrote ${name} (${buffer.length} bytes)`);
}
