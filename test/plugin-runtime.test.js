/**
 * Runtime tests: the real plugin process, driven by a fake StreamDock host.
 *
 * These are the tests that prove the plugin actually works rather than merely
 * parses: a keyUp event goes in, an HTTP request lands on the mock trakteer-ws,
 * and the plugin answers the host with showOk / showAlert and a title.
 *
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { startHost } = require('./helpers/fake-host');

const KNOWN_KEY = 'mockstreamkey01';
const MOCK = path.resolve(__dirname, '..', 'tools', 'mock-ws-server.js');

function startMock(env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [MOCK, '0'], {
            env: { ...process.env, MOCK_KNOWN_KEY: KNOWN_KEY, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const received = [];
        let out = '';
        child.stdout.on('data', (c) => {
            out += c.toString();
            const lines = out.split('\n');
            out = lines.pop();
            for (const line of lines) if (line.trim()) received.push(JSON.parse(line));
        });
        let err = '';
        const onErr = (c) => {
            err += c.toString();
            const m = err.match(/http:\/\/127\.0\.0\.1:(\d+)/);
            if (m) {
                child.stderr.off('data', onErr);
                resolve({
                    baseUrl: `http://127.0.0.1:${m[1]}`,
                    received,
                    stop: () => new Promise((d) => { child.once('exit', d); child.kill('SIGTERM'); }),
                });
            }
        };
        child.stderr.on('data', onErr);
        child.once('error', reject);
        setTimeout(() => reject(new Error('mock did not start')), 5000).unref();
    });
}

const GENERIC = 'id.trakteer.streamdock.generic';
const WIDGET = 'id.trakteer.streamdock.widget';
const TESTALERT = 'id.trakteer.streamdock.testalert';

/** willAppear envelope, matching the shape documented in the SDK readme. */
function willAppear(action, context, settings) {
    return {
        action,
        event: 'willAppear',
        context,
        device: 'fake-device',
        payload: { settings, coordinates: { column: 0, row: 0 }, state: 0, isInMultiAction: false },
    };
}

function keyUp(action, context, settings) {
    return {
        action,
        event: 'keyUp',
        context,
        device: 'fake-device',
        payload: { settings, coordinates: { column: 0, row: 0 }, state: 0, isInMultiAction: false },
    };
}

test('plugin registers with the host on start', async (t) => {
    const host = await startHost();
    t.after(() => host.stop());

    const registration = await host.waitFor((f) => f.event === 'registerPlugin');
    assert.equal(registration.uuid, 'fake-host-uuid');
});

test('willAppear sets a resting title from the stored settings', async (t) => {
    const host = await startHost();
    t.after(() => host.stop());
    await host.waitFor((f) => f.event === 'registerPlugin');

    host.send(willAppear(GENERIC, 'ctx-title', { action: 'pause', label: '', tokenId: KNOWN_KEY }));

    const frame = await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-title');
    assert.equal(frame.payload.title, 'pause');
});

test('a custom label wins over the action name', async (t) => {
    const host = await startHost();
    t.after(() => host.stop());
    await host.waitFor((f) => f.event === 'registerPlugin');

    host.send(willAppear(GENERIC, 'ctx-label', { action: 'next', label: 'Skip', tokenId: KNOWN_KEY }));

    const frame = await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-label');
    assert.equal(frame.payload.title, 'Skip');
});

test('keyUp on the generic action sends the broadcast request and answers showOk', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = { baseUrl: mock.baseUrl, action: 'next', tokenId: KNOWN_KEY, label: '' };
    host.send(willAppear(GENERIC, 'ctx-ok', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-ok');
    host.send(keyUp(GENERIC, 'ctx-ok', settings));

    const okFrame = await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-ok');
    assert.equal(okFrame.event, 'showOk');

    const request = mock.received.find((r) => r.path === '/api/controls/next');
    assert.ok(request, `no request reached the mock; saw ${JSON.stringify(mock.received)}`);
    assert.equal(request.method, 'POST');
    assert.match(request.contentType, /application\/json/);
    assert.deepEqual(JSON.parse(request.body), { token_id: KNOWN_KEY });

    // and the button shows a short status
    const status = await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-ok' && f.payload.title === 'OK');
    assert.equal(status.payload.title, 'OK');
});

test('an offline overlay answers showAlert and an "overlay offline" status', async (t) => {
    const mock = await startMock({ MOCK_ROOM_ONLINE: '0' });
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = { baseUrl: mock.baseUrl, action: 'play', tokenId: KNOWN_KEY, label: 'Play' };
    host.send(willAppear(GENERIC, 'ctx-404', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-404');
    host.send(keyUp(GENERIC, 'ctx-404', settings));

    await host.waitFor((f) => f.event === 'showAlert' && f.context === 'ctx-404');
    const status = await host.waitFor(
        (f) => f.event === 'setTitle' && f.context === 'ctx-404' && f.payload.title !== 'Play',
    );
    assert.match(status.payload.title.replace(/\n/g, ' '), /offline/);
});

test('an empty token never reaches the network', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = { baseUrl: mock.baseUrl, action: 'next', tokenId: '', label: 'Next' };
    host.send(willAppear(GENERIC, 'ctx-empty', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-empty');
    const before = mock.received.length;
    host.send(keyUp(GENERIC, 'ctx-empty', settings));

    await host.waitFor((f) => f.event === 'showAlert' && f.context === 'ctx-empty');
    assert.equal(mock.received.length, before, 'no HTTP request should have been made');
});

test('the widget action drives a per-widget endpoint', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = {
        baseUrl: mock.baseUrl, widget: 'timer', action: 'add', streamKey: KNOWN_KEY, amount: 60, kind: '', label: '',
    };
    host.send(willAppear(WIDGET, 'ctx-widget', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-widget');
    host.send(keyUp(WIDGET, 'ctx-widget', settings));

    await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-widget');

    const request = mock.received.find((r) => r.path === '/api/overlay/timer/control');
    assert.ok(request, `no timer request; saw ${JSON.stringify(mock.received)}`);
    assert.equal(request.method, 'GET');
    assert.equal(request.query.stream_key, KNOWN_KEY);
    assert.equal(request.query.action, 'add');
    assert.equal(request.query.amount, '60');
});

test('the widget action reports a bad stream key', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = {
        baseUrl: mock.baseUrl, widget: 'goal', action: 'hide', streamKey: 'wrongkey99999', amount: '', kind: '', label: 'Hide',
    };
    host.send(willAppear(WIDGET, 'ctx-401', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-401');
    host.send(keyUp(WIDGET, 'ctx-401', settings));

    await host.waitFor((f) => f.event === 'showAlert' && f.context === 'ctx-401');
    const status = await host.waitFor(
        (f) => f.event === 'setTitle' && f.context === 'ctx-401' && f.payload.title !== 'Hide',
    );
    // The status is wrapped onto button lines, so compare ignoring the line breaks.
    assert.match(status.payload.title.replace(/\n/g, ' '), /stream key/);
});

test('the test alert action sends newtip with its media payload', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = { baseUrl: mock.baseUrl, media: 'gif', quantity: 2, tokenId: KNOWN_KEY, label: 'Test' };
    host.send(willAppear(TESTALERT, 'ctx-tip', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-tip');
    host.send(keyUp(TESTALERT, 'ctx-tip', settings));

    await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-tip');

    const request = mock.received.find((r) => r.path === '/api/controls/newtip');
    assert.ok(request, `no newtip request; saw ${JSON.stringify(mock.received)}`);
    assert.deepEqual(JSON.parse(request.body), {
        token_id: KNOWN_KEY,
        payload: { media: 'gif', quantity: 2 },
    });
});

test('didReceiveSettings refreshes the resting title', async (t) => {
    const host = await startHost();
    t.after(() => host.stop());
    await host.waitFor((f) => f.event === 'registerPlugin');

    host.send(willAppear(WIDGET, 'ctx-upd', { widget: 'goal', action: 'hide', streamKey: KNOWN_KEY }));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-upd');

    host.send({
        action: WIDGET,
        event: 'didReceiveSettings',
        context: 'ctx-upd',
        device: 'fake-device',
        payload: { settings: { widget: 'goal', action: 'show', streamKey: KNOWN_KEY, label: '' } },
    });

    const frame = await host.waitFor(
        (f) => f.event === 'setTitle' && f.context === 'ctx-upd' && f.payload.title === 'Show',
    );
    assert.equal(frame.payload.title, 'Show');
});

test('the plugin process stays up and logs no uncaught error', async (t) => {
    const mock = await startMock();
    const host = await startHost();
    await host.waitFor((f) => f.event === 'registerPlugin');

    const settings = { baseUrl: mock.baseUrl, action: 'next', tokenId: KNOWN_KEY, label: '' };
    host.send(willAppear(GENERIC, 'ctx-live', settings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-live');
    host.send(keyUp(GENERIC, 'ctx-live', settings));
    await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-live');

    assert.equal(host.child.exitCode, null, 'plugin process should still be running');

    const { stderr } = await host.stop();
    await mock.stop();
    assert.equal(stderr.trim(), '', `plugin wrote to stderr: ${stderr}`);
});

test('the log file never contains a token or stream key', async (t) => {
    const fs = require('node:fs');
    const LOG_DIR = path.resolve(__dirname, '..', 'id.trakteer.streamdock.sdPlugin', 'plugin', 'log');
    const UNIQUE_KEY = 'leaktestkey0001';

    const mock = await startMock({ MOCK_KNOWN_KEY: UNIQUE_KEY });
    const host = await startHost();
    t.after(async () => { await host.stop(); await mock.stop(); });
    await host.waitFor((f) => f.event === 'registerPlugin');

    // A query-string endpoint (widget) and a bodied one (broadcast): the query
    // string is the path that actually risked leaking a credential into the log.
    const widgetSettings = {
        baseUrl: mock.baseUrl, widget: 'timer', action: 'pause', streamKey: UNIQUE_KEY, amount: '', kind: '', label: '',
    };
    host.send(willAppear(WIDGET, 'ctx-leak-w', widgetSettings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-leak-w');
    host.send(keyUp(WIDGET, 'ctx-leak-w', widgetSettings));
    await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-leak-w');

    const genericSettings = { baseUrl: mock.baseUrl, action: 'next', tokenId: UNIQUE_KEY, label: '' };
    host.send(willAppear(GENERIC, 'ctx-leak-g', genericSettings));
    await host.waitFor((f) => f.event === 'setTitle' && f.context === 'ctx-leak-g');
    host.send(keyUp(GENERIC, 'ctx-leak-g', genericSettings));
    await host.waitFor((f) => f.event === 'showOk' && f.context === 'ctx-leak-g');

    // log4js flushes asynchronously; give it a moment before reading.
    await new Promise((r) => setTimeout(r, 400));

    const files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : [];
    assert.ok(files.length > 0, 'the plugin should have written a log file');

    for (const file of files) {
        const contents = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
        const offending = contents.split('\n').filter((l) => l.includes(UNIQUE_KEY));
        assert.deepEqual(offending, [], `credential found in log/${file}`);
    }
});
