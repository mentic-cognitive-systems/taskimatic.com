const DAY_MS = 86400000;
const dateNumber = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
const secondsOfDay = date => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();

export function sessionDraft(session) {
    const start = new Date(session.startedAt);
    const end = new Date(session.endedAt || start.getTime() + Number(session.durationSeconds || 0) * 1000);
    return { anchor: start, originalStart: start.getTime(), originalEnd: end.getTime(), originalStartSeconds: secondsOfDay(start), originalEndSeconds: secondsOfDay(end), originalDays: dateNumber(end) - dateNumber(start), startMilliseconds: start.getMilliseconds(), endMilliseconds: end.getMilliseconds(), start: secondsOfDay(start), end: secondsOfDay(end), days: dateNumber(end) - dateNumber(start) };
}

export function sessionTimestamps(draft) {
    const at = (days, seconds, milliseconds) => {
        const date = new Date(draft.anchor);
        date.setDate(date.getDate() + days);
        date.setHours(Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60, milliseconds);
        return date.getTime();
    };
    return {
        start: draft.start === draft.originalStartSeconds ? draft.originalStart : at(0, draft.start, draft.startMilliseconds || 0),
        end: draft.end === draft.originalEndSeconds && draft.days === draft.originalDays ? draft.originalEnd : at(draft.days, draft.end, draft.endMilliseconds || 0)
    };
}

export function installSessionTimes(formatDuration, targetWindow = window) {
    if (targetWindow.customElements.get('session-times')) return;
    class SessionTimes extends targetWindow.HTMLElement {
        constructor() {
            super();
            this.attachShadow({mode: 'open'});
            this._sessions = [];
        }
        set data({taskId, sessions}) {
            this.taskId = taskId;
            this._sessions = sessions || [];
            this.render();
        }
        emit(type, detail) {
            this.dispatchEvent(new targetWindow.CustomEvent(type, {bubbles: true, composed: true, detail: {id: this.taskId, ...detail}}));
        }
        renderShortSession(session, saved) {
            const row = this.ownerDocument.createElement('div');
            row.className = 'session';
            row.innerHTML = `<span class="when"></span><div class="session-editor"><span class="start-time"></span><dual-range-slider hide-labels start-label="${escapeHTML(t('ui.text.sessionStart'))}" end-label="${escapeHTML(t('ui.text.sessionStop'))}"></dual-range-slider><span class="end-time"></span></div><div class="actions"><span class="duration" role="status"></span><button class="confirm" type="button" hidden>${escapeHTML(t('ui.text.oK'))}</button><button class="delete" type="button">${escapeHTML(t('ui.text.delete'))}</button></div>`;
            row.querySelector('.when').textContent = `${session.actor === 'agent' ? t('ui.text.agent') : t('ui.text.human')} · ${new Date(saved.start).toLocaleString()}`;
            row.querySelector('.session-editor').classList.add('short-session');
            const slider = row.querySelector('dual-range-slider');
            const formatTime = seconds => new Date(seconds * 1000).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
            const savedStart = saved.start / 1000;
            const savedEnd = saved.end / 1000;
            const padding = Math.min(3600, Math.max(0, (86400 - (savedEnd - savedStart)) / 2));
            slider.valueFormatter = formatTime;
            slider.setRange({min: savedStart - padding, max: savedEnd + padding, step: 60, start: savedStart, end: savedEnd});
            let start = savedStart;
            let end = savedEnd;
            const confirm = row.querySelector('.confirm');
            const refresh = () => {
                row.querySelector('.start-time').textContent = formatTime(start);
                row.querySelector('.end-time').textContent = formatTime(end);
                row.querySelector('.duration').textContent = formatDuration(end - start);
                confirm.hidden = start === savedStart && end === savedEnd;
            };
            const update = event => { start = event.detail.start; end = event.detail.end; refresh(); };
            slider.addEventListener('input', update);
            slider.addEventListener('change', update);
            confirm.addEventListener('click', () => this.emit('task-session-update', {sessionId: session.id, startedAt: new Date(start * 1000).toISOString(), endedAt: new Date(end * 1000).toISOString()}));
            row.querySelector('.delete').addEventListener('click', () => {
                if (targetWindow.confirm('Delete this work session? This cannot be undone.')) this.emit('task-session-delete', {sessionId: session.id});
            });
            refresh();
            return row;
        }
        render() {
            this.shadowRoot.innerHTML = `<style>
                :host { display: block; }
                * { box-sizing: border-box; }
                .sessions { display: grid; gap: 14px; margin-top: 7px; max-height: 320px; overflow-y: auto; overscroll-behavior: contain; padding: 3px 6px 6px 2px; }
                .session { display: grid; gap: 6px; color: var(--muted, #697177); font: 650 10px/1.35 ui-monospace, monospace; }
                .session-editor { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; }
                .short-session { grid-template-columns: auto minmax(80px, 1fr) auto; }
                dual-range-slider { min-width: 0; --dual-range-track-color: #d6d0c3; --dual-range-selection-color: #315f91; --dual-range-active-color: #e65135; --dual-range-thumb-color: #fffdf7; --dual-range-thumb-border-color: #18242b; }
                label { display: grid; gap: 4px; min-width: 0; }
                input[type=range] { width: 100%; min-width: 0; margin: 0; accent-color: var(--accent, #e65135); }
                button, input { font: inherit; color: inherit; }
                button { min-height: 26px; border: 1px solid var(--line, #cfc8b8); border-radius: 6px; background: var(--panel, #fffdf7); cursor: pointer; padding: 3px 7px; }
                input[type=time] { width: 100%; min-width: 0; border: 1px solid var(--line, #cfc8b8); border-radius: 4px; background: var(--panel, #fffdf7); padding: 3px; }
                .days-input { width: 65px; padding: 4px; }
                .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
                .duration { color: var(--ink, #18242b); }
                .confirm { background: var(--green, #28785c); color: white; }
                .delete { color: var(--accent, #e65135); }
                [hidden] { display: none !important; }
            </style><div class="sessions" role="region" aria-label="${escapeHTML(t('ui.text.workSessions'))}" tabindex="0"></div>`;
            const document = this.ownerDocument;
            for (const session of [...this._sessions].reverse()) {
                const draft = sessionDraft(session);
                const saved = sessionTimestamps(draft);
                if (!Number.isFinite(saved.start) || !Number.isFinite(saved.end)) continue;
                if (saved.end - saved.start <= DAY_MS) {
                    this.shadowRoot.querySelector('.sessions').append(this.renderShortSession(session, saved));
                    continue;
                }
                const row = document.createElement('div');
                row.className = 'session';
                row.innerHTML = `<span class="when"></span><div class="session-editor"><label>${escapeHTML(t('ui.text.start'))}<input class="start-time" type="time" step="1" aria-label="${escapeHTML(t('ui.text.sessionStartTime'))}"><input class="start-slider" type="range" min="0" max="86399" step="60" aria-label="${escapeHTML(t('ui.text.sessionStartTimeSlider'))}"></label><span><button class="days" type="button"></button><input class="days-input" type="number" min="0" step="1" aria-label="${escapeHTML(t('ui.text.daysAfterStartDate'))}" hidden></span><label>${escapeHTML(t('ui.text.stop'))}<input class="end-time" type="time" step="1" aria-label="${escapeHTML(t('ui.text.sessionStopTime'))}"><input class="end-slider" type="range" min="0" max="86399" step="60" aria-label="${escapeHTML(t('ui.text.sessionStopTimeSlider'))}"></label></div><div class="actions"><span class="duration" role="status"></span><button class="confirm" type="button" hidden>${escapeHTML(t('ui.text.oK'))}</button><button class="delete" type="button">${escapeHTML(t('ui.text.delete'))}</button></div>`;
                row.querySelector('.when').textContent = `${session.actor === 'agent' ? t('ui.text.agent') : t('ui.text.human')} · ${draft.anchor.toLocaleString()}`;
                const daysButton = row.querySelector('.days');
                const daysInput = row.querySelector('.days-input');
                const confirm = row.querySelector('.confirm');
                const timeText = seconds => [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
                const refresh = () => {
                    const {start, end} = sessionTimestamps(draft);
                    for (const side of ['start', 'end']) {
                        row.querySelector(`.${side}-time`).value = timeText(draft[side]);
                        row.querySelector(`.${side}-slider`).value = draft[side];
                    }
                    daysButton.textContent = t('ui.text.countUnit', { count: draft.days, unit: t(draft.days === 1 ? 'ui.text.day' : 'ui.text.days') });
                    daysButton.setAttribute('aria-label', t('ui.text.editDaysAfterStartDateDays', { days: draft.days }));
                    daysInput.value = draft.days;
                    row.querySelector('.duration').textContent = end < start ? t('ui.text.stopMustBeAfterStartAdjustDaysOrTime') : formatDuration((end - start) / 1000);
                    confirm.hidden = start === saved.start && end === saved.end;
                    confirm.disabled = end < start || !Number.isFinite(end);
                };
                for (const side of ['start', 'end']) {
                    row.querySelector(`.${side}-slider`).addEventListener('input', event => { draft[side] = Number(event.target.value); refresh(); });
                    row.querySelector(`.${side}-time`).addEventListener('input', event => {
                        if (!event.target.value) return;
                        const [hours, minutes, seconds = 0] = event.target.value.split(':').map(Number);
                        draft[side] = hours * 3600 + minutes * 60 + seconds;
                        refresh();
                    });
                }
                daysButton.addEventListener('click', () => { daysButton.hidden = true; daysInput.hidden = false; daysInput.focus(); daysInput.select(); });
                daysInput.addEventListener('input', () => {
                    if (!daysInput.validity.valid || daysInput.value === '') { confirm.disabled = true; return; }
                    draft.days = Number(daysInput.value);
                    refresh();
                });
                const finishDays = () => { daysInput.hidden = true; daysButton.hidden = false; refresh(); };
                daysInput.addEventListener('blur', finishDays);
                daysInput.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === 'Escape') { finishDays(); daysButton.focus(); } });
                confirm.addEventListener('click', () => {
                    const {start, end} = sessionTimestamps(draft);
                    if (end < start || !Number.isFinite(end)) return;
                    this.emit('task-session-update', {sessionId: session.id, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString()});
                });
                row.querySelector('.delete').addEventListener('click', () => {
                    if (targetWindow.confirm('Delete this work session? This cannot be undone.')) this.emit('task-session-delete', {sessionId: session.id});
                });
                refresh();
                this.shadowRoot.querySelector('.sessions').append(row);
            }
        }
    }
    targetWindow.customElements.define('session-times', SessionTimes);
}
