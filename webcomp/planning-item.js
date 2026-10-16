import { COMMON_PROPERTIES, cloneValue, canonicalType, parseQuickTask } from '../js/task-model.js';
class PlanningItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._saveTimers = {};
        this._confirmTimer = null;
    }

    setData({ kind, record, parents, children, associations, catalog, thinkingTab = 'myThinking' }) {
        this.kind = kind;
        this._thinkingTab = thinkingTab === 'aiThinking' ? 'aiThinking' : 'myThinking';
        this._record = cloneValue(record);
        this.dataset.recordId = record.id;
        this.render(parents, children, associations, catalog);
    }

    updateThinkingTabs() {
        this.shadowRoot.querySelectorAll('[data-thinking-tab]').forEach(tab => {
            const active = tab.dataset.thinkingTab === this._thinkingTab;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        this.shadowRoot.querySelectorAll('[data-thinking-panel]').forEach(panel => { panel.hidden = panel.dataset.thinkingPanel !== this._thinkingTab; });
    }

    disconnectedCallback() {
        Object.values(this._saveTimers).forEach(clearTimeout);
        clearTimeout(this._confirmTimer);
    }

    emit(name, detail = {}) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: { kind: this.kind, id: this._record.id, ...detail } }));
    }

    render(parents, children, associations, catalog) {
        const isPlan = this.kind === 'plans';
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; min-width: 0; }
                * { box-sizing: border-box; }
                [hidden] { display: none !important; }
                article { padding: 16px; border: 1px solid var(--ink, #18242b); border-radius: 14px; background: var(--panel, #fffdf7); box-shadow: 3px 3px 0 rgba(24,36,43,.11); }
                :host([attention]) article { outline: 3px solid var(--blue, #315f91); }
                button, input, select, textarea { font: inherit; color: inherit; }
                button { min-height: 32px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; padding: 4px 10px; background: var(--paper, #f3efe4); cursor: pointer; font-size: 12px; }
                button:hover { border-color: var(--ink, #18242b); }
                button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                label { display: grid; gap: 5px; margin-bottom: 12px; color: var(--muted, #697177); font-size: 11px; }
                textarea, input, select { width: 100%; min-width: 0; border: 1px solid var(--line, #cfc8b8); border-radius: 8px; background: var(--panel, #fffdf7); padding: 8px; color: var(--ink, #18242b); }
                .text { border: 0; padding: 0; font-size: 17px; font-weight: 750; resize: vertical; }
                .thinking-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
                .thinking-tabs button { flex: 1; }
                .thinking-tabs button[aria-selected="true"] { background: var(--ink, #18242b); color: white; }
                button[role="tab"]:hover { background: var(--panel, #fffdf7); color: var(--ink, #18242b); }
                .notes, .my-thinking, .ai-thinking { min-height: 110px; resize: vertical; line-height: 1.5; font-size: 13px; }
                .parent-row { display: flex; gap: 8px; }
                .parent-row select { flex: 1; }
                .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
                .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line, #cfc8b8); border-radius: 999px; padding: 4px 8px; color: var(--blue, #315f91); background: rgba(49,95,145,.06); font-size: 11px; overflow-wrap: anywhere; }
                .chip button { min-height: 20px; border: 0; padding: 0 3px; background: transparent; }
                .chip.inherited { border-style: dashed; }
                .association-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; margin: 8px 0 14px; }
                .children { display: grid; gap: 5px; margin: 10px 0; }
                .child-link { text-align: left; overflow-wrap: anywhere; }
                h3 { margin: 18px 0 8px; font-size: 12px; color: var(--muted, #697177); }
                .child-form { display: flex; gap: 6px; }
                .child-form input { flex: 1; }
                .footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; align-items: center; }
                .age { color: var(--muted, #697177); font-size: 10px; }
                .delete { color: var(--muted, #697177); }
                .delete.armed { color: var(--accent, #D00E00); }
                @media (max-width: 520px) { .association-form { grid-template-columns: 1fr 1fr; } .association-form button { grid-column: 1 / -1; } }
            </style>
            <article>
                <label>${isPlan ? t('ui.text.plan') : t('ui.text.want')}<textarea class="text" rows="1" maxlength="1000" aria-label="${escapeHTML(t('ui.text.value1Title', { value1: isPlan ? t('ui.text.plan') : t('ui.text.want') }))}"></textarea></label>
                ${isPlan ? `
                    <div class="thinking-tabs" role="tablist" aria-label="${escapeHTML(t('ui.text.planThinking'))}">
                        <button type="button" id="my-thinking-tab" role="tab" data-thinking-tab="myThinking" aria-controls="my-thinking-panel">${escapeHTML(t('ui.text.myThinking'))}</button>
                        <button type="button" id="ai-thinking-tab" role="tab" data-thinking-tab="aiThinking" aria-controls="ai-thinking-panel">${escapeHTML(t('ui.text.aIThinking'))}</button>
                    </div>
                    <div role="tabpanel" id="my-thinking-panel" data-thinking-panel="myThinking" aria-labelledby="my-thinking-tab"><label>${escapeHTML(t('ui.text.myThinkingApproachAndNextSteps'))}<textarea class="my-thinking" rows="5" maxlength="50000" aria-label="${escapeHTML(t('ui.text.myThinking'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></label></div>
                    <div role="tabpanel" id="ai-thinking-panel" data-thinking-panel="aiThinking" aria-labelledby="ai-thinking-tab"><label>${escapeHTML(t('ui.text.aIThinking2'))}<textarea class="ai-thinking" rows="5" maxlength="50000" aria-label="${escapeHTML(t('ui.text.aIThinking'))}" placeholder="${escapeHTML(t('ui.text.saveTextGeneratedByAI'))}"></textarea></label></div>
                ` : `<label>${escapeHTML(t('ui.text.ideasAspirationsAndPossibilities'))}<textarea class="notes" rows="5" maxlength="10000" aria-label="${escapeHTML(t('ui.text.wantNotes'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></label>`}
                <label class="parent-label" ${isPlan ? '' : 'hidden'}>${escapeHTML(t('ui.text.wantOptional'))}<span class="parent-row"><select class="parent" aria-label="${escapeHTML(t('ui.text.parentWant'))}"></select><button class="open-parent" type="button" ${this._record.wantId ? '' : 'hidden'}>${escapeHTML(t('ui.text.openWant'))}</button></span></label>
                <div class="chips" aria-label="${escapeHTML(t('ui.text.associations'))}"></div>
                <form class="association-form">
                    <input class="association-type" list="planning-types" maxlength="60" placeholder="${escapeHTML(t('ui.text.property'))}" aria-label="${escapeHTML(t('ui.text.associationProperty'))}" required>
                    <datalist id="planning-types"></datalist>
                    <input class="association-value" list="planning-values" maxlength="120" placeholder="${escapeHTML(t('ui.text.chooseOrTypeAValue'))}" aria-label="${escapeHTML(t('ui.text.associationValue'))}" required>
                    <datalist id="planning-values"></datalist>
                    <button type="submit">${escapeHTML(t('ui.text.addAssociation'))}</button>
                </form>
                <h3>${isPlan ? t('ui.text.tasksInThisPlan') : t('ui.text.plansFromThisWant')} · ${children.length}</h3>
                <div class="children"></div>
                <form class="child-form"><input class="child-text" maxlength="1000" aria-label="${escapeHTML(t('ui.text.newValue7', { value7: uiLabel(isPlan ? 'task' : 'plan') }))}" placeholder="${isPlan ? t('ui.text.turnANextStepIntoATask') : t('ui.text.turnThisWantIntoAPlan')}" required><button type="submit">${escapeHTML(t('ui.text.addValue9', { value9: uiLabel(isPlan ? 'task' : 'plan') }))}</button></form>
                <div class="footer"><span class="age"></span><button class="delete" type="button">${escapeHTML(t('ui.text.deleteValue10', { value10: uiLabel(isPlan ? 'plan' : 'want') }))}</button></div>
            </article>
        `;
        for (const field of isPlan ? ['text', 'myThinking', 'aiThinking'] : ['text', 'notes']) {
            const selector = { myThinking: '.my-thinking', aiThinking: '.ai-thinking' }[field] || `.${field}`;
            const input = this.shadowRoot.querySelector(selector);
            input.value = this._record[field];
            const save = () => {
                clearTimeout(this._saveTimers[field]);
                const value = ['myThinking', 'aiThinking'].includes(field) ? input.value : input.value.trim();
                if (field === 'text' && !value) { input.value = this._record.text; return; }
                if (value !== this._record[field]) this.emit('planning-update', { patch: { [field]: value }, quiet: true });
            };
            input.addEventListener('input', () => {
                clearTimeout(this._saveTimers[field]);
                this._saveTimers[field] = setTimeout(save, 550);
            });
            input.addEventListener('blur', save);
        }
        this.shadowRoot.querySelectorAll('[data-thinking-tab]').forEach(tab => {
            tab.addEventListener('click', () => {
                this._thinkingTab = tab.dataset.thinkingTab;
                this.updateThinkingTabs();
                this.emit('planning-thinking-tab-change', { tab: this._thinkingTab });
            });
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'myThinking' : event.key === 'End' ? 'aiThinking' : this._thinkingTab === 'myThinking' ? 'aiThinking' : 'myThinking';
                const nextTab = this.shadowRoot.querySelector(`[data-thinking-tab="${next}"]`);
                nextTab.click();
                nextTab.focus();
            });
        });
        this.updateThinkingTabs();
        const parent = this.shadowRoot.querySelector('.parent');
        parent.append(new Option(t('error.messages.noWant'), ''));
        for (const record of parents) parent.append(new Option(record.text, record.id));
        parent.value = this._record.wantId || '';
        parent.addEventListener('change', () => this.emit('planning-update', { patch: { wantId: parent.value || null } }));
        this.shadowRoot.querySelector('.open-parent').addEventListener('click', () => this.emit('planning-navigate', { targetKind: 'wants', targetId: this._record.wantId }));
        const ownKeys = new Set(this._record.associations.map(item => `${item.type}\u0000${item.value.toLowerCase()}`));
        const chips = this.shadowRoot.querySelector('.chips');
        for (const association of associations) {
            const own = ownKeys.has(`${association.type}\u0000${association.value.toLowerCase()}`);
            const chip = document.createElement('span');
            chip.className = `chip${own ? '' : ' inherited'}`;
            chip.textContent = `${association.type}: ${association.value}${own ? '' : t('ui.text.fromValue0', { value0: uiLabel(isPlan ? 'tasks' : 'plans') })}`;
            if (own) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = '×';
                remove.setAttribute('aria-label', t('ui.text.removeValue0Value1', { value0: association.type, value1: association.value }));
                remove.addEventListener('click', () => this.emit('planning-association-remove', { association }));
                chip.append(remove);
            }
            chips.append(chip);
        }
        const type = this.shadowRoot.querySelector('.association-type');
        const value = this.shadowRoot.querySelector('.association-value');
        const types = this.shadowRoot.querySelector('#planning-types');
        for (const property of new Set([...COMMON_PROPERTIES, ...Object.keys(catalog)])) types.append(new Option(property, property));
        type.addEventListener('input', () => {
            const values = this.shadowRoot.querySelector('#planning-values');
            values.replaceChildren();
            for (const name of catalog[canonicalType(type.value)] || []) values.append(new Option(name, name));
        });
        this.shadowRoot.querySelector('.association-form').addEventListener('submit', event => {
            event.preventDefault();
            this.emit('planning-association-add', { association: { type: type.value, value: value.value } });
        });
        const childList = this.shadowRoot.querySelector('.children');
        for (const child of children) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'child-link';
            button.textContent = `${child.status === 'done' ? '✓ ' : ''}${child.text}`;
            button.addEventListener('click', () => this.emit('planning-navigate', { targetKind: isPlan ? 'tasks' : 'plans', targetId: child.id }));
            childList.append(button);
        }
        this.shadowRoot.querySelector('.child-form').addEventListener('submit', event => {
            event.preventDefault();
            const input = this.shadowRoot.querySelector('.child-text');
            const parsed = parseQuickTask(input.value);
            if (parsed.text) this.emit('planning-child-add', { input: parsed });
        });
        this.shadowRoot.querySelector('.age').textContent = t('ui.text.createdValue0', { value0: new Date(this._record.createdAt).toLocaleDateString() });
        this.shadowRoot.querySelector('.delete').addEventListener('click', event => {
            const button = event.currentTarget;
            if (button.classList.contains('armed')) this.emit('planning-delete');
            else {
                button.classList.add('armed');
                button.textContent = t('ui.text.confirmDeleteKeepsValue0', { value0: uiLabel(isPlan ? 'tasks' : 'plans') });
                this._confirmTimer = setTimeout(() => {
                    button.classList.remove('armed');
                    button.textContent = t('ui.text.deleteValue0', { value0: uiLabel(isPlan ? 'plan' : 'want') });
                }, 3500);
            }
        });
    }
}
customElements.define('planning-item', PlanningItem);
