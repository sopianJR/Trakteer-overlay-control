/**
 * Trakteer StreamDock plugin — entry point.
 *
 * Three actions:
 *   generic   — POST /api/controls/:action with token_id (play/pause/next/censor…)
 *   testalert — POST /api/controls/newtip with a media payload
 *   widget    — the per-widget control endpoints (stream_key based)
 *
 * All request building lives in lib/; this file only wires StreamDock events to it.
 * Credentials are read from each action's own settings and never written to disk
 * by this plugin.
 */

'use strict';

const { Plugins, Actions, log } = require('./utils/plugin');
const { DEFAULT_BASE_URL, buildBroadcastRequest, buildWidgetRequest, sendRequest, redactUrl } = require('./lib/trakteer-api');
const { findAction } = require('./lib/endpoints');
const { reportResult, clearTimer, setTitle } = require('./lib/feedback');

const plugin = new Plugins('trakteer');

/** Resting label for a button: the user's own title wins, else the action id. */
function restingLabel(settings, fallback) {
    const custom = (settings && settings.label) || '';
    return custom || fallback || '';
}

/** Shared press handler: build → send → report. */
async function press({ context, settings, build, label }) {
    const built = build();
    if (!built.ok) {
        log.error('build-failed', { error: built.error });
        reportResult(plugin, context, { ok: false, error: built.error }, label);
        return;
    }

    const result = await sendRequest(built.request, {
        timeoutMs: Number(settings.timeoutMs) || undefined,
    });

    // Log the verdict, never the credentials: redactUrl strips the token/stream_key
    // values that per-widget endpoints carry in the query string.
    log.info('control-request', {
        method: built.request.method,
        path: redactUrl(built.request.url),
        status: result.status,
        ok: result.ok,
        error: result.error,
    });

    reportResult(plugin, context, result, label);
}

// ── Action: generic broadcast ────────────────────────────────────────────────
plugin.generic = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, action: 'next', tokenId: '', label: '' },
    _willAppear({ context }) {
        const settings = plugin.generic.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, settings.action));
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.generic.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, settings.action));
    },
    _willDisappear({ context }) {
        clearTimer(context);
    },
    keyUp({ context }) {
        const settings = plugin.generic.data[context] || {};
        const label = restingLabel(settings, settings.action);
        press({
            context,
            settings,
            label,
            build: () => buildBroadcastRequest({
                baseUrl: settings.baseUrl,
                action: settings.action,
                tokenId: settings.tokenId,
            }),
        });
    },
});

// ── Action: test alert (newtip) ──────────────────────────────────────────────
plugin.testalert = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, media: 'null', quantity: 1, tokenId: '', label: 'Test' },
    _willAppear({ context }) {
        const settings = plugin.testalert.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, 'Test'));
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.testalert.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, 'Test'));
    },
    _willDisappear({ context }) {
        clearTimer(context);
    },
    keyUp({ context }) {
        const settings = plugin.testalert.data[context] || {};
        const label = restingLabel(settings, 'Test');
        // "null" in the Property Inspector means a text-only alert: send JSON null,
        // which is what docs/stream-deck.md specifies for that case.
        const media = settings.media === 'null' || !settings.media ? null : settings.media;
        const quantity = Math.max(1, parseInt(settings.quantity, 10) || 1);
        press({
            context,
            settings,
            label,
            build: () => buildBroadcastRequest({
                baseUrl: settings.baseUrl,
                action: 'newtip',
                tokenId: settings.tokenId,
                extraBody: { payload: { media, quantity } },
            }),
        });
    },
});

// ── Action: per-widget control ───────────────────────────────────────────────
plugin.widget = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, widget: 'alert-queue', action: 'play', streamKey: '', amount: '', kind: '', label: '' },
    _willAppear({ context }) {
        const settings = plugin.widget.data[context] || {};
        setTitle(plugin, context, widgetLabel(settings));
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.widget.data[context] || {};
        setTitle(plugin, context, widgetLabel(settings));
    },
    _willDisappear({ context }) {
        clearTimer(context);
    },
    keyUp({ context }) {
        const settings = plugin.widget.data[context] || {};
        const label = widgetLabel(settings);
        press({
            context,
            settings,
            label,
            build: () => buildWidgetRequest({
                baseUrl: settings.baseUrl,
                widget: settings.widget,
                action: settings.action,
                streamKey: settings.streamKey,
                values: { amount: settings.amount, kind: settings.kind },
            }),
        });
    },
});

/** Prefer the user's label, else the registry label, else the raw action id. */
function widgetLabel(settings) {
    if (settings.label) return settings.label;
    const descriptor = findAction(settings.widget, settings.action);
    return (descriptor && descriptor.label) || settings.action || '';
}

module.exports = { plugin };
