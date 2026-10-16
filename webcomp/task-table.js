import { TIMER_ACTORS, colorFor } from '../js/task-model.js';
import { automaticHierarchy, buildTaskTable } from '../js/task-table-model.js';

class TaskTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.closedGroups = new Set();
        this._tasks = [];
        this._hierarchy = null;
    }

    set tasks(value) { this._tasks = value || []; this.render(); }
    get tasks() { return this._tasks; }
    set hierarchy(value) { this._hierarchy = Array.isArray(value) ? value : null; this.render(); }
    get hierarchy() { return this._hierarchy ?? automaticHierarchy(this._tasks); }
    setData(tasks, hierarchy = null) { this._tasks = tasks; this._hierarchy = hierarchy; this.render(); }

    focusTask(id) {
        const button = [...this.shadowRoot.querySelectorAll('[data-task-id]')].find(item => item.dataset.taskId === id);
        if (!button) return;
        for (let parent = button.parentElement; parent; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS') parent.open = true;
        }
        button.focus({ preventScroll: true });
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; color: var(--ink, #18242b); }
                * { box-sizing: border-box; }
                .boxes { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 5px; }
                .box { flex: 1 1 180px; min-width: 0; max-width: 100%; border: 1px solid var(--line, #cfc8b8); border-top: 2px solid var(--group-color); border-radius: 6px; background: var(--panel, #fffdf7); overflow: hidden; }
                .box .box { flex-basis: 150px; }
                summary { display: flex; align-items: center; gap: 5px; padding: 5px 7px; cursor: pointer; background: color-mix(in srgb, var(--group-color) 7%, var(--panel, #fffdf7)); list-style: none; font-size: 11px; }
                summary::-webkit-details-marker { display: none; }
                summary::before { content: '▸'; color: var(--muted, #697177); }
                details[open] > summary::before { content: '▾'; }
                .type { color: var(--muted, #697177); font-size: 9px; }
                .value { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 750; }
                .count { color: var(--muted, #697177); font: 10px ui-monospace, monospace; }
                .contents { padding: 5px; }
                button { font: inherit; color: inherit; cursor: pointer; }
                button:focus-visible, summary:focus-visible { outline: 2px solid var(--blue, #315f91); outline-offset: -2px; }
                .filter { border: 0; background: transparent; padding: 0 3px; border-radius: 3px; color: var(--blue, #315f91); }
                .filter:hover { background: var(--paper, #f3efe4); }
                .tasks { display: grid; gap: 1px; flex: 1 1 180px; min-width: 0; }
                .task { display: flex; align-items: baseline; gap: 6px; width: 100%; min-height: 28px; border: 0; border-radius: 3px; padding: 5px 6px; background: transparent; text-align: left; font-size: 12px; line-height: 1.3; }
                .task:hover { background: var(--paper, #f3efe4); }
                .task span:last-child { overflow-wrap: anywhere; }
                .marker { color: var(--muted, #697177); font: 10px ui-monospace, monospace; }
                .done span:last-child { text-decoration: line-through; color: var(--muted, #697177); }
                .running .marker { color: var(--green, #28785c); }
                .order { margin: 0 0 8px; color: var(--muted, #697177); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
            </style><p class="order"></p><div class="boxes"></div>`;
        this.shadowRoot.querySelector('.order').textContent = this.hierarchy.length
            ? `${this._hierarchy === null ? t('ui.text.automatic') : t('ui.text.hierarchy')}: ${this.hierarchy.join(' → ')}` : t('ui.text.tasksWithoutGrouping');
        const appendNode = (node, container) => {
            for (const group of node.groups) {
                const box = document.createElement('details');
                box.className = 'box';
                box.open = !this.closedGroups.has(group.key);
                box.style.setProperty('--group-color', colorFor(group.type));
                const summary = document.createElement('summary');
                const type = document.createElement('span');
                type.className = 'type';
                type.textContent = group.type;
                const value = document.createElement('span');
                value.className = 'value';
                value.textContent = group.values.join(' · ') || t('ui.text.noValue0', { value0: group.type });
                const count = document.createElement('span');
                count.className = 'count';
                count.textContent = group.count;
                summary.append(type, value, count);
                for (const name of group.values) {
                    const filter = document.createElement('button');
                    filter.type = 'button';
                    filter.className = 'filter';
                    filter.textContent = '⌕';
                    filter.title = t('ui.text.filterValue0Value1', { value0: group.type, value1: name });
                    filter.setAttribute('aria-label', filter.title);
                    filter.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.dispatchEvent(new CustomEvent('task-table-filter', { bubbles: true, composed: true, detail: { type: group.type, value: name } }));
                    });
                    summary.append(filter);
                }
                const contents = document.createElement('div');
                contents.className = 'contents boxes';
                box.append(summary, contents);
                box.addEventListener('toggle', () => {
                    if (!box.isConnected) return;
                    if (box.open) this.closedGroups.delete(group.key); else this.closedGroups.add(group.key);
                });
                appendNode(group, contents);
                container.append(box);
            }
            if (node.tasks.length) {
                const rows = document.createElement('div');
                rows.className = 'tasks';
                for (const task of node.tasks) {
                    const button = document.createElement('button');
                    const running = TIMER_ACTORS.some(actor => task.activeTimers?.[actor]);
                    button.type = 'button';
                    button.className = `task${task.status === 'done' ? ' done' : ''}${running ? ' running' : ''}`;
                    button.dataset.taskId = task.id;
                    button.title = (task.associations || []).map(item => `${item.type}: ${item.value}`).join('\n');
                    const marker = document.createElement('span');
                    marker.className = 'marker';
                    marker.textContent = task.priority ? `${task.priority}.` : task.status === 'done' ? '✓' : running ? '▶' : task.tabled ? '◇' : '·';
                    marker.setAttribute('aria-hidden', 'true');
                    const text = document.createElement('span');
                    text.textContent = task.text;
                    button.append(marker, text);
                    button.addEventListener('click', () => this.dispatchEvent(new CustomEvent('task-table-open', { bubbles: true, composed: true, detail: { id: task.id } })));
                    rows.append(button);
                }
                container.append(rows);
            }
        };
        appendNode(buildTaskTable(this._tasks, this.hierarchy), this.shadowRoot.querySelector('.boxes'));
    }
}
customElements.define('task-table', TaskTable);
