/**
 * Integration tests: real HTTP against the local mock trakteer-ws.
 *
 * The mock reproduces the status codes the real server returns on the control
 * routes (see tools/mock-ws-server.js). These tests check what the plugin actually
 * puts on the wire and how it classifies each response — not just that a function
 * returned.
 *
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const {
    buildBroadcastRequest,
    buildWidgetRequest,
    sendRequest,
} = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/trakteer-api');

const KNOWN_KEY = 'mockstreamkey01';
const UNKNOWN_KEY = 'unknownkey99999';
const SERVER = path.resolve(__dirname, '..', 'tools', 'mock-ws-server.js');

/** Start the mock server, resolving once it reports its port. */
function startMock(env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SERVER, '0'], {
            env: { ...process.env, MOCK_KNOWN_KEY: KNOWN_KEY, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const received = [];
        let stdoutBuffer = '';
        child.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop();
            for (const line of lines) {
                if (line.trim()) received.push(JSON.parse(line));
            }
        });

        let stderrBuffer = '';
        const onStderr = (chunk) => {
            stderrBuffer += chunk.toString();
            const match = stderrBuffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
            if (match) {
                child.stderr.off('data', onStderr);
                resolve({
                    baseUrl: `http://127.0.0.1:${match[1]}`,
                    received,
                    stop: () => new Promise((done) => { child.once('exit', done); child.kill('SIGTERM'); }),
                });
            }
        };
        child.stderr.on('data', onStderr);
        child.once('error', reject);
        setTimeout(() => reject(new Error('mock server did not start within 5s')), 5000).unref();
    });
}

test('broadcast: 200 on a known token, and the wire format is exactly as documented', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildBroadcastRequest({ baseUrl: mock.baseUrl, action: 'next', tokenId: KNOWN_KEY });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, true, `expected 2xx, got ${result.status} ${result.error || ''}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, type: 'next' });

    const seen = mock.received.at(-1);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.path, '/api/controls/next');
    assert.match(seen.contentType, /application\/json/);
    assert.deepEqual(JSON.parse(seen.body), { token_id: KNOWN_KEY });
});

test('broadcast: 404 room_not_found is reported as "overlay offline"', async (t) => {
    const mock = await startMock({ MOCK_ROOM_ONLINE: '0' });
    t.after(() => mock.stop());

    const built = buildBroadcastRequest({ baseUrl: mock.baseUrl, action: 'play', tokenId: KNOWN_KEY });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.error, 'overlay offline');
});

test('broadcast: newtip sends the media payload', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildBroadcastRequest({
        baseUrl: mock.baseUrl,
        action: 'newtip',
        tokenId: KNOWN_KEY,
        extraBody: { payload: { media: 'youtube', quantity: 3 } },
    });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, true);
    const seen = mock.received.at(-1);
    assert.equal(seen.path, '/api/controls/newtip');
    assert.deepEqual(JSON.parse(seen.body), {
        token_id: KNOWN_KEY,
        payload: { media: 'youtube', quantity: 3 },
    });
});

test('broadcast: a text-only test alert sends media null', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildBroadcastRequest({
        baseUrl: mock.baseUrl, action: 'newtip', tokenId: KNOWN_KEY,
        extraBody: { payload: { media: null, quantity: 1 } },
    });
    await sendRequest(built.request);

    assert.equal(JSON.parse(mock.received.at(-1).body).payload.media, null);
});

test('widget GET: 200 and the key travels as ?token=', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildWidgetRequest({
        baseUrl: mock.baseUrl, widget: 'alert-queue', action: 'pause', streamKey: KNOWN_KEY,
    });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, true, `${result.status} ${result.error || ''}`);
    assert.equal(result.body.action, 'pause');

    const seen = mock.received.at(-1);
    assert.equal(seen.method, 'GET');
    assert.equal(seen.path, '/api/overlay/alert-queue/control/pause');
    assert.equal(seen.query.token, KNOWN_KEY);
    assert.equal(seen.body, null, 'GET carries no body');
});

test('widget POST: 200 and the key travels in the JSON body', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildWidgetRequest({
        baseUrl: mock.baseUrl, widget: 'soundboard-queue', action: 'next', streamKey: KNOWN_KEY,
    });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, true, `${result.status} ${result.error || ''}`);
    const seen = mock.received.at(-1);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.path, '/api/overlay/soundboard-queue/control');
    assert.deepEqual(JSON.parse(seen.body), { stream_key: KNOWN_KEY, action: 'next' });
});

test('widget: an unknown stream key is reported as "bad stream key"', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildWidgetRequest({
        baseUrl: mock.baseUrl, widget: 'timer', action: 'pause', streamKey: UNKNOWN_KEY,
    });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, 'bad stream key');
});

test('widget: timer add carries the amount', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const built = buildWidgetRequest({
        baseUrl: mock.baseUrl, widget: 'timer', action: 'add', streamKey: KNOWN_KEY, values: { amount: 120 },
    });
    const result = await sendRequest(built.request);

    assert.equal(result.ok, true, `${result.status} ${result.error || ''}`);
    const seen = mock.received.at(-1);
    assert.equal(seen.query.action, 'add');
    assert.equal(seen.query.amount, '120');
});

test('every registry action is accepted by the mock server', async (t) => {
    const mock = await startMock();
    t.after(() => mock.stop());

    const { WIDGETS } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');
    const failures = [];

    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        for (const action of widget.actions) {
            const values = {};
            for (const need of action.needs || []) values[need] = need === 'amount' ? 10 : 'support';
            const built = buildWidgetRequest({
                baseUrl: mock.baseUrl, widget: widgetId, action: action.id, streamKey: KNOWN_KEY, values,
            });
            if (!built.ok) { failures.push(`${widgetId}/${action.id}: build ${built.error}`); continue; }
            const result = await sendRequest(built.request);
            if (!result.ok) failures.push(`${widgetId}/${action.id}: ${result.status} ${result.error}`);
        }
    }

    assert.deepEqual(failures, [], `actions rejected by the mock:\n${failures.join('\n')}`);
});

test('an unreachable server is reported, not thrown', async () => {
    // Port 1 on loopback: nothing listens, so connect fails immediately.
    const built = buildBroadcastRequest({ baseUrl: 'http://127.0.0.1:1', action: 'play', tokenId: KNOWN_KEY });
    const result = await sendRequest(built.request, { timeoutMs: 2000 });

    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.ok(result.error, 'an error string is always present');
});
