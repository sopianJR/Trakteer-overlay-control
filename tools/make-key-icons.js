/**
 * Render the key icons: one 144x144 PNG per Phosphor icon the endpoint registry names.
 *
 * The icons come from @phosphor-icons/react, the same package (and version) the Trakteer
 * dashboard uses. Each icon's `bold` path data is placed on a tile with the palette of
 * static/key.png, rasterised with @resvg/resvg-js and written to static/icons/<Name>.png.
 * The PNGs are committed, so the plugin and its tests need neither dependency; only
 * this tool does (both are devDependencies of the repo root).
 *
 * PNG rather than SVG: the SDK docs say setImage takes SVG too, but this repo carries a
 * report of SVG data URIs rendering black on hardware (see docs/device-compatibility.md).
 *
 * Usage: npm run icons      (after `npm install` at the repo root)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { iconNames } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');

const OUT_DIR = path.resolve(__dirname, '..', 'id.trakteer.streamdock.sdPlugin', 'static', 'icons');

// Tile geometry and palette. The colours are the Trakteer logo's: a diagonal red gradient
// (sampled from the logo PNG: #be1e2d top-left to #db2935 bottom-right) with a white mark,
// the same as static/key.png (tools/make-icons.js). The icon sits in the upper part of the
// tile because the host draws the button title, up to three lines, along the bottom. Tune
// ICON_SIZE and ICON_TOP after trying the plugin on a device.
const SIZE = 144;
const GRADIENT_FROM = '#be1e2d';
const GRADIENT_TO = '#db2935';
const ICON_COLOUR = '#ffffff';
const ICON_SIZE = 76;
const ICON_TOP = 12;
const WEIGHT = 'bold';

/** Phosphor draws every icon on a 256-unit grid. */
const PHOSPHOR_GRID = 256;

function fail(message) {
    console.error(`make-key-icons: ${message}`);
    process.exit(1);
}

/** `require` or `require.resolve` a devDependency, with a pointer to `npm install` if it is missing. */
function fromDevDependency(request, resolveOnly = false) {
    try {
        return resolveOnly ? require.resolve(request) : require(request);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') fail(`${request} is not installed; run "npm install" at the repo root first`);
        throw err;
    }
}

/**
 * Read one icon's path data out of the Phosphor package.
 *
 * `dist/defs/<Name>.mjs` default-exports a Map of weight → React element, a Fragment whose
 * children are `<path d=… [opacity=…]>`. Anything else (another tag, another prop) is not
 * understood, so it stops the run instead of drawing a wrong icon.
 *
 * @returns {Promise<Array<{ d: string, opacity?: string }>>}
 */
async function iconPaths(distDir, name) {
    const file = path.join(distDir, 'defs', `${name}.mjs`);
    if (!fs.existsSync(file)) throw new Error(`${name}: no such Phosphor icon`);

    const defs = (await import(pathToFileURL(file).href)).default;
    const element = defs.get(WEIGHT);
    if (!element) throw new Error(`${name}: no "${WEIGHT}" weight`);

    const children = [].concat(element.props.children).filter(Boolean);
    if (children.length === 0) throw new Error(`${name}: no shapes`);

    return children.map((child) => {
        if (child.type !== 'path') throw new Error(`${name}: unsupported element <${String(child.type)}>`);
        const { d, opacity, ...rest } = child.props;
        if (Object.keys(rest).length) throw new Error(`${name}: unsupported path props ${Object.keys(rest).join(', ')}`);
        if (typeof d !== 'string' || !/^[0-9a-zA-Z.,\s-]+$/.test(d)) throw new Error(`${name}: unexpected path data`);
        return opacity === undefined ? { d } : { d, opacity: String(opacity) };
    });
}

/** The tile as SVG: gradient background, then the icon scaled from Phosphor's grid. */
function tileSvg(paths) {
    const scale = ICON_SIZE / PHOSPHOR_GRID;
    const left = (SIZE - ICON_SIZE) / 2;
    const shapes = paths
        .map(({ d, opacity }) => `<path d="${d}" fill="${ICON_COLOUR}"${opacity ? ` opacity="${opacity}"` : ''}/>`)
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`
        + `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0" stop-color="${GRADIENT_FROM}"/><stop offset="1" stop-color="${GRADIENT_TO}"/>`
        + `</linearGradient></defs>`
        + `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>`
        + `<g transform="translate(${left} ${ICON_TOP}) scale(${scale})">${shapes}</g>`
        + '</svg>';
}

async function main() {
    const { Resvg } = fromDevDependency('@resvg/resvg-js');
    // dist/defs is internal to the package, so read it by absolute path from the entry
    // file's folder instead of through a package subpath.
    const distDir = path.dirname(fromDevDependency('@phosphor-icons/react', true));
    const packageDir = path.dirname(distDir);
    const phosphorVersion = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;

    const names = iconNames();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const problems = [];
    const rendered = new Map();
    for (const name of names) {
        try {
            const svg = tileSvg(await iconPaths(distDir, name));
            rendered.set(name, new Resvg(svg).render().asPng());
        } catch (err) {
            problems.push(err.message);
        }
    }
    if (problems.length) fail(`${problems.length} icon(s) could not be rendered:\n  ${problems.join('\n  ')}`);

    let written = 0;
    let unchanged = 0;
    for (const [name, png] of rendered) {
        const target = path.join(OUT_DIR, `${name}.png`);
        if (fs.existsSync(target) && fs.readFileSync(target).equals(png)) {
            unchanged++;
            continue;
        }
        fs.writeFileSync(target, png);
        written++;
    }

    // A renamed or dropped icon must not leave a stray PNG behind.
    let removed = 0;
    for (const file of fs.readdirSync(OUT_DIR)) {
        if (file.endsWith('.png') && !rendered.has(file.slice(0, -'.png'.length))) {
            fs.unlinkSync(path.join(OUT_DIR, file));
            console.log(`removed ${file} (no longer referenced)`);
            removed++;
        }
    }

    // The MIT licence asks for its notice to travel with copies of the icons.
    const notice = `The PNG icons in this folder are rendered from Phosphor Icons\n`
        + `(@phosphor-icons/react ${phosphorVersion}, ${WEIGHT} weight), https://phosphoricons.com\n\n`
        + fs.readFileSync(path.join(packageDir, 'LICENSE'), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'LICENSE.txt'), notice);

    console.log(`${names.length} icons (${written} written, ${unchanged} unchanged, ${removed} removed) in ${path.relative(process.cwd(), OUT_DIR) || '.'}`);
}

main().catch((err) => fail(err.stack || err.message));
