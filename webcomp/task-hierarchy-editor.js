import { COMMON_PROPERTIES, cloneValue } from '../js/task-model.js';
import { associationDimensions, automaticHierarchy } from '../js/task-table-model.js';

class TaskHierarchyEditor extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                * { box-sizing: border-box; }
                dialog { width: min(410px, calc(100vw - 24px)); max-height: 85dvh; padding: 18px; border: 1px solid var(--ink, #18242b); border-radius: 12px; background: var(--panel, #fffdf7); color: var(--ink, #18242b); box-shadow: 5px 5px 0 #18242b22; }
                dialog::backdrop { background: #18242b55; }
                h3 { margin: 0; font-size: 17px; }
                p { color: var(--muted, #697177); font-size: 12px; line-height: 1.5; }
                button, input, select { font: inherit; color: inherit; }
                select, .name { display: block; width: 100%; height: 34px; margin: 6px 0 12px; padding: 5px 8px; border: 1px solid var(--line, #cfc8b8); border-radius: 6px; background: var(--panel, #fffdf7); }
                label { font-size: 12px; }
                .rows { display: grid; gap: 4px; margin: 12px 0; }
                .row { display: flex; align-items: center; gap: 7px; padding: 5px 7px; border: 1px solid var(--line, #cfc8b8); border-radius: 6px; background: var(--paper, #f3efe4); }
                .row label { flex: 1; overflow-wrap: anywhere; }
                .grip { cursor: grab; color: var(--muted, #697177); }
                .count { font-size: 10px; color: var(--muted, #697177); }
                button { min-height: 30px; border: 1px solid var(--line, #cfc8b8); border-radius: 5px; background: var(--panel, #fffdf7); padding: 0 8px; cursor: pointer; }
                button:disabled { opacity: .35; cursor: default; }
                button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--blue, #315f91); }
                .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
                .save { background: var(--ink, #18242b); color: white; }
                .drop-target { outline: 2px solid var(--blue, #315f91); }
            </style>
            <dialog aria-labelledby="heading">
                <h3 id="heading">${escapeHTML(t('ui.text.tableHierarchy'))}</h3>
                <p>${escapeHTML(t('ui.text.orderDimensionsFromOuterToInnerBoxesDragRowsOrUseTheArrowsUncheckDimensionsToLeaveThe'))}</p>
                <label>${escapeHTML(t('ui.text.savedHierarchy'))}<select class="presets"></select></label>
                <label>${escapeHTML(t('ui.text.name'))}<input class="name" maxlength="80" placeholder="${escapeHTML(t('ui.text.eGClientDelivery'))}" required></label>
                <p>${escapeHTML(t('ui.text.automaticUsesFewerDistinctValuesFirstCountsReflectTheTasksCurrentlyShownMultipleValue'))}</p>
                <div class="rows"></div>
                <div class="actions"><button type="button" class="automatic">${escapeHTML(t('ui.text.automatic'))}</button><button type="button" class="delete">${escapeHTML(t('ui.text.deleteSaved'))}</button><button type="button" class="cancel">${escapeHTML(t('ui.text.cancel'))}</button><button type="button" class="save">${escapeHTML(t('ui.text.saveUse'))}</button></div>
            </dialog>`;
        this.dialog = this.shadowRoot.querySelector('dialog');
        this.shadowRoot.querySelector('.cancel').onclick = () => this.dialog.close();
        this.dialog.addEventListener('click', event => {
            const bounds = this.dialog.getBoundingClientRect();
            if (event.target === this.dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) this.dialog.close();
        });
        this.shadowRoot.querySelector('.presets').onchange = event => this.loadDraft(event.target.value);
        this.shadowRoot.querySelector('.automatic').onclick = () => this.commit(null);
        this.shadowRoot.querySelector('.delete').onclick = () => {
            const name = this.shadowRoot.querySelector('.presets').value;
            if (!name) return;
            this.presets = this.presets.filter(item => item.name !== name);
            this.commit(null);
        };
        this.shadowRoot.querySelector('.save').onclick = () => {
            const input = this.shadowRoot.querySelector('.name');
            input.value = input.value.trim();
            if (!input.reportValidity()) return;
            const preset = { name: input.value, order: this.rows.filter(item => item.enabled).map(item => item.type) };
            this.presets = [...this.presets.filter(item => item.name !== preset.name), preset];
            this.commit(preset.name);
        };
    }

    show({ tasks, presets, selected }) {
        this.presets = cloneValue(presets);
        this.dimensions = associationDimensions(tasks, COMMON_PROPERTIES);
        this.automatic = automaticHierarchy(tasks);
        const select = this.shadowRoot.querySelector('.presets');
        select.replaceChildren(new Option(t('error.messages.automaticByAssociationCounts'), ''));
        for (const preset of this.presets) select.append(new Option(preset.name, preset.name));
        select.value = selected || '';
        this.loadDraft(select.value);
        this.dialog.showModal();
    }

    loadDraft(name) {
        const preset = this.presets.find(item => item.name === name);
        const order = preset?.order ?? this.automatic;
        const types = [...new Set([...order, ...this.dimensions.map(item => item.type)])];
        this.rows = types.map(type => ({ type, enabled: !preset || order.includes(type) }));
        this.shadowRoot.querySelector('.name').value = preset?.name || '';
        this.shadowRoot.querySelector('.delete').disabled = !preset;
        this.renderRows();
    }

    move(type, position) {
        const index = this.rows.findIndex(item => item.type === type);
        const [row] = this.rows.splice(index, 1);
        this.rows.splice(position, 0, row);
        this.renderRows();
        [...this.shadowRoot.querySelectorAll('.row')].find(item => item.dataset.type === type)?.querySelector('input').focus();
    }

    renderRows() {
        const list = this.shadowRoot.querySelector('.rows');
        list.replaceChildren();
        this.rows.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'row';
            row.dataset.type = item.type;
            row.draggable = true;
            const grip = document.createElement('span');
            grip.className = 'grip';
            grip.textContent = '⠿';
            grip.setAttribute('aria-hidden', 'true');
            const label = document.createElement('label');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = item.enabled;
            check.onchange = () => { item.enabled = check.checked; };
            label.append(check, ` ${uiLabel(item.type)}`);
            const count = document.createElement('span');
            count.className = 'count';
            count.textContent = t('ui.text.values', { count: this.dimensions.find(dimension => dimension.type === item.type)?.count || 0 });
            row.append(grip, label, count);
            for (const [arrow, delta] of [['↑', -1], ['↓', 1]]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = arrow;
                button.setAttribute('aria-label', t('ui.text.moveValue0Value1', { value0: item.type, value1: delta < 0 ? t('ui.text.outward') : t('ui.text.inward') }));
                button.disabled = index + delta < 0 || index + delta >= this.rows.length;
                button.onclick = () => this.move(item.type, index + delta);
                row.append(button);
            }
            row.ondragstart = event => {
                this.dragType = item.type;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.type);
            };
            row.ondragover = event => { if (this.dragType) { event.preventDefault(); row.classList.add('drop-target'); } };
            row.ondragleave = () => row.classList.remove('drop-target');
            row.ondragend = () => { this.dragType = null; list.querySelectorAll('.drop-target').forEach(item => item.classList.remove('drop-target')); };
            row.ondrop = event => {
                event.preventDefault();
                if (this.dragType) this.move(this.dragType, index);
                this.dragType = null;
            };
            list.append(row);
        });
    }

    commit(selected) {
        this.dispatchEvent(new CustomEvent('task-hierarchy-change', { bubbles: true, composed: true, detail: { presets: this.presets, selected } }));
        this.dialog.close();
    }
}
customElements.define('task-hierarchy-editor', TaskHierarchyEditor);
