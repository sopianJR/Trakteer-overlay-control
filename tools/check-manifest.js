/**
 * Manifest / package sanity check.
 *
 * Catches the mistakes that make StreamDock silently refuse a plugin: a UUID that
 * does not match the folder, a Property Inspector path that is not on disk, a
 * referenced icon that does not exist, invalid JSON.
 *
 * Usage: node tools/check-manifest.js
 * Exit code 0 = all checks pass.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'id.trakteer.streamdock.sdPlugin');

const problems = [];
const checks = [];

function ok(label) { checks.push(`ok    ${label}`); }
function fail(label, detail) { problems.push(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }

/**
 * Run one check group and print `ok` only when that group itself added no failures.
 * Without this an unconditional ok() prints a passing line next to its own FAIL.
 */
function group(label, fn) {
    const before = problems.length;
    const detail = fn();
    if (problems.length === before) ok(detail ? `${label} — ${detail}` : label);
}

function exists(relative) {
    return fs.existsSync(path.join(PLUGIN_DIR, relative));
}

// 1. folder name must end in .sdPlugin
group('plugin folder ends with .sdPlugin', () => {
    if (!path.basename(PLUGIN_DIR).endsWith('.sdPlugin')) fail('plugin folder ends with .sdPlugin');
});

// 2. manifest parses
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8'));
    ok('manifest.json parses');
} catch (err) {
    fail('manifest.json parses', err.message);
    report();
}

// 3. UUID prefix matches the folder id
const folderId = path.basename(PLUGIN_DIR).replace(/\.sdPlugin$/, '');
group(`every action UUID starts with ${folderId}.`, () => {
    for (const action of manifest.Actions || []) {
        if (typeof action.UUID !== 'string' || !action.UUID.startsWith(`${folderId}.`)) {
            fail(`action UUID prefixed with ${folderId}`, action.UUID);
        }
    }
});

// 4. UUIDs unique
const uuids = (manifest.Actions || []).map((a) => a.UUID);
group('action UUIDs are unique', () => {
    if (new Set(uuids).size !== uuids.length) fail('action UUIDs are unique');
});

// 5. the plugin dispatches on the LAST dot-segment of the UUID (see utils/plugin.js:
//    `data.action?.split('.').pop()`), so that segment must match a plugin.<name>
const entry = fs.readFileSync(path.join(PLUGIN_DIR, 'plugin', 'index.js'), 'utf8');
group('every action UUID has a handler in plugin/index.js', () => {
    for (const uuid of uuids) {
        const handler = String(uuid).split('.').pop();
        if (!new RegExp(`plugin\\.${handler}\\s*=`).test(entry)) {
            fail(`plugin/index.js defines a handler for "${handler}"`);
        }
    }
});

// 6. Property Inspector paths and their scripts exist
group('Property Inspector pages and their assets exist', () => {
    for (const action of manifest.Actions || []) {
        const pi = action.PropertyInspectorPath;
        if (!pi) { fail(`action ${action.UUID} declares PropertyInspectorPath`); continue; }
        if (!exists(pi)) { fail(`PropertyInspector exists: ${pi}`); continue; }
        const html = fs.readFileSync(path.join(PLUGIN_DIR, pi), 'utf8');
        for (const src of [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1])) {
            const resolved = path.resolve(path.dirname(path.join(PLUGIN_DIR, pi)), src);
            if (!fs.existsSync(resolved)) fail(`script referenced by ${pi} exists: ${src}`);
        }
        for (const href of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1])) {
            const resolved = path.resolve(path.dirname(path.join(PLUGIN_DIR, pi)), href);
            if (!fs.existsSync(resolved)) fail(`stylesheet referenced by ${pi} exists: ${href}`);
        }
    }
});

// 7. every icon/image the manifest names is on disk
group('every manifest image exists', () => {
    const imageRefs = new Set();
    for (const action of manifest.Actions || []) {
        if (action.Icon) imageRefs.add(action.Icon);
        for (const state of action.States || []) if (state.Image) imageRefs.add(state.Image);
    }
    if (manifest.Icon) imageRefs.add(manifest.Icon);
    if (manifest.CategoryIcon) imageRefs.add(manifest.CategoryIcon);
    for (const ref of imageRefs) {
        // StreamDock also accepts an extensionless name; accept either form.
        if (!exists(ref) && !exists(`${ref}.png`)) fail(`image exists: ${ref}`);
    }
});

// 8. code path points at a real file
group('code path(s) resolve', () => {
    for (const field of ['CodePathWin', 'CodePathMac', 'CodePath']) {
        const value = manifest[field];
        if (value && !exists(value)) fail(`${field} exists: ${value}`);
    }
});

// 9. the Node-entry form requires the Nodejs block (bare .js CodePath without it
//    makes the StreamDock host restart the plugin forever — see docs/)
const pointsAtJs = [manifest.CodePathWin, manifest.CodePathMac, manifest.CodePath]
    .filter(Boolean).some((p) => p.endsWith('.js'));
if (pointsAtJs) {
    group('Nodejs.Version declared for a .js code path', () => {
        if (!manifest.Nodejs?.Version) fail('Nodejs.Version declared when CodePath points at a .js file');
        return manifest.Nodejs?.Version ? `version ${manifest.Nodejs.Version}` : '';
    });
}

// 10. no credential-looking default left in the manifest
group('no credential defaults in manifest', () => {
    for (const action of manifest.Actions || []) {
        for (const [key, value] of Object.entries(action.Settings || {})) {
            if (/token|key|secret|passcode/i.test(key) && value) {
                fail(`no credential default in manifest Settings.${key}`, String(value));
            }
        }
    }
});

// 11. plugin sources parse
group('plugin sources parse', () => {
    const sources = [
        'plugin/index.js',
        'plugin/lib/endpoints.js',
        'plugin/lib/trakteer-api.js',
        'plugin/lib/feedback.js',
    ];
    for (const file of sources) {
        const full = path.join(PLUGIN_DIR, file);
        if (!fs.existsSync(full)) { fail(`source exists: ${file}`); continue; }
        try {
            new (require('node:vm').Script)(fs.readFileSync(full, 'utf8'), { filename: full });
        } catch (err) {
            fail(`source parses: ${file}`, err.message);
        }
    }
});

report();

function report() {
    for (const line of checks) console.log(line);
    for (const line of problems) console.log(line);
    if (problems.length) {
        console.log(`\n${problems.length} problem(s)`);
        process.exit(1);
    }
    console.log(`\nall ${checks.length} check group(s) passed`);
    process.exit(0);
}
