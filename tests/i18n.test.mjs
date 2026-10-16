import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createI18nContext, english} from './i18n-test-context.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../data/i18n.json', import.meta.url), 'utf8'));
const locales = Object.fromEntries(Object.keys(manifest.languages).map(lang => [lang,
    JSON.parse(fs.readFileSync(new URL(`../data/i18n/${lang}.json`, import.meta.url), 'utf8'))]));
const flatten = (value, prefix = '') => Object.fromEntries(Object.entries(value).flatMap(([key, text]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof text === 'string' ? [[path, text]] : Object.entries(flatten(text, path));
}));
const placeholders = value => [...new Set(value.match(/\{\w+\}/g) || [])].sort();

test('all supported locales cover every English key and preserve interpolation parameters', () => {
    const expected = flatten(english);
    for (const lang of ['es', 'zh', 'hi', 'pt', 'ja', 'de', 'fr', 'ko', 'it', 'ru', 'id', 'uk', 'tr', 'nl']) {
        const actual = flatten(locales[lang]);
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
        for (const [key, value] of Object.entries(expected)) {
            assert.deepEqual(placeholders(actual[key]), placeholders(value), `${lang}: ${key}`);
        }
    }
});

function portable(search = '') {
    return createI18nContext({search, embedded: {
        data: locales, languages: manifest.languages, currentLang: 'zh'
    }});
}

test('portable copies switch between all embedded languages without a network request', async () => {
    const {window: {i18n}, t} = portable();
    await i18n.ready;
    assert.equal(t('ui.text.today'), '今天');
    assert.equal(await i18n.setLanguage('es-MX'), true);
    assert.equal(t('ui.text.today'), 'Hoy');
    assert.equal(t('ui.text.shown', {count: 3}), '3 visibles');
    assert.equal(await i18n.setLanguage('hi'), true);
    assert.equal(t('ui.text.today'), 'आज');
    assert.equal(t('ui.text.shown', {count: 3}), '3 प्रदर्शित');
    assert.equal(await i18n.setLanguage('pt-BR'), true);
    assert.equal(t('ui.text.today'), 'Hoje');
    assert.equal(t('ui.text.shown', {count: 3}), '3 exibidos');
    assert.equal(await i18n.setLanguage('ja-JP'), true);
    assert.equal(t('ui.text.today'), '今日');
    assert.equal(t('ui.text.shown', {count: 3}), '3 件表示中');
    assert.equal(await i18n.setLanguage('de-DE'), true);
    assert.equal(t('ui.text.today'), 'Heute');
    assert.equal(t('ui.text.shown', {count: 3}), '3 angezeigt');
    assert.equal(await i18n.setLanguage('fr-FR'), true);
    assert.equal(t('ui.text.today'), "Aujourd'hui");
    assert.equal(t('ui.text.shown', {count: 3}), '3 affichés');
    assert.equal(await i18n.setLanguage('ko-KR'), true);
    assert.equal(t('ui.text.today'), '오늘');
    assert.equal(t('ui.text.shown', {count: 3}), '3개 표시됨');
    assert.equal(await i18n.setLanguage('it-IT'), true);
    assert.equal(t('ui.text.today'), 'Oggi');
    assert.equal(t('ui.text.shown', {count: 3}), '3 mostrati');
    assert.equal(await i18n.setLanguage('ru-RU'), true);
    assert.equal(t('ui.text.today'), 'Сегодня');
    assert.equal(t('ui.text.shown', {count: 3}), '3 показано');
    assert.equal(await i18n.setLanguage('id-ID'), true);
    assert.equal(t('ui.text.today'), 'Hari ini');
    assert.equal(t('ui.text.shown', {count: 3}), '3 ditampilkan');
    assert.equal(await i18n.setLanguage('uk-UA'), true);
    assert.equal(t('ui.text.today'), 'Сьогодні');
    assert.equal(t('ui.text.shown', {count: 3}), '3 показано');
    assert.equal(await i18n.setLanguage('tr-TR'), true);
    assert.equal(t('ui.text.today'), 'Bugün');
    assert.equal(t('ui.text.shown', {count: 3}), '3 gösteriliyor');
    assert.equal(await i18n.setLanguage('nl-NL'), true);
    assert.equal(t('ui.text.today'), 'Vandaag');
    assert.equal(t('ui.text.shown', {count: 3}), '3 weergegeven');
    assert.equal(await i18n.setLanguage('en'), true);
    assert.equal(t('ui.text.today'), 'Today');
});

test('portable language URL takes effect on reload and regional Chinese resolves correctly', async () => {
    const {window: {i18n}} = portable('?lang=es');
    await i18n.ready;
    assert.equal(i18n.currentLang, 'es');
    assert.equal(i18n.resolveLanguage('zh-CN'), 'zh');
    assert.equal(i18n.resolveLanguage('es-ES'), 'es');
    assert.equal(i18n.resolveLanguage('hi-IN'), 'hi');
    assert.equal(i18n.resolveLanguage('pt-BR'), 'pt');
    assert.equal(i18n.resolveLanguage('pt-PT'), 'pt');
    assert.equal(i18n.resolveLanguage('ja-JP'), 'ja');
    assert.equal(i18n.resolveLanguage('de-DE'), 'de');
    assert.equal(i18n.resolveLanguage('de-AT'), 'de');
    assert.equal(i18n.resolveLanguage('de-CH'), 'de');
    assert.equal(i18n.resolveLanguage('fr-FR'), 'fr');
    assert.equal(i18n.resolveLanguage('fr-CA'), 'fr');
    assert.equal(i18n.resolveLanguage('ko-KR'), 'ko');
    assert.equal(i18n.resolveLanguage('it-IT'), 'it');
    assert.equal(i18n.resolveLanguage('it-CH'), 'it');
    assert.equal(i18n.resolveLanguage('ru-RU'), 'ru');
    assert.equal(i18n.resolveLanguage('id-ID'), 'id');
    assert.equal(i18n.resolveLanguage('uk-UA'), 'uk');
    assert.equal(i18n.resolveLanguage('tr-TR'), 'tr');
    assert.equal(i18n.resolveLanguage('nl-NL'), 'nl');
    assert.equal(i18n.resolveLanguage('nl-BE'), 'nl');
    assert.equal(await i18n.setLanguage('missing'), false);
    assert.equal(i18n.currentLang, 'es');
});

test('a missing translated entry falls back to English and translated markup is escaped', async () => {
    const {window: {i18n}, t, escapeHTML} = portable('?lang=es');
    await i18n.ready;
    delete i18n.data.es.ui.text.today;
    assert.equal(t('ui.text.today'), 'Today');
    assert.equal(escapeHTML(t('ui.text.showTasksAttachedToValue0', {value0: '<script>alert(1)</script>'})),
        'Mostrar tareas vinculadas a &lt;script&gt;alert(1)&lt;/script&gt;');
});

test('the service worker caches every language offered by the picker', () => {
    const worker = fs.readFileSync(new URL('../tasks-sw.js', import.meta.url), 'utf8');
    for (const lang of Object.keys(manifest.languages)) assert.ok(worker.includes(`./data/i18n/${lang}.json`));
    const html = fs.readFileSync(new URL('../webcomp/task-workspace.js', import.meta.url), 'utf8')
        + fs.readFileSync(new URL('../js/portable-app.js', import.meta.url), 'utf8');
    assert.match(html, /class="language-picker"/);
    assert.match(html, /getAvailableLanguages\(\)\.map\(lang => window\.i18n\.loadLocale\(lang\)\)/);
});
