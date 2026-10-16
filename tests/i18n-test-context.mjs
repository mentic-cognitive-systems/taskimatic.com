import fs from 'node:fs';
import vm from 'node:vm';

export const english = JSON.parse(fs.readFileSync(new URL('../data/i18n/en.json', import.meta.url), 'utf8'));
export function createI18nContext(options = {}) {
    const embedded = {data: {en: english}, languages: {en: {Lang: 'English'}}, defaultLang: 'en', currentLang: 'en'};
    Object.assign(embedded, options.embedded);
    const context = vm.createContext({
        window: {location: {search: options.search || '', protocol: 'https:'}}, console, URL, URLSearchParams, navigator: {language: 'en'},
        document: {readyState: 'loading', baseURI: 'https://taskimatic.test/', cookie: '',
            getElementById: id => id === 'taskimatic-i18n' ? {textContent: JSON.stringify(embedded)} : null,
            addEventListener() {}}
    });
    vm.runInContext(fs.readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8'), context);
    return context;
}
export const {t, escapeHTML, uiLabel, window: {i18n}} = createI18nContext();
