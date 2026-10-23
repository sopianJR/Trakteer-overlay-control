/**
 * Request building and sending for the trakteer-ws control API.
 *
 * Split in two on purpose:
 *   buildRequest()  — pure, no I/O, fully unit-testable
 *   sendRequest()   — the only part that touches the network
 *
 * No token or stream key is ever stored here; both arrive per call from the
 * action's StreamDock settings.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const { findAction, resolveTestAlertMedia } = require('./endpoints');

const DEFAULT_BASE_URL = 'https://ws.trakteer.id';
const DEFAULT_TIMEOUT_MS = 8000;

/** Token format accepted by trakteer-ws (src/auth.js: TOKEN_PATTERN, 8..128). */
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOKEN_MIN = 8;
const TOKEN_MAX = 128;

/**
 * Mirror of the server-side format check so a typo is caught before a request
 * leaves the machine. Deliberately the same rule, not a stricter one.
 * @param {unknown} token
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTokenFormat(token) {
    if (typeof token !== 'string' || token.length === 0) return { valid: false, reason: 'token is empty' };
    if (token.length < TOKEN_MIN) return { valid: false, reason: `token too short (min ${TOKEN_MIN})` };
    if (token.length > TOKEN_MAX) return { valid: false, reason: `token too long (max ${TOKEN_MAX})` };
    if (!TOKEN_PATTERN.test(token)) return { valid: false, reason: 'token has invalid characters' };
    return { valid: true };
}

/** Strip a trailing slash so base + path never produces a double slash. */
function normalizeBaseUrl(baseUrl) {
    const raw = (baseUrl || '').trim() || DEFAULT_BASE_URL;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withScheme.replace(/\/+$/, '');
}

/** Drop null/undefined/'' entries so we never send empty query params. */
function compact(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === null || v === undefined || v === '') continue;
        out[k] = v;
    }
    return out;
}

/**
 * Build the generic broadcast request: POST /api/controls/:action, body { token_id }.
 *
 * The server does not whitelist the action here, so any non-empty action is
 * allowed through; the Property Inspector is what keeps users on the documented set.
 *
 * @param {object} params
 * @param {string} params.baseUrl
 * @param {string} params.action
 * @param {string} params.tokenId
 * @param {object} [params.extraBody] merged into the body (e.g. { payload: {...} })
 * @returns {{ ok: true, request: object } | { ok: false, error: string }}
 */
function buildBroadcastRequest({ baseUrl, action, tokenId, extraBody }) {
    if (!action || typeof action !== 'string') {
        return { ok: false, error: 'no action selected' };
    }
    const token = validateTokenFormat(tokenId);
    if (!token.valid) return { ok: false, error: token.reason };

    return {
        ok: true,
        request: {
            method: 'POST',
            url: `${normalizeBaseUrl(baseUrl)}/api/controls/${encodeURIComponent(action)}`,
            headers: { 'Content-Type': 'application/json' },
            body: { token_id: tokenId, ...(extraBody || {}) },
        },
    };
}

/**
 * Build a per-widget control request from the endpoint registry.
 *
 * @param {object} params
 * @param {string} params.baseUrl
 * @param {string} params.widget   registry widget id
 * @param {string} params.action   registry action id
 * @param {string} params.streamKey
 * @param {object} [params.values] user-supplied extras (amount, kind, ...)
 * @returns {{ ok: true, request: object } | { ok: false, error: string }}
 */
function buildWidgetRequest({ baseUrl, widget, action, streamKey, values }) {
    const descriptor = findAction(widget, action);
    if (!descriptor) return { ok: false, error: `unknown action ${widget}/${action}` };

    const key = validateTokenFormat(streamKey);
    if (!key.valid) return { ok: false, error: `stream key: ${key.reason}` };

    const supplied = compact(values);
    for (const need of descriptor.needs || []) {
        if (supplied[need] === undefined) {
            return { ok: false, error: `missing ${need}` };
        }
    }

    // The action goes either into the path or into a field, never both.
    const inPath = descriptor.path.includes(':action');
    const path = inPath ? descriptor.path.replace(':action', encodeURIComponent(descriptor.id)) : descriptor.path;

    const fields = {
        [descriptor.keyField]: streamKey,
        ...(descriptor.extras || {}),
        ...supplied,
    };
    if (!inPath && descriptor.actionField) {
        fields[descriptor.actionField] = descriptor.id;
    }

    const base = normalizeBaseUrl(baseUrl);

    if (descriptor.send === 'query') {
        const qs = new URLSearchParams(compact(fields)).toString();
        return {
            ok: true,
            request: {
                method: descriptor.method,
                url: `${base}${path}${qs ? `?${qs}` : ''}`,
                headers: {},
                body: null,
            },
        };
    }

    return {
        ok: true,
        request: {
            method: descriptor.method,
            url: `${base}${path}`,
            headers: { 'Content-Type': 'application/json' },
            body: compact(fields),
        },
    };
}

/**
 * Build the test alert request: `GET /api/overlay/alert-queue/test/:mediaType`.
 *
 * This is the route the Trakteer dashboard's own test buttons use, and the only one
 * that makes an alert appear in OBS: it hydrates a transient tip item and publishes
 * it as `alert-queue:test-alert`, which the overlay handles. The older
 * `POST /api/controls/newtip` answered 200 but only rebroadcast a raw `newtip`
 * type that no overlay build listens for.
 *
 * The credential is the creator's **stream key** in the `token` query param — the
 * same value the dashboard's Stream Deck modal puts in its URLs — and it is looked
 * up in the database here, unlike the format-only check on /api/controls/:action.
 *
 * @param {object} params
 * @param {string} params.baseUrl
 * @param {string} params.media       media id or legacy newtip media id
 * @param {string} params.streamKey
 * @param {number|string} [params.quantity]
 * @param {string} [params.widgetType] 'alert-box' (default) | 'media-share'
 * @returns {{ ok: true, request: object } | { ok: false, error: string }}
 */
function buildTestAlertRequest({ baseUrl, media, streamKey, quantity, widgetType }) {
    const mediaType = resolveTestAlertMedia(media);
    const values = {};
    if (quantity !== undefined && quantity !== null && quantity !== '') {
        values.quantity = quantity;
    }
    if (widgetType) values.widget_type = widgetType;

    return buildWidgetRequest({
        baseUrl,
        widget: 'alert-queue',
        action: mediaType,
        streamKey,
        values,
    });
}

/**
 * Perform a request built by one of the builders above.
 *
 * Never throws: every failure comes back as { ok: false, ... } so a button press
 * can always be given a verdict.
 *
 * @param {object} request from buildBroadcastRequest / buildWidgetRequest
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number|null, body: unknown, error?: string }>}
 */
function sendRequest(request, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
        let url;
        try {
            url = new URL(request.url);
        } catch {
            resolve({ ok: false, status: null, body: null, error: 'invalid base URL' });
            return;
        }

        const transport = url.protocol === 'http:' ? http : https;
        const payload = request.body === null || request.body === undefined
            ? null
            : Buffer.from(JSON.stringify(request.body), 'utf8');

        const headers = { Accept: 'application/json', ...(request.headers || {}) };
        if (payload) headers['Content-Length'] = String(payload.length);

        const req = transport.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'http:' ? 80 : 443),
                path: `${url.pathname}${url.search}`,
                method: request.method,
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let body = text;
                    try {
                        body = JSON.parse(text);
                    } catch {
                        // keep the raw text; some error paths answer plain text
                    }
                    const status = res.statusCode || 0;
                    resolve({
                        ok: status >= 200 && status < 300,
                        status,
                        body,
                        error: status >= 200 && status < 300 ? undefined : describeFailure(status, body),
                    });
                });
            },
        );

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve({ ok: false, status: null, body: null, error: 'timeout' });
        });
        req.on('error', (err) => {
            resolve({ ok: false, status: null, body: null, error: err.code || err.message });
        });

        if (payload) req.write(payload);
        req.end();
    });
}

/**
 * Turn a request URL into something safe to log: path only, with the values of
 * credential-bearing query params replaced. Credentials travel in `token`,
 * `stream_key` and `token_id`, and a query string is otherwise the natural thing
 * to log, so redaction happens here rather than at each call site.
 * @param {string} url
 * @returns {string}
 */
function redactUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return '<unparseable url>';
    }
    const SENSITIVE = new Set(['token', 'token_id', 'stream_key', 'key', 'passcode']);
    for (const name of [...parsed.searchParams.keys()]) {
        if (SENSITIVE.has(name.toLowerCase())) parsed.searchParams.set(name, '***');
    }
    const qs = parsed.searchParams.toString();
    return `${parsed.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * Turn a non-2xx response into a short phrase that fits on a button.
 * The specific strings come from the trakteer-ws error bodies.
 * @param {number} status
 * @param {unknown} body
 */
function describeFailure(status, body) {
    const reason = (body && typeof body === 'object' && (body.error || body.reason || body.message)) || '';
    if (status === 404 && String(reason).includes('room_not_found')) return 'overlay offline';
    if (status === 401) return 'bad stream key';
    if (status === 400) return String(reason) || 'bad request';
    if (status === 413) return 'payload too large';
    if (status >= 500) return 'server error';
    return `HTTP ${status}${reason ? `: ${reason}` : ''}`;
}

module.exports = {
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_MS,
    validateTokenFormat,
    normalizeBaseUrl,
    buildBroadcastRequest,
    buildWidgetRequest,
    buildTestAlertRequest,
    sendRequest,
    redactUrl,
    describeFailure,
};
