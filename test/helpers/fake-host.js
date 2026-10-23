/**
 * Fake StreamDock host.
 *
 * Reproduces the parts of the real host the plugin process depends on, read off
 * SDNodeJsSDKV2/.../plugin/utils/plugin.js:
 *
 *   - argv layout: Plugins uses process.argv[3] as the port, [5] as the uuid,
 *     [7] as the register event and [9] as the JSON app info. With node's own
 *     argv[0]/[1] that means: -port <p> -pluginUUID <u> -registerEvent <e> -info <json>
 *   - a WebSocket server that receives the register frame and then exchanges
 *     the same event envelopes the host uses (willAppear, keyUp, setTitle, showOk...)
 *
 * This lets us drive the real plugin/index.js end to end — button press in, HTTP
 * request out, feedback event back — without StreamDock or hardware.
 *
 * Used by test/plugin-runtime.test.js.
 */

'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
// __dirname is test/helpers, so the repo root is two levels up.
const ROOT = path.resolve(__dirname, '..', '..');
const { WebSocketServer } = require(path.join(
    ROOT, 'id.trakteer.streamdock.sdPlugin', 'plugin', 'node_modules', 'ws',
));

const PLUGIN_ENTRY = path.join(ROOT, 'id.trakteer.streamdock.sdPlugin', 'plugin', 'index.js');
const PLUGIN_CWD = path.dirname(PLUGIN_ENTRY);

/**
 * Boot a fake host plus the plugin process.
 * @param {object} [options]
 * @param {string} [options.language] value put in info.application.language
 * @returns {Promise<object>} host handle
 */
async function startHost(options = {}) {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve) => wss.once('listening', resolve));
    const port = wss.address().port;

    /** every frame the plugin sent us, in order */
    const frames = [];
    /** resolvers waiting for a frame to match */
    const waiters = [];

    const socketReady = new Promise((resolve) => {
        wss.once('connection', (socket) => {
            socket.on('message', (raw) => {
                let frame;
                try {
                    frame = JSON.parse(raw.toString());
                } catch {
                    frame = { raw: raw.toString() };
                }
                frames.push(frame);
                for (let i = waiters.length - 1; i >= 0; i--) {
                    if (waiters[i].predicate(frame)) {
                        waiters[i].resolve(frame);
                        waiters.splice(i, 1);
                    }
                }
            });
            resolve(socket);
        });
    });

    const info = JSON.stringify({
        application: { language: options.language || 'en', platform: 'windows', version: '3.10.203' },
        devices: [],
    });

    // argv indices the SDK reads: [3] port, [5] uuid, [7] event, [9] info.
    const child = spawn(
        process.execPath,
        [
            PLUGIN_ENTRY,
            '-port', String(port),
            '-pluginUUID', 'fake-host-uuid',
            '-registerEvent', 'registerPlugin',
            '-info', info,
        ],
        { cwd: PLUGIN_CWD, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const stderr = [];
    child.stderr.on('data', (c) => stderr.push(c.toString()));
    const stdout = [];
    child.stdout.on('data', (c) => stdout.push(c.toString()));

    const socket = await socketReady;

    /** Send one host→plugin event. */
    const send = (payload) => socket.send(JSON.stringify(payload));

    /** Wait for the next frame matching `predicate` (or any frame already buffered). */
    const waitFor = (predicate, timeoutMs = 5000) => {
        const existing = frames.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`timed out waiting for frame; got: ${JSON.stringify(frames)}`));
            }, timeoutMs);
            waiters.push({
                predicate,
                resolve: (frame) => { clearTimeout(timer); resolve(frame); },
            });
        });
    };

    const stop = () => new Promise((resolve) => {
        child.once('exit', () => {
            wss.close(() => resolve({ stderr: stderr.join(''), stdout: stdout.join('') }));
        });
        child.kill('SIGTERM');
    });

    return { port, frames, send, waitFor, stop, child, stderr, stdout };
}

module.exports = { startHost };
