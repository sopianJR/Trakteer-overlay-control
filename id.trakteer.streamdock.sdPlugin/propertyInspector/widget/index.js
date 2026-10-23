/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

const $local = false, $back = false, $dom = {
    main: $('.sdpi-wrapper')
};

const { WIDGETS, findAction } = window.TRAKTEER_ENDPOINTS;

const FIELDS = [
    { id: 'widget', key: 'widget', default: 'alert-queue' },
    { id: 'action', key: 'action', default: 'play' },
    { id: 'amount', key: 'amount', default: '' },
    { id: 'kind', key: 'kind', default: '' },
    { id: 'streamKey', key: 'streamKey', default: '' },
    { id: 'label', key: 'label', default: '' },
    { id: 'baseUrl', key: 'baseUrl', default: 'https://ws.trakteer.id' },
];

// Widget list is fixed; the action list follows the selected widget.
fillSelect('widget', Object.entries(WIDGETS).map(([id, w]) => ({ id, label: w.label })));

/** Repopulate the action select for the chosen widget and show only the extras it needs. */
function refreshDependentUi(settings) {
    const widgetId = document.getElementById('widget').value || settings.widget;
    const widget = WIDGETS[widgetId];
    if (!widget) return;

    const actionSelect = document.getElementById('action');
    const wanted = settings.action || actionSelect.value;
    const stillValid = widget.actions.some((a) => a.id === wanted);
    fillSelect('action', widget.actions, stillValid ? wanted : widget.actions[0].id);

    // A widget change usually invalidates the stored action; persist the fallback
    // so the plugin never holds an action the selected widget does not have.
    if (!stillValid && typeof $settings !== 'undefined' && $settings) {
        $settings.action = widget.actions[0].id;
    }

    const descriptor = findAction(widgetId, actionSelect.value) || {};
    const needs = descriptor.needs || [];
    toggleRow('row-amount', needs.includes('amount'));
    toggleRow('row-kind', needs.includes('kind'));

    const hint = document.getElementById('endpoint-hint');
    if (hint) {
        hint.textContent = descriptor.path
            ? `${descriptor.method} ${descriptor.path.replace(':action', descriptor.id)}`
            : '';
    }
}

const binding = bindFields(FIELDS, refreshDependentUi);

document.getElementById('widget').addEventListener('change', () => {
    refreshDependentUi(typeof $settings !== 'undefined' && $settings ? $settings : {});
});
document.getElementById('action').addEventListener('change', () => {
    refreshDependentUi(typeof $settings !== 'undefined' && $settings ? $settings : {});
});

const $propEvent = {
    didReceiveSettings({ settings }) {
        const s = settings || {};
        // Fill the widget select first so the action list is built for the right widget.
        const widgetEl = document.getElementById('widget');
        if (s.widget && WIDGETS[s.widget]) widgetEl.value = s.widget;
        refreshDependentUi(s);
        binding.apply(s);
        refreshDependentUi(s);
    },
    sendToPropertyInspector() { }
};
