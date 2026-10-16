export const SEARCHER_ELEMENT_TAG = 'searcher-element';
export const SEARCH_HISTORY_KEY = 'taskimatic:recent-searches';

export function installSearcherElement(targetWindow = window) {
    if (targetWindow.customElements.get(SEARCHER_ELEMENT_TAG)) return targetWindow.customElements.get(SEARCHER_ELEMENT_TAG);

    class SearcherElement extends targetWindow.HTMLElement {
        constructor() {
            super();
            this._value = '';
            this._placeholder = null;
            this._disabled = false;
            this._hideTimer = null;
            this.input = null;
        }

        connectedCallback() {
            if (this.input) return;
            const document = this.ownerDocument;
            const field = document.createElement('div');
            field.className = 'searcher-field';
            const input = document.createElement('input');
            input.className = 'searcher-input search-input';
            input.type = 'search';
            input.placeholder = this._placeholder ?? this.getAttribute('placeholder') ?? t('ui.text.search');
            input.disabled = this._disabled || this.hasAttribute('disabled');
            input.autocomplete = 'off';
            input.setAttribute('aria-label', this.getAttribute('aria-label') || t('ui.text.search'));
            input.setAttribute('aria-expanded', 'false');
            field.append(input);
            this.append(field);
            this.input = input;
            input.value = this._value;
            if (this.hasAttribute('on-now-filter')) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'searcher-on-now';
               
                button.title = t('ui.text.showOnlyTasksWithRunningClocks');
                this.onNowButton = button;
                this.onNow = this._onNow || false;
                button.textContent = this.onNow ? t('ui.text.onNow') : t('ui.text.onNow2');
                button.addEventListener('click', () => {
                    this.onNow = !this.onNow;
                    button.textContent = this.onNow ? t('ui.text.onNow') : t('ui.text.onNow2');
                    this.dispatchEvent(new targetWindow.CustomEvent('searcher:on-now', {bubbles: true, detail: {active: this.onNow}}));
                });
                field.append(button);
            }
            input.addEventListener('input', () => {
                this._value = input.value;
                this.dispatchSearchEvent('searcher:input');
                this.renderMenu();
            });
            input.addEventListener('focus', () => this.renderMenu());
            input.addEventListener('blur', () => {
                this._hideTimer = targetWindow.setTimeout(() => this.hideMenu(), 120);
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.commit();
                } else if (event.key === 'Escape') {
                    this.hideMenu();
                }
            });
        }

        disconnectedCallback() {
            targetWindow.clearTimeout(this._hideTimer);
        }

        get onNow() { return Boolean(this._onNow); }
        set onNow(value) {
            this._onNow = Boolean(value);
            this.onNowButton?.setAttribute('aria-pressed', String(this._onNow));
        }

        get value() {
            return this._value;
        }

        set value(value) {
            this._value = String(value || '');
            if (this.input) this.input.value = this._value;
        }

        get placeholder() {
            return this.input ? this.input.placeholder : (this._placeholder ?? '');
        }

        set placeholder(value) {
            this._placeholder = value;
            if (this.input) this.input.placeholder = value;
        }

        get disabled() {
            return this.input ? this.input.disabled : this._disabled;
        }

        set disabled(value) {
            this._disabled = !!value;
            if (this.input) this.input.disabled = this._disabled;
        }

        get historyKey() {
            return this.getAttribute('history-key') || SEARCH_HISTORY_KEY;
        }

        history() {
            try {
                const saved = JSON.parse(targetWindow.localStorage.getItem(this.historyKey) || '[]');
                return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string' && item.trim()) : [];
            } catch {
                return [];
            }
        }

        saveHistory(items) {
            try {
                targetWindow.localStorage.setItem(this.historyKey, JSON.stringify(items.slice(0, 8)));
            } catch {
                // localStorage is optional for the search widget.
            }
        }

        commit() {
            const query = this._value.trim();
            if (query) {
                this.saveHistory([query, ...this.history().filter((item) => item.toLowerCase() !== query.toLowerCase())]);
            }
            this.dispatchSearchEvent('searcher:search');
            this.hideMenu();
        }

        dispatchSearchEvent(type) {
            this.dispatchEvent(new targetWindow.CustomEvent(type, {
                bubbles: true,
                detail: { query: this._value.trim() }
            }));
        }

        hideMenu() {
            targetWindow.clearTimeout(this._hideTimer);
            this.querySelector('.searcher-menu')?.remove();
            this.input?.setAttribute('aria-expanded', 'false');
        }

        renderMenu() {
            targetWindow.clearTimeout(this._hideTimer);
            this.querySelector('.searcher-menu')?.remove();
            const query = this._value.trim().toLowerCase();
            const items = this.history().filter((item) => !query || item.toLowerCase().includes(query));
            if (!items.length || !this.input) {
                this.input?.setAttribute('aria-expanded', 'false');
                return;
            }
            const menu = this.ownerDocument.createElement('div');
            menu.className = 'searcher-menu';
            menu.setAttribute('role', 'listbox');
            for (const item of items) {
                const option = this.ownerDocument.createElement('div');
                option.className = 'searcher-option';
                option.setAttribute('role', 'option');
                option.tabIndex = 0;
                const label = this.ownerDocument.createElement('span');
                label.className = 'searcher-query';
                label.textContent = item;
                const remove = this.ownerDocument.createElement('button');
                remove.type = 'button';
                remove.className = 'searcher-remove';
                remove.textContent = '×';
                remove.setAttribute('aria-label', t('ui.text.removeRecentSearchQuery', { query: item }));
                remove.addEventListener('mousedown', (event) => event.preventDefault());
                remove.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.saveHistory(this.history().filter((entry) => entry !== item));
                    this.renderMenu();
                });
                option.append(label, remove);
                option.addEventListener('mousedown', (event) => event.preventDefault());
                option.addEventListener('click', () => {
                    this.value = item;
                    this.dispatchSearchEvent('searcher:input');
                    this.commit();
                });
                option.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        option.click();
                    }
                });
                menu.append(option);
            }
            this.append(menu);
            this.input.setAttribute('aria-expanded', 'true');
        }
    }

    targetWindow.customElements.define(SEARCHER_ELEMENT_TAG, SearcherElement);
    return SearcherElement;
}