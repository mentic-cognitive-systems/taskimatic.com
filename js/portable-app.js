import { downloadBlob } from './download.js';

const escapeScript = source => source.replace(/<\/script/gi, '<\\/script');

async function readAsset(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(t('error.messages.couldNotEmbedValue0InTheDownload', { value0: String(url) }));
    return response.text();
}

// The app uses static named/side-effect imports and named exports. Each module
// gets its own scope, and shared dependencies execute once in dependency order.
export async function bundleModule(entryURL, readSource = readAsset) {
    const modules = new Map();
    const definitions = [];
    async function visit(url) {
        const key = String(url);
        if (modules.has(key)) return modules.get(key);
        const id = `module${modules.size}`;
        modules.set(key, id);
        let source = await readSource(url);
        const imports = [...source.matchAll(/^import\s+(?:\{([^}]+)\}\s+from\s+)?['"]([^'"]+)['"];[ \t]*$/gm)];
        const bindings = [];
        for (const match of imports) {
            const dependency = await visit(new URL(match[2], url));
            if (match[1]) {
                const names = match[1].trim().replace(/\s+as\s+/g, ': ');
                bindings.push(`const { ${names} } = ${dependency};`);
            }
            source = source.replace(match[0], '');
        }
        const exports = [];
        source = source.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let)\s+(\w+))/gm, (_, name) => {
            exports.push(name);
            return '';
        });
        source = source.replace(/^export\s*\{([^}]+)\};?[ \t]*$/gm, (_, names) => {
            exports.push(...names.split(',').map(name => name.trim()));
            return '';
        });
        definitions.push(`const ${id} = await (async () => {\n${bindings.join('\n')}\n${source}\nreturn { ${exports.join(', ')} };\n})();`);
        return id;
    }
    await visit(new URL(entryURL));
    return definitions.join('\n');
}

// Inline every local dependency before serializing, including on re-downloads
// from a portable copy where these assets are already embedded.
export async function embedPortableAssets(clone) {
    for (const link of clone.querySelectorAll('link[data-taskimatic-style]')) {
        const style = document.createElement('style');
        if (link.id) style.id = link.id;
        style.textContent = await readAsset(new URL(link.getAttribute('href'), document.baseURI));
        link.replaceWith(style);
    }
    for (const script of clone.querySelectorAll('script[src]')) {
        const url = new URL(script.getAttribute('src'), document.baseURI);
        const source = script.type === 'module' ? await bundleModule(url) : await readAsset(url);
        script.removeAttribute('src');
        script.textContent = escapeScript(source);
    }
}

export async function downloadPortableApp(workspace) {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelector('[data-taskimatic-offline]')?.remove();
    await window.i18n.ready;
    await Promise.all(window.i18n.getAvailableLanguages().map(lang => window.i18n.loadLocale(lang)));
    const localeSeed = document.createElement('script');
    localeSeed.type = 'application/json';
    localeSeed.id = 'taskimatic-i18n';
    localeSeed.textContent = JSON.stringify({ data: window.i18n.data, languages: window.i18n.languages,
        defaultLang: window.i18n.defaultLang, currentLang: window.i18n.currentLang }).replace(/</g, '\\u003c');
    clone.querySelector('#taskimatic-i18n')?.remove();
    clone.querySelector('[data-taskimatic-i18n-service]').before(localeSeed);
    const mounted = clone.querySelector('task-workspace');
    if (mounted) { mounted.replaceChildren(); mounted.removeAttribute('data-mounted'); }
    await embedPortableAssets(clone);
    const seed = clone.querySelector('#taskimatic-seed');
    if (seed) seed.textContent = JSON.stringify(workspace.exportData()).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html>\n${clone.outerHTML}`;
    const filename = `taskimatic-app-${new Date().toISOString().slice(0, 10)}.html`;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
    workspace.toast(t('ui.text.portableAppDownloadedWithTheCurrentWorkspace'));
    return { filename, taskCount: workspace.tasks.length, planCount: workspace.plans.length,
        wantCount: workspace.wants.length, agentCount: workspace.agents.length };
}
