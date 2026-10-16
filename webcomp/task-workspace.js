import { APP_VERSION, TIMER_ACTORS, cloneValue, uid, nowISO, cleanString, canonicalType, setText, durationCache, currentDay, invalidateDurationCache, completedDurationsTodayForTask, normalizeTask, parseQuickTask, durationForTask, durationTodayForTask, formatDuration, formatProtectTime, colorFor } from '../js/task-model.js';
import { TaskRepository } from '../js/task-repository.js';
import { downloadBlob } from '../js/download.js';
import { installLockInControls } from './lock-in-controls.js';
import { WORKSPACE_COLLECTIONS, normalizeAssociations, normalizePlanningRecord, normalizeAgent, agentTaskReferences, normalizeWorkspaceSnapshot, validateWorkspaceLinks, planningAssociations } from '../js/task-planning-model.js';
import { installSearcherElement } from './searcher-element.js';
import { downloadPortableApp } from '../js/portable-app.js';

class TaskWorkspace extends HTMLElement {
    constructor() {
        super();
        this.repository = new TaskRepository();
        this.tasks = [];
        this.plans = [];
        this.wants = [];
        this.agents = [];
        this.taskEditorTabs = new Map();
        this.planThinkingTabs = new Map();
        this.mainView = 'tasks';
        this.planningSearch = { plans: '', wants: '' };
        this.statusFilter = 'open';
        this.associationFilter = null;
        this.planFilter = null;
        this.search = '';
        this.sortKey = 'default';
        this.sortDir = 'asc';
        this.tablePreferences = { enabled: false, presets: [], selected: null };
        try {
            const saved = JSON.parse(localStorage.getItem('taskimatic-table-preferences') || 'null');
            if (saved) {
                this.tablePreferences.enabled = saved.enabled === true;
                this.tablePreferences.presets = Array.isArray(saved.presets) ? saved.presets.filter(item =>
                    typeof item?.name === 'string' && item.name.trim() && Array.isArray(item.order)
                    && item.order.every(type => typeof type === 'string')).map(item => ({
                        name: cleanString(item.name, 80), order: [...new Set(item.order.map(canonicalType).filter(Boolean))]
                    })) : [];
                this.tablePreferences.selected = this.tablePreferences.presets.some(item => item.name === saved.selected) ? saved.selected : null;
            }
        } catch (error) { /* Preferences are optional when storage is unavailable. */ }
        this.tableTaskId = null;
        this.taskTable = document.createElement('task-table');
        this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
        this.timerTick = null;
        this.lastClockTickAt = 0;
        this.lastMainClockMinute = -1;
        this.lastMainClockDay = '';
        this.mainClockActive = null;
        this.todayStatsCache = { dayKey: '', version: -1, human: 0, agent: 0 };
        this.pipWindow = null;
        this.pipTab = 'open';
        this.pipSearch = '';
        this.pipOnNow = false;
        this.pipClockElements = new Map();
        this.openSessionDetails = new Set();
        this.collapsedAssociationTypes = new Set();
        this.activeDrawer = null;
        this.todayTabDrag = null;
        this.suppressTodayTabClick = false;
        this.todayTabTop = 86;
        try {
            const savedTop = localStorage.getItem('taskimatic-today-tab-top');
            if (savedTop !== null && Number.isFinite(Number(savedTop))) this.todayTabTop = Number(savedTop);
        } catch (error) { /* Position is optional when storage is unavailable. */ }
        this.protectPlan = 'no';
        try {
            const savedPlan = localStorage.getItem('taskimatic-protect-plan');
            if (['no', 'now', 'sprint', 'focus', 'flow'].includes(savedPlan)) this.protectPlan = savedPlan;
        } catch (error) { /* Storage is optional. */ }
        this.protectTaskId = null;
        this.protectIsPaused = false;
        this.protectAccumulatedSeconds = 0;
        this.protectSessionStartedAt = null;
        this.protectTargetSeconds = 1320;
        this.protectTimerInterval = null;
        this.lockInEnabled = false;
        try {
            const savedLockIn = localStorage.getItem('taskimatic-lock-in-enabled');
            this.lockInEnabled = savedLockIn === null ? this.protectPlan !== 'no' : savedLockIn === 'true';
        } catch (error) { /* Storage is optional. */ }
        this.lockInPillPos = null;
        try {
            const savedPillPos = JSON.parse(localStorage.getItem('taskimatic-lock-in-pill-pos') || 'null');
            if (savedPillPos && Number.isFinite(savedPillPos.x) && Number.isFinite(savedPillPos.y)) this.lockInPillPos = savedPillPos;
        } catch (error) { /* Position is optional when storage is unavailable. */ }
        this.lockInPillDrag = null;
        this.suppressLockInPillClick = false;
        this.handleResize = () => {
            this.positionTodayTab(this.todayTabTop);
            this.updateTaskColumns();
            this.positionBrandHelp();
            this.positionLockInPill();
        };
        this.handleClockStateChange = () => this.syncClock();
        this.handleHashChange = () => {
            const association = this.associationFromHash();
            const unchanged = (association?.type ?? null) === (this.associationFilter?.type ?? null)
                && (association?.value ?? null) === (this.associationFilter?.value ?? null);
            if (unchanged) return;
            this.associationFilter = association;
            this.renderAll();
        };
        this.handleGlobalKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (this.protectTaskId && this.querySelector('#protect-modal')?.classList.contains('is-open')) {
                    this.stopProtectModal();
                    return;
                }
                if (this.activeDrawer) {
                    this.closeDrawers();
                }
            }
        };
    }

    connectedCallback() {
        if (this.dataset.mounted) return;
        this.dataset.mounted = 'true';
        this.renderShell();
        const plansNav = this.querySelector('#plans-nav');
        this.plansNavResizeObserver = new ResizeObserver(() => {
            this.style.setProperty('--plans-nav-height', `${plansNav.getBoundingClientRect().height}px`);
        });
        this.plansNavResizeObserver.observe(plansNav);
        this.updateTaskColumns();
        this.bindEvents();
        window.addEventListener('resize', this.handleResize);
        window.addEventListener('focus', this.handleClockStateChange);
        window.addEventListener('blur', this.handleClockStateChange);
        window.addEventListener('hashchange', this.handleHashChange);
        window.addEventListener('keydown', this.handleGlobalKeyDown);
        document.addEventListener('visibilitychange', this.handleClockStateChange);
        this.initialize();
    }

    disconnectedCallback() {
        this.plansNavResizeObserver?.disconnect();
        clearTimeout(this.timerTick);
        if (this.protectTimerInterval) {
            clearInterval(this.protectTimerInterval);
            this.protectTimerInterval = null;
        }
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('focus', this.handleClockStateChange);
        window.removeEventListener('blur', this.handleClockStateChange);
        window.removeEventListener('hashchange', this.handleHashChange);
        window.removeEventListener('keydown', this.handleGlobalKeyDown);
        document.removeEventListener('visibilitychange', this.handleClockStateChange);
    }

    async initialize() {
        await this.repository.init();
        const [tasks, plans, wants, agents] = await Promise.all(WORKSPACE_COLLECTIONS.map(kind => this.repository.all(kind)));
        this.tasks = tasks.map(normalizeTask);
        this.plans = plans.map(record => normalizePlanningRecord('plans', record));
        this.wants = wants.map(record => normalizePlanningRecord('wants', record));
        this.agents = agents.map(normalizeAgent);
        this.associationFilter = this.associationFromHash();
        invalidateDurationCache();
        this.querySelector('backup-tracker').initializeData(WORKSPACE_COLLECTIONS.some(kind => this[kind].length > 0));
        this.querySelector('.storage-state').dataset.mode = this.repository.mode;
        this.querySelector('.storage-label').textContent = this.repository.mode === 'memory' ? t('ui.text.sessionOnly') : this.repository.mode === 'opfs' ? t('ui.text.savedLocallyOPFS') : t('ui.text.savedLocallyIndexedDB');
        this.renderAll();
        this.resolveReady(this);
        document.dispatchEvent(new CustomEvent('taskimatic:ready', { detail: { version: APP_VERSION, storage: this.repository.mode } }));
        this.syncClock();
    }

    hasRunningTimers() {
        return this.tasks.some((task) => TIMER_ACTORS.some((actor) => task.activeTimers?.[actor]));
    }

    isMainFocused() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    isPipFocused() {
        return Boolean(this.pipWindow && !this.pipWindow.closed && this.pipWindow.document.hasFocus());
    }

    syncClock(updateNow = true) {
        clearTimeout(this.timerTick);
        this.timerTick = null;
        const mainFocused = this.isMainFocused();
        if (mainFocused !== this.mainClockActive) {
            this.mainClockActive = mainFocused;
            this.querySelectorAll('task-item').forEach((item) => item.toggleAttribute('clock-active', mainFocused));
        }
        if (!this.isConnected || (!mainFocused && !this.isPipFocused())) return;

        const now = Date.now();
        if (updateNow && now - this.lastClockTickAt >= 1000) this.clockTick(now);
        const interval = this.hasRunningTimers() ? 1000 : 60000;
        const elapsed = Date.now() - this.lastClockTickAt;
        const delay = this.lastClockTickAt ? Math.max(50, interval - elapsed) : interval;
        this.timerTick = setTimeout(() => {
            this.timerTick = null;
            if (!this.isMainFocused() && !this.isPipFocused()) return;
            this.clockTick(Date.now());
            this.syncClock(false);
        }, delay);
    }

    clockTick(now = Date.now()) {
        this.lastClockTickAt = now;
        const hasRunningTimers = this.hasRunningTimers();
        if (this.isMainFocused()) {
            const { key: dayKey } = currentDay(now);
            const minute = Math.floor(now / 60000);
            const minuteChanged = minute !== this.lastMainClockMinute;
            const dayChanged = dayKey !== this.lastMainClockDay;
            const selector = minuteChanged ? 'task-item' : 'task-item[data-running="true"]';
            this.querySelectorAll(selector).forEach((item) => item.updateClock(now));
            if (hasRunningTimers || dayChanged) this.renderStats(now);
            if ((hasRunningTimers && minuteChanged) || dayChanged) {
                this.querySelector('task-visualization').tasks = this.tasks;
            }
            if (dayChanged) {
                const today = new Date(now);
                const dateStamp = this.querySelector('.date-stamp');
                if (dateStamp?.dataset.day !== dayKey) {
                    dateStamp.replaceChildren(
                        today.toLocaleDateString(window.i18n.currentLang, { weekday: 'long' }),
                        document.createElement('br'),
                        today.toLocaleDateString(window.i18n.currentLang, { month: 'long', day: 'numeric', year: 'numeric' })
                    );
                    dateStamp.dataset.day = dayKey;
                }
            }
            this.lastMainClockMinute = minute;
            this.lastMainClockDay = dayKey;
        }
        if (this.isPipFocused()) this.updatePipClocks(now);
    }

    renderShell() {
        const today = new Date();
        const dayKey = currentDay(today.getTime()).key;
        this.innerHTML = `
            <header class="topbar">
                <div class="brand">
                    <button type="button" class="brand-mark" popovertarget="brand-help" aria-label="${escapeHTML(t('ui.text.helpAndContactTaskimatic'))}" title="${escapeHTML(t('ui.text.questions'))}">${escapeHTML(t('ui.text.t'))}</button>
                    <div class="brand-help" id="brand-help" popover aria-label="${escapeHTML(t('ui.text.helpAndContact'))}">
                        <p><strong>${escapeHTML(t('ui.text.questionProblemSuggestion'))}</strong><br>
                        ${escapeHTML(t('ui.text.email'))} <a href="mailto:bot@taskimatic.com">${escapeHTML(t('ui.text.botTaskimaticCom'))}</a></p>
                        <p>${escapeHTML(t('ui.text.weHopeTaskimaticHelpsYouGetMoreDone'))}</p>
                        <small><a href="https://mentic.com" target="_blank">${escapeHTML(t('ui.text.broughtYouByMENTICCognitiveSystems'))}</a></small>
                    </div>
                    <div><div class="brand-name">${escapeHTML(t('ui.text.taskimatic'))}</div><div class="brand-sub">${escapeHTML(t('ui.text.localWorkLedger'))}</div></div>
                </div>
                <div class="top-actions">
                    <div class="storage-state" data-mode="indexeddb" title="${escapeHTML(t('ui.text.yourWorkspaceIsStoredInThisBrowser'))}">
                        <span class="storage-dot"></span><span class="storage-label">${escapeHTML(t('ui.text.openingStorage'))}</span>
                    </div>
                    <backup-tracker storage-key="taskimatic:backuptracker" change-event="taskimatic:change">
                        <button slot="before-button" class="pip-action" type="button" aria-pressed="false" title="${escapeHTML(t('ui.text.openAnAlwaysOnTopTaskWindow'))}">${escapeHTML(t('ui.text.miniMe'))}</button>
                        <button slot="action" data-backup-action class="export-action" type="button">${escapeHTML(t('ui.text.exportData'))}</button>

                    </backup-tracker>
                    <button class="import-action desktop-action" type="button">${escapeHTML(t('ui.text.import'))}</button>
                    <button class="download-action primary" type="button">${escapeHTML(t('ui.text.downloadApp'))}</button>
                    <input class="import-input" type="file" accept="application/json,.json" hidden aria-label="${escapeHTML(t('ui.text.importTaskData'))}">
                    <select class="language-picker" aria-label="${escapeHTML(t('ui.text.language'))}">
                        ${window.i18n.getAvailableLanguages().map(lang => `<option value="${escapeHTML(lang)}" ${lang === window.i18n.currentLang ? 'selected' : ''}>${escapeHTML(window.i18n.languages[lang].Lang)}</option>`).join('')}
                    </select>
                </div>
            </header>
            <div class="app-grid">
                <aside class="rail" aria-label="${escapeHTML(t('ui.text.taskViewsAndAssociations'))}">
                    <div class="rail-sticky">
                        <div class="eyebrow rail-eyebrow">${escapeHTML(t('ui.text.views'))}</div>
                        <nav class="nav-list" aria-label="${escapeHTML(t('ui.text.taskViews'))}">
                            <button class="nav-button active" type="button" data-status="open"><span>${escapeHTML(t('ui.text.active'))}</span><span class="nav-count" data-count="open">0</span></button>
                            <button class="nav-button" type="button" data-status="tabled"><span>${escapeHTML(t('ui.text.tabled'))}</span><span class="nav-count" data-count="tabled">0</span></button>
                            <button class="nav-button" type="button" data-status="all"><span>${escapeHTML(t('ui.text.allTasks'))}</span><span class="nav-count" data-count="all">0</span></button>
                            <button class="nav-button" type="button" data-status="done"><span>${escapeHTML(t('ui.text.completed'))}</span><span class="nav-count" data-count="done">0</span></button>
                        </nav>
                        <details class="association-group plans-nav" id="plans-nav" open>
                            <summary class="association-summary" aria-label="${escapeHTML(t('ui.text.togglePlansList'))}">
                                <div class="association-summary-left">
                                    <span class="association-caret" aria-hidden="true">▶</span>
                                    <span class="association-type-label">${escapeHTML(t('ui.text.plans'))}</span>
                                </div>
                                <span class="nav-count" data-plans-count>0</span>
                            </summary>
                            <div class="association-tree-children plans-list" role="group" aria-label="${escapeHTML(t('ui.text.plans'))}"></div>
                        </details>
                        <hr class="rail-rule">
                        <div class="association-drawer" id="associations-drawer">
                            <div class="drawer-header">
                                <div class="eyebrow">${escapeHTML(t('ui.text.associations'))}</div>
                                <button type="button" class="drawer-close" id="associations-close" aria-label="${escapeHTML(t('ui.text.closeAssociations'))}">✕</button>
                            </div>
                            <div class="association-nav" role="tree" aria-label="${escapeHTML(t('ui.text.taskAssociationsTree'))}"></div>
                        </div>
                    </div>
                </aside>
                <main class="main-column">
                    <nav class="workspace-tabs" role="tablist" aria-label="${escapeHTML(t('ui.text.workspace'))}">
                        ${['tasks', 'plans', 'wants'].map((kind, index) => `<button class="workspace-tab" id="${kind}-tab" type="button" role="tab" aria-controls="${kind}-view" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}" data-view="${kind}">${escapeHTML(uiLabel(kind, true))}<span class="nav-count" data-workspace-count="${kind}">0</span></button>`).join('')}
                    </nav>
                    <section id="tasks-view" role="tabpanel" aria-labelledby="tasks-tab">
                    <div class="welcome-row">
                        <div><div class="eyebrow">${escapeHTML(t('ui.text.yourWorkbench'))}</div><h1>${escapeHTML(t('ui.text.whatNeedsDoing'))}</h1></div>
                        <div class="date-stamp" data-day="${dayKey}">${today.toLocaleDateString(window.i18n.currentLang, { weekday: 'long' })}<br>${today.toLocaleDateString(window.i18n.currentLang, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <section class="capture-card" aria-label="${escapeHTML(t('ui.text.quickAddTask'))}">
                        <form class="capture-form">
                            <input class="capture-input" name="task" maxlength="1000" autocomplete="off" placeholder="${escapeHTML(t('ui.text.addATaskAndPressEnter'))}" aria-label="${escapeHTML(t('ui.text.newTaskText'))}">
                            <button class="add-button" type="submit">${escapeHTML(t('ui.text.addTask'))} <span aria-hidden="true">↵</span></button>
                        </form>
                        <div class="capture-help">${escapeHTML(t('ui.text.tagAsYouType'))} <code>${escapeHTML(t('ui.text.projectWebsite'))}</code> <code>${escapeHTML(t('ui.text.clientNorthWind'))}</code></div>
                    </section>
                    <div class="list-toolbar">
                        <div class="list-heading"><h2>${escapeHTML(t('ui.text.activeTasks'))}</h2><span class="list-count">${escapeHTML(t('ui.text.0Shown'))}</span><label class="table-toggle"><input class="table-checkbox" type="checkbox"> ${escapeHTML(t('ui.text.table2'))}</label><button class="hierarchy-button" type="button" aria-haspopup="dialog" hidden>${escapeHTML(t('ui.text.hierarchy'))}</button></div>
                        <div class="list-toolbar-right">
                            <task-sort-controls class="main-sort" aria-label="${escapeHTML(t('ui.text.sortMainTaskList'))}"></task-sort-controls>
                            <searcher-element on-now-filter class="task-search" aria-label="${escapeHTML(t('ui.text.searchTasks'))}"></searcher-element>
                        </div>
                    </div>
                    <div class="active-filter" hidden><span></span><button type="button">${escapeHTML(t('ui.text.clearGrouping'))}</button></div>
                    <section class="task-list" aria-live="polite"></section>
                    </section>
                    ${['plans', 'wants'].map(kind => `
                        <section id="${kind}-view" role="tabpanel" aria-labelledby="${kind}-tab" hidden>
                            <div class="welcome-row"><div><div class="eyebrow">${kind === 'plans' ? t('ui.text.fromThinkingToDoing') : t('ui.text.roomForPossibilities')}</div><h1>${kind === 'plans' ? t('ui.text.shapeAPlan') : t('ui.text.whatWouldYouLikeToHaveOrAchieve')}</h1></div></div>
                            <p class="planning-help">${kind === 'plans' ? t('ui.text.developYourApproachAndLinkTheTasksThatMakeItHappenAssociationsOnThoseTasksRollUpIntoT') : t('ui.text.captureVagueDesiresAndAspirationsThenTurnThemIntoPlansWhenTheyTakeShape')}</p>
                            <section class="capture-card"><form class="planning-capture capture-form" data-kind="${kind}"><input class="capture-input" maxlength="1000" aria-label="${escapeHTML(t('ui.text.newValue6Title', { value6: uiLabel(kind === 'plans' ? 'plan' : 'want') }))}" placeholder="${kind === 'plans' ? t('ui.text.giveYourPlanAName') : t('ui.text.captureADesireOrAspiration')}" required><button class="add-button" type="submit">${escapeHTML(t('ui.text.addValue8', { value8: uiLabel(kind === 'plans' ? 'plan' : 'want') }))}</button></form></section>
                            <div class="planning-search"><input type="search" data-planning-search="${kind}" aria-label="${escapeHTML(t('ui.text.searchValue10', { value10: uiLabel(kind) }))}" placeholder="${escapeHTML(t('ui.text.searchValue11ThinkingAndAssociations', { value11: uiLabel(kind) }))}"></div>
                            <div class="active-filter planning-filter" data-kind="${kind}" hidden><span></span><button type="button" data-clear-planning-filter>${escapeHTML(t('ui.text.clearGrouping'))}</button></div>
                            <section class="planning-list" data-kind="${kind}" aria-live="polite"></section>
                        </section>
                    `).join('')}
                </main>
                <aside class="insights-column" id="insights-drawer" aria-label="${escapeHTML(t('ui.text.workAnalytics'))}">
                    <div class="insights-sticky">
                    <section class="stats-row" aria-label="${escapeHTML(t('ui.text.taskSummary'))}">
                        <div class="stat"><span class="eyebrow">${escapeHTML(t('ui.text.humanTime'))}</span><span class="stat-value" data-stat="human-today">${escapeHTML(t('ui.text.0s'))}</span></div>
                        <div class="stat"><span class="eyebrow">${escapeHTML(t('ui.text.agentTime'))}</span><span class="stat-value" data-stat="agent-today">${escapeHTML(t('ui.text.0s'))}</span></div>
                        <div class="stat"><span class="eyebrow">${escapeHTML(t('ui.text.openTasks'))}</span><span class="stat-value" data-stat="open">0</span></div>
                    </section>
                        <div class="insights-heading">
                            <h2>${escapeHTML(t('ui.text.workComposition'))}</h2>
                            <div class="insights-heading-right">
                                <span class="live-label">${escapeHTML(t('ui.text.live'))}</span>
                                <button type="button" class="drawer-close" id="insights-close" aria-label="${escapeHTML(t('ui.text.closeWorkComposition'))}">✕</button>
                            </div>
                        </div>
                        <task-visualization></task-visualization>
                        <div class="portable-card"><strong>${escapeHTML(t('ui.text.thePageIsTheApp'))}</strong><p>${escapeHTML(t('ui.text.downloadAWorkingHTMLCopyWithYourWantsPlansAndTasksEmbeddedEditsStayPrivateInThisBrows'))}</p></div>
                    </div>
                </aside>
            </div>
            <aside class="today-drawer" id="today-drawer" tabindex="-1" aria-labelledby="today-heading" aria-hidden="true" inert>
                <div class="drawer-header">
                    <div class="list-heading"><h2 id="today-heading">${escapeHTML(t('ui.text.today'))}</h2><span class="today-count list-count">${escapeHTML(t('ui.text.0Tasks'))}</span></div>
                    <button type="button" class="drawer-close" id="today-close" aria-label="${escapeHTML(t('ui.text.closeToday'))}">✕</button>
                </div>
                <lock-in-controls></lock-in-controls>
                <p class="today-lock" id="today-lock" role="status" hidden>${escapeHTML(t('ui.text.humanTimerRunningStopItToCloseToday'))}</p>
                <task-sort-controls class="today-sort" aria-label="${escapeHTML(t('ui.text.sortTodayTasks'))}"></task-sort-controls>
                <section class="today-task-list" aria-label="${escapeHTML(t('ui.text.todayTasks'))}" aria-live="polite"></section>
            </aside>
            <button type="button" class="panel-grab-tab today-tab" id="today-tab" aria-label="${escapeHTML(t('ui.text.toggleTodayPanel'))}" aria-controls="today-drawer" aria-describedby="today-lock" aria-expanded="false" title="${escapeHTML(t('ui.text.todayDragUpOrDownToMoveArrowKeysAlsoMoveTheTab'))}">
                <span class="tab-text">${escapeHTML(t('ui.text.today'))}</span>
            </button>
            <button type="button" class="lock-in-pill" id="lock-in-pill" aria-pressed="false">${escapeHTML(t('ui.text.lockIn3'))} <span class="lock-in-emoji">🔓</span></button>
            <button type="button" class="panel-grab-tab left-tab" id="associations-tab" aria-label="${escapeHTML(t('ui.text.toggleAssociationsPanel'))}" aria-expanded="false" title="${escapeHTML(t('ui.text.associations'))}">
                <span class="tab-text">${escapeHTML(t('ui.text.associations'))}</span>
            </button>
            <button type="button" class="panel-grab-tab right-tab" id="insights-tab" aria-label="${escapeHTML(t('ui.text.toggleAnalyticsPanel'))}" aria-expanded="false" title="${escapeHTML(t('ui.text.analytics'))}">
                <span class="tab-text">${escapeHTML(t('ui.text.analytics'))}</span>
            </button>
            <div class="drawer-scrim" id="drawer-scrim" aria-hidden="true"></div>
            <div class="protect-modal" id="protect-modal" role="dialog" aria-modal="true" aria-labelledby="protect-modal-task" aria-hidden="true" inert tabindex="-1">
                <div class="protect-modal-content">
                    <form class="protect-new-task">
                        <label for="protect-new-task-text">${escapeHTML(t('ui.text.newTask'))}</label>
                        <div class="protect-new-task-row">
                            <input id="protect-new-task-text" name="text" maxlength="1000" placeholder="${escapeHTML(t('ui.text.captureANewTask'))}" required>
                            <button type="submit" class="protect-btn protect-btn-secondary">${escapeHTML(t('ui.text.addTask2'))}</button>
                        </div>
                        <p class="protect-form-status" role="status"></p>
                    </form>
                    <h2 class="protect-modal-task" id="protect-modal-task"></h2>
                    <div class="protect-donut-wrapper">
                        <svg class="protect-donut-svg" viewBox="0 0 320 320" width="320" height="320" aria-hidden="true">
                            <circle class="protect-donut-bg" cx="160" cy="160" r="130" fill="none" stroke="rgba(255, 253, 247, 0.12)" stroke-width="14" />
                            <circle class="protect-donut-arc" cx="160" cy="160" r="130" fill="none" stroke="var(--accent, #D00E00)" stroke-width="14" stroke-linecap="round" stroke-dasharray="816.814" stroke-dashoffset="816.814" transform="rotate(-90 160 160)" />
                        </svg>
                        <div class="protect-modal-center">
                            <div class="protect-modal-time">22:00</div>
                            <div class="protect-modal-plan-label">${escapeHTML(t('ui.text.sprint22min'))}</div>
                        </div>
                    </div>
                    <div class="protect-modal-actions">
                        <button type="button" class="protect-btn protect-btn-pause">${escapeHTML(t('ui.text.pause'))}</button>
                        <button type="button" class="protect-btn protect-btn-stop">${escapeHTML(t('ui.text.stop'))}</button>
                    </div>
                    <form class="protect-notes-form">
                        <label for="protect-task-notes">${escapeHTML(t('ui.text.taskNotesChangesAreEphemeralPressSaveToKeepThem'))}</label>
                        <textarea id="protect-task-notes" maxlength="10000"></textarea>
                        <button type="submit" class="protect-btn protect-btn-secondary">${escapeHTML(t('ui.text.save'))}</button>
                        <p class="protect-form-status" role="status"></p>
                    </form>
                </div>
            </div>
            <div class="toast-region" role="status" aria-live="polite"></div>
            <task-hierarchy-editor></task-hierarchy-editor>
            <dialog class="agent-manager" id="agent-manager" aria-labelledby="agent-manager-title">
                <h2 id="agent-manager-title">${escapeHTML(t('ui.text.namedAgents'))}</h2>
                <p>${escapeHTML(t('ui.text.agentNamesAreSharedAcrossAllTasksAnAgentCanBeDeletedWhenNoTasksAreAssignedToIt'))}</p>
                <form class="global-agent-form"><input class="global-agent-name" maxlength="120" aria-label="${escapeHTML(t('ui.text.agentName'))}" placeholder="${escapeHTML(t('ui.text.addANamedAgent'))}" required><button type="submit">${escapeHTML(t('ui.text.add'))}</button></form>
                <p class="agent-error" role="status"></p>
                <div class="agent-list"></div>
                <button type="button" id="agent-manager-close">${escapeHTML(t('ui.text.close'))}</button>
            </dialog>
        `;
    }

    bindAgentEvents() {
        this.addEventListener('task-editor-tab-change', event => {
            const { id, tab } = event.detail;
            this.taskEditorTabs.set(id, tab);
            this.querySelectorAll('task-item').forEach(item => { if (item.dataset.taskId === id) item.editorTab = tab; });
        });
        this.addEventListener('task-estimate-change', event => this.updateTask(event.detail.id, { estimatedMinutes: event.detail.estimatedMinutes }, { quiet: true, source: event.target }));
        this.addEventListener('task-prompts-change', event => this.updateTask(event.detail.id, { prompts: event.detail.prompts }, { quiet: true, source: event.target }));
        this.addEventListener('task-agent-change', event => this.updateTask(event.detail.id, { agentId: event.detail.agentId }));
        this.addEventListener('task-agent-create', async event => {
            try {
                const agent = await this.createAgent({ name: event.detail.name });
                await this.updateTask(event.detail.id, { agentId: agent.id });
            } catch (error) { this.toast(error.message); }
        });
        this.addEventListener('task-agents-manage', () => {
            this.renderAgents();
            this.querySelector('#agent-manager').showModal();
        });
        this.querySelector('#agent-manager-close').addEventListener('click', () => this.querySelector('#agent-manager').close());
        this.querySelector('.global-agent-form').addEventListener('submit', async event => {
            event.preventDefault();
            const input = this.querySelector('.global-agent-name');
            try {
                await this.createAgent({ name: input.value });
                input.value = '';
                input.focus();
            } catch (error) { this.querySelector('.agent-error').textContent = error.message; }
        });
    }

    renderAgents() {
        const list = this.querySelector('.agent-list');
        list.replaceChildren();
        this.querySelector('.agent-error').textContent = '';
        for (const agent of [...this.agents].sort((a, b) => a.name.localeCompare(b.name))) {
            const count = agentTaskReferences(this.tasks, agent.id).length;
            const row = document.createElement('div');
            row.className = 'agent-row';
            row.dataset.agentId = agent.id;
            const name = document.createElement('strong');
            name.textContent = agent.name;
            const usage = document.createElement('span');
            usage.textContent = `${count} ${uiLabel(count === 1 ? 'task' : 'tasks')}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = t('ui.text.delete');
            remove.disabled = count > 0;
            remove.title = count > 0 ? t('ui.text.unassignThisAgentFromItsTasksBeforeDeletingIt') : t('ui.text.deleteValue0', { value0: agent.name });
            remove.setAttribute('aria-label', t('ui.text.deleteValue0', { value0: agent.name }));
            remove.addEventListener('click', async () => {
                try { await this.deleteAgent(agent.id); }
                catch (error) { this.querySelector('.agent-error').textContent = error.message; }
            });
            row.append(name, usage, remove);
            list.append(row);
        }
        if (!this.agents.length) {
            const empty = document.createElement('p');
            empty.textContent = t('ui.text.addAnAgentNameHereOrFromATaskSDropdown');
            list.append(empty);
        }
    }

    async createAgent(input) {
        const record = normalizeAgent(typeof input === 'string' ? { name: input } : input);
        if (!record.name) throw new Error(t('error.messages.anAgentNameIsRequired'));
        if (this.agents.some(agent => agent.id === record.id)) throw new Error(t('error.messages.agentAlreadyExistsValue0', { value0: record.id }));
        const existing = this.agents.find(agent => agent.name.toLowerCase() === record.name.toLowerCase());
        if (existing) return cloneValue(existing);
        await this.repository.put(record, 'agents');
        this.agents.push(record);
        this.renderAll();
        this.emitChange('agent-created', record);
        return cloneValue(record);
    }

    async deleteAgent(id) {
        const agent = this.agents.find(agent => agent.id === id);
        if (!agent) throw new Error(t('error.messages.agentNotFoundValue0', { value0: id }));
        const references = agentTaskReferences(this.tasks, id);
        if (references.length) throw new Error(t('error.messages.cannotDeleteValue0Value1Value2StillAssigned', { value0: agent.name, value1: references.length, value2: t(references.length === 1 ? 'ui.text.assignedTaskIs' : 'ui.text.assignedTasksAre') }));
        await this.repository.delete(id, 'agents');
        this.agents = this.agents.filter(agent => agent.id !== id);
        this.renderAll();
        this.emitChange('agent-deleted', agent);
        return { id, deleted: true };
    }

    setMainView(kind, focus = false) {
        if (!['tasks', 'plans', 'wants'].includes(kind)) return;
        this.mainView = kind;
        for (const view of ['tasks', 'plans', 'wants']) {
            const active = view === kind;
            const tab = this.querySelector(`#${view}-tab`);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            this.querySelector(`#${view}-view`).hidden = !active;
            if (active && focus) tab.focus();
        }
        this.renderAssociations();
        this.renderPlanning();
    }

    bindPlanningEvents() {
        const kinds = ['tasks', 'plans', 'wants'];
        this.querySelectorAll('.workspace-tab').forEach(tab => {
            tab.addEventListener('click', () => this.setMainView(tab.dataset.view));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = kinds.indexOf(tab.dataset.view);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
                    : (index + (event.key === 'ArrowLeft' ? 2 : 1)) % 3;
                this.setMainView(kinds[next], true);
            });
        });
        this.querySelectorAll('.planning-capture').forEach(form => form.addEventListener('submit', async event => {
            event.preventDefault();
            const input = form.querySelector('input');
            const parsed = parseQuickTask(input.value);
            if (!parsed.text) return;
            await this.createPlanning(form.dataset.kind, parsed);
            input.value = '';
            input.focus();
        }));
        this.querySelectorAll('[data-planning-search]').forEach(input => input.addEventListener('input', () => {
            this.planningSearch[input.dataset.planningSearch] = input.value.toLowerCase();
            this.renderPlanning();
        }));
        this.querySelectorAll('[data-clear-planning-filter]').forEach(button => button.addEventListener('click', () => this.setAssociationFilter(null)));
        this.addEventListener('task-plan-change', event => this.updateTask(event.detail.id, { planId: event.detail.planId }));
        this.addEventListener('planning-thinking-tab-change', event => this.planThinkingTabs.set(event.detail.id, event.detail.tab));
        this.addEventListener('planning-update', event => this.updatePlanning(event.detail.kind, event.detail.id, event.detail.patch, { quiet: event.detail.quiet, source: event.target }));
        this.addEventListener('planning-delete', event => this.deletePlanning(event.detail.kind, event.detail.id));
        this.addEventListener('planning-association-add', event => {
            const { kind, id, association } = event.detail;
            const record = this[kind].find(record => record.id === id);
            this.updatePlanning(kind, id, { associations: normalizeAssociations([...record.associations, association]) });
        });
        this.addEventListener('planning-association-remove', event => {
            const { kind, id, association } = event.detail;
            const record = this[kind].find(record => record.id === id);
            this.updatePlanning(kind, id, { associations: record.associations.filter(item => !(item.type === association.type && item.value.toLowerCase() === association.value.toLowerCase())) });
        });
        this.addEventListener('planning-child-add', event => {
            const { kind, id, input } = event.detail;
            if (kind === 'plans') this.createTask({ ...input, planId: id });
            else this.createPlanning('plans', { ...input, wantId: id });
        });
        this.addEventListener('planning-navigate', event => {
            const { targetKind, targetId } = event.detail;
            if (targetKind === 'tasks') { this.closeDrawers(); this.revealTask(targetId); return; }
            this.associationFilter = null;
            this.updateLocationHash(null);
            this.planningSearch[targetKind] = '';
            this.querySelector(`[data-planning-search="${targetKind}"]`).value = '';
            this.closeDrawers();
            this.setMainView(targetKind);
            this.renderAll();
            const item = [...this.querySelectorAll(`.planning-list[data-kind="${targetKind}"] planning-item`)].find(item => item.dataset.recordId === targetId);
            item?.setAttribute('attention', '');
            item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item?.shadowRoot.querySelector('.text').focus({ preventScroll: true });
            if (item) setTimeout(() => item.removeAttribute('attention'), 1700);
        });
    }

    renderPlanning(source = null) {
        for (const kind of ['plans', 'wants']) {
            const list = this.querySelector(`.planning-list[data-kind="${kind}"]`);
            const records = this.listPlanning(kind, { search: this.planningSearch[kind], association: this.associationFilter });
            const filter = this.querySelector(`.planning-filter[data-kind="${kind}"]`);
            filter.hidden = !this.associationFilter;
            if (this.associationFilter) filter.querySelector('span').textContent = `${this.associationFilter.type}: ${this.associationFilter.value}`;
            const items = records.map(record => {
                if (source?.kind === kind && source.dataset.recordId === record.id) return source;
                const element = document.createElement('planning-item');
                element.setData({
                    kind, record, thinkingTab: this.planThinkingTabs.get(record.id), parents: kind === 'plans' ? this.wants : [],
                    children: kind === 'plans' ? this.tasks.filter(task => task.planId === record.id) : this.plans.filter(plan => plan.wantId === record.id),
                    associations: record.effectiveAssociations,
                    catalog: this.associationCatalogFor()
                });
                return element;
            });
            // Leave the focused editor attached while its debounced save updates other views.
            if (source && list.contains(source) && items.includes(source)) {
                [...list.children].filter(item => item !== source).forEach(item => item.remove());
                items.forEach((item, index) => {
                    const current = list.children[index] || null;
                    if (current !== item) list.insertBefore(item, current);
                });
            } else list.replaceChildren(...items);
            if (!records.length) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                const title = document.createElement('h3');
                title.textContent = this[kind].length ? t('ui.text.noMatches') : kind === 'plans' ? t('ui.text.makeSpaceForAPlan') : t('ui.text.letAnIdeaTakeShape');
                const copy = document.createElement('p');
                copy.textContent = this[kind].length ? t('ui.text.tryAnotherSearchOrAssociation') : kind === 'plans' ? t('ui.text.nameYourPlanAboveExploreItInMyThinkingAndTurnNextStepsIntoLinkedTasks') : t('ui.text.captureAnAspirationAboveItCanGrowIntoPlansWhenYouAreReady');
                empty.append(title, copy);
                list.append(empty);
            }
        }
    }

    listPlanning(kind, query = {}) {
        if (!['plans', 'wants'].includes(kind)) throw new Error(t('error.messages.expectedPlansOrWants'));
        const search = String(query.search || '').toLowerCase();
        const [association] = normalizeAssociations(query.association ? [query.association] : []);
        return cloneValue(this[kind].map(record => ({ ...record, effectiveAssociations: planningAssociations(kind, record, this) }))
            .filter(record => (!query.wantId || record.wantId === query.wantId)
                && (!search || `${record.text} ${record.notes || ''} ${record.myThinking || ''} ${record.aiThinking || ''} ${JSON.stringify(record.effectiveAssociations)}`.toLowerCase().includes(search))
                && (!association || record.effectiveAssociations.some(item => item.type === association.type && item.value.toLowerCase() === association.value.toLowerCase())))
            .sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true })));
    }

    async createPlanning(kind, input) {
        if (!['plans', 'wants'].includes(kind)) throw new Error(t('error.messages.expectedPlansOrWants'));
        const payload = typeof input === 'string' ? { text: input } : input;
        if (!payload || !cleanString(payload.text ?? payload.title ?? payload.name, 1000)) throw new Error(t('error.messages.aTitleIsRequired'));
        const record = normalizePlanningRecord(kind, payload);
        if (this[kind].some(item => item.id === record.id)) throw new Error(t('error.messages.recordAlreadyExistsValue0', { value0: record.id }));
        if (record.wantId && !this.wants.some(want => want.id === record.wantId)) throw new Error(t('error.messages.wantNotFoundValue0', { value0: record.wantId }));
        await this.repository.put(record, kind);
        this[kind].push(record);
        this.renderAll();
        this.emitChange(`${kind === 'plans' ? 'plan' : 'want'}-created`, record);
        return cloneValue(record);
    }

    async updatePlanning(kind, id, patch = {}, options = {}) {
        if (!['plans', 'wants'].includes(kind)) throw new Error(t('error.messages.expectedPlansOrWants'));
        const index = this[kind].findIndex(record => record.id === id);
        if (index < 0) throw new Error(t('error.messages.recordNotFoundValue0', { value0: id }));
        if ('text' in patch && !cleanString(patch.text, 1000)) throw new Error(t('error.messages.aTitleIsRequired'));
        if (kind === 'plans' && 'notes' in patch && !('myThinking' in patch)) patch = { ...patch, myThinking: patch.notes };
        const record = normalizePlanningRecord(kind, { ...this[kind][index], ...patch, id, createdAt: this[kind][index].createdAt, updatedAt: nowISO() });
        if (record.wantId && !this.wants.some(want => want.id === record.wantId)) throw new Error(t('error.messages.wantNotFoundValue0', { value0: record.wantId }));
        await this.repository.put(record, kind);
        this[kind].splice(index, 1, record);
        if (options.quiet) {
            if (options.source) options.source._record = cloneValue(record);
            this.renderPlanning(options.source);
            this.renderAssociations();
            this.querySelectorAll('task-item').forEach(item => {
                item.planCatalog = this.plans;
                const select = item.shadowRoot.querySelector('.plan-select');
                select.replaceChildren(new Option(t('error.messages.noPlan'), ''), ...this.plans.map(plan => new Option(plan.text, plan.id)));
                select.value = item.task.planId || '';
            });
        } else this.renderAll();
        this.emitChange(`${kind === 'plans' ? 'plan' : 'want'}-updated`, record);
        return cloneValue(record);
    }

    async deletePlanning(kind, id) {
        if (!['plans', 'wants'].includes(kind)) throw new Error(t('error.messages.expectedPlansOrWants'));
        const record = this[kind].find(record => record.id === id);
        if (!record) throw new Error(t('error.messages.recordNotFoundValue0', { value0: id }));
        const snapshot = { tasks: this.tasks, plans: this.plans, wants: this.wants, agents: this.agents, [kind]: this[kind].filter(record => record.id !== id) };
        if (kind === 'plans') snapshot.tasks = snapshot.tasks.map(task => task.planId === id ? { ...task, planId: null, updatedAt: nowISO() } : task);
        else snapshot.plans = snapshot.plans.map(plan => plan.wantId === id ? { ...plan, wantId: null, updatedAt: nowISO() } : plan);
        await this.repository.replaceWorkspace(snapshot);
        Object.assign(this, snapshot);
        this.renderAll();
        this.emitChange(`${kind === 'plans' ? 'plan' : 'want'}-deleted`, record);
        return { id, deleted: true };
    }

    positionTodayTab(top) {
        const tab = this.querySelector('#today-tab');
        if (!tab) return;
        // Leave room for the mobile tabs along the bottom edge.
        const bottomSpace = window.innerWidth <= 820 ? 128 : 8;
        const maxTop = Math.max(8, window.innerHeight - tab.offsetHeight - bottomSpace);
        this.todayTabTop = Math.max(8, Math.min(maxTop, top));
        tab.style.top = `${this.todayTabTop}px`;
    }

    saveTodayTabPosition() {
        try { localStorage.setItem('taskimatic-today-tab-top', String(this.todayTabTop)); }
        catch (error) { /* Keep the position for this session when storage is unavailable. */ }
    }

    bindTodayTabDrag() {
        const tab = this.querySelector('#today-tab');
        this.positionTodayTab(this.todayTabTop);
        tab.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary || event.button !== 0) return;
            this.suppressTodayTabClick = false;
            this.todayTabDrag = { pointerId: event.pointerId, startY: event.clientY, startTop: this.todayTabTop, moved: false };
            tab.setPointerCapture(event.pointerId);
        });
        tab.addEventListener('pointermove', (event) => {
            const drag = this.todayTabDrag;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const delta = event.clientY - drag.startY;
            if (Math.abs(delta) >= 4) drag.moved = true;
            if (!drag.moved) return;
            tab.classList.add('is-dragging');
            this.positionTodayTab(drag.startTop + delta);
        });
        const finishDrag = (event) => {
            const drag = this.todayTabDrag;
            if (!drag || drag.pointerId !== event.pointerId) return;
            this.suppressTodayTabClick = drag.moved;
            this.todayTabDrag = null;
            tab.classList.remove('is-dragging');
            if (tab.hasPointerCapture(event.pointerId)) tab.releasePointerCapture(event.pointerId);
            if (drag.moved) this.saveTodayTabPosition();
        };
        tab.addEventListener('pointerup', finishDrag);
        tab.addEventListener('pointercancel', finishDrag);
        tab.addEventListener('lostpointercapture', finishDrag);
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 60 : 20;
            const top = event.key === 'Home' ? 8 : event.key === 'End' ? window.innerHeight
                : this.todayTabTop + (event.key === 'ArrowUp' ? -step : step);
            this.positionTodayTab(top);
            this.saveTodayTabPosition();
        });
    }

    setLockInEnabled(enabled) {
        this.lockInEnabled = Boolean(enabled);
        try { localStorage.setItem('taskimatic-lock-in-enabled', String(this.lockInEnabled)); } catch (error) { /* Storage is optional. */ }
        this.updateLockInPill();
    }

    updateLockInPill() {
        const pills = [this.querySelector('#lock-in-pill')];
        if (this.pipWindow && !this.pipWindow.closed) pills.push(this.pipWindow.document.querySelector('#lock-in-pill'));
        for (const pill of pills.filter(Boolean)) {
            pill.innerHTML = `${escapeHTML(t('ui.text.lockInValue0', { value0: this.lockInEnabled ? '!' : '?' }))} <span class="lock-in-emoji">${this.lockInEnabled ? '🔒' : '🔓'}</span>`;
            pill.classList.toggle('is-locked', this.lockInEnabled);
            pill.setAttribute('aria-pressed', String(this.lockInEnabled));
            pill.title = this.lockInEnabled
                ? t('ui.text.lockInOnHumanTimersOpenTheFocusTimerClickToTurnOffDragToMove')
                : t('ui.text.lockInOffClickToTurnOnDragToMove');
        }
    }

    positionLockInPill(targetWindow = window) {
        const positionKey = targetWindow === window ? 'lockInPillPos' : 'pipLockInPillPos';
        const pill = targetWindow === window ? this.querySelector('#lock-in-pill') : targetWindow.document.querySelector('#lock-in-pill');
        if (!pill) return;
        if (!this[positionKey]) {
            pill.style.left = '';
            pill.style.top = '';
            pill.style.bottom = '';
            return;
        }
        const maxX = Math.max(8, targetWindow.innerWidth - pill.offsetWidth - 8);
        const maxY = Math.max(8, targetWindow.innerHeight - pill.offsetHeight - 8);
        this[positionKey] = {
            x: Math.max(8, Math.min(maxX, this[positionKey].x)),
            y: Math.max(8, Math.min(maxY, this[positionKey].y))
        };
        pill.style.left = `${this[positionKey].x}px`;
        pill.style.top = `${this[positionKey].y}px`;
        pill.style.bottom = 'auto';
    }

    saveLockInPillPosition(targetWindow = window) {
        // Mini Me keeps its own position for the lifetime of the app.
        if (targetWindow !== window) return;
        if (!this.lockInPillPos) return;
        try { localStorage.setItem('taskimatic-lock-in-pill-pos', JSON.stringify(this.lockInPillPos)); }
        catch (error) { /* Keep the position for this session when storage is unavailable. */ }
    }

    bindLockInPill(targetWindow = window) {
        const positionKey = targetWindow === window ? 'lockInPillPos' : 'pipLockInPillPos';
        const dragKey = targetWindow === window ? 'lockInPillDrag' : 'pipLockInPillDrag';
        const suppressKey = targetWindow === window ? 'suppressLockInPillClick' : 'suppressPipLockInPillClick';
        const pill = targetWindow === window ? this.querySelector('#lock-in-pill') : targetWindow.document.querySelector('#lock-in-pill');
        if (!pill) return;
        this.positionLockInPill(targetWindow);
        this.updateLockInPill();
        pill.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary || event.button !== 0) return;
            this[suppressKey] = false;
            const rect = pill.getBoundingClientRect();
            this[dragKey] = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPos: { x: rect.left, y: rect.top }, moved: false };
            pill.setPointerCapture(event.pointerId);
        });
        pill.addEventListener('pointermove', (event) => {
            const drag = this[dragKey];
            if (!drag || drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - drag.startX;
            const deltaY = event.clientY - drag.startY;
            if (Math.abs(deltaX) + Math.abs(deltaY) >= 4) drag.moved = true;
            if (!drag.moved) return;
            pill.classList.add('is-dragging');
            this[positionKey] = { x: drag.startPos.x + deltaX, y: drag.startPos.y + deltaY };
            this.positionLockInPill(targetWindow);
        });
        const finishDrag = (event) => {
            const drag = this[dragKey];
            if (!drag || drag.pointerId !== event.pointerId) return;
            this[suppressKey] = drag.moved;
            this[dragKey] = null;
            pill.classList.remove('is-dragging');
            if (pill.hasPointerCapture(event.pointerId)) pill.releasePointerCapture(event.pointerId);
            if (drag.moved) this.saveLockInPillPosition(targetWindow);
        };
        pill.addEventListener('pointerup', finishDrag);
        pill.addEventListener('pointercancel', finishDrag);
        pill.addEventListener('lostpointercapture', finishDrag);
        pill.addEventListener('keydown', (event) => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 60 : 20;
            const rect = pill.getBoundingClientRect();
            const current = this[positionKey] || { x: rect.left, y: rect.top };
            this[positionKey] = {
                x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
                y: current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
            };
            this.positionLockInPill(targetWindow);
            this.saveLockInPillPosition(targetWindow);
        });
    }

    isTodayLocked() {
        return this.tasks.some(task => task.today && Boolean(task.activeTimers?.human));
    }

    syncTodayDrawer() {
        const locked = this.isTodayLocked();
        const close = this.querySelector('#today-close');
        close.disabled = locked;
        close.title = locked ? t('ui.text.stopTheTodayTaskSHumanTimerToCloseThisPanel') : t('ui.text.closeToday');
        this.querySelector('#today-lock').hidden = !locked;
        if (locked && this.activeDrawer !== 'today') this.openDrawer('today');
    }

    toggleDrawer(drawerName) {
        if (this.activeDrawer === drawerName) {
            this.closeDrawers();
        } else {
            this.openDrawer(drawerName);
        }
    }

    openDrawer(drawerName) {
        if (this.isTodayLocked() && drawerName !== 'today') return false;
        this.activeDrawer = drawerName;
        for (const name of ['associations', 'insights', 'today']) {
            const drawer = this.querySelector(`#${name}-drawer`);
            const tab = this.querySelector(`#${name}-tab`);
            const open = drawerName === name;
            drawer?.classList.toggle('is-open', open);
            tab?.setAttribute('aria-expanded', String(open));
            tab?.classList.toggle('active', open);
            if (name === 'today' && drawer) {
                drawer.inert = !open;
                drawer.setAttribute('aria-hidden', String(!open));
                if (open) {
                    const close = this.querySelector('#today-close');
                    (close.disabled ? drawer : close).focus({ preventScroll: true });
                }
            }
        }
        this.querySelector('#drawer-scrim')?.classList.toggle('is-active', Boolean(drawerName));
        return true;
    }

    closeDrawers() {
        const previous = this.activeDrawer;
        if (!this.openDrawer(null)) return;
        this.querySelector(`#${previous}-tab`)?.focus({ preventScroll: true });
    }

    positionBrandHelp() {
        const bubble = this.querySelector('#brand-help');
        const mark = this.querySelector('.brand-mark');
        if (!bubble || !mark) return;
        const bounds = mark.getBoundingClientRect();
        const width = Math.min(330, window.innerWidth - 32);
        bubble.style.left = `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`;
        bubble.style.top = `${bounds.bottom + 14}px`;
    }

    bindEvents() {
        this.querySelector('.language-picker').addEventListener('change', async event => {
            const picker = event.currentTarget;
            picker.disabled = true;
            try {
                if (!await window.i18n.setLanguage(picker.value)) return;
                // Reload the shell so generated text, shadow DOM, and charts share one locale.
                const url = new URL(location.href);
                url.searchParams.set('lang', window.i18n.currentLang);
                location.assign(url.href);
            } catch (error) {
                picker.value = window.i18n.currentLang;
                this.toast(error.message);
            } finally { picker.disabled = false; }
        });
        this.querySelector('#brand-help').addEventListener('beforetoggle', (event) => {
            if (event.newState === 'open') this.positionBrandHelp();
        });
        this.bindPlanningEvents();
        this.bindAgentEvents();
        this.querySelector('.table-checkbox').checked = this.tablePreferences.enabled;
        this.querySelector('.table-checkbox').addEventListener('change', event => {
            this.tablePreferences.enabled = event.target.checked;
            this.tableTaskId = null;
            this.saveTablePreferences();
            this.renderTasks();
        });
        this.querySelector('.hierarchy-button').addEventListener('click', () => {
            this.querySelector('task-hierarchy-editor').show({ tasks: this.filteredTasks(), ...this.tablePreferences });
        });
        this.addEventListener('task-hierarchy-change', event => {
            Object.assign(this.tablePreferences, event.detail);
            this.saveTablePreferences();
            this.renderTasks();
        });
        this.addEventListener('task-table-open', event => {
            this.tableTaskId = event.detail.id;
            this.tableScrollY = window.scrollY;
            this.renderTasks();
            this.querySelector('task-item[table-detail]')?.shadowRoot.querySelector('.text')?.focus({ preventScroll: true });
        });
        this.addEventListener('task-table-back', () => {
            const id = this.tableTaskId;
            this.tableTaskId = null;
            this.renderTasks();
            this.taskTable.focusTask(id);
            window.scrollTo({ top: this.tableScrollY ?? window.scrollY, behavior: 'instant' });
        });
        this.addEventListener('task-table-filter', event => {
            this.tableTaskId = null;
            this.setAssociationFilter(event.detail);
        });
        this.querySelector('.capture-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const input = this.querySelector('.capture-input');
            const parsed = parseQuickTask(input.value);
            if (!parsed.text) { input.focus(); return; }
            if (this.associationFilter && !this.associationFilter.values && !(this.associationFilter.chartSelection && this.associationFilter.value === 'Unassigned') && !parsed.associations.some((item) => item.type === this.associationFilter.type && item.value === this.associationFilter.value)) {
                parsed.associations.push(cloneValue(this.associationFilter));
            }
            if (this.planFilter) parsed.planId = this.planFilter;
            await this.createTask(parsed);
            input.value = '';
            input.focus();
        });

        this.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => {
            this.tableTaskId = null;
            this.setMainView('tasks');
            this.statusFilter = button.dataset.status;
            this.querySelectorAll('.nav-button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
            this.renderTasks();
        }));
        this.querySelector('.task-search').addEventListener('searcher:on-now', (event) => { this.onNow = event.detail.active; this.renderTasks(); });
        this.querySelector('.task-search').addEventListener('searcher:input', (event) => { this.search = event.detail.query.toLowerCase(); this.renderTasks(); });
        this.querySelector('.task-search').addEventListener('searcher:search', (event) => { this.search = event.detail.query.toLowerCase(); this.renderTasks(); });
        this.querySelector('.main-sort').addEventListener('task-sort-change', (event) => {
            this.sortKey = event.detail.sortKey;
            this.sortDir = event.detail.sortDir;
            this.renderTasks();
        });
        this.querySelector('.today-sort').addEventListener('task-sort-change', () => this.renderTodayTasks());

        // Lock In toggles and modal
        this.querySelector('lock-in-controls').addEventListener('lock-in:change', event => {
            this.setProtectPlan(event.detail.plan);
        });
        this.updateProtectPlanButtons();

        this.bindProtectModal(this.querySelector('#protect-modal'));
        this.querySelector('.active-filter button').addEventListener('click', () => { this.planFilter = null; this.setAssociationFilter(null); });
        this.querySelector('.pip-action').addEventListener('click', () => this.openPipWindow());
        this.querySelector('backup-tracker').addEventListener('backup-request', async () => {
            await this.ready;
            this.downloadData();
        });
        this.querySelector('.download-action').addEventListener('click', () => this.downloadApp());
        this.querySelector('.import-action').addEventListener('click', () => this.querySelector('.import-input').click());
        this.querySelector('.import-input').addEventListener('change', async (event) => {
            const [file] = event.target.files;
            if (!file) return;
            try {
                await this.importData(await file.text(), { strategy: 'merge' });
                this.toast(t('ui.text.importedTasksFromValue0', { value0: file.name }));
            } catch (error) {
                this.toast(t('ui.text.importFailedValue0', { value0: error.message }));
            } finally { event.target.value = ''; }
        });

        // Drawer interactions
        this.bindTodayTabDrag();
        this.bindLockInPill();
        this.querySelector('#lock-in-pill').addEventListener('click', (event) => {
            if (this.suppressLockInPillClick && event.detail !== 0) {
                this.suppressLockInPillClick = false;
                return;
            }
            this.setLockInEnabled(!this.lockInEnabled);
        });
        this.querySelector('#today-tab').addEventListener('click', (event) => {
            if (this.suppressTodayTabClick && event.detail !== 0) {
                this.suppressTodayTabClick = false;
                return;
            }
            this.toggleDrawer('today');
        });
        this.querySelector('#today-close').addEventListener('click', () => this.closeDrawers());
        this.querySelector('#associations-tab')?.addEventListener('click', () => this.toggleDrawer('associations'));
        this.querySelector('#insights-tab')?.addEventListener('click', () => this.toggleDrawer('insights'));
        this.querySelector('#associations-close')?.addEventListener('click', () => this.closeDrawers());
        this.querySelector('#insights-close')?.addEventListener('click', () => this.closeDrawers());
        this.querySelector('#drawer-scrim')?.addEventListener('click', () => this.closeDrawers());

        this.addEventListener('task-text-change', (event) => this.updateTask(event.detail.id, { text: event.detail.text }, { quiet: true, source: event.target }));
        this.addEventListener('task-notes-change', (event) => this.updateTask(event.detail.id, { notes: event.detail.notes }, { quiet: true, source: event.target }));
        this.addEventListener('task-status-toggle', async (event) => {
            const task = this.tasks.find((item) => item.id === event.detail.id);
            if (task) await this.updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' });
        });
        this.addEventListener('task-today-change', (event) => this.updateTask(event.detail.id, { today: event.detail.today }));
        this.addEventListener('task-priority-change', (event) => this.setTaskPriority(event.detail.id, event.detail.priority));
        this.addEventListener('task-tabled-change', (event) => this.updateTask(event.detail.id, { tabled: event.detail.tabled }));
        this.addEventListener('task-timer-toggle', async (event) => {
            const task = this.tasks.find((item) => item.id === event.detail.id);
            const actor = TIMER_ACTORS.includes(event.detail.actor) ? event.detail.actor : 'human';
            if (task?.activeTimers?.[actor]) await this.stopTimer(task.id, actor); else await this.startTimer(event.detail.id, actor);
        });
        this.addEventListener('task-association-add', (event) => this.addAssociation(event.detail.id, event.detail.association));
        this.addEventListener('task-association-remove', (event) => this.removeAssociation(event.detail.id, event.detail.association));
        this.addEventListener('task-session-update', (event) => this.updateSession(event.detail.id, event.detail.sessionId, event.detail));
        this.addEventListener('task-session-delete', (event) => this.deleteSession(event.detail.id, event.detail.sessionId));
        this.addEventListener('task-sessions-toggle', (event) => {
            if (event.detail.open) this.openSessionDetails.add(event.detail.id);
            else this.openSessionDetails.delete(event.detail.id);
        });
        this.addEventListener('task-chart-navigate', (event) => this.revealTask(event.detail.id));
        this.addEventListener('task-chart-filter', (event) => {
            this.setMainView('tasks');
            this.statusFilter = 'all';
            this.onNow = false;
            this.querySelector('.task-search').onNow = false;
            this.planFilter = null;
            this.search = '';
            const searcher = this.querySelector('.task-search');
            if (searcher) searcher.value = '';
            this.querySelectorAll('.nav-button').forEach((button) => {
                button.classList.toggle('active', button.dataset.status === 'all');
            });
            this.closeDrawers();
            const association = { ...event.detail, chartSelection: true };
            const synthetic = association.values || association.value === 'Unassigned';
            if (synthetic) this.updateLocationHash(null);
            this.setAssociationFilter(association, { updateUrl: !synthetic });
            this.querySelector('.list-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        this.addEventListener('task-delete', (event) => this.deleteTask(event.detail.id));
    }

    saveTablePreferences() {
        try { localStorage.setItem('taskimatic-table-preferences', JSON.stringify(this.tablePreferences)); }
        catch (error) { this.toast(t('ui.text.tableSettingsWillLastForThisSessionOnly')); }
    }

    sortedTasks(tasks = this.tasks, sortKey = this.sortKey, sortDir = this.sortDir) {
        const dir = sortDir === 'desc' ? -1 : 1;
        const now = Date.now();
        return [...tasks].sort((a, b) => {
            const aRunning = TIMER_ACTORS.some((actor) => a.activeTimers?.[actor]);
            const bRunning = TIMER_ACTORS.some((actor) => b.activeTimers?.[actor]);
            if (sortKey === 'default') {
                const aPriority = a.priority ?? Infinity;
                const bPriority = b.priority ?? Infinity;
                if (aPriority !== bPriority) return aPriority - bPriority;
                if (aRunning !== bRunning) return aRunning ? -1 : 1;
                return a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true });
            }
            if (sortKey === 'name') {
                return dir * a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true });
            }
            if (sortKey === 'age') {
                const ageDifference = Date.parse(b.createdAt) - Date.parse(a.createdAt);
                if (ageDifference) return dir * ageDifference;
                return a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true });
            }
            if (sortKey === 'time') {
                const aDur = durationForTask(a, null, true, now);
                const bDur = durationForTask(b, null, true, now);
                if (aDur !== bDur) return dir * (aDur - bDur);
                return a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true });
            }
            if (sortKey === 'human' || sortKey === 'agent') {
                const actor = sortKey;
                const aDur = durationForTask(a, actor, false);
                const bDur = durationForTask(b, actor, false);
                return dir * (aDur - bDur);
            }
            if (sortKey === 'lastActive') {
                const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
                const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
                return dir * (aTime - bTime);
            }
            if (sortKey === 'priority') {
                const aPriority = a.priority ?? Infinity;
                const bPriority = b.priority ?? Infinity;
                return dir * (aPriority - bPriority);
            }
            return 0;
        });
    }

    filteredTasks() {
        return this.sortedTasks().filter((task) => {
            if (this.onNow && !TIMER_ACTORS.some(actor => task.activeTimers?.[actor])) return false;
            if (this.statusFilter === 'open' && (task.status !== 'open' || task.tabled)) return false;
            if (this.statusFilter === 'tabled' && !task.tabled) return false;
            if (this.statusFilter === 'done' && task.status !== 'done') return false;
            if (this.planFilter && task.planId !== this.planFilter) return false;
            if (this.associationFilter) {
                const filter = this.associationFilter;
                const values = filter.values || [filter.value];
                const matches = task.associations.some((item) => item.type === filter.type && values.includes(item.value));
                const unassigned = filter.chartSelection && values.includes('Unassigned') && !task.associations.some((item) => item.type === filter.type);
                if (!matches && !unassigned) return false;
            }
            if (this.search) {
                const haystack = `${task.text} ${task.notes} ${task.prompts} ${task.associations.map((item) => `${item.type} ${item.value}`).join(' ')}`.toLowerCase();
                if (!haystack.includes(this.search)) return false;
            }
            return true;
        });
    }

    associationFromHash(hash = window.location.hash) {
        const match = /^#([^=]+)=(.*)$/.exec(hash || '');
        if (!match) return null;
        try {
            const type = canonicalType(decodeURIComponent(match[1]));
            const value = cleanString(decodeURIComponent(match[2]), 120);
            return type && value ? { type, value } : null;
        } catch (error) {
            return null;
        }
    }

    updateLocationHash(association) {
        const hash = association
            ? `#${encodeURIComponent(association.type)}=${encodeURIComponent(association.value)}`
            : '';
        const url = `${window.location.pathname}${window.location.search}${hash}`;
        try {
            window.history.pushState(null, '', url);
        } catch (error) {
            // Some contexts (e.g. file://) reject pushState; assigning the hash still deep-links.
            if (window.location.hash !== hash) window.location.hash = hash;
        }
    }

    setAssociationFilter(association, { updateUrl = true } = {}) {
        this.tableTaskId = null;
        this.associationFilter = association;
        if (updateUrl) this.updateLocationHash(association);
        this.renderAll();
    }

    setPlanFilter(planId) {
        this.planFilter = planId;
        this.renderAll();
    }

    revealAssociation(association) {
        const [normalized] = normalizeAssociations([association]);
        if (!normalized) return;
        this.setAssociationFilter(normalized);
        this.querySelector('.list-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.focus();
    }

    revealTask(taskId) {
        this.setMainView('tasks');
        const task = this.tasks.find((item) => item.id === taskId);
        if (!task) return;
        if (this.tablePreferences.enabled) this.tableTaskId = taskId;
        this.onNow = false;
        this.querySelector('.task-search').onNow = false;
        this.statusFilter = task.tabled ? 'tabled' : task.status === 'done' ? 'done' : 'open';
        this.associationFilter = null;
        this.planFilter = null;
        this.search = '';
        this.updateLocationHash(null);
        const searcher = this.querySelector('.task-search');
        if (searcher) searcher.value = '';
        this.querySelectorAll('.nav-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.status === this.statusFilter);
        });
        this.renderTasks();
        requestAnimationFrame(() => {
            const element = [...this.querySelectorAll('task-item')].find((item) => item.dataset.taskId === taskId);
            if (!element) return;
            element.setAttribute('attention', '');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.shadowRoot?.querySelector('.text')?.focus({ preventScroll: true });
            setTimeout(() => element.removeAttribute('attention'), 1700);
            window.focus();
        });
    }

    renderAll() {
        this.renderCounts();
        this.renderAssociations();
        this.renderPlansNav();
        this.renderStats();
        this.renderTasks();
        this.renderTodayTasks();
        this.renderPlanning();
        this.renderAgents();
        this.syncTodayDrawer();
        this.querySelector('task-visualization').tasks = this.tasks;
        this.renderPipWindow();
        const renderedAt = Date.now();
        this.lastClockTickAt = renderedAt;
        if (this.isMainFocused()) {
            const dayKey = currentDay(renderedAt).key;
            this.lastMainClockMinute = Math.floor(renderedAt / 60000);
            if (this.querySelector('.date-stamp')?.dataset.day === dayKey) this.lastMainClockDay = dayKey;
        }
        this.syncClock(false);
    }

    async openPipWindow() {
        if (!('documentPictureInPicture' in window)) {
            this.toast(t('ui.text.miniWindowRequiresABrowserWithDocumentPictureInPictureSupport'));
            return null;
        }
        if (this.pipWindow && !this.pipWindow.closed) {
            this.pipWindow.focus();
            return this.pipWindow;
        }
        try {
            const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 420, height: 620 });
            this.pipWindow = pipWindow;
            pipWindow.document.documentElement.lang = 'en';
            installSearcherElement(pipWindow);
            installLockInControls(pipWindow);
            pipWindow.document.head.innerHTML = `
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${escapeHTML(t('ui.text.miniTaskimatic'))}</title>
                <style>
                    :root { --paper: #f3efe4; --panel: #fffdf7; --ink: #18242b; --muted: #697177; --line: #cfc8b8; --accent: #e65135; --green: #28785c; --blue: #315f91; color-scheme: light; }
                    * { box-sizing: border-box; }
                    body { min-width: 260px; margin: 0; background: var(--paper); color: var(--ink); font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
                    button { min-height: 34px; border: 1px solid var(--ink); border-radius: 8px; background: var(--panel); color: inherit; font: inherit; cursor: pointer; }
                    button:hover { background: var(--paper); color: var(--ink); }
                    button:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                    header { position: sticky; top: 0; z-index: 2; padding: 4px; border-bottom: 1px solid var(--ink); background: rgba(243,239,228,.96); }
                    .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
                    h1 { margin: 0; font-size: 17px; letter-spacing: -.03em; }
                    .live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); font: 750 10px ui-monospace, monospace; text-transform: uppercase; }
                    .live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
                    searcher-element { position: relative; display: block; width: 100%; margin-top: 11px; }
                    .searcher-field { position: relative; display: flex; align-items: center; gap: 6px; }
                    .searcher-field .searcher-input { min-width: 0; flex: 1; }
                    .searcher-on-now { flex: none; white-space: nowrap; min-height: 34px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); font-size: 11px; cursor: pointer; }
                    .searcher-on-now[aria-pressed="true"] { background: var(--accent); color: white; border-color: var(--accent); }
                    .searcher-field::before { content: '⌕'; position: absolute; left: 11px; top: 6px; color: var(--muted); font-size: 18px; pointer-events: none; }
                    .searcher-input { width: 100%; height: 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 0 9px 0 32px; color: var(--ink); font: inherit; font-size: 12px; }
                    .searcher-menu { position: absolute; z-index: 4; top: calc(100% + 5px); left: 0; right: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 2px 2px 0 rgba(24,36,43,.12); }
                    .searcher-option { min-height: 32px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; align-items: center; padding: 0 4px 0 9px; cursor: pointer; font-size: 12px; }
                    .searcher-option:hover, .searcher-option:focus { background: #fff8e7; outline: 0; }
                    .searcher-query { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .searcher-remove { min-width: 24px; min-height: 24px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; font-size: 17px; line-height: 1; }
                    .searcher-remove:hover { color: var(--accent); background: rgba(230,81,53,.1); }
                    .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 4px; }
                    .tab { border-color: var(--line); box-shadow: none; font-size: 12px; font-weight: 800; }
                    .tab[aria-selected="true"] { border-color: var(--ink); background: var(--ink); color: white; }
                    button[role="tab"]:hover { background: var(--panel); color: var(--ink); }
                    main { display: grid; gap: 8px; padding: 12px 12px 60px; }
                    .lock-in-pill { position: fixed; left: 12px; bottom: 12px; z-index: 62; padding: 0 14px; border-radius: 999px; background: var(--panel); color: var(--muted); box-shadow: 2px 2px 6px rgba(24,36,43,.12); font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; white-space: nowrap; cursor: grab; touch-action: none; user-select: none; }
                    .lock-in-pill:hover { border-color: var(--accent); color: var(--ink); }
                    .lock-in-pill.is-locked { background: var(--accent); border-color: var(--accent); color: white; }
                    .lock-in-pill.is-dragging { cursor: grabbing; }
                    .lock-in-emoji { font-size: 22px; line-height: 1; vertical-align: -2px; }
                    .task { position: relative; display: grid; gap: 9px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 2px 2px 0 rgba(24,36,43,.09); }
                    .task.running { border-left: 5px solid var(--accent); padding-left: 7px; }
                    .task.done { opacity: .7; }
                    .task-title { overflow-wrap: anywhere; font-size: 13px; font-weight: 750; line-height: 1.35; }
                    .task-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; }
                    .task-actions { display: flex; align-items: center; gap: 5px; }
                    .task-check { width: 27px; min-width: 27px; min-height: 27px; padding: 0; border-radius: 7px; background: transparent; font-weight: 900; }
                    .task-check.checked { border-color: var(--green); background: var(--green); color: white; }
                    .priority-picker { display: inline-flex; align-items: center; gap: 3px; color: var(--muted); font: 750 9px/1 ui-monospace, monospace; text-transform: uppercase; }
                    .priority-picker input { width: 37px; height: 27px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--ink); text-align: center; font: 800 11px/1 ui-monospace, monospace; }
                    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
                    .chip { min-height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--chip-color, var(--line)) 55%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--chip-color, var(--line)) 10%, transparent); color: var(--chip-color, var(--muted)); font: 750 9px/1 ui-monospace, monospace; }
                    .chip:hover { background: color-mix(in srgb, var(--chip-color, var(--line)) 20%, transparent); }
                    .task-meta { color: var(--muted); font: 650 10px/1.3 ui-monospace, monospace; }
                    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
                    .timer { min-width: 0; border-color: var(--blue); background: var(--blue); color: white; font: 750 10px/1 ui-monospace, monospace; }
                    .timer.running { border-color: var(--accent); background: var(--accent); }
                    .human.timer.running { background: var(--green); }
                    lock-in-controls { margin-top: 9px; }
                    .pip-controls { display: grid; grid-template-columns: 1fr; gap: 7px; margin-top: -8px; }
                    .restore { grid-column: 1 / -1; font-size: 11px; font-weight: 800; }
                    .empty { padding: 38px 18px; border: 1px dashed #a9a292; border-radius: 10px; color: var(--muted); text-align: center; font-size: 12px; line-height: 1.5; }
                </style>`;
            pipWindow.document.body.innerHTML = `<header><div class="brand-row"><h1>${escapeHTML(t('ui.text.taskimatic'))}</h1><span class="live">${escapeHTML(t('ui.text.live'))}</span></div>` +
                `<div class="pip-controls"><searcher-element on-now-filter class="pip-search" aria-label="${escapeHTML(t('ui.text.searchTasksInMiniWindow'))}"></searcher-element></div><lock-in-controls></lock-in-controls><div class="tabs" role="tablist"></div></header><main></main><button type="button" class="lock-in-pill" id="lock-in-pill" aria-pressed="false">${escapeHTML(t('ui.text.lockIn3'))} <span class="lock-in-emoji">🔓</span></button>`;
            this.bindLockInPill(pipWindow);
            pipWindow.document.querySelector('#lock-in-pill').addEventListener('click', event => {
                if (this.suppressPipLockInPillClick && event.detail !== 0) {
                    this.suppressPipLockInPillClick = false;
                    return;
                }
                this.setLockInEnabled(!this.lockInEnabled);
            });
            pipWindow.addEventListener('resize', () => this.positionLockInPill(pipWindow));
            pipWindow.document.querySelector('lock-in-controls').addEventListener('lock-in:change', event => {
                this.setProtectPlan(event.detail.plan);
            });
            this.updateProtectPlanButtons();
            pipWindow.document.querySelector('searcher-element.pip-search').addEventListener('searcher:input', (event) => {
                this.pipSearch = event.detail.query.toLowerCase();
                this.renderPipWindow();
            });
            pipWindow.document.querySelector('searcher-element.pip-search').addEventListener('searcher:search', (event) => {
                this.pipSearch = event.detail.query.toLowerCase();
                this.renderPipWindow();
            });
            const pipSearcher = pipWindow.document.querySelector('.pip-search');
            pipSearcher.onNow = Boolean(this.pipOnNow);
            pipSearcher.addEventListener('searcher:on-now', event => {
                this.pipOnNow = event.detail.active;
                this.renderPipWindow();
            });
            const protectStyles = document.querySelector('#protect-modal-styles');
            const pipProtectStyles = protectStyles.cloneNode(true);
            if (protectStyles.tagName === 'LINK') pipProtectStyles.href = protectStyles.href;
            pipWindow.document.head.append(pipProtectStyles);
            this.syncPipProtectModal();
            pipWindow.addEventListener('keydown', this.handleGlobalKeyDown);
            pipWindow.addEventListener('focus', this.handleClockStateChange);
            pipWindow.addEventListener('blur', this.handleClockStateChange);
            pipWindow.addEventListener('pagehide', () => {
                this.pipWindow = null;
                this.pipClockElements.clear();
                const button = this.querySelector('.pip-action');
                if (button) { button.setAttribute('aria-pressed', 'false'); button.textContent = t('ui.text.miniMe'); }
                this.syncClock();
            }, { once: true });
            const button = this.querySelector('.pip-action');
            button.setAttribute('aria-pressed', 'true');
            button.textContent = t('ui.text.miniMeOut');
            this.renderPipWindow();
            this.syncClock();
            return pipWindow;
        } catch (error) {
            this.pipWindow = null;
            this.toast(t('ui.text.couldNotOpenMiniWindowValue0', { value0: error.message }));
            return null;
        }
    }

    renderPipWindow() {
        const pipWindow = this.pipWindow;
        if (!pipWindow || pipWindow.closed) return;
        const pipDocument = pipWindow.document;
        const tabs = pipDocument.querySelector('.tabs');
        const list = pipDocument.querySelector('main');
        if (!tabs || !list) return;
        pipDocument.querySelector('.pip-search').onNow = Boolean(this.pipOnNow);
        const now = Date.now();
        this.pipClockElements.clear();
        const matchesPipSearch = (task) => !this.pipSearch || `${task.text} ${task.notes || ''} ${task.prompts || ''}`.toLowerCase().includes(this.pipSearch);
        const sortTasksForPip = (taskList) => {
            const baseSorted = this.sortedTasks(this.pipOnNow ? taskList.filter(task => TIMER_ACTORS.some(actor => task.activeTimers?.[actor])) : taskList);
            if (!this.pipOnNow) return baseSorted;

            return [...baseSorted].sort((a, b) => {
                const aHuman = Boolean(a.activeTimers?.human);
                const bHuman = Boolean(b.activeTimers?.human);
                if (aHuman && !bHuman) return -1;
                if (!aHuman && bHuman) return 1;
                if (aHuman && bHuman) {
                    const aTime = Date.parse(a.activeTimers.human) || 0;
                    const bTime = Date.parse(b.activeTimers.human) || 0;
                    if (aTime !== bTime) return aTime - bTime;
                }

                const aAgent = Boolean(a.activeTimers?.agent);
                const bAgent = Boolean(b.activeTimers?.agent);
                if (aAgent && !bAgent) return -1;
                if (!aAgent && bAgent) return 1;
                if (aAgent && bAgent) {
                    const aTime = Date.parse(a.activeTimers.agent) || 0;
                    const bTime = Date.parse(b.activeTimers.agent) || 0;
                    if (aTime !== bTime) return aTime - bTime;
                }

                return 0;
            });
        };
        const activeTasks = sortTasksForPip(this.tasks.filter((task) => task.status === 'open' && !task.tabled && matchesPipSearch(task)));
        const tabledTasks = sortTasksForPip(this.tasks.filter((task) => task.tabled && matchesPipSearch(task)));
        const views = [
            { id: 'open', label: t('ui.text.active'), tasks: activeTasks },
            { id: 'tabled', label: t('ui.text.tabled'), tasks: tabledTasks }
        ];
        tabs.replaceChildren();
        for (const view of views) {
            const tab = pipDocument.createElement('button');
            tab.type = 'button';
            tab.className = 'tab';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(this.pipTab === view.id));
            tab.textContent = `${view.label} ${view.tasks.length}`;
            tab.addEventListener('click', () => { this.pipTab = view.id; this.renderPipWindow(); });
            tabs.append(tab);
        }
        const tasks = views.find((view) => view.id === this.pipTab)?.tasks || activeTasks;
        list.replaceChildren();
        if (!tasks.length) {
            const empty = pipDocument.createElement('div');
            empty.className = 'empty';
            empty.textContent = this.pipTab === 'tabled' ? t('ui.text.noTabledTasks') : t('ui.text.noActiveTasks');
            list.append(empty);
            return;
        }
        for (const task of tasks) {
            const runningActors = TIMER_ACTORS.filter((actor) => task.activeTimers?.[actor]);
            const row = pipDocument.createElement('article');
            row.className = `task${runningActors.length ? ' running' : ''}${task.status === 'done' ? ' done' : ''}`;
            const head = pipDocument.createElement('div');
            head.className = 'task-head';
            const title = pipDocument.createElement('div');
            title.className = 'task-title';
            title.textContent = task.text;
            const taskActions = pipDocument.createElement('div');
            taskActions.className = 'task-actions';
            const complete = pipDocument.createElement('button');
            const done = task.status === 'done';
            complete.type = 'button';
            complete.className = `task-check${done ? ' checked' : ''}`;
            complete.textContent = done ? '✓' : '';
            complete.title = done ? t('ui.text.reopenTask') : t('ui.text.completeTask');
            complete.setAttribute('aria-label', `${done ? t('ui.text.reopen') : t('ui.text.complete')} ${task.text}`);
            complete.addEventListener('click', () => this.updateTask(task.id, { status: done ? 'open' : 'done' }));
            const priority = pipDocument.createElement('label');
            priority.className = 'priority-picker';
            priority.textContent = t('ui.text.priority');
            const priorityInput = pipDocument.createElement('input');
            priorityInput.type = 'number';
            priorityInput.min = '1';
            priorityInput.max = String(this.priorityLimitFor(task.id));
            priorityInput.step = '1';
            priorityInput.inputMode = 'numeric';
            priorityInput.value = task.priority ?? '';
            priorityInput.disabled = done;
            priorityInput.setAttribute('aria-label', t('ui.text.priorityForValue01IsHighest', { value0: task.text }));
            priorityInput.addEventListener('change', () => {
                const raw = priorityInput.value.trim();
                this.setTaskPriority(task.id, raw === '' ? null : Number(raw));
            });
            priority.append(priorityInput);
            taskActions.append(complete, priority);
            head.append(title, taskActions);
            row.append(head);
            if (task.associations.length) {
                const chips = pipDocument.createElement('div');
                chips.className = 'chips';
                for (const association of task.associations) {
                    const chip = pipDocument.createElement('button');
                    chip.type = 'button';
                    chip.className = 'chip';
                    chip.style.setProperty('--chip-color', colorFor(association.type));
                    chip.textContent = `${association.type}: ${association.value}`;
                    const hint = t('ui.text.showValue0Value1InTheMainWindow', { value0: association.type, value1: association.value });
                    chip.title = hint;
                    chip.setAttribute('aria-label', hint);
                    chip.addEventListener('click', () => this.revealAssociation(association));
                    chips.append(chip);
                }
                row.append(chips);
            }
            const meta = pipDocument.createElement('div');
            meta.className = 'task-meta';
            meta.textContent = runningActors.length
                ? t('ui.text.runningSummary', { timers: runningActors.map(actor => `${uiLabel(actor)} ${formatDuration(durationForTask(task, actor, true, now))}`).join(' · ') })
                : t('ui.text.humanValue0AgentValue1', { value0: formatDuration(durationForTask(task, 'human', true, now), true), value1: formatDuration(durationForTask(task, 'agent', true, now), true) });
            const controls = pipDocument.createElement('div');
            controls.className = 'controls';
            const clockElements = { task, meta, timers: new Map() };
            if (this.pipTab === 'tabled') {
                const restore = pipDocument.createElement('button');
                restore.type = 'button';
                restore.className = 'restore';
                restore.textContent = t('ui.text.moveToActive');
                restore.addEventListener('click', () => this.updateTask(task.id, { tabled: false }));
                controls.append(restore);
            } else {
                for (const actor of TIMER_ACTORS) {
                    const running = Boolean(task.activeTimers?.[actor]);
                    const timer = pipDocument.createElement('button');
                    timer.type = 'button';
                    timer.className = `${actor} timer${running ? ' running' : ''}`;
                    timer.textContent = `${running ? '■' : '▶'} ${uiLabel(actor, true)} ${formatDuration(durationTodayForTask(task, actor, now))}`;
                    timer.setAttribute('aria-label', t('ui.text.value0Value1TimerForValue2', { value0: running ? t('ui.text.stop') : t('ui.text.start'), value1: uiLabel(actor), value2: task.text }));
                    timer.addEventListener('click', () => running ? this.stopTimer(task.id, actor) : this.startTimer(task.id, actor));
                    controls.append(timer);
                    clockElements.timers.set(actor, timer);
                }
            }
            row.append(meta, controls);
            list.append(row);
            this.pipClockElements.set(task.id, clockElements);
        }
    }

    updatePipClocks(now = Date.now()) {
        for (const { task, meta, timers } of this.pipClockElements.values()) {
            const runningActors = TIMER_ACTORS.filter((actor) => task.activeTimers?.[actor]);
            if (!runningActors.length) continue;
            setText(
                meta,
                t('ui.text.runningSummary', { timers: runningActors.map(actor => `${uiLabel(actor)} ${formatDuration(durationForTask(task, actor, true, now))}`).join(' · ') })
            );
            for (const actor of runningActors) {
                setText(
                    timers.get(actor),
                    `■ ${uiLabel(actor, true)} ${formatDuration(durationTodayForTask(task, actor, now))}`
                );
            }
        }
    }

    updateTaskColumns() {
        const columns = Math.max(1, 1 + Math.ceil((window.innerWidth - 1366) / 700));
        this.style.setProperty('--task-columns', String(columns));
    }

    renderTasks() {
        const tasks = this.filteredTasks();
        const list = this.querySelector('.task-list');
        const heading = this.statusFilter === 'all' ? t('ui.text.allTasks') : this.statusFilter === 'done' ? t('ui.text.completedTasks') : this.statusFilter === 'tabled' ? t('ui.text.tabledTasks') : t('ui.text.activeTasks');
        this.querySelector('.list-heading h2').textContent = heading;
        this.querySelector('.list-count').textContent = t('ui.text.shown', { count: tasks.length });
        const hierarchyButton = this.querySelector('.hierarchy-button');
        hierarchyButton.hidden = !this.tablePreferences.enabled;
        hierarchyButton.textContent = this.tablePreferences.selected || t('ui.text.hierarchy');
        const filterBar = this.querySelector('.active-filter');
        const filterPlan = this.planFilter ? this.plans.find(plan => plan.id === this.planFilter) : null;
        filterBar.hidden = !this.associationFilter && !filterPlan;
        const filterBits = [];
        if (filterPlan) filterBits.push(t('ui.text.planFilter', { plan: filterPlan.text }));
        if (this.associationFilter) filterBits.push(`${this.associationFilter.type}: ${this.associationFilter.value}`);
        filterBar.querySelector('span').textContent = filterBits.join(' · ');
        list.replaceChildren();
        if (!tasks.some(task => task.id === this.tableTaskId)) this.tableTaskId = null;
        if (this.tablePreferences.enabled && tasks.length) {
            const preset = this.tablePreferences.presets.find(item => item.name === this.tablePreferences.selected);
            this.taskTable.setData(tasks, preset?.order ?? null);
            this.taskTable.hidden = Boolean(this.tableTaskId);
            list.append(this.taskTable);
        }
        const detailTasks = this.tablePreferences.enabled ? tasks.filter(task => task.id === this.tableTaskId) : tasks;
        if (!this.tablePreferences.enabled && tasks.some(task => task.today)) {
            for (const [name, members] of [[t('ui.text.today'), tasks.filter(task => task.today)], [t('ui.text.otherTasks'), tasks.filter(task => !task.today)]]) {
                if (!members.length) continue;
                const group = document.createElement('section');
                group.className = 'task-group';
                group.setAttribute('aria-label', name);
                const title = document.createElement('h3');
                title.className = 'task-group-heading';
                title.textContent = `${name} · ${members.length}`;
                const items = document.createElement('div');
                items.className = 'task-group-list';
                members.forEach(task => items.append(this.createTaskItem(task)));
                group.append(title, items);
                list.append(group);
            }
        } else {
            detailTasks.forEach(task => list.append(this.createTaskItem(task, this.tablePreferences.enabled)));
        }
        if (!tasks.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            const mark = document.createElement('div');
            mark.className = 'empty-mark';
            mark.textContent = this.tasks.length ? '⌕' : '✓';
            const title = document.createElement('h3');
            title.textContent = this.tasks.length ? t('ui.text.noTasksMatchThisView') : t('ui.text.aClearDeskNice');
            const copy = document.createElement('p');
            copy.textContent = this.tasks.length ? t('ui.text.tryAnotherViewGroupingOrSearch') : t('ui.text.typeTheNextUsefulActionAboveYouCanAddProjectOrClientAssociationsNowOrAnytimeLater');
            empty.append(mark, title, copy);
            list.append(empty);
        }
    }

    createTaskItem(task, tableDetail = false) {
        const element = document.createElement('task-item');
        element.toggleAttribute('table-detail', tableDetail);
        element.agentCatalog = this.agents;
        element.editorTab = this.taskEditorTabs.get(task.id) || 'notes';
        element.planCatalog = this.plans;
        element.associationCatalog = this.associationCatalogFor(task.id);
        element.priorityLimit = this.priorityLimitFor(task.id);
        element.task = task;
        element.sessionsOpen = this.openSessionDetails.has(task.id);
        element.toggleAttribute('clock-active', this.isMainFocused());
        return element;
    }

    renderTodayTasks() {
        const controls = this.querySelector('.today-sort');
        const tasks = this.sortedTasks(this.tasks.filter(task => task.today), controls.sortKey, controls.sortDir);
        const list = this.querySelector('.today-task-list');
        this.querySelector('.today-count').textContent = `${tasks.length} ${uiLabel(tasks.length === 1 ? 'task' : 'tasks')}`;
        list.replaceChildren();
        tasks.forEach(task => list.append(this.createTaskItem(task)));
        if (!tasks.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            const title = document.createElement('h3');
            title.textContent = t('ui.text.planYourDay');
            const copy = document.createElement('p');
            copy.textContent = t('ui.text.checkTodayOnATaskToAddItHere');
            empty.append(title, copy);
            list.append(empty);
        }
    }

    renderCounts() {
        for (const kind of ['tasks', 'plans', 'wants']) this.querySelector(`[data-workspace-count="${kind}"]`).textContent = this[kind].length;
        this.querySelector('[data-count="all"]').textContent = this.tasks.length;
        this.querySelector('[data-count="open"]').textContent = this.tasks.filter((task) => task.status === 'open' && !task.tabled).length;
        this.querySelector('[data-count="tabled"]').textContent = this.tasks.filter((task) => task.tabled).length;
        this.querySelector('[data-count="done"]').textContent = this.tasks.filter((task) => task.status === 'done').length;
    }

    renderStats(now = Date.now()) {
        const { key: dayKey, start: todayStart } = currentDay(now);
        if (this.todayStatsCache.dayKey !== dayKey || this.todayStatsCache.version !== durationCache.version) {
            const completed = { human: 0, agent: 0 };
            for (const task of this.tasks) {
                const taskDurations = completedDurationsTodayForTask(task, now);
                for (const actor of TIMER_ACTORS) completed[actor] += taskDurations[actor];
            }
            this.todayStatsCache = { dayKey, version: durationCache.version, ...completed };
        }
        const todaySeconds = {
            human: this.todayStatsCache.human,
            agent: this.todayStatsCache.agent
        };
        for (const task of this.tasks) for (const actor of TIMER_ACTORS) {
            const activeTimer = task.activeTimers?.[actor];
            if (!activeTimer) continue;
            const startedAt = Date.parse(activeTimer);
            if (!Number.isNaN(startedAt)) {
                todaySeconds[actor] += Math.max(0, now - Math.max(startedAt, todayStart)) / 1000;
            }
        }
        setText(this.querySelector('[data-stat="human-today"]'), formatDuration(todaySeconds.human, true));
        setText(this.querySelector('[data-stat="agent-today"]'), formatDuration(todaySeconds.agent, true));
        setText(this.querySelector('[data-stat="open"]'), String(this.tasks.filter((task) => task.status === 'open' && !task.tabled).length));
    }

    associationCatalogFor(taskId) {
        const catalog = Object.create(null);
        for (const task of [...this.tasks, ...this.plans, ...this.wants]) for (const association of task.associations) {
            if (!catalog[association.type]) catalog[association.type] = new Set();
            catalog[association.type].add(association.value);
        }
        catalog['dependent-task'] = new Set(this.tasks.filter((task) => task.id !== taskId).map((task) => task.text));
        return Object.fromEntries(Object.entries(catalog).map(([type, values]) => [type, [...values].sort((a, b) => a.localeCompare(b))]));
    }

    renderAssociations() {
        const container = this.querySelector('.association-nav');
        const grouped = new Map();
        const records = this.mainView === 'tasks' ? this.tasks : this.listPlanning(this.mainView);
        for (const task of records) {
            for (const item of task.effectiveAssociations || task.associations) {
                if (!grouped.has(item.type)) grouped.set(item.type, new Map());
                const values = grouped.get(item.type);
                values.set(item.value, (values.get(item.value) || 0) + 1);
            }
        }
        container.replaceChildren();
        if (!grouped.size) {
            const empty = document.createElement('p');
            empty.className = 'no-associations';
            empty.textContent = t('ui.text.projectsClientsWorkAreasAndAnyCustomPropertyWillAppearHere');
            container.append(empty);
            return;
        }
        for (const [type, values] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const details = document.createElement('details');
            details.className = 'association-group';
            details.dataset.type = type;

            // Auto-expand if active filter belongs to this type
            if (this.associationFilter?.type === type) {
                this.collapsedAssociationTypes.delete(type);
                details.open = true;
            } else {
                details.open = !this.collapsedAssociationTypes.has(type);
            }

            details.addEventListener('toggle', () => {
                if (details.open) {
                    this.collapsedAssociationTypes.delete(type);
                } else {
                    this.collapsedAssociationTypes.add(type);
                }
            });

            const summary = document.createElement('summary');
            summary.className = 'association-summary';
            summary.setAttribute('role', 'button');
            summary.setAttribute('aria-label', t('ui.text.toggleValue0Associations', { value0: type }));

            const left = document.createElement('div');
            left.className = 'association-summary-left';

            const caret = document.createElement('span');
            caret.className = 'association-caret';
            caret.setAttribute('aria-hidden', 'true');
            caret.textContent = '▶';

            const color = document.createElement('span');
            color.className = 'association-color';
            color.style.setProperty('--association-color', colorFor(type));

            const label = document.createElement('span');
            label.className = 'association-type-label';
            label.textContent = uiLabel(type);

            left.append(caret, color, label);

            const totalCount = [...values.values()].reduce((sum, count) => sum + count, 0);
            const totalBadge = document.createElement('span');
            totalBadge.className = 'nav-count';
            totalBadge.textContent = totalCount;
            totalBadge.title = t('ui.text.value0TaskValue1WithValue2', { value0: totalCount, value1: totalCount === 1 ? '' : t('ui.text.pluralSuffix'), value2: type });

            summary.append(left, totalBadge);
            details.append(summary);

            const children = document.createElement('div');
            children.className = 'association-tree-children';
            children.setAttribute('role', 'group');

            for (const [value, count] of [...values.entries()].sort((a, b) => b[1] - a[1])) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'association-button';
                if (this.associationFilter?.type === type && this.associationFilter?.value === value) {
                    button.classList.add('active');
                }
                const name = document.createElement('span');
                name.className = 'association-button-label';
                name.textContent = value;
                name.title = value;

                const number = document.createElement('span');
                number.className = 'nav-count';
                number.textContent = count;

                button.append(name, number);
                button.addEventListener('click', () => {
                    const isSame = this.associationFilter?.type === type && this.associationFilter?.value === value;
                    this.setAssociationFilter(isSame ? null : { type, value });
                    if (window.innerWidth <= 820) {
                        this.closeDrawers();
                    }
                });
                children.append(button);
            }
            details.append(children);
            container.append(details);
        }
    }

    renderPlansNav() {
        const nav = this.querySelector('#plans-nav');
        if (!nav) return;
        if (this.planFilter && !this.plans.some(plan => plan.id === this.planFilter)) this.planFilter = null;
        const badge = nav.querySelector('[data-plans-count]');
        if (badge) badge.textContent = this.plans.length;
        const list = nav.querySelector('.plans-list');
        list.replaceChildren();
        if (!this.plans.length) {
            const empty = document.createElement('p');
            empty.className = 'no-associations';
            empty.textContent = t('ui.text.addAPlanFromThePlansTabAndItWillShowUpHere');
            list.append(empty);
            return;
        }
        const sorted = [...this.plans].sort((a, b) => a.text.localeCompare(b.text));
        for (const plan of sorted) {
            const openCount = this.tasks.filter(task => task.planId === plan.id && task.status === 'open').length;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'association-button';
            if (this.planFilter === plan.id) button.classList.add('active');
            button.title = t('ui.text.showTasksAttachedToValue0', { value0: plan.text });
            const name = document.createElement('span');
            name.className = 'association-button-label';
            name.textContent = plan.text;
            const number = document.createElement('span');
            number.className = 'nav-count';
            number.textContent = openCount;
            number.title = t('ui.text.value0OpenTaskValue1', { value0: openCount, value1: openCount === 1 ? '' : t('ui.text.pluralSuffix') });
            button.append(name, number);
            button.addEventListener('click', () => {
                const isSame = this.planFilter === plan.id;
                if (!isSame) this.setMainView('tasks');
                this.setPlanFilter(isSame ? null : plan.id);
                if (window.innerWidth <= 820) this.closeDrawers();
            });
            list.append(button);
        }
    }

    emitChange(action, record = null) {
        const kind = action.startsWith('plan-') ? 'plan' : action.startsWith('want-') ? 'want' : action.startsWith('agent-') ? 'agent' : 'task';
        document.dispatchEvent(new CustomEvent('taskimatic:change', { detail: { action, kind, record: record ? cloneValue(record) : null, task: kind === 'task' && record ? cloneValue(record) : null } }));
    }

    async createTask(input) {
        const payload = typeof input === 'string' ? { text: input } : input;
        if (!payload || !cleanString(payload.text ?? payload.name, 1000)) throw new Error(t('error.messages.taskTextIsRequired'));
        const task = normalizeTask(payload);
        if (task.agentId && !this.agents.some(agent => agent.id === task.agentId)) throw new Error(t('error.messages.agentNotFoundValue0', { value0: task.agentId }));
        if (task.planId && !this.plans.some(plan => plan.id === task.planId)) throw new Error(t('error.messages.planNotFoundValue0', { value0: task.planId }));
        if (this.tasks.some(item => item.id === task.id)) throw new Error(t('error.messages.taskAlreadyExistsValue0', { value0: task.id }));
        task.updatedAt = nowISO();
        await this.repository.put(task);
        invalidateDurationCache(task.id);
        this.tasks.push(task);
        this.statusFilter = this.statusFilter === 'done' ? 'open' : this.statusFilter;
        this.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.status === this.statusFilter));
        this.renderAll();
        this.emitChange('created', task);
        return cloneValue(task);
    }

    priorityLimitFor(taskId) {
        return this.tasks.filter((task) => task.id !== taskId && task.status !== 'done').length + 1;
    }

    async reprioritize({ taskId = null, requestedPriority = null } = {}) {
        const task = taskId ? this.tasks.find((item) => item.id === taskId) : null;
        if (taskId && !task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: taskId }));
        const shouldInsert = task?.status !== 'done' && requestedPriority !== null;
        const ranked = this.tasks
            .filter((item) => item.status !== 'done' && item.id !== taskId)
            .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity)
                || a.createdAt.localeCompare(b.createdAt)
                || a.id.localeCompare(b.id));

        if (shouldInsert) {
            const position = Math.min(requestedPriority, ranked.length + 1);
            ranked.splice(position - 1, 0, task);
        }

        const now = nowISO();
        const updatedById = new Map();
        ranked.forEach((item, index) => {
            const priority = index + 1;
            updatedById.set(item.id, { ...item, priority, updatedAt: item.id === taskId ? now : item.updatedAt });
        });
        if (task && !shouldInsert) {
            updatedById.set(task.id, { ...task, priority: null, updatedAt: now });
        }

        await Promise.all([...updatedById.values()].map((item) => this.repository.put(item)));
        this.tasks = this.tasks.map((item) => updatedById.get(item.id) || item);
        return taskId ? cloneValue(this.tasks.find((item) => item.id === taskId)) : null;
    }

    async setTaskPriority(id, value) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        if (task.status === 'done') return cloneValue(task);
        const requestedPriority = value === null || value === '' ? null : Number(value);
        if (requestedPriority !== null && (!Number.isInteger(requestedPriority) || requestedPriority < 1)) {
            throw new Error(t('error.messages.priorityMustBeAWholeNumberStartingAt1'));
        }

        const updated = await this.reprioritize({ taskId: id, requestedPriority });
        this.renderAll();
        this.emitChange('priority-changed', updated);
        return updated;
    }

    async updateTask(id, patch = {}, options = {}) {
        let index = this.tasks.findIndex((task) => task.id === id);
        if (index < 0) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        let current = this.tasks[index];
        if (patch.status === 'done' || patch.tabled === true) {
            for (const actor of TIMER_ACTORS) {
                if (current.activeTimers?.[actor]) await this.stopTimer(id, actor, { silent: true });
            }
            index = this.tasks.findIndex((task) => task.id === id);
            current = this.tasks[index];
        }
        const updated = cloneValue(current);
        if ('text' in patch) {
            const text = cleanString(patch.text, 1000);
            if (!text) throw new Error(t('error.messages.taskTextCannotBeEmpty'));
            updated.text = text;
        }
        if ('planId' in patch) {
            updated.planId = cleanString(patch.planId, 120) || null;
            if (updated.planId && !this.plans.some(plan => plan.id === updated.planId)) throw new Error(t('error.messages.planNotFoundValue0', { value0: updated.planId }));
        }
        if ('today' in patch) updated.today = patch.today === true;
        if ('agentId' in patch) {
            updated.agentId = cleanString(patch.agentId, 120) || null;
            if (updated.agentId && !this.agents.some(agent => agent.id === updated.agentId)) throw new Error(t('error.messages.agentNotFoundValue0', { value0: updated.agentId }));
        }
        if ('estimatedMinutes' in patch) {
            const estimate = patch.estimatedMinutes === null ? null : Number(patch.estimatedMinutes);
            if (estimate !== null && ![10, 30, 60, 90].includes(estimate)) {
                throw new Error(t('error.messages.estimatedMinutesMustBe10306090OrNull'));
            }
            updated.estimatedMinutes = estimate;
        }
        if ('prompts' in patch) updated.prompts = String(patch.prompts ?? '').slice(0, 50000);
        if ('notes' in patch) updated.notes = cleanString(patch.notes, 10000);
        if ('status' in patch) {
            if (!['open', 'done'].includes(patch.status)) throw new Error(t('error.messages.statusMustBeOpenOrDone'));
            updated.status = patch.status;
            updated.completedAt = patch.status === 'done' ? (current.completedAt || nowISO()) : null;
            if (patch.status === 'done') updated.priority = null;
        }
        if ('tabled' in patch) {
            updated.tabled = Boolean(patch.tabled);
            updated.tabledAt = updated.tabled ? (current.tabledAt || nowISO()) : null;
        }
        if ('associations' in patch) updated.associations = normalizeAssociations(patch.associations);
        updated.updatedAt = nowISO();
        await this.repository.put(updated);
        this.tasks.splice(index, 1, updated);
        if (patch.status === 'done') await this.reprioritize();
        if (!options.quiet) this.renderAll();
        else {
            this.querySelectorAll('task-item').forEach(item => {
                if (item.dataset.taskId !== id) return;
                if (item === options.source) item._task = cloneValue(updated);
                else item.task = updated;
            });
            this.renderCounts();
            this.renderStats();
            this.renderAssociations();
            this.renderPlanning();
            this.querySelector('task-visualization').tasks = this.tasks;
        }
        this.emitChange('updated', updated);
        return cloneValue(updated);
    }

    async deleteTask(id) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        await this.repository.delete(id);
        this.tasks = this.tasks.filter((item) => item.id !== id);
        invalidateDurationCache(id);
        this.renderAll();
        this.toast(t('ui.text.taskDeleted'));
        this.emitChange('deleted', task);
        return { id, deleted: true };
    }

    async startTimer(id, actor = 'human') {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        if (!TIMER_ACTORS.includes(actor)) throw new Error(t('error.messages.timerActorMustBeHumanOrAgent'));
        if (task.status === 'done') throw new Error(t('error.messages.reopenTheTaskBeforeStartingItsTimer'));
        if (task.tabled) throw new Error(t('error.messages.untableTheTaskBeforeStartingATimer'));
        if (task.activeTimers[actor]) return cloneValue(task);
        if (actor === 'human') {
            const otherRunning = this.tasks.find((item) => item.activeTimers?.human && item.id !== id);
            if (otherRunning) await this.stopTimer(otherRunning.id, 'human', { silent: true });
        }
        task.activeTimers[actor] = nowISO();
        task.updatedAt = nowISO();
        await this.repository.put(task);
        this.renderAll();
        this.emitChange(`${actor}-timer-started`, task);
        if (actor === 'human' && this.isProtectPlanEngaged()) {
            this.openProtectModal(task);
        }
        return cloneValue(task);
    }

    async stopTimer(id, actor = 'human', options = {}) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        if (!TIMER_ACTORS.includes(actor)) throw new Error(t('error.messages.timerActorMustBeHumanOrAgent'));
        if (!task.activeTimers[actor]) return cloneValue(task);
        const endedAt = nowISO();
        const durationSeconds = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(task.activeTimers[actor])) / 1000));
        task.sessions.push({ id: uid('session'), actor, startedAt: task.activeTimers[actor], endedAt, durationSeconds });
        task.activeTimers[actor] = null;
        task.updatedAt = endedAt;
        invalidateDurationCache(id);
        await this.repository.put(task);
        this.renderAll();
        if (!options.silent) this.toast(t('ui.text.loggedValue0ForValue1', { value0: formatDuration(durationSeconds, true), value1: uiLabel(actor) }));
        this.emitChange(`${actor}-timer-stopped`, task);
        if (actor === 'human' && this.protectTaskId === id && !options.protectPause) {
            this.closeProtectModal();
        }
        return cloneValue(task);
    }

    async updateSession(id, sessionId, patch = {}) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        const session = task.sessions.find((item) => item.id === sessionId);
        if (!session) throw new Error(t('error.messages.sessionNotFoundValue0', { value0: sessionId }));
        const startedAt = Date.parse(patch.startedAt);
        const endedAt = Date.parse(patch.endedAt);
        if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) throw new Error(t('error.messages.sessionTimesMustBeValidDates'));
        if (endedAt < startedAt) throw new Error(t('error.messages.sessionEndMustBeAtOrAfterItsStart'));
        session.startedAt = new Date(startedAt).toISOString();
        session.endedAt = new Date(endedAt).toISOString();
        session.durationSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
        task.updatedAt = nowISO();
        invalidateDurationCache(id);
        await this.repository.put(task);
        this.renderAll();
        this.toast(t('ui.text.updatedTimeEntryValue0', { value0: formatDuration(session.durationSeconds, true) }));
        this.emitChange('updated', task);
        return cloneValue(task);
    }

    async deleteSession(id, sessionId) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        const idx = task.sessions.findIndex((item) => item.id === sessionId);
        if (idx === -1) throw new Error(t('error.messages.sessionNotFoundValue0', { value0: sessionId }));
        const [removed] = task.sessions.splice(idx, 1);
        task.updatedAt = nowISO();
        invalidateDurationCache(id);
        await this.repository.put(task);
        this.renderAll();
        this.toast(t('ui.text.deletedTimeEntryValue0', { value0: formatDuration(removed.durationSeconds, true) }));
        this.emitChange('updated', task);
        return cloneValue(task);
    }

    async addAssociation(id, association) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        const associations = normalizeAssociations([...task.associations, association]);
        return this.updateTask(id, { associations });
    }

    async removeAssociation(id, association) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task) throw new Error(t('error.messages.taskNotFoundValue0', { value0: id }));
        const target = normalizeAssociations([association])[0];
        const associations = task.associations.filter((item) => !(item.type === target?.type && item.value.toLowerCase() === target.value.toLowerCase()));
        return this.updateTask(id, { associations });
    }

    async listTasks(query = {}) {
        let result = this.sortedTasks();
        if (query.status === 'open') result = result.filter((task) => task.status === 'open' && !task.tabled);
        else if (query.status === 'tabled') result = result.filter((task) => task.tabled);
        else if (query.status === 'done') result = result.filter((task) => task.status === 'done');
        if (query.agentId !== undefined) result = result.filter(task => task.agentId === query.agentId);
        if (query.planId !== undefined) result = result.filter(task => task.planId === query.planId);
        if (typeof query.today === 'boolean') result = result.filter(task => task.today === query.today);
        if (query.search) {
            const search = String(query.search).toLowerCase();
            result = result.filter((task) => `${task.text} ${task.notes} ${task.prompts} ${JSON.stringify(task.associations)}`.toLowerCase().includes(search));
        }
        if (query.association) {
            const [association] = normalizeAssociations([query.association]);
            if (association) result = result.filter((task) => task.associations.some((item) => item.type === association.type && item.value.toLowerCase() === association.value.toLowerCase()));
        }
        return cloneValue(result);
    }

    exportData() {
        return {
            format: 'taskimatic-data',
            version: APP_VERSION,
            exportedAt: nowISO(),
            schemaVersion: 3,
            tasks: cloneValue(this.sortedTasks()),
            plans: cloneValue(this.plans),
            wants: cloneValue(this.wants),
            agents: cloneValue(this.agents)
        };
    }

    downloadData() {
        const data = JSON.stringify(this.exportData(), null, 2);
        downloadBlob(new Blob([data], { type: 'application/json' }), `taskimatic-data-${new Date().toISOString().slice(0, 10)}.json`);
        this.querySelector('backup-tracker')?.recordBackup();
        this.toast(t('ui.text.workspaceDataExported'));
        return this.exportData();
    }

    async importData(input, options = {}) {
        const incoming = normalizeWorkspaceSnapshot(input, normalizeTask);
        const strategy = options.strategy || 'merge';
        if (!['merge', 'replace'].includes(strategy)) throw new Error(t('error.messages.importStrategyMustBeMergeOrReplace'));
        const snapshot = strategy === 'replace' ? incoming : Object.fromEntries(WORKSPACE_COLLECTIONS.map(kind => {
            const merged = new Map(this[kind].map(record => [record.id, record]));
            for (const record of incoming[kind]) merged.set(record.id, record);
            return [kind, [...merged.values()]];
        }));
        validateWorkspaceLinks(snapshot);
        await this.repository.replaceWorkspace(snapshot);
        Object.assign(this, snapshot);
        invalidateDurationCache();
        this.renderAll();
        this.emitChange('imported');
        return { imported: incoming.tasks.length, total: this.tasks.length, plans: { imported: incoming.plans.length, total: this.plans.length }, wants: { imported: incoming.wants.length, total: this.wants.length }, agents: { imported: incoming.agents.length, total: this.agents.length } };
    }

    async downloadApp() {
        return downloadPortableApp(this);
    }

    toast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        this.querySelector('.toast-region').append(toast);
        setTimeout(() => toast.remove(), 3200);
    }

    isProtectPlanEngaged() {
        return Boolean(this.lockInEnabled);
    }

    setProtectPlan(plan) {
        if (!['no', 'now', 'sprint', 'focus', 'flow'].includes(plan)) plan = 'no';
        this.protectPlan = plan;
        if (plan !== 'no') this.setLockInEnabled(true);
        try { localStorage.setItem('taskimatic-protect-plan', plan); } catch (e) {}
        this.updateProtectPlanButtons();
    }

    updateProtectPlanButtons() {
        const controls = [...this.querySelectorAll('lock-in-controls')];
        if (this.pipWindow && !this.pipWindow.closed) {
            controls.push(...this.pipWindow.document.querySelectorAll('lock-in-controls'));
        }
        controls.forEach(control => { control.plan = this.protectPlan; });
    }

    protectModals() {
        return [this.querySelector('#protect-modal'),
            this.pipWindow && !this.pipWindow.closed ? this.pipWindow.document.querySelector('#protect-modal') : null
        ].filter(Boolean);
    }

    bindProtectModal(modal) {
        if (!modal) return;
        modal.querySelector('.protect-btn-pause')?.addEventListener('click', () => this.toggleProtectPause());
        modal.querySelector('.protect-btn-stop')?.addEventListener('click', () => this.stopProtectModal());
        modal.querySelector('.protect-new-task')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const input = form.querySelector('input');
            const button = form.querySelector('button');
            const status = form.querySelector('[role="status"]');
            if (!input.value.trim()) return;
            button.disabled = true;
            try {
                await this.createTask({ text: input.value });
                for (const other of this.protectModals()) {
                    other.querySelector('#protect-new-task-text').value = '';
                    other.querySelector('.protect-new-task [role="status"]').textContent = t('ui.text.taskAdded');
                }
                input.focus();
            } catch (error) { status.textContent = error.message; }
            finally { button.disabled = false; }
        });
        modal.querySelector('.protect-notes-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!this.protectTaskId) return;
            const form = event.currentTarget;
            const button = form.querySelector('button');
            const status = form.querySelector('[role="status"]');
            button.disabled = true;
            try {
                await this.updateTask(this.protectTaskId, { notes: form.querySelector('textarea').value });
                for (const other of this.protectModals()) {
                    other.querySelector('.protect-notes-form [role="status"]').textContent = t('ui.text.notesSaved');
                }
            } catch (error) { status.textContent = error.message; }
            finally { button.disabled = false; }
        });
        modal.querySelectorAll('input, textarea').forEach(field => {
            field.addEventListener('input', () => {
                for (const other of this.protectModals()) {
                    if (other !== modal) other.querySelector(`#${field.id}`).value = field.value;
                    if (field.id === 'protect-task-notes') {
                        other.querySelector('.protect-notes-form [role="status"]').textContent = t('ui.text.unsavedChanges');
                    }
                }
            });
        });
    }

    syncPipProtectModal() {
        if (!this.pipWindow || this.pipWindow.closed) return;
        const source = this.querySelector('#protect-modal');
        if (!source) return;
        const pipDocument = this.pipWindow.document;
        let modal = pipDocument.querySelector('#protect-modal');
        if (!modal) {
            modal = source.cloneNode(true);
            pipDocument.body.append(modal);
            this.bindProtectModal(modal);
        }
        source.querySelectorAll('input, textarea').forEach(field => {
            modal.querySelector(`#${field.id}`).value = field.value;
        });
        modal.querySelector('.protect-modal-task').textContent = source.querySelector('.protect-modal-task').textContent;
        modal.querySelector('.protect-modal-plan-label').textContent = source.querySelector('.protect-modal-plan-label').textContent;
        source.querySelectorAll('.protect-form-status').forEach((status, index) => {
            modal.querySelectorAll('.protect-form-status')[index].textContent = status.textContent;
        });
        const isOpen = source.classList.contains('is-open');
        modal.classList.toggle('is-open', isOpen);
        modal.inert = !isOpen;
        modal.setAttribute('aria-hidden', String(!isOpen));
        if (isOpen) modal.focus();
        this.updateProtectModalDisplay();
    }

    openProtectModal(task) {
        if (!task) return;
        const modal = this.querySelector('#protect-modal');
        if (this.protectTaskId === task.id && modal?.classList.contains('is-open')) {
            return;
        }
        const durations = {
            now: 8 * 60,
            sprint: 22 * 60,
            focus: 44 * 60,
            flow: 88 * 60
        };
        const labels = {
            now: t('ui.text.now8min'),
            sprint: t('ui.text.sprint22min'),
            focus: t('ui.text.focus44min'),
            flow: t('ui.text.flow88min')
        };
        this.protectTaskId = task.id;
        // A today-panel plan (Now/Sprint/Focus/Flow) overrides the task's estimated time.
        this.protectTargetSeconds = durations[this.protectPlan] || (task.estimatedMinutes ? task.estimatedMinutes * 60 : 22 * 60);
        this.protectAccumulatedSeconds = 0;
        this.protectSessionStartedAt = Date.now();
        this.protectIsPaused = false;

        if (!modal) return;
        const taskTitle = modal.querySelector('.protect-modal-task');
        if (taskTitle) taskTitle.textContent = task.text;
        const notes = modal.querySelector('#protect-task-notes');
        if (notes) notes.value = task.notes || '';
        modal.querySelectorAll?.('.protect-form-status').forEach(status => { status.textContent = ''; });
        const planLabel = modal.querySelector('.protect-modal-plan-label');
        if (planLabel) planLabel.textContent = labels[this.protectPlan] || (task.estimatedMinutes ? t('ui.text.estimateValue0Min', { value0: task.estimatedMinutes }) : t('ui.text.lockIn2'));
        const pauseBtn = modal.querySelector('.protect-btn-pause');
        if (pauseBtn) pauseBtn.textContent = t('ui.text.pause');
        const center = modal.querySelector('.protect-modal-center');
        if (center) center.classList.remove('is-paused');

        modal.classList.add('is-open');
        modal.removeAttribute('aria-hidden');
        modal.inert = false;
        modal.focus();
        this.syncPipProtectModal();

        this.updateProtectModalDisplay();

        if (this.protectTimerInterval) clearInterval(this.protectTimerInterval);
        this.protectTimerInterval = setInterval(() => this.updateProtectModalDisplay(), 200);
    }

    updateProtectModalDisplay() {
        const modal = this.querySelector('#protect-modal');
        if (!modal || !modal.classList.contains('is-open')) return;

        let elapsed = this.protectAccumulatedSeconds;
        if (!this.protectIsPaused && this.protectSessionStartedAt) {
            elapsed += (Date.now() - this.protectSessionStartedAt) / 1000;
        }

        const remaining = Math.max(0, this.protectTargetSeconds - elapsed);
        for (const modal of this.protectModals()) {
            const timeElem = modal.querySelector('.protect-modal-time');
            if (timeElem) timeElem.textContent = formatProtectTime(remaining);

            const circumference = 816.814;
            const fraction = Math.min(1, Math.max(0, elapsed / this.protectTargetSeconds));
            const offset = circumference * (1 - fraction);
            const arc = modal.querySelector('.protect-donut-arc');
            if (arc) arc.style.strokeDashoffset = String(offset);

            modal.querySelector('.protect-btn-pause').textContent = this.protectIsPaused ? t('ui.text.resume') : t('ui.text.pause');
            modal.querySelector('.protect-modal-center').classList.toggle('is-paused', this.protectIsPaused);
            if (remaining === 0) {
                const planLabel = modal.querySelector('.protect-modal-plan-label');
                if (planLabel) planLabel.textContent = t('ui.text.goalReached');
            }
        }
    }

    async toggleProtectPause() {
        if (!this.protectTaskId) return;
        const modal = this.querySelector('#protect-modal');
        const pauseBtn = modal?.querySelector('.protect-btn-pause');
        const center = modal?.querySelector('.protect-modal-center');

        if (this.protectIsPaused) {
            this.protectIsPaused = false;
            this.protectSessionStartedAt = Date.now();
            if (pauseBtn) pauseBtn.textContent = t('ui.text.pause');
            if (center) center.classList.remove('is-paused');
            await this.startTimer(this.protectTaskId, 'human');
        } else {
            this.protectIsPaused = true;
            const now = Date.now();
            if (this.protectSessionStartedAt) {
                this.protectAccumulatedSeconds += (now - this.protectSessionStartedAt) / 1000;
                this.protectSessionStartedAt = null;
            }
            if (pauseBtn) pauseBtn.textContent = t('ui.text.resume');
            if (center) center.classList.add('is-paused');
            await this.stopTimer(this.protectTaskId, 'human', { silent: true, protectPause: true });
        }
        this.updateProtectModalDisplay();
    }

    async stopProtectModal() {
        const taskId = this.protectTaskId;
        this.closeProtectModal();
        if (taskId) {
            const task = this.tasks.find(t => t.id === taskId);
            if (task?.activeTimers?.human) {
                await this.stopTimer(taskId, 'human');
            }
        }
    }

    closeProtectModal() {
        if (this.protectTimerInterval) {
            clearInterval(this.protectTimerInterval);
            this.protectTimerInterval = null;
        }
        this.protectTaskId = null;
        this.protectIsPaused = false;
        this.protectAccumulatedSeconds = 0;
        this.protectSessionStartedAt = null;

        for (const modal of this.protectModals()) {
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            modal.inert = true;
            const center = modal.querySelector('.protect-modal-center');
            if (center) center.classList.remove('is-paused');
        }
    }
}

export { TaskWorkspace };
