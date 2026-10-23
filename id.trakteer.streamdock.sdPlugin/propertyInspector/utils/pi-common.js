/**
 * Shared Property Inspector helpers.
 *
 * The SDK's action.js exposes `$settings` (a Proxy that persists on write) only
 * after the first didReceiveSettings. Everything here waits for that, then binds
 * plain inputs to setting keys — no framework, no two-way magic beyond one listener.
 */

/**
 * Bind a set of fields to $settings.
 *
 * @param {Array<{ id: string, key: string, default?: any, type?: 'number' }>} fields
 * @param {(settings: object) => void} [onChange] called after any field is written
 * @returns {{ apply: (settings: object) => void }}
 */
function bindFields(fields, onChange) {
    const apply = (settings) => {
        for (const field of fields) {
            const el = document.getElementById(field.id);
            if (!el) continue;
            const stored = settings[field.key];
            el.value = stored === undefined || stored === null ? (field.default ?? '') : stored;
        }
        if (onChange) onChange(settings);
    };

    for (const field of fields) {
        const el = document.getElementById(field.id);
        if (!el) continue;
        const handler = () => {
            if (typeof $settings === 'undefined' || !$settings) return;
            $settings[field.key] = field.type === 'number' ? Number(el.value) : el.value;
            if (onChange) onChange($settings);
        };
        el.addEventListener('change', handler);
        if (el.tagName === 'INPUT') el.addEventListener('input', debounceLocal(handler, 400));
    }

    return { apply };
}

/** Small local debounce: common.js's $.debounce is bound to WebSocket.saveData. */
function debounceLocal(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Replace a <select>'s options.
 * @param {string} id select element id
 * @param {Array<{ id: string, label: string }>} items
 * @param {string} [selected] value to keep selected when still present
 */
function fillSelect(id, items, selected) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        el.appendChild(option);
    }
    if (selected && items.some((i) => i.id === selected)) {
        el.value = selected;
    }
}

/** Show or hide a row by element id. */
function toggleRow(id, visible) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !visible);
}
