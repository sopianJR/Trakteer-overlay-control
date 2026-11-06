/**
 * Key icon tests: which Phosphor icon each button gets, and that every icon the registry
 * can pick ships as a real PNG.
 *
 * The PNGs themselves are made by tools/make-key-icons.js (needs the devDependencies) and
 * committed; these tests need neither, so a missing or stale file fails here, not on a key.
 *
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');
const { iconDataUri, ICON_DIR, NAME_PATTERN } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/icons');

const {
    WIDGETS,
    BROADCAST_ACTIONS,
    TEST_ALERT_MEDIA,
    iconNames,
    resolveWidgetIcon,
    resolveBroadcastIcon,
    resolveTestAlertIcon,
} = registry;

const NAMES = iconNames();
const SHIPPED = new Set(NAMES);

/** Settings a hand-edited or corrupt profile could carry; none may become an icon. */
const BAD_OVERRIDES = ['', undefined, null, 'Nope', '../key', 'play', 'Play ', 42, 'constructor', '__proto__'];

// ── which icon a button gets ─────────────────────────────────────────────────

test('icon names are plain Phosphor names, sorted and unique', () => {
    assert.ok(NAMES.length > 0);
    for (const name of NAMES) assert.match(name, NAME_PATTERN, `${name} is not a plain name`);
    assert.deepEqual(NAMES, [...new Set(NAMES)].sort());
});

test('every widget action resolves to a shipped icon', () => {
    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        assert.ok(SHIPPED.has(widget.icon), `${widgetId} has no shipped icon of its own`);
        for (const action of widget.actions) {
            const icon = resolveWidgetIcon(widgetId, action.id, '');
            assert.ok(SHIPPED.has(icon), `${widgetId}/${action.id} resolved to ${JSON.stringify(icon)}`);
        }
    }
});

test('every broadcast action and test alert media resolves to a shipped icon', () => {
    for (const action of BROADCAST_ACTIONS) {
        const icon = resolveBroadcastIcon(action.id, '');
        assert.ok(SHIPPED.has(icon), `broadcast/${action.id} resolved to ${JSON.stringify(icon)}`);
    }
    for (const media of TEST_ALERT_MEDIA) {
        assert.equal(resolveTestAlertIcon(media.id, ''), media.icon);
        assert.ok(SHIPPED.has(media.icon), `test alert ${media.id}`);
    }
});

test('the widget action icons follow the action, then fall back to the widget', () => {
    // ACTION_ICONS decides a shared action id...
    assert.equal(resolveWidgetIcon('timer', 'add', ''), 'Plus');
    assert.equal(resolveWidgetIcon('goal', 'show', ''), 'Eye');
    // ...an action without an entry takes its widget's icon...
    assert.equal(resolveWidgetIcon('qr-code', 'toggle_open_close', ''), 'QrCode');
    assert.equal(resolveWidgetIcon('gacha', 'spin', ''), 'Gift');
    // ...and so does an id the registry has never heard of, rather than coming back empty.
    assert.equal(resolveWidgetIcon('timer', 'explode', ''), 'Timer');
    assert.equal(resolveWidgetIcon('nope', 'x', ''), null);
});

test('an icon on the action itself beats the shared action id', () => {
    assert.equal(resolveWidgetIcon('polling', 'hide-results', ''), 'SubtitlesSlash');
    assert.equal(resolveWidgetIcon('polling', 'show-results', ''), 'Subtitles');
    // Both `show` buttons are the shared Eye, so the explicit ones are really explicit.
    assert.equal(resolveWidgetIcon('polling', 'show', ''), 'Eye');

    // Precedence proved directly: give a shared id its own icon and it must win.
    const add = WIDGETS.timer.actions.find((a) => a.id === 'add');
    add.icon = 'Heart';
    try {
        assert.equal(resolveWidgetIcon('timer', 'add', ''), 'Heart');
    } finally {
        delete add.icon;
    }
});

test('the alert-queue test actions use their media icons', () => {
    for (const media of TEST_ALERT_MEDIA) {
        assert.equal(resolveWidgetIcon('alert-queue', media.id, ''), media.icon, media.id);
    }
});

test('test alert: buttons saved by the newtip version keep an icon', () => {
    assert.equal(resolveTestAlertIcon('tts', ''), 'SpeakerHigh');
    assert.equal(resolveTestAlertIcon('youtube', ''), 'YoutubeLogo');
    assert.equal(resolveTestAlertIcon(null, ''), 'BellRinging');
    assert.equal(resolveTestAlertIcon('something-unknown', ''), 'BellRinging');
});

test('a valid override wins on every kind of button', () => {
    assert.equal(resolveWidgetIcon('polling', 'hide-results', 'Star'), 'Star');
    assert.equal(resolveBroadcastIcon('play', 'Star'), 'Star');
    assert.equal(resolveTestAlertIcon('tts', 'Star'), 'Star');
});

test('an override that is not a shipped icon is ignored', () => {
    for (const bad of BAD_OVERRIDES) {
        const label = JSON.stringify(bad);
        assert.equal(resolveWidgetIcon('timer', 'add', bad), 'Plus', `widget ${label}`);
        assert.equal(resolveBroadcastIcon('play', bad), 'Play', `broadcast ${label}`);
        assert.equal(resolveTestAlertIcon('tts', bad), 'SpeakerHigh', `test alert ${label}`);
    }
});

test('an action id that collides with an Object property does not pick a wrong icon', () => {
    // Settings are user-editable; "constructor" must not read Object.prototype.constructor.
    assert.equal(resolveWidgetIcon('timer', 'constructor', ''), 'Timer');
    assert.equal(resolveBroadcastIcon('__proto__', ''), 'Megaphone');
});

test('the Property Inspector choices are exactly the shipped icons, labelled readably', () => {
    assert.deepEqual(registry.ICON_CHOICES.map((c) => c.id), NAMES);
    const byId = Object.fromEntries(registry.ICON_CHOICES.map((c) => [c.id, c.label]));
    assert.equal(byId.SkipForward, 'Skip forward');
    assert.equal(byId.Play, 'Play');
});

// ── the icon files ───────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('every icon ships as a 144x144 RGBA PNG', () => {
    for (const name of NAMES) {
        const file = path.join(ICON_DIR, `${name}.png`);
        assert.ok(fs.existsSync(file), `static/icons/${name}.png is missing; run "npm run icons"`);

        const png = fs.readFileSync(file);
        assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), `${name}.png is not a PNG`);
        assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR', `${name}.png has no IHDR first`);
        assert.equal(png.readUInt32BE(16), 144, `${name}.png width`);
        assert.equal(png.readUInt32BE(20), 144, `${name}.png height`);
        assert.equal(png[24], 8, `${name}.png bit depth`);
        assert.equal(png[25], 6, `${name}.png colour type (6 = RGBA)`);
    }
});

test('no icon PNG is left behind that nothing refers to', () => {
    const strays = fs.readdirSync(ICON_DIR)
        .filter((file) => file.endsWith('.png'))
        .filter((file) => !SHIPPED.has(file.slice(0, -'.png'.length)));
    assert.deepEqual(strays, [], 'run "npm run icons" to remove them');
});

test('the Phosphor licence travels with the icons', () => {
    const notice = fs.readFileSync(path.join(ICON_DIR, 'LICENSE.txt'), 'utf8');
    assert.match(notice, /Phosphor/);
    assert.match(notice, /MIT License/);
});

// ── iconDataUri ──────────────────────────────────────────────────────────────

test('iconDataUri returns the PNG as a data URI', () => {
    const uri = iconDataUri('Play');
    assert.ok(uri.startsWith('data:image/png;base64,'));
    const decoded = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
    assert.ok(decoded.equals(fs.readFileSync(path.join(ICON_DIR, 'Play.png'))));
    assert.equal(iconDataUri('Play'), uri, 'a second call gives the same answer');
});

test('iconDataUri refuses names that are not a plain icon name', () => {
    for (const name of ['', '../key', 'Play/../Play', 'Play.png', ' Play', null, undefined, 42, {}]) {
        assert.equal(iconDataUri(name), null, JSON.stringify(name));
    }
});

test('iconDataUri answers null for an icon that does not ship', () => {
    assert.equal(iconDataUri('NoSuchIcon'), null);
    assert.equal(iconDataUri('NoSuchIcon'), null, 'and stays null on the second call');
});
