import { COMMON_PROPERTIES, TIMER_ACTORS, cloneValue, canonicalType, setText, extractTaskLinks, currentDay, durationForTask, durationTodayForTask, formatAge, formatDuration, colorFor } from '../js/task-model.js';
class TaskItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._task = null;
        this._saveTimer = null;
        this._notesSaveTimer = null;
        this._promptsSaveTimer = null;
        this._editorTab = 'notes';
        this._agents = [];
        this._confirmTimer = null;
        this._associationCatalog = {};
        this._plans = [];
        this._clockDayKey = '';
        this._clockMinute = -1;
        this._sessionsOpen = false;
    }

    set agentCatalog(value) { this._agents = value || []; }

    set editorTab(value) { this._editorTab = value === 'prompts' ? 'prompts' : 'notes'; this.updateEditorTabs(); }

    updateEditorTabs() {
        this.shadowRoot.querySelectorAll('[data-editor-tab]').forEach(tab => {
            const active = tab.dataset.editorTab === this._editorTab;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        this.shadowRoot.querySelectorAll('[data-editor-panel]').forEach(panel => { panel.hidden = panel.dataset.editorPanel !== this._editorTab; });
    }

    set planCatalog(value) { this._plans = value || []; }

    set associationCatalog(value) { this._associationCatalog = cloneValue(value || {}); }

    set priorityLimit(value) { this._priorityLimit = Math.max(1, Number(value) || 1); }

    set sessionsOpen(value) {
        this._sessionsOpen = Boolean(value);
        const details = this.shadowRoot.querySelector('.details');
        if (details) details.open = this._sessionsOpen;
    }

    set task(value) {
        this._task = cloneValue(value);
        this.setAttribute('task-id', value.id);
        this.setAttribute('status', value.status);
        this.dataset.taskId = value.id;
        this.dataset.taskStatus = value.status;
        this.dataset.taskText = value.text;
        this.dataset.humanSeconds = String(Math.round(durationForTask(value, 'human')));
        this.dataset.agentSeconds = String(Math.round(durationForTask(value, 'agent')));
        this.dataset.associations = JSON.stringify(value.associations);
        this.dataset.running = String(TIMER_ACTORS.some((actor) => value.activeTimers?.[actor]));
        this.render();
    }

    get task() { return cloneValue(this._task); }

    disconnectedCallback() {
        clearTimeout(this._saveTimer);
        clearTimeout(this._notesSaveTimer);
        clearTimeout(this._promptsSaveTimer);
        clearTimeout(this._confirmTimer);
    }

    emit(name, detail = {}) {
        this.dispatchEvent(new CustomEvent(name, {
            bubbles: true,
            composed: true,
            detail: { id: this._task.id, ...detail }
        }));
    }

    render() {
        if (!this._task) return;
        const done = this._task.status === 'done';
        const tabled = this._task.tabled;
        const runningHuman = Boolean(this._task.activeTimers.human);
        const runningAgent = Boolean(this._task.activeTimers.agent);
        const running = runningHuman || runningAgent;

        this.shadowRoot.innerHTML = `
            <style>
                :host { --local-accent: var(--accent, #e65135); }
                * { box-sizing: border-box; }
                button, input, textarea { font: inherit; color: inherit; }
                button { cursor: pointer; }
                .card {
                    position: relative;
                    padding: 15px 15px 12px;
                    border: 1px solid var(--ink, #18242b);
                    border-radius: 12px;
                    background: var(--panel, #fffdf7);
                    box-shadow: 3px 3px 0 rgba(24,36,43,.1);
                    transition: transform 140ms ease, box-shadow 140ms ease;
                }
                .card:hover { transform: translateY(-1px); box-shadow: 4px 5px 0 rgba(24,36,43,.11); }
                :host([attention]) .card { animation: chart-attention 1.6s ease; }
                .card.running { border-left: 5px solid var(--accent, #e65135); padding-left: 11px; }
                .card.done { opacity: .7; box-shadow: none; }
                .card.tabled { border-style: dashed; background: color-mix(in srgb, var(--panel, #fffdf7) 72%, #e8e1d2); }
                .main-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 11px; }
                .check {
                    width: 23px;
                    height: 23px;
                    min-width: 23px;
                    display: grid;
                    place-items: center;
                    margin-top: 3px;
                    border: 1px solid var(--ink, #18242b);
                    border-radius: 7px;
                    background: transparent;
                    box-shadow: none;
                    color: white;
                    font-size: 14px;
                    font-weight: 900;
                }
                .check.checked { background: var(--green, #28785c); }
                .check.today-check.checked { background: var(--blue, #315f91); }
                .check-control { display: grid; justify-items: center; gap: 4px; margin-bottom: 9px; color: var(--muted, #697177); font: 750 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; text-transform: uppercase; cursor: pointer; }
                .check-control input { appearance: none; cursor: pointer; margin: 3px 0 0; }
                .check-control input:checked { background: var(--blue, #315f91); }
                .check-control input:checked::after { content: '✓'; }
                .check-control .check { margin: 3px 0 0; }
                .check:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                .priority-control { display: grid; justify-items: center; gap: 3px; margin-top: 6px; color: var(--muted, #697177); font: 750 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; text-transform: uppercase; }
                .priority-input { width: 38px; height: 25px; border: 1px solid #bdb7aa; border-radius: 6px; background: var(--panel, #fffdf7); padding: 0 3px; color: var(--ink, #18242b); text-align: center; font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
                .priority-input:focus { outline: 2px solid rgba(49,95,145,.22); outline-offset: 1px; }
                .text {
                    display: block;
                    width: 100%;
                    min-height: 30px;
                    max-height: 150px;
                    resize: vertical;
                    overflow: auto;
                    border: 0;
                    padding: 2px 3px;
                    background: transparent;
                    color: var(--ink, #18242b);
                    font-size: 15px;
                    font-weight: 720;
                    line-height: 1.45;
                }
                .text:focus { outline: 2px solid rgba(49,95,145,.22); border-radius: 4px; }
                .done .text { text-decoration: line-through; color: var(--muted, #697177); }
                .timers { display: grid; gap: 5px; }
                .timer {
                    min-width: 88px;
                    min-height: 35px;
                    padding: 0 10px;
                    border: 1px solid var(--ink, #18242b);
                    border-radius: 999px;
                    background: var(--ink, #18242b);
                    color: white;
                    box-shadow: 2px 2px 0 rgba(24,36,43,.16);
                    font: 750 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                }
                .human.timer.running { background: var(--green); }
                .timer.running { background: var(--accent, #e65135); }
                :host([clock-active]) .timer.running { animation: pulse 2s ease-in-out infinite; }
                .timer.agent { border-color: var(--blue, #315f91); background: var(--blue, #315f91); }
                .timer.agent.running { background: var(--green, #28785c); }
                .timer:disabled { cursor: not-allowed; opacity: .45; }
                @keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(230,81,53,.14); } }
                @keyframes chart-attention { 25%, 70% { box-shadow: 0 0 0 4px rgba(49,95,145,.28), 4px 5px 0 rgba(24,36,43,.11); } }
                .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin: 5px 0 0 5px; }
                .meta-left { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-width: 0; }
                .chips { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-width: 0; }
                .chip {
                    display: inline-flex;
                    align-items: center;
                    max-width: 210px;
                    min-height: 25px;
                    border: 1px solid color-mix(in srgb, var(--chip-color) 55%, transparent);
                    border-radius: 999px;
                    background: color-mix(in srgb, var(--chip-color) 10%, transparent);
                    color: var(--chip-color);
                    font: 750 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                }
                .chip-label { overflow: hidden; padding: 0 5px 0 8px; text-overflow: ellipsis; white-space: nowrap; }
                .chip button { width: 22px; height: 23px; border: 0; background: transparent; color: inherit; opacity: .65; }
                .link-pills { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-width: 0; }
                .link-pill {
                    display: inline-flex;
                    align-items: center;
                    min-height: 25px;
                    max-width: 210px;
                    border: 1px solid color-mix(in srgb, var(--blue, #315f91) 45%, transparent);
                    border-radius: 999px;
                    background: color-mix(in srgb, var(--blue, #315f91) 8%, transparent);
                    color: var(--blue, #315f91);
                    padding: 0 9px;
                    font: 750 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    text-decoration: none;
                }
                .link-pill:hover { background: color-mix(in srgb, var(--blue, #315f91) 16%, transparent); }
                .add-group { min-height: 25px; border: 1px dashed #999488; border-radius: 999px; padding: 0 8px; background: transparent; color: var(--muted, #697177); font-size: 10px; font-weight: 750; }
                .time-total { color: var(--muted, #697177); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
                .time-totals { display: grid; justify-items: end; gap: 4px; }
                .group-editor { display: grid; grid-template-columns: 120px minmax(130px, 1fr) auto; gap: 5px; margin: 5px 0 0 5px; padding: 8px; border: 1px solid #d6d0c3; border-radius: 9px; background: #f5f0e5; }
                .group-editor input { min-width: 0; height: 34px; border: 1px solid #bdb7aa; border-radius: 7px; background: #fffdf7; padding: 0 8px; font-size: 12px; }
                .group-editor button { min-height: 34px; border: 1px solid var(--ink, #18242b); border-radius: 7px; background: var(--ink, #18242b); color: white; padding: 0 10px; font-size: 11px; font-weight: 800; }
                .details { margin: 5px 0 0 5px; border-top: 1px solid #ded8ca; padding-top: 8px; }
                .plan-control { display: grid; gap: 5px; margin: 5px 0 0 5px; color: var(--muted, #697177); font-size: 10px; }
                .plan-row { display: flex; gap: 5px; }
                .plan-select { flex: 1; min-width: 0; max-width: 100%; height: 30px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); color: var(--ink, #18242b); font-size: 11px; }
                .open-plan { border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); font-size: 10px; cursor: pointer; }
                .editor-toolbar { display: flex; align-items: flex-end; gap: 8px; margin-top: 9px; }
                .editor-tabs { display: flex; flex-shrink: 0; gap: 3px; }
                .estimated-time { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; min-width: 0; padding-bottom: 3px; color: var(--muted, #697177); font-size: 9px; }
                .estimate-options { display: inline-flex; gap: 3px; }
                .estimate-option { position: relative; cursor: pointer; }
                .estimate-option input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
                .estimate-option span { display: block; padding: 3px 4px; border: 1px solid var(--line, #cfc8b8); border-radius: 4px; white-space: nowrap; font-weight: 750; }
                .estimate-option:hover span { border-color: var(--ink, #18242b); color: var(--ink, #18242b); }
                .estimate-option input:checked + span { background: var(--ink, #18242b); border-color: var(--ink, #18242b); color: white; }
                .estimate-option input:focus-visible + span { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                .editor-tabs button { min-height: 24px; padding: 3px 7px; border: 1px solid var(--line, #cfc8b8); border-bottom: 0; border-radius: 6px 6px 0 0; background: transparent; color: var(--muted, #697177); font-size: 10px; cursor: pointer; }
                .editor-tabs button[aria-selected="true"] { background: var(--ink, #18242b); color: white; border-color: var(--ink, #18242b); }
                button[role="tab"]:hover { background: var(--panel, #fffdf7); color: var(--ink, #18242b); }
                .agent-picker { display: grid; gap: 4px; min-width: 0; max-width: 160px; font-size: 10px; color: var(--muted, #697177); }
                .agent-select { width: 100%; min-width: 0; height: 31px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); color: var(--ink, #18242b); font-size: 10px; }
                .agent-form { display: grid; gap: 4px; max-width: 160px; }
                .agent-form input { min-width: 0; width: 100%; height: 31px; padding: 0 5px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); font-size: 11px; }
                .agent-form button { min-height: 27px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--paper, #f3efe4); font-size: 10px; cursor: pointer; }
                .notes, .prompts { display: block; width: 100%; min-height: 48px; max-height: 180px; resize: vertical; border: 1px solid #d6d0c3; border-radius: 0 8px 8px 8px; background: rgba(245,240,229,.55); padding: 8px; color: var(--ink, #18242b); font-size: 12px; line-height: 1.45; }
                summary { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #697177); cursor: pointer; font-size: 10px; font-weight: 750; list-style: none; }
                summary::-webkit-details-marker { display: none; }
                summary::before { content: '›'; font-size: 16px; transition: transform 120ms ease; }
                details[open] summary::before { transform: rotate(90deg); }
                .footer { display: flex; align-items: end; justify-content: space-between; gap: 5px; margin: 5px 0 0 5px; }
                .age { color: var(--muted, #697177); font: 650 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
                :host([table-detail]) .footer { margin-left: 0; flex-wrap: wrap; }
                .table-back { min-height: 30px; padding: 0 8px; border: 1px solid var(--line, #cfc8b8); border-radius: 6px; background: var(--panel, #fffdf7); font-size: 12px; }
                .tabled-control { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #697177); font-size: 10px; font-weight: 750; cursor: pointer; }
                .tabled-control input { width: 15px; height: 15px; accent-color: var(--yellow, #e8b949); }
                .actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
                .delete { min-height: 27px; border: 0; background: transparent; color: var(--muted, #697177); font-size: 10px; }
                .delete.armed { color: var(--accent-dark, #b93621); font-weight: 850; }
                [hidden] { display: none !important; }
                @media (max-width: 520px) {
                    .main-row { grid-template-columns: auto minmax(0, 1fr); }
                    .timers { grid-column: 2; justify-self: stretch; grid-template-columns: 1fr 1fr; }
                    .agent-picker, .agent-form { grid-column: 2; max-width: none; }
                    .plan-control, .meta-row, .group-editor, .details, .footer { margin-left: 5px; }
                    .notes-wrap { margin-left: 0; }
                    .group-editor { grid-template-columns: 1fr 1fr; }
                    .group-editor button { grid-column: 1 / -1; }
                }
                @media (prefers-reduced-motion: reduce) { :host([clock-active]) .timer.running { animation: none; } }
            </style>
            <article class="card ${running ? 'running' : ''} ${done ? 'done' : ''} ${tabled ? 'tabled' : ''}">
                <div class="main-row">
                    <div>
                        <label class="check-control"><input class="check today-check" type="checkbox" ${this._task.today ? 'checked' : ''}><span>${escapeHTML(t('ui.text.today'))}</span></label>
                        <div class="check-control"><button class="check complete-check ${done ? 'checked' : ''}" type="button" aria-pressed="${done}" aria-label="${done ? t('ui.text.reopenTask') : t('ui.text.completeTask')}" aria-describedby="complete-label">${done ? '✓' : ''}</button><span id="complete-label">${escapeHTML(t('ui.text.complete'))}</span></div>
                        <label class="priority-control">${escapeHTML(t('ui.text.priority'))}<input class="priority-input" type="number" min="1" max="${this._priorityLimit || 1}" step="1" inputmode="numeric" ${done ? 'disabled' : ''} aria-label="${escapeHTML(t('ui.text.taskPriority1IsHighest'))}"></label>
                    </div>
                    <div>
                        <textarea class="text" rows="1" aria-label="${escapeHTML(t('ui.text.taskText'))}"></textarea>
                        <div class="editor-toolbar">
                            <div class="editor-tabs" role="tablist" aria-label="${escapeHTML(t('ui.text.taskTextFields'))}">
                                <button id="task-notes-tab" type="button" role="tab" data-editor-tab="notes" aria-controls="task-notes-panel">${escapeHTML(t('ui.text.notes'))}</button>
                                <button id="task-prompts-tab" type="button" role="tab" data-editor-tab="prompts" aria-controls="task-prompts-panel">${escapeHTML(t('ui.text.prompts'))}</button>
                            </div>
                            <div class="estimated-time" role="group" aria-label="${escapeHTML(t('ui.text.estimatedTimeNeeded'))}">
                                <span>${escapeHTML(t('ui.text.estimatedTimeNeeded2'))}</span>
                                <span class="estimate-options">${[10, 30, 60, 90].map(minutes => `<label class="estimate-option"><input type="radio" name="estimatedMinutes" value="${minutes}" aria-label="${escapeHTML(t('ui.text.lessThanValue1Minutes', { value1: minutes }))}" ${this._task.estimatedMinutes === minutes ? 'checked' : ''}><span>${escapeHTML(t('ui.text.value3', { value3: minutes }))}</span></label>`).join('')}</span>
                                <span>${escapeHTML(t('ui.text.minutes'))}</span>
                            </div>
                        </div>
                        <div id="task-notes-panel" role="tabpanel" data-editor-panel="notes" aria-labelledby="task-notes-tab"><textarea class="notes" rows="2" maxlength="10000" placeholder="${escapeHTML(t('ui.text.addNotes'))}" aria-label="${escapeHTML(t('ui.text.taskNotes'))}"></textarea></div>
                        <div id="task-prompts-panel" role="tabpanel" data-editor-panel="prompts" aria-labelledby="task-prompts-tab"><textarea class="prompts" rows="5" maxlength="50000" placeholder="${escapeHTML(t('ui.text.recordAPrompt'))}" aria-label="${escapeHTML(t('ui.text.taskPrompts'))}"></textarea></div>
                    </div>
                    <div class="timers">
                        <button class="timer human ${runningHuman ? 'running' : ''}" data-actor="human" type="button" ${done || tabled ? 'disabled' : ''} aria-label="${runningHuman ? t('ui.text.stopHumanTimer') : t('ui.text.startHumanTimer')}"></button>
                        <button class="timer agent ${runningAgent ? 'running' : ''}" data-actor="agent" type="button" ${done || tabled ? 'disabled' : ''} aria-label="${runningAgent ? t('ui.text.stopAgentTimer') : t('ui.text.startAgentTimer')}"></button>
                        <label class="agent-picker">${escapeHTML(t('ui.text.namedAgent'))}<select class="agent-select" aria-label="${escapeHTML(t('ui.text.namedAgent'))}"></select></label>
                        <form class="agent-form" hidden><input class="agent-name" maxlength="120" placeholder="${escapeHTML(t('ui.text.agentName'))}" aria-label="${escapeHTML(t('ui.text.newAgentName'))}" required><button type="submit">${escapeHTML(t('ui.text.addAgent'))}</button><button class="agent-cancel" type="button">${escapeHTML(t('ui.text.cancel'))}</button></form>
                    </div>
                </div>
                <label class="plan-control">${escapeHTML(t('ui.text.planOptional'))}<span class="plan-row"><select class="plan-select" aria-label="${escapeHTML(t('ui.text.taskPlan'))}"></select><button class="open-plan" type="button" ${this._task.planId ? '' : 'hidden'}>${escapeHTML(t('ui.text.openPlan'))}</button></span></label>
                <div class="meta-row">
                    <div class="meta-left"><div class="chips"></div><div class="link-pills" hidden></div></div>
                    <div class="time-totals"><span class="time-total human-total"></span><span class="time-total agent-total"></span></div>
                </div>
                <form class="group-editor" hidden>
                    <input class="group-type" list="property-types" maxlength="60" placeholder="${escapeHTML(t('ui.text.property'))}" aria-label="${escapeHTML(t('ui.text.associationProperty'))}">
                    <datalist id="property-types">${COMMON_PROPERTIES.map((type) => `<option value="${type}"></option>`).join('')}</datalist>
                    <input class="group-value" list="association-values" maxlength="120" placeholder="${escapeHTML(t('ui.text.chooseOrTypeANewValue'))}" aria-label="${escapeHTML(t('ui.text.associationValue'))}">
                    <datalist id="association-values"></datalist>
                    <button type="submit">${escapeHTML(t('ui.text.addAssociation'))}</button>
                </form>

                <details class="details" ${this._task.sessions.length ? '' : 'hidden'} ${this._sessionsOpen ? 'open' : ''}>
                    <summary>${escapeHTML(t('ui.text.value21TimeValue22', { value21: this._task.sessions.length, value22: uiLabel(this._task.sessions.length === 1 ? 'entry' : 'entries') }))}</summary>
                    <session-times></session-times>
                </details>
                <div class="footer">
                    ${this.hasAttribute('table-detail') ? `<button class="table-back" type="button" aria-label="${escapeHTML(t('ui.text.backToTaskTable'))}">${escapeHTML(t('ui.text.table'))}</button>` : ''}
                    <span class="age" title="${escapeHTML(t('ui.text.createdValue24', { value24: new Date(this._task.createdAt).toLocaleString() }))}"></span>
                    <div class="actions"><label class="tabled-control"><input class="tabled" type="checkbox" ${tabled ? 'checked' : ''}> ${escapeHTML(t('ui.text.tabled'))}</label><button class="delete" type="button" aria-label="${escapeHTML(t('ui.text.deleteTask'))}">${escapeHTML(t('ui.text.delete'))}</button></div>
                </div>
            </article>
        `;

        const textArea = this.shadowRoot.querySelector('.text');
        const priorityInput = this.shadowRoot.querySelector('.priority-input');
        priorityInput.value = this._task.priority ?? '';
        priorityInput.addEventListener('change', () => {
            const raw = priorityInput.value.trim();
            this.emit('task-priority-change', { priority: raw === '' ? null : Number(raw) });
        });
        textArea.value = this._task.text;
        this.resizeText(textArea);
        textArea.addEventListener('input', () => {
            this.resizeText(textArea);
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.emit('task-text-change', { text: textArea.value }), 550);
        });
        textArea.addEventListener('blur', () => {
            clearTimeout(this._saveTimer);
            if (textArea.value.trim() && textArea.value.trim() !== this._task.text) this.emit('task-text-change', { text: textArea.value });
            if (!textArea.value.trim()) textArea.value = this._task.text;
        });
        textArea.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') textArea.blur();
        });

        const planSelect = this.shadowRoot.querySelector('.plan-select');
        planSelect.append(new Option(t('error.messages.noPlan'), ''));
        for (const plan of this._plans) planSelect.append(new Option(plan.text, plan.id));
        planSelect.value = this._task.planId || '';
        planSelect.addEventListener('change', () => this.emit('task-plan-change', { planId: planSelect.value || null }));
        this.shadowRoot.querySelector('.open-plan').addEventListener('click', () => this.emit('planning-navigate', { targetKind: 'plans', targetId: this._task.planId }));

        const notesArea = this.shadowRoot.querySelector('.notes');
        notesArea.value = this._task.notes;
        notesArea.addEventListener('input', () => {
            clearTimeout(this._notesSaveTimer);
            this._notesSaveTimer = setTimeout(() => this.emit('task-notes-change', { notes: notesArea.value }), 550);
        });
        notesArea.addEventListener('blur', () => {
            clearTimeout(this._notesSaveTimer);
            if (notesArea.value.trim() !== this._task.notes) this.emit('task-notes-change', { notes: notesArea.value });
        });

        const promptsArea = this.shadowRoot.querySelector('.prompts');
        promptsArea.value = this._task.prompts;
        const savePrompts = () => {
            clearTimeout(this._promptsSaveTimer);
            if (promptsArea.value !== this._task.prompts) this.emit('task-prompts-change', { prompts: promptsArea.value });
        };
        promptsArea.addEventListener('input', () => {
            clearTimeout(this._promptsSaveTimer);
            this._promptsSaveTimer = setTimeout(savePrompts, 550);
        });
        promptsArea.addEventListener('blur', savePrompts);
        this.shadowRoot.querySelectorAll('[data-editor-tab]').forEach(tab => {
            const select = () => {
                this.editorTab = tab.dataset.editorTab;
                this.emit('task-editor-tab-change', { tab: this._editorTab });
            };
            tab.addEventListener('click', select);
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'notes' : event.key === 'End' ? 'prompts' : this._editorTab === 'notes' ? 'prompts' : 'notes';
                this.shadowRoot.querySelector(`[data-editor-tab="${next}"]`).click();
                this.shadowRoot.querySelector(`[data-editor-tab="${next}"]`).focus();
            });
        });
        this.updateEditorTabs();
        this.shadowRoot.querySelectorAll('input[name="estimatedMinutes"]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) this.emit('task-estimate-change', { estimatedMinutes: Number(input.value) });
            });
        });
        const agentSelect = this.shadowRoot.querySelector('.agent-select');
        agentSelect.append(new Option(t('error.messages.noNamedAgent'), ''));
        for (const agent of this._agents) agentSelect.append(new Option(agent.name, agent.id));
        for (const [label, action] of [[t('ui.text.addNamedAgent'), 'add'], [t('ui.text.manageNamedAgents'), 'manage']]) {
            const option = new Option(label, `__${action}_agent__`);
            option.dataset.action = action;
            agentSelect.append(option);
        }
        agentSelect.value = this._task.agentId || '';
        const agentForm = this.shadowRoot.querySelector('.agent-form');
        agentSelect.addEventListener('change', () => {
            const action = agentSelect.selectedOptions[0]?.dataset.action;
            if (action) {
                agentSelect.value = this._task.agentId || '';
                if (action === 'manage') this.emit('task-agents-manage');
                else { agentForm.hidden = false; agentForm.querySelector('input').focus(); }
            } else this.emit('task-agent-change', { agentId: agentSelect.value || null });
        });
        agentForm.addEventListener('submit', event => {
            event.preventDefault();
            const name = agentForm.querySelector('input').value.trim();
            if (name) this.emit('task-agent-create', { name });
        });
        this.shadowRoot.querySelector('.agent-cancel').addEventListener('click', () => { agentForm.hidden = true; agentSelect.focus(); });

        this.shadowRoot.querySelector('.complete-check').addEventListener('click', () => this.emit('task-status-toggle'));
        this.shadowRoot.querySelector('.today-check').addEventListener('change', (event) => this.emit('task-today-change', { today: event.target.checked }));
        this.shadowRoot.querySelector('.table-back')?.addEventListener('click', () => this.emit('task-table-back'));
        this.shadowRoot.querySelector('.tabled').addEventListener('change', (event) => this.emit('task-tabled-change', { tabled: event.target.checked }));
        this.shadowRoot.querySelectorAll('.timer').forEach((button) => button.addEventListener('click', () => this.emit('task-timer-toggle', { actor: button.dataset.actor })));

        const chips = this.shadowRoot.querySelector('.chips');
        for (const association of this._task.associations) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.style.setProperty('--chip-color', colorFor(association.type));
            const label = document.createElement('span');
            label.className = 'chip-label';
            label.textContent = `${association.type}: ${association.value}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', t('ui.text.removeValue0Value1', { value0: association.type, value1: association.value }));
            remove.addEventListener('click', () => this.emit('task-association-remove', { association }));
            chip.append(label, remove);
            chips.append(chip);
        }

        const addGroup = document.createElement('button');
        addGroup.type = 'button';
        addGroup.className = 'add-group';
        addGroup.textContent = t('ui.text.association');
        addGroup.addEventListener('click', () => {
            const editor = this.shadowRoot.querySelector('.group-editor');
            editor.hidden = !editor.hidden;
            if (!editor.hidden) this.shadowRoot.querySelector('.group-type').focus();
        });
        chips.append(addGroup);

        const linkPills = this.shadowRoot.querySelector('.link-pills');
        const links = extractTaskLinks(this._task);
        if (links.length) {
            linkPills.hidden = false;
            for (const link of links) {
                const anchor = document.createElement('a');
                anchor.className = 'link-pill';
                anchor.href = link.href;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = link.label;
                anchor.title = link.href;
                linkPills.append(anchor);
            }
        }

        const typeInput = this.shadowRoot.querySelector('.group-type');
        const valueInput = this.shadowRoot.querySelector('.group-value');
        const propertyList = this.shadowRoot.querySelector('#property-types');
        for (const type of Object.keys(this._associationCatalog).filter((type) => !COMMON_PROPERTIES.includes(type)).sort()) {
            const option = document.createElement('option');
            option.value = type;
            propertyList.append(option);
        }
        const updateValueOptions = () => {
            const type = canonicalType(typeInput.value);
            const list = this.shadowRoot.querySelector('#association-values');
            list.replaceChildren(...(this._associationCatalog[type] || []).map((value) => {
                const option = document.createElement('option');
                option.value = value;
                return option;
            }));
            valueInput.placeholder = type === 'dependent-task' ? t('ui.text.chooseAnExistingTask') : t('ui.text.chooseOrTypeANewValue');
        };
        typeInput.addEventListener('input', updateValueOptions);
        typeInput.addEventListener('change', updateValueOptions);

        this.shadowRoot.querySelector('.group-editor').addEventListener('submit', (event) => {
            event.preventDefault();
            if (!typeInput.value.trim() || !valueInput.value.trim()) return;
            this.emit('task-association-add', { association: { type: typeInput.value, value: valueInput.value } });
        });

        const details = this.shadowRoot.querySelector('.details');
        details.addEventListener('toggle', () => {
            this._sessionsOpen = details.open;
            this.emit('task-sessions-toggle', { open: details.open });
        });

        this.shadowRoot.querySelector('session-times').data = { taskId: this._task.id, sessions: this._task.sessions };

        const deleteButton = this.shadowRoot.querySelector('.delete');
        deleteButton.addEventListener('click', () => {
            if (deleteButton.classList.contains('armed')) {
                clearTimeout(this._confirmTimer);
                this.emit('task-delete');
                return;
            }
            deleteButton.classList.add('armed');
            deleteButton.textContent = t('ui.text.deleteClickAgain');
            this._confirmTimer = setTimeout(() => {
                deleteButton.classList.remove('armed');
                deleteButton.textContent = t('ui.text.delete');
            }, 3000);
        });

        this._clockDayKey = '';
        this._clockMinute = -1;
        this.updateClock(Date.now(), true);
    }

    updateClock(now = Date.now(), force = false) {
        if (!this._task) return;
        const { key: dayKey } = currentDay(now);
        const minute = Math.floor(now / 60000);
        const dayChanged = dayKey !== this._clockDayKey;
        const runningHuman = Boolean(this._task.activeTimers.human);
        const runningAgent = Boolean(this._task.activeTimers.agent);
        const updateActor = (actor, running) => {
            if (!force && !dayChanged && !running) return;
            const label = actor === 'human' ? t('ui.text.human') : t('ui.text.agent');
            setText(
                this.shadowRoot.querySelector(`.timer.${actor}`),
                `${running ? '■' : '▶'} ${label} ${formatDuration(durationTodayForTask(this._task, actor, now))}`
            );
            if (force || running) {
                setText(
                    this.shadowRoot.querySelector(`.${actor}-total`),
                    `${label} ${formatDuration(durationForTask(this._task, actor, true, now), true)}`
                );
            }
        };
        updateActor('human', runningHuman);
        updateActor('agent', runningAgent);
        if (force || minute !== this._clockMinute) {
            const tabledDuration = this._task.tabled && this._task.tabledAt
                ? t('ui.text.tabledValue0', { value0: formatAge(this._task.tabledAt, new Date(now)) })
                : '';
            setText(this.shadowRoot.querySelector('.age'), t('ui.text.ageValue0Value1', { value0: formatAge(this._task.createdAt, new Date(now)), value1: tabledDuration }));
        }
        this._clockDayKey = dayKey;
        this._clockMinute = minute;
    }

    resizeText(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(150, Math.max(30, textarea.scrollHeight))}px`;
    }
}
customElements.define('task-item', TaskItem);
