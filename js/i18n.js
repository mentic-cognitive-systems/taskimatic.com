class I18nService {
    constructor() {
        this.data = {};
        this.manifest = null;
        this.languages = {};
        this.fixup = {};
        this.loadedLocales = new Set();
        this.defaultLang = 'en';
        this.currentLang = 'en';
        this.listeners = new Set();
        this.cookieName = 'taskimatic_lang';
        this.cookieExpireDays = 365;
        this.ready = this.load();
    }

    async load() {
        const sourceUrl = new URL('./data/i18n.json', document.baseURI).href;
        const embedded = document.getElementById('taskimatic-i18n');
        if (embedded) {
            const saved = JSON.parse(embedded.textContent);
            this.data = saved.data;
            this.languages = saved.languages;
            this.defaultLang = saved.defaultLang;
            const params = new URLSearchParams(window.location.search);
            this.currentLang = this.resolveLanguage(params.get('lang') || params.get('Lang'))
                || this.resolveLanguage(this.getCookie(this.cookieName)) || saved.currentLang;
            this.loadedLocales = new Set(Object.keys(this.data));
            return true;
        }
        try {
            const i18nData = await this.fetchJson(sourceUrl);

            if (this.isSplitManifest(i18nData)) {
                this.manifest = i18nData;
                this.defaultLang = i18nData.defaultLang || 'en';
                this.fixup = i18nData.fixup || {};
                this.languages = i18nData.languages || {};
                this.data = {};

                Object.entries(this.languages).forEach(([langCode, meta]) => {
                    this.data[langCode] = { Lang: meta.Lang || meta.name || langCode };
                });

                await this.loadLocale(this.defaultLang);
                this.currentLang = this.detectLanguage();
                await this.loadLocale(this.currentLang);
            } else {
                this.manifest = null;
                this.data = i18nData;
                this.fixup = i18nData.fixup || {};
                this.defaultLang = i18nData.en ? 'en' : Object.keys(i18nData).find(key => key !== 'fixup') || 'en';
                this.languages = Object.fromEntries(
                    Object.entries(i18nData)
                        .filter(([key]) => key !== 'fixup')
                        .map(([langCode, locale]) => [langCode, { Lang: locale.Lang || langCode }])
                );
                this.loadedLocales = new Set(Object.keys(this.languages));
                this.currentLang = this.detectLanguage();
            }

            // Notify all listeners
            this.listeners.forEach(callback => callback(this.currentLang));

            return true;
        } catch (error) {
            console.error(error.message || 'Failed to load i18n data:', error);
            this.data = { en: {} };
            this.languages = { en: { Lang: 'English' } };
            this.fixup = {};
            this.loadedLocales = new Set(['en']);
            return false;
        }
    }

    isSplitManifest(data) {
        return data && typeof data === 'object' && data.languages && !data.en?.auth;
    }

    async fetchJson(sourceUrl) {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`Failed to load ${sourceUrl}: HTTP ${response.status}`);

        const raw = await response.text();
        try {
            return JSON.parse(raw);
        } catch (parseError) {
            throw this.describeJsonParseError(sourceUrl, raw, parseError);
        }
    }

    async loadLocale(langCode) {
        const resolvedLang = this.resolveLanguage(langCode);
        if (!resolvedLang || this.loadedLocales.has(resolvedLang)) return resolvedLang;

        const meta = this.languages[resolvedLang];
        if (!meta) return null;

        const sourceUrl = meta.file || `/data/i18n/${resolvedLang}.json`;
        const locale = await this.fetchJson(sourceUrl);
        this.data[resolvedLang] = locale;
        this.languages[resolvedLang] = {
            ...meta,
            Lang: locale.Lang || meta.Lang || meta.name || resolvedLang
        };
        this.loadedLocales.add(resolvedLang);
        return resolvedLang;
    }

    describeJsonParseError(sourceUrl, raw, parseError) {
        const message = parseError?.message || String(parseError);
        const position = this.getJsonErrorPosition(message);
        const location = position === null ? this.getJsonErrorLocation(message) : this.getTextLocation(raw, position);
        const context = location ? this.getTextContext(raw, location.line) : null;

        const details = [
            `Failed to parse ${sourceUrl}: ${message}`
        ];

        if (location) {
            details.push(`Location: ${sourceUrl}:${location.line}:${location.column}`);
        } else {
            details.push('Location: unavailable from this browser; paste the JSON into a validator or run JSON.parse locally.');
        }

        if (context) {
            details.push('Context:');
            details.push(context);
        }

        const error = new SyntaxError(details.join('\n'));
        error.cause = parseError;
        error.sourceUrl = sourceUrl;
        error.position = position;
        error.line = location?.line;
        error.column = location?.column;
        return error;
    }

    getJsonErrorPosition(message) {
        const positionMatch = message.match(/position\s+(\d+)/i);
        if (positionMatch) return Number(positionMatch[1]);
        return null;
    }

    getJsonErrorLocation(message) {
        const locationMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
        if (!locationMatch) return null;

        return {
            line: Number(locationMatch[1]),
            column: Number(locationMatch[2])
        };
    }

    getTextLocation(text, position) {
        let line = 1;
        let column = 1;
        const max = Math.min(position, text.length);

        for (let i = 0; i < max; i++) {
            if (text[i] === '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }

        return { line, column };
    }

    getTextContext(text, targetLine, radius = 2) {
        const lines = text.split(/\r?\n/);
        const start = Math.max(1, targetLine - radius);
        const end = Math.min(lines.length, targetLine + radius);
        const width = String(end).length;
        const output = [];

        for (let lineNo = start; lineNo <= end; lineNo++) {
            const marker = lineNo === targetLine ? '>' : ' ';
            output.push(`${marker} ${String(lineNo).padStart(width, ' ')} | ${lines[lineNo - 1]}`);
        }

        return output.join('\n');
    }

    detectLanguage() {
        if (!this.languages) return this.defaultLang;

        // Priority order: cookie > URL param > browser language > default

        // 1. Check for saved cookie preference first
        const cookieLang = this.resolveLanguage(this.getCookie(this.cookieName));
        if (cookieLang) return cookieLang;

        // 2. Check URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = this.resolveLanguage(urlParams.get('lang') || urlParams.get('Lang'));
        if (urlLang) {
            this.setCookie(this.cookieName, urlLang, this.cookieExpireDays);
            return urlLang;
        }

        // 3. Check browser language
        const browserLang = this.resolveLanguage(navigator.language || navigator.userLanguage);
        if (browserLang) {
            this.setCookie(this.cookieName, browserLang, this.cookieExpireDays);
            return browserLang;
        }

        // 4. Default to English
        this.setCookie(this.cookieName, this.defaultLang, this.cookieExpireDays);
        return this.defaultLang;
    }

    resolveLanguage(langCode) {
        if (!langCode) return null;

        const normalized = String(langCode).toLowerCase();
        const candidates = [normalized, normalized.split('-')[0]];

        for (const candidate of candidates) {
            const fixed = this.fixup[candidate] || candidate;
            if (this.languages[fixed]) return fixed;
        }

        return null;
    }

    t(txt, dataOrFallback = {}, fallback = undefined, ...extraReplacements) {
        if (!txt) return fallback || '';

        const args = this.normalizeTranslationArgs(dataOrFallback, fallback, extraReplacements);
        const key = String(txt);
        const text = this.resolveText(key, args.fallback);

        return this.interpolate(text, args.params, args.replacements);
    }

    normalizeTranslationArgs(dataOrFallback, fallback, extraReplacements) {
        if (Array.isArray(dataOrFallback)) {
            return {
                params: {},
                replacements: dataOrFallback,
                fallback: fallback ?? ''
            };
        }

        if (dataOrFallback && typeof dataOrFallback === 'object') {
            return {
                params: dataOrFallback,
                replacements: [],
                fallback: fallback ?? ''
            };
        }

        const legacyValues = [dataOrFallback, fallback, ...extraReplacements]
            .filter(value => value !== undefined && value !== null);

        if (legacyValues.length > 1) {
            return {
                params: {},
                replacements: legacyValues,
                fallback: ''
            };
        }

        return {
            params: {},
            replacements: legacyValues,
            fallback: legacyValues.length === 1 ? String(legacyValues[0]) : ''
        };
    }

    resolveText(key, fallback, visited = new Set()) {
        const text = this.lookup(key) ?? (key.includes(' ') ? this.lookup(key.replaceAll(' ', '')) : undefined);
        const resolved = text ?? (fallback || key);

        if (typeof resolved !== 'string') return fallback || key;
        if (visited.has(resolved)) return resolved;

        const referenced = this.lookup(resolved);
        if (referenced !== undefined && referenced !== resolved) {
            visited.add(resolved);
            return this.resolveText(resolved, fallback, visited);
        }

        return resolved;
    }

    lookup(key) {
        if (!this.data) return undefined;

        const keyParts = String(key).split('.');
        const explicitLang = this.resolveLanguage(keyParts[0]);

        if (explicitLang) {
            if (keyParts.length === 2 && keyParts[1] === 'Lang') {
                return this.languages[explicitLang]?.Lang || this.getByPath(this.data[explicitLang], 'Lang');
            }
            return this.getByPath(this.data[explicitLang], keyParts.slice(1).join('.'));
        }

        return this.getByPath(this.data[this.currentLang], key)
            ?? this.getByPath(this.data[this.defaultLang], key);
    }

    getByPath(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    }

    interpolate(text, params, replacements) {
        let output = String(text);

        output = output.replace(/\{(\w+)\}/g, (_, key) => {
            const value = params?.[key];
            return value === undefined || value === null ? `{${key}}` : String(value);
        });

        replacements.forEach((replacement, index) => {
            output = output.replace(new RegExp(`\\|${index}\\|`, 'g'), String(replacement));
        });

        return output;
    }

    async setLanguage(langCode) {
        await this.ready;

        const resolvedLang = this.resolveLanguage(langCode);
        if (!resolvedLang) {
            console.warn(`Language code '${langCode}' not found in i18n data.`);
            return false;
        }

        await this.loadLocale(resolvedLang);
        this.currentLang = resolvedLang;

        // Save to cookie for persistence across pages
        this.setCookie(this.cookieName, resolvedLang, this.cookieExpireDays);

        // Notify all listeners
        this.listeners.forEach(callback => callback(resolvedLang));
        return true;
    }

    onLanguageChange(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    getAvailableLanguages() {
        if (!this.languages) return [this.defaultLang];
        return Object.keys(this.languages);
    }

    // Cookie management methods
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }

        // Set cookie with appropriate flags
        const isSecure = window.location.protocol === 'https:';
        let cookieString = `${name}=${value}${expires}; path=/`;

        if (isSecure) {
            cookieString += '; Secure; SameSite=Lax';
        } else {
            cookieString += '; SameSite=Lax';
        }

        document.cookie = cookieString;
    }

    // Method to clear the language preference (for logout scenarios)
    clearLanguagePreference() {
        this.setCookie(this.cookieName, '', -1); // Set expiry to past date
    }
}

// Global instance
window.i18n = new I18nService();

// Text and attribute translations never insert locale content as HTML.
function t(key, params = {}) {
    return window.i18n.t(key, params);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function updateI18nElements(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = t(element.dataset.i18n);
    });
    for (const attribute of ['title', 'placeholder', 'aria-label', 'content']) {
        root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
            element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
        });
    }
    document.documentElement.lang = window.i18n.currentLang;
}

const translatePage = async () => {
    await window.i18n.ready;
    if (window.i18n.data[window.i18n.defaultLang]?.ui) updateI18nElements();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', translatePage);
else translatePage();
window.i18n.onLanguageChange(() => {
    if (document.readyState !== 'loading') updateI18nElements();
});

// Translate built-in display names while preserving custom names and stored identifiers.
function uiLabel(value, capitalized = false) {
    const lower = { task: 'task', tasks: 'tasksLower', plan: 'planLower', plans: 'plansLower',
        want: 'wantLower', wants: 'wantsLower', human: 'humanLower', agent: 'agentLower',
        time: 'timeLower', entry: 'entry', entries: 'entries', project: 'project', initiative: 'initiative',
        'sub-system': 'subsystem', feature: 'feature', client: 'client', domain: 'domain',
        'work-area': 'workArea', 'dependent-task': 'dependentTask', Unassigned: 'unassigned', Other: 'other' };
    const upper = { tasks: 'tasksTab', plans: 'plansTab', wants: 'wantsTab', human: 'human', agent: 'agent' };
    const key = (capitalized ? upper[value] : null) || lower[value];
    return key ? t(`ui.text.${key}`) : value;
}
