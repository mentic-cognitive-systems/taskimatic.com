class TaskSortControls extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.sortKey = 'default';
        this.sortDir = 'asc';
    }

    connectedCallback() {
        if (this.shadowRoot.childElementCount) return;
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                .sort-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; }
                button { min-height: 29px; padding: 0 9px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); color: var(--muted, #697177); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; cursor: pointer; }
                button:hover { border-color: var(--ink, #18242b); color: var(--ink, #18242b); }
                button.active { border-color: var(--blue, #315f91); background: rgba(49,95,145,.08); color: var(--blue, #315f91); }
                button:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                .sort-arrow { margin-left: 3px; font-style: normal; }
            </style>
            <div class="sort-controls" role="group" aria-label="${escapeHTML(t('ui.text.sortTasks'))}">
                ${Object.entries({ name: t('ui.text.name'), age: t('ui.text.age'), time: t('ui.text.time'), human: t('ui.text.human'), agent: t('ui.text.agent'), lastActive: t('ui.text.lastActive'), priority: t('ui.text.priority') }).map(([key, label]) => `<button type="button" class="sort-btn" data-sort="${key}" data-label="${label}">${label}</button>`).join('')}
            </div>
        `;
        this.shadowRoot.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-sort]');
            if (!button) return;
            const key = button.dataset.sort;
            this.sortDir = this.sortKey === key && this.sortDir === 'asc' ? 'desc' : 'asc';
            this.sortKey = key;
            this.updateButtons();
            this.dispatchEvent(new CustomEvent('task-sort-change', {
                bubbles: true, composed: true,
                detail: { sortKey: this.sortKey, sortDir: this.sortDir }
            }));
        });
        this.updateButtons();
    }

    setSort(sortKey, sortDir) {
        this.sortKey = sortKey;
        this.sortDir = sortDir;
        this.updateButtons();
    }

    updateButtons() {
        this.shadowRoot.querySelectorAll('button').forEach((button) => {
            const active = button.dataset.sort === this.sortKey;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
            const description = button.dataset.sort === 'age'
                ? t('ui.text.taskAgeSinceCreationAscendingNewestFirst')
                : button.dataset.sort === 'time'
                    ? t('ui.text.totalTrackedTimeIncludingRunningClocksAscendingLeastTimeFirst')
                    : button.dataset.label;
            button.title = description;
            button.setAttribute('aria-label', `${description}${active ? `, ${this.sortDir === 'asc' ? t('ui.text.ascending') : t('ui.text.descending')}` : ''}`);
            button.innerHTML = `${button.dataset.label}${active ? `<i class="sort-arrow" aria-hidden="true">${this.sortDir === 'asc' ? '↑' : '↓'}</i>` : ''}`;
        });
    }
}
customElements.define('task-sort-controls', TaskSortControls);
