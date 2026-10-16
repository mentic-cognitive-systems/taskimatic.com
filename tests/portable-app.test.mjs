import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { bundleModule, embedPortableAssets } from '../js/portable-app.js';
import { t, escapeHTML, uiLabel, i18n } from './i18n-test-context.mjs';

const entry = new URL('../js/tasks-app.js', import.meta.url);

test('portable bundle boots the complete app graph with isolated modules and no network imports', async () => {
    const reads = new Map();
    const code = await bundleModule(entry, async url => {
        reads.set(String(url), (reads.get(String(url)) || 0) + 1);
        return fs.readFile(url, 'utf8');
    });
    assert.ok([...reads.values()].every(count => count === 1));
    assert.doesNotMatch(code, /^\s*(?:import|export)\s/gm);
    const registered = new Map();
    const target = {
        HTMLElement: class {},
        customElements: { get: name => registered.get(name), define: (name, component) => registered.set(name, component) },
        i18n
    };
    await vm.runInNewContext(`(async () => { ${code} })()`, {
        window: target, HTMLElement: target.HTMLElement, customElements: target.customElements,
        t, escapeHTML, uiLabel, console
    });
    for (const name of ['task-workspace', 'task-item', 'task-table', 'task-hierarchy-editor',
        'task-sort-controls', 'task-visualization', 'planning-item', 'dual-range-slider',
        'lock-in-controls', 'searcher-element', 'session-times', 'backup-tracker']) {
        assert.ok(registered.has(name), `${name} registered`);
    }
    assert.equal(target.taskimatic.version, '2.1.0');
    const worker = await fs.readFile(new URL('../tasks-sw.js', import.meta.url), 'utf8');
    for (const url of reads.keys()) {
        const relative = new URL(url).pathname.slice(new URL('../', import.meta.url).pathname.length);
        assert.ok(worker.includes(`'./${relative}'`), `${relative} cached for offline use`);
    }
});

test('portable bundler reports asset failures instead of creating a partial download', async () => {
    await assert.rejects(bundleModule(entry, async () => { throw Error('asset unavailable'); }), /asset unavailable/);
});


test('portable assets embed CSS and classic scripts and can be exported again without fetching', async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const requests = [];
    const link = {id: 'protect-modal-styles', getAttribute: () => './css/protect-modal.css',
        replaceWith(style) { this.style = style; }};
    const script = {type: '', getAttribute: () => './js/workspace-tabs.js',
        removeAttribute(name) { this.removedAttribute = name; }};
    const clone = {querySelectorAll(selector) {
        if (selector === 'link[data-taskimatic-style]') return link.style ? [] : [link];
        return script.removedAttribute ? [] : [script];
    }};
    try {
        globalThis.document = {baseURI: 'https://taskimatic.test/subdir/', createElement: () => ({})};
        globalThis.fetch = async url => {
            requests.push(String(url));
            return {ok: true, text: async () => String(url).endsWith('.css') ? '.modal { color: red; }' : 'console.log("</script>");'};
        };
        await embedPortableAssets(clone);
        assert.equal(link.style.id, 'protect-modal-styles');
        assert.equal(link.style.textContent, '.modal { color: red; }');
        assert.equal(script.removedAttribute, 'src');
        assert.ok(!script.textContent.includes('</script>'));
        assert.deepEqual(requests, ['https://taskimatic.test/subdir/css/protect-modal.css',
            'https://taskimatic.test/subdir/js/workspace-tabs.js']);
        await embedPortableAssets(clone);
        assert.equal(requests.length, 2);
    } finally {
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
    }
});
