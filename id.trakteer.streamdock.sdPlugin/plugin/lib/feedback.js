/**
 * Button feedback.
 *
 * Feedback is deliberately conservative: showOk/showAlert (the native StreamDock
 * overlays) plus a short title line. The status is not drawn with setImage: the key
 * image is its Phosphor icon (lib/icons.js), and an SVG data URI is reported to render
 * black on StreamDock hardware (an unsourced report, see the setImage section of
 * docs/device-compatibility.md), so a title-based status is the option that degrades
 * safely on every device.
 *
 * Titles are wrapped here and sent with the SDK's row argument left at its
 * default. The SDK's own wrapping (utils/plugin.js setTitle with row > 0) starts
 * its accumulator at `null` and then concatenates onto it, so every wrapped title
 * comes out prefixed with the literal text "null". We keep the vendored SDK file
 * unmodified and simply do not use that code path.
 */

'use strict';

/** How long a status line stays on the button before the label returns. */
const STATUS_HOLD_MS = 2500;

/** Button title geometry: at most this many lines of this many characters. */
const TITLE_ROWS = 3;
const TITLE_COLS = 9;

/** @type {Map<string, NodeJS.Timeout>} */
const timers = new Map();

/**
 * Wrap text onto the button, breaking on spaces where possible.
 * @param {string} text
 * @param {number} [rows]
 * @param {number} [cols]
 * @returns {string} text with embedded newlines, truncated with "…" if too long
 */
function wrapTitle(text, rows = TITLE_ROWS, cols = TITLE_COLS) {
    const source = String(text ?? '').trim();
    if (!source) return '';

    const lines = [];
    let rest = source;

    while (rest.length > 0 && lines.length < rows) {
        if (rest.length <= cols) {
            lines.push(rest);
            rest = '';
            break;
        }
        // Prefer a space inside the window so words are not split mid-way.
        const window = rest.slice(0, cols + 1);
        const breakAt = window.lastIndexOf(' ');
        const cut = breakAt > 0 ? breakAt : cols;
        lines.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }

    if (rest.length > 0 && lines.length > 0) {
        // Ran out of rows: mark the last line as truncated.
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = `${last.slice(0, Math.max(0, cols - 1))}…`;
    }

    return lines.join('\n');
}

/**
 * Show a transient status line, then restore the resting label.
 * @param {object} plugin Plugins instance
 * @param {string} context action context
 * @param {string} status short status text ("OK", "overlay offline", ...)
 * @param {string} restingLabel what to show once the status expires
 */
function flashStatus(plugin, context, status, restingLabel) {
    clearTimer(context);
    setTitle(plugin, context, status);
    const timer = setTimeout(() => {
        timers.delete(context);
        setTitle(plugin, context, restingLabel);
    }, STATUS_HOLD_MS);
    timers.set(context, timer);
}

/**
 * Set a wrapped button title.
 * @param {object} plugin Plugins instance
 * @param {string} context action context
 * @param {string} text
 */
function setTitle(plugin, context, text) {
    plugin.setTitle(context, wrapTitle(text));
}

/**
 * Report the outcome of one control request on the button.
 * @param {object} plugin Plugins instance
 * @param {string} context action context
 * @param {{ ok: boolean, error?: string }} result from sendRequest, or a build failure
 * @param {string} restingLabel
 */
function reportResult(plugin, context, result, restingLabel) {
    if (result.ok) {
        plugin.showOk(context);
        flashStatus(plugin, context, 'OK', restingLabel);
        return;
    }
    plugin.showAlert(context);
    flashStatus(plugin, context, result.error || 'error', restingLabel);
}

/** Cancel a pending restore (used on willDisappear). */
function clearTimer(context) {
    const existing = timers.get(context);
    if (existing) {
        clearTimeout(existing);
        timers.delete(context);
    }
}

module.exports = {
    STATUS_HOLD_MS,
    TITLE_ROWS,
    TITLE_COLS,
    wrapTitle,
    setTitle,
    flashStatus,
    reportResult,
    clearTimer,
};
