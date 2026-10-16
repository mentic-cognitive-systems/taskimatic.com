import {t, escapeHTML, uiLabel, i18n} from './i18n-test-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/offline.js', import.meta.url), 'utf8');
const code = source;
function launch({ua = 'iPhone', installed = false, storage = new Map(), blocked = false, platform = '', touch = 0} = {}) {
    const events = {}, timers = [], panels = [];
    const document = {
        readyState: 'complete', body: {append: node => panels.push(node)},
        createElement() {
            const button = () => ({hidden: true, addEventListener(name, fn) { this[name] = fn; }});
            const install = button(), dismiss = button();
            return {setAttribute() {}, remove() {this.removed = true;}, querySelector: selector => selector === '.phone-install-button' ? install : dismiss};
        }
    };
    vm.runInNewContext(code, {
        t, escapeHTML, uiLabel,
        window: {i18n: {ready: {then: fn => fn()}}, isSecureContext: true, matchMedia: () => ({matches: installed}), addEventListener: (name, fn) => {events[name] = fn;}},
        navigator: {userAgent: ua, platform, maxTouchPoints: touch}, location: {protocol: 'https:'}, document,
        localStorage: {getItem(key) {if (blocked) throw Error(); return storage.get(key);}, setItem(key,value) {if (blocked) throw Error(); storage.set(key,value);}},
        setTimeout: fn => {timers.push(fn); return 1;}, clearTimeout() {timers.length = 0;}
    });
    timers.forEach(fn => fn());
    return {events, panels, storage};
}

test('iOS offers Home Screen instructions once, even without dismissal', () => {
    const first = launch();
    assert.equal(first.panels.length, 1);
    assert.match(first.panels[0].innerHTML, /Tap Share, then Add to Home Screen/);
    assert.equal(launch({storage: first.storage}).panels.length, 0);
    first.panels[0].querySelector('.phone-install-dismiss').click();
    assert.equal(first.panels[0].removed, true);
});

test('Android supports a late native install event and consumes it once on click', async () => {
    const {panels, events} = launch({ua: 'Android'});
    const button = panels[0].querySelector('.phone-install-button');
    assert.equal(button.hidden, true);
    let prompted = 0, prevented = false;
    events.beforeinstallprompt({preventDefault() {prevented = true;}, async prompt() {prompted++;}, userChoice: Promise.resolve({outcome: 'accepted'})});
    assert.equal(prevented, true);
    assert.equal(button.hidden, false);
    await button.click();
    await button.click();
    assert.equal(prompted, 1);
    assert.equal(panels[0].removed, true);
});

test('desktop, installed mode, and unavailable persistent storage skip the guide', () => {
    assert.equal(launch({ua: 'Macintosh'}).panels.length, 0);
    assert.equal(launch({installed: true}).panels.length, 0);
    assert.equal(launch({blocked: true}).panels.length, 0);
    assert.equal(launch({ua: 'Macintosh', platform: 'MacIntel', touch: 5}).panels.length, 1);
});

test('appinstalled closes the guide and prevents future offers', () => {
    const {panels, events, storage} = launch({ua: 'Android'});
    events.appinstalled();
    assert.equal(panels[0].removed, true);
    assert.equal(launch({ua: 'Android', storage}).panels.length, 0);
});

test('manifest and service worker shell reference existing files', () => {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(new URL('tasks.webmanifest', root), 'utf8'));
    assert.ok(fs.existsSync(new URL(manifest.start_url, root)));
    for (const icon of manifest.icons) assert.ok(fs.existsSync(new URL(icon.src, root)));
    const worker = fs.readFileSync(new URL('tasks-sw.js', root), 'utf8');
    const assets = worker.match(/const SHELL_ASSETS = \[([\s\S]*?)\]/)[1];
    for (const [, path] of assets.matchAll(/'([^']+)'/g)) assert.ok(fs.existsSync(new URL(path, root)), path);
});
