/**
 * Generate the plugin's PNG icons with no image library.
 *
 * Writes real, valid PNGs (zlib stored blocks + CRC) so the manifest never points at
 * a placeholder. Flat Trakteer-orange tiles with a darker border; replace them with
 * proper artwork from the design repo when that exists.
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

/** Orange tile with a darker 4px border. */
function tile(size, inner, border) {
    return png(size, size, (x, y) => {
        const edge = 4;
        const onBorder = x < edge || y < edge || x >= size - edge || y >= size - edge;
        return onBorder ? border : inner;
    });
}

const ORANGE = [0xff, 0x6b, 0x35, 0xff];
const DARK = [0x2d, 0x2d, 0x2d, 0xff];

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = {
    'icon-plugin.png': tile(72, ORANGE, DARK),
    'icon-action.png': tile(40, ORANGE, DARK),
    'key.png': tile(144, DARK, ORANGE),
};

for (const [name, buffer] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), buffer);
    console.log(`wrote ${name} (${buffer.length} bytes)`);
}
