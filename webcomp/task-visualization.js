import { COMMON_PROPERTIES, COLOR_PALETTE, cloneValue, formatDuration, colorFor } from '../js/task-model.js';
import { analysisWindow, analyticsFor } from '../js/task-analytics.js';

class TaskVisualization extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._tasks = [];
        this.mode = 'parts';
        this.measure = 'time';
        this.groupBy = 'project';
        this.lastGroupedBy = 'project';
        this.period = '30';
        this.taskHitRegions = [];
        this.resizeObserver = new ResizeObserver(() => this.draw());
    }

    connectedCallback() {
        this.render();
        this.resizeObserver.observe(this);
    }

    disconnectedCallback() { this.resizeObserver.disconnect(); }
    set tasks(value) { this._tasks = cloneValue(value || []); if (this.isConnected) this.refresh(); }
    get tasks() { return cloneValue(this._tasks); }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                * { box-sizing: border-box; }
                button, select { font: inherit; color: inherit; }
                .panel { min-height: 390px; padding: 14px; border: 1px solid var(--ink, #18242b); border-radius: 13px; background: var(--panel, #fffdf7); box-shadow: 3px 3px 0 rgba(24,36,43,.1); }
                .mode-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; border-radius: 9px; background: var(--paper-deep, #e8e1d2); }
                .mode-tabs button { min-height: 31px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: var(--muted, #697177); font-size: 11px; font-weight: 800; }
                .mode-tabs button.active { background: var(--panel, #fffdf7); color: var(--ink, #18242b); box-shadow: 1px 1px 0 rgba(24,36,43,.15); }
                button[role="tab"]:hover { background: var(--panel, #fffdf7); color: var(--ink, #18242b); }
                .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 11px 0 6px; }
                label { display: grid; gap: 4px; color: var(--muted, #697177); font: 700 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .06em; }
                select { width: 100%; height: 34px; border: 1px solid #cfc8b8; border-radius: 7px; background: #fffdf7; padding: 0 7px; font-size: 11px; text-transform: none; }
                .chart-title { margin: 15px 0 0; font-size: 13px; font-weight: 850; }
                .chart-subtitle { margin: 3px 0 8px; color: var(--muted, #697177); font-size: 10px; }
                .canvas-wrap { position: relative; height: 210px; }
                canvas { width: 100%; height: 100%; display: block; }
                .task-hit-layer { position: absolute; inset: 0; pointer-events: none; }
                .task-hit { position: absolute; min-width: 0; min-height: 0; margin: 0; border: 0; border-radius: 0; padding: 0; background: transparent; box-shadow: none; cursor: pointer; pointer-events: auto; }
                .task-hit:focus-visible { outline: 2px solid var(--ink, #18242b); outline-offset: 1px; background: rgba(255,255,255,.14); }
                .chart-tooltip { position: absolute; z-index: 3; max-width: min(230px, calc(100% - 16px)); padding: 6px 8px; border: 1px solid var(--ink, #18242b); border-radius: 6px; background: var(--ink, #18242b); color: white; box-shadow: 2px 2px 0 rgba(24,36,43,.14); font-size: 10px; font-weight: 750; line-height: 1.3; text-align: center; pointer-events: none; }
                .empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 35px; color: var(--muted, #697177); text-align: center; font-size: 11px; line-height: 1.5; }
                .legend { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 10px; margin-top: 8px; }
                .legend-item { min-width: 0; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 5px; font-size: 9px; }
                button.legend-item { width: 100%; border: 0; border-radius: 4px; padding: 4px; background: transparent; text-align: left; cursor: pointer; }
                button.legend-item:hover { background: var(--paper-deep, #e8e1d2); }
                button.legend-item:focus-visible { outline: 2px solid var(--ink, #18242b); outline-offset: 1px; }
                .swatch { width: 7px; height: 7px; border-radius: 2px; }
                .legend-name { overflow: hidden; color: var(--muted, #697177); text-overflow: ellipsis; white-space: nowrap; }
                .legend-value { font: 750 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
                @media (max-width: 1120px) { .panel { min-height: 355px; } .canvas-wrap { height: 190px; } }
            </style>
            <section class="panel" aria-label="${escapeHTML(t('ui.text.taskAnalytics'))}">
                <div class="mode-tabs" role="tablist" aria-label="${escapeHTML(t('ui.text.visualizationType'))}">
                    <button type="button" data-mode="parts" class="active" role="tab" aria-selected="true">${escapeHTML(t('ui.text.partWhole'))}</button>
                    <button type="button" data-mode="timeline" role="tab" aria-selected="false">${escapeHTML(t('ui.text.timeline'))}</button>
                    <button type="button" data-mode="pile" role="tab" aria-selected="false">${escapeHTML(t('ui.text.timePile'))}</button>
                </div>
                <div class="controls">
                    <label>${escapeHTML(t('ui.text.measure'))}<select class="measure"><option value="time">${escapeHTML(t('ui.text.trackedTime'))}</option><option value="tasks">${escapeHTML(t('ui.text.taskCount'))}</option></select></label>
                    <label>${escapeHTML(t('ui.text.groupBy'))}<select class="group-by"></select></label>
                    <label class="period-control" hidden>${escapeHTML(t('ui.text.window'))}<select class="period"><option value="today">${escapeHTML(t('ui.text.today'))}</option><option value="this-week">${escapeHTML(t('ui.text.thisWeek'))}</option><option value="14">${escapeHTML(t('ui.text.14Days'))}</option><option value="30" selected>${escapeHTML(t('ui.text.30Days'))}</option><option value="90">${escapeHTML(t('ui.text.90Days'))}</option><option value="365">${escapeHTML(t('ui.text.1Year'))}</option></select></label>
                </div>
                <h3 class="chart-title"></h3>
                <p class="chart-subtitle"></p>
                <div class="canvas-wrap">
                    <canvas role="img"></canvas>
                    <div class="task-hit-layer"></div>
                    <div class="chart-tooltip" role="tooltip" hidden></div>
                    <div class="empty" hidden></div>
                </div>
                <div class="legend" aria-label="${escapeHTML(t('ui.text.chartLegend'))}"></div>
            </section>
        `;
        this.shadowRoot.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
            this.mode = button.dataset.mode;
            this.shadowRoot.querySelectorAll('[data-mode]').forEach((candidate) => {
                const active = candidate === button;
                candidate.classList.toggle('active', active);
                candidate.setAttribute('aria-selected', String(active));
            });
            this.shadowRoot.querySelector('.period-control').hidden = this.mode === 'parts';
            this.refresh();
        }));
        this.shadowRoot.querySelector('.measure').addEventListener('change', (event) => { this.measure = event.target.value; this.refresh(); });
        this.shadowRoot.querySelector('.group-by').addEventListener('change', (event) => {
            this.groupBy = event.target.value;
            if (this.groupBy) this.lastGroupedBy = this.groupBy;
            this.refresh();
        });
        this.shadowRoot.querySelector('.period').addEventListener('change', (event) => { this.period = event.target.value; this.refresh(); });
        this.refresh();
    }

    refresh() {
        const groupSelect = this.shadowRoot.querySelector('.group-by');
        const types = [...new Set(this._tasks.flatMap((task) => task.associations.map((item) => item.type)))].sort();
        if (!types.length) types.push(...COMMON_PROPERTIES.slice(0, 3));
        const windowRange = analysisWindow(this.period);
        const allowTaskView = this.mode === 'pile' && windowRange.shortPeriod;
        if (!allowTaskView && !this.groupBy) this.groupBy = types.includes(this.lastGroupedBy) ? this.lastGroupedBy : types[0];
        if (this.groupBy && !types.includes(this.groupBy)) this.groupBy = types[0];
        const oldValue = this.groupBy;
        const options = types.map((type) => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = uiLabel(type);
            return option;
        });
        if (allowTaskView) {
            const taskOption = document.createElement('option');
            taskOption.value = '';
            taskOption.textContent = '';
            taskOption.setAttribute('aria-label', t('ui.text.individualTasksByTimeOfDay'));
            options.unshift(taskOption);
        }
        groupSelect.replaceChildren(...options);
        groupSelect.value = oldValue;
        const title = this.shadowRoot.querySelector('.chart-title');
        const subtitle = this.shadowRoot.querySelector('.chart-subtitle');
        if (this.mode === 'parts') {
            title.textContent = t('ui.text.value0ByValue1', { value0: this.measure === 'time' ? t('ui.text.time') : t('ui.text.tasks'), value1: uiLabel(this.groupBy) });
            subtitle.textContent = t('ui.text.associatedWorkIsDividedEvenlyUnassignedWorkIsListedBelowAndExcludedFromTheChart');
        } else if (this.mode === 'pile') {
            title.textContent = t('ui.text.timePileValue0ByValue1', { value0: this.measure === 'time' ? t('ui.text.trackedTime') : t('ui.text.taskCount'), value1: uiLabel(this.groupBy || 'task') });
            subtitle.textContent = this.groupBy
                ? t('ui.text.value0LargestAssignedPeriodTotalAtTheBaseIncludesUnassignedWork', { value0: windowRange.rangeLabel })
                : t('ui.text.value0IndividualTasksOrderedByTimeOfDayEarliestAtTheBase', { value0: windowRange.rangeLabel });
        } else {
            title.textContent = t('ui.text.cumulativeValue0', { value0: this.measure === 'time' ? t('ui.text.trackedTime2') : t('ui.text.taskGrowth') });
            subtitle.textContent = t('ui.text.value0AttributedByValue1IncludesUnassignedWork', { value0: windowRange.rangeLabel, value1: uiLabel(this.groupBy) });
        }
        queueMicrotask(() => this.draw());
    }

    draw() {
        const canvas = this.shadowRoot.querySelector('canvas');
        if (!canvas) return;
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        canvas.width = Math.round(bounds.width * ratio);
        canvas.height = Math.round(bounds.height * ratio);
        const context = canvas.getContext('2d');
        context.scale(ratio, ratio);
        context.clearRect(0, 0, bounds.width, bounds.height);
        this.clearTaskInteractions();
        const analytics = analyticsFor(this._tasks, { groupBy: this.groupBy, measure: this.measure, period: this.period });
        if (this.mode === 'parts') this.drawPie(context, bounds, analytics);
        else if (this.mode === 'pile') this.drawPile(context, bounds, analytics);
        else this.drawLine(context, bounds, analytics);
    }

    setEmpty(message) {
        const empty = this.shadowRoot.querySelector('.empty');
        empty.hidden = !message;
        empty.textContent = message || '';
    }

    clearTaskInteractions() {
        this.taskHitRegions = [];
        this.shadowRoot.querySelector('.task-hit-layer')?.replaceChildren();
        const tooltip = this.shadowRoot.querySelector('.chart-tooltip');
        if (tooltip) tooltip.hidden = true;
    }

    renderTaskInteractions() {
        const layer = this.shadowRoot.querySelector('.task-hit-layer');
        const tooltip = this.shadowRoot.querySelector('.chart-tooltip');
        if (!layer || !tooltip) return;
        const showTooltip = (region) => {
            tooltip.textContent = uiLabel(region.label);
            tooltip.hidden = false;
            const halfWidth = tooltip.offsetWidth / 2;
            const center = Math.max(8 + halfWidth, Math.min(layer.clientWidth - 8 - halfWidth, region.x + region.width / 2));
            tooltip.style.left = `${center}px`;
            if (region.y < 42) {
                tooltip.style.top = `${region.y + region.height + 6}px`;
                tooltip.style.transform = 'translateX(-50%)';
            } else {
                tooltip.style.top = `${region.y - 6}px`;
                tooltip.style.transform = 'translate(-50%, -100%)';
            }
        };
        const hideTooltip = () => { tooltip.hidden = true; };
        layer.replaceChildren(...this.taskHitRegions.map((region) => {
            const target = document.createElement('button');
            target.type = 'button';
            target.className = 'task-hit';
            target.style.left = `${region.x}px`;
            target.style.top = `${region.y}px`;
            target.style.width = `${region.width}px`;
            target.style.height = `${region.height}px`;
            target.setAttribute('aria-label', t('ui.text.openTaskValue0', { value0: region.label }));
            target.addEventListener('pointerenter', () => showTooltip(region));
            target.addEventListener('pointerleave', hideTooltip);
            target.addEventListener('focus', () => showTooltip(region));
            target.addEventListener('blur', hideTooltip);
            target.addEventListener('click', () => this.dispatchEvent(new CustomEvent('task-chart-navigate', {
                bubbles: true,
                composed: true,
                detail: { id: region.taskId }
            })));
            return target;
        }));
    }

    renderLegend(items) {
        const legend = this.shadowRoot.querySelector('.legend');
        const unassigned = items.find(item => item.label === 'Unassigned');
        const listed = items.filter(item => item.label !== 'Unassigned');
        if (unassigned) listed.push(unassigned);
        legend.replaceChildren(...listed.map((item, index) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'legend-item';
            row.title = t('ui.text.showTasksWithValue0Value1', { value0: this.groupBy, value1: item.label });
            row.setAttribute('aria-label', row.title);
            const association = { type: this.groupBy, value: item.label };
            if (item.associationValues) association.values = item.associationValues;
            row.addEventListener('click', () => this.dispatchEvent(new CustomEvent('task-chart-filter', {
                bubbles: true,
                composed: true,
                detail: association
            })));
            const swatch = document.createElement('span');
            swatch.className = 'swatch';
            swatch.style.background = item.label === 'Unassigned' ? '#cfc8b8' : COLOR_PALETTE[index % COLOR_PALETTE.length];
            const name = document.createElement('span');
            name.className = 'legend-name';
            name.textContent = uiLabel(item.label);
            const value = document.createElement('span');
            value.className = 'legend-value';
            value.textContent = this.measure === 'time' ? formatDuration(item.value, true) : String(Math.round(item.value * 10) / 10);
            row.append(swatch, name, value);
            return row;
        }));
    }

    drawPie(context, bounds, analytics) {
        const listed = analytics.partWhole.filter(item => item.value > 0);
        const data = listed.filter(item => item.label !== 'Unassigned');
        const total = data.reduce((sum, item) => sum + item.value, 0);
        this.renderLegend(listed);
        canvasLabel(this.shadowRoot.querySelector('canvas'), t('ui.text.partWholeChartOfValue0GroupedByValue1', { value0: uiLabel(this.measure), value1: uiLabel(this.groupBy) }));
        if (!total) { this.setEmpty(listed.length ? t('ui.text.associateTasksWithValue0ToBuildThisChart', { value0: this.groupBy }) : this.measure === 'time' ? t('ui.text.startATimerToBuildYourTimePicture') : t('ui.text.addAndAssociateATaskToBuildThisChart')); return; }
        this.setEmpty('');
        const centerX = bounds.width / 2;
        const centerY = bounds.height / 2;
        const radius = Math.min(bounds.width, bounds.height) * .37;
        let angle = -Math.PI / 2;
        data.forEach((item, index) => {
            const next = angle + (item.value / total) * Math.PI * 2;
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.arc(centerX, centerY, radius, angle, next);
            context.closePath();
            context.fillStyle = COLOR_PALETTE[index % COLOR_PALETTE.length];
            context.fill();
            context.strokeStyle = '#fffdf7';
            context.lineWidth = 3;
            context.stroke();
            angle = next;
        });
        context.beginPath();
        context.arc(centerX, centerY, radius * .53, 0, Math.PI * 2);
        context.fillStyle = '#fffdf7';
        context.fill();
        context.fillStyle = '#18242b';
        context.textAlign = 'center';
        context.font = '800 16px ui-monospace, monospace';
        context.fillText(this.measure === 'time' ? formatDuration(total, true) : String(Math.round(total)), centerX, centerY - 1);
        context.fillStyle = '#697177';
        context.font = '700 9px ui-monospace, monospace';
        context.fillText(this.measure === 'time' ? t('ui.text.aSSIGNEDTIME') : t('ui.text.aSSIGNEDTASKS'), centerX, centerY + 15);
    }

    drawPile(context, bounds, analytics) {
        const series = analytics.pile.series;
        const taskView = analytics.taskView && analytics.shortPeriod;
        const dailyTotals = taskView
            ? analytics.taskPile.days.map((items) => items.reduce((sum, item) => sum + item.value, 0))
            : analytics.pile.labels.map((_, dayIndex) => series.reduce((sum, item) => sum + item.values[dayIndex], 0));
        const max = Math.max(0, ...dailyTotals);
        this.renderLegend(taskView ? [] : series.map((item) => ({ label: item.label, value: item.total, associationValues: item.associationValues })));
        canvasLabel(
            this.shadowRoot.querySelector('canvas'),
            taskView
                ? t('ui.text.stackedDailyBarChartOfIndividualTasksOrderedByTimeOfDayEarliestAtTheBase')
                : t('ui.text.value0ChartOfValue1GroupedByValue2WithTheLargestPeriodTotalAtTheBase', { value0: analytics.shortPeriod ? t('ui.text.stackedDailyBar') : t('ui.text.stackedDailyLine'), value1: this.measure, value2: this.groupBy })
        );
        if (!max) {
            this.setEmpty(this.measure === 'time'
                ? t('ui.text.trackedSessionsFromValue0WillBuildThisPile', { value0: analytics.rangeLabel.toLowerCase() })
                : t('ui.text.tasksCreatedDuringValue0WillBuildThisPile', { value0: analytics.rangeLabel.toLowerCase() }));
            return;
        }
        this.setEmpty('');
        const padding = { top: 13, right: 8, bottom: 25, left: 39 };
        const width = bounds.width - padding.left - padding.right;
        const height = bounds.height - padding.top - padding.bottom;

        context.strokeStyle = '#ded8ca';
        context.lineWidth = 1;
        context.fillStyle = '#697177';
        context.font = '8px ui-monospace, monospace';
        context.textAlign = 'right';
        for (let index = 0; index <= 3; index += 1) {
            const y = padding.top + (height / 3) * index;
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(bounds.width - padding.right, y);
            context.stroke();
            const value = max * (1 - index / 3);
            context.fillText(this.measure === 'time' ? compactAxisTime(value) : String(Math.round(value)), padding.left - 5, y + 3);
        }

        if (analytics.shortPeriod) {
            const slotWidth = width / analytics.pile.labels.length;
            const barWidth = Math.min(46, slotWidth * .68);
            analytics.pile.labels.forEach((_, dayIndex) => {
                const x = padding.left + slotWidth * (dayIndex + .5) - barWidth / 2;
                let bottom = padding.top + height;
                const stackItems = taskView
                    ? analytics.taskPile.days[dayIndex].map((item) => ({ ...item, amount: item.value, color: colorFor(item.taskId) }))
                    : series.map((item, seriesIndex) => ({ ...item, amount: item.values[dayIndex], color: item.label === 'Unassigned' ? '#cfc8b8' : COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length] }));
                stackItems.forEach((item) => {
                    const segmentHeight = (item.amount / max) * height;
                    if (segmentHeight <= 0) return;
                    bottom -= segmentHeight;
                    context.fillStyle = item.color;
                    context.fillRect(x, bottom, barWidth, segmentHeight);
                    if (segmentHeight > 2) {
                        context.strokeStyle = '#fffdf7';
                        context.lineWidth = 1;
                        context.strokeRect(x, bottom, barWidth, segmentHeight);
                    }
                    if (taskView) this.taskHitRegions.push({
                        taskId: item.taskId,
                        label: item.label,
                        x,
                        y: bottom,
                        width: barWidth,
                        height: segmentHeight
                    });
                });
            });
            if (taskView) this.renderTaskInteractions();
        } else {
            let baseline = new Array(analytics.pile.labels.length).fill(0);
            series.forEach((item, seriesIndex) => {
                const top = item.values.map((value, index) => baseline[index] + value);
                const xFor = (index) => padding.left + (index / Math.max(1, top.length - 1)) * width;
                const yFor = (value) => padding.top + height - (value / max) * height;
                context.beginPath();
                top.forEach((value, index) => {
                    const x = xFor(index);
                    const y = yFor(value);
                    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
                });
                for (let index = baseline.length - 1; index >= 0; index -= 1) context.lineTo(xFor(index), yFor(baseline[index]));
                context.closePath();
                context.save();
                context.globalAlpha = .22;
                context.fillStyle = item.label === 'Unassigned' ? '#cfc8b8' : COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length];
                context.fill();
                context.restore();
                context.beginPath();
                top.forEach((value, index) => {
                    const x = xFor(index);
                    const y = yFor(value);
                    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
                });
                context.strokeStyle = item.label === 'Unassigned' ? '#cfc8b8' : COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length];
                context.lineWidth = 1.7;
                context.lineJoin = 'round';
                context.stroke();
                baseline = top;
            });
        }

        context.fillStyle = '#697177';
        context.font = '8px ui-monospace, monospace';
        if (analytics.shortPeriod) {
            const slotWidth = width / analytics.pile.labels.length;
            context.textAlign = 'center';
            analytics.pile.labels.forEach((label, index) => {
                const date = new Date(`${label}T12:00:00`);
                const text = analytics.days === 1 ? t('ui.text.today') : date.toLocaleDateString(window.i18n.currentLang, { weekday: 'short' });
                context.fillText(text, padding.left + slotWidth * (index + .5), bounds.height - 6);
            });
        } else {
            const first = new Date(`${analytics.pile.labels[0]}T12:00:00`);
            const last = new Date(`${analytics.pile.labels.at(-1)}T12:00:00`);
            context.textAlign = 'left';
            context.fillText(first.toLocaleDateString(window.i18n.currentLang, { month: 'short', day: 'numeric' }), padding.left, bounds.height - 6);
            context.textAlign = 'right';
            context.fillText(last.toLocaleDateString(window.i18n.currentLang, { month: 'short', day: 'numeric' }), bounds.width - padding.right, bounds.height - 6);
        }
    }

    drawLine(context, bounds, analytics) {
        const series = analytics.timeline.series;
        const max = Math.max(0, ...series.flatMap((item) => item.values));
        this.renderLegend(series.map((item) => ({ label: item.label, value: item.values.at(-1) || 0 })));
        canvasLabel(this.shadowRoot.querySelector('canvas'), t('ui.text.timelineOfCumulativeValue0GroupedByValue1', { value0: uiLabel(this.measure), value1: uiLabel(this.groupBy) }));
        if (!max) { this.setEmpty(this.measure === 'time' ? t('ui.text.completedTimerSessionsWillAppearOnThisTimeline') : t('ui.text.newTasksWillBuildYourGrowthTimeline')); return; }
        this.setEmpty('');
        const padding = { top: 13, right: 8, bottom: 25, left: 39 };
        const width = bounds.width - padding.left - padding.right;
        const height = bounds.height - padding.top - padding.bottom;
        context.strokeStyle = '#ded8ca';
        context.lineWidth = 1;
        context.fillStyle = '#697177';
        context.font = '8px ui-monospace, monospace';
        context.textAlign = 'right';
        for (let index = 0; index <= 3; index += 1) {
            const y = padding.top + (height / 3) * index;
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(bounds.width - padding.right, y);
            context.stroke();
            const value = max * (1 - index / 3);
            context.fillText(this.measure === 'time' ? compactAxisTime(value) : String(Math.round(value)), padding.left - 5, y + 3);
        }
        series.forEach((item, seriesIndex) => {
            context.beginPath();
            item.values.forEach((value, index) => {
                const x = padding.left + (item.values.length === 1 ? .5 : index / (item.values.length - 1)) * width;
                const y = padding.top + height - (value / max) * height;
                if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.strokeStyle = item.label === 'Unassigned' ? '#cfc8b8' : COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length];
            context.lineWidth = 2;
            context.lineJoin = 'round';
            context.stroke();
            if (item.values.length === 1) {
                context.beginPath();
                context.arc(padding.left + width / 2, padding.top + height - (item.values[0] / max) * height, 3, 0, Math.PI * 2);
                context.fillStyle = context.strokeStyle;
                context.fill();
            }
        });
        context.fillStyle = '#697177';
        context.font = '8px ui-monospace, monospace';
        context.textAlign = 'left';
        const first = new Date(`${analytics.timeline.labels[0]}T12:00:00`);
        const last = new Date(`${analytics.timeline.labels.at(-1)}T12:00:00`);
        context.fillText(first.toLocaleDateString(window.i18n.currentLang, { month: 'short', day: 'numeric' }), padding.left, bounds.height - 6);
        context.textAlign = 'right';
        context.fillText(last.toLocaleDateString(window.i18n.currentLang, { month: 'short', day: 'numeric' }), bounds.width - padding.right, bounds.height - 6);
    }
}

function canvasLabel(canvas, label) { canvas.setAttribute('aria-label', label); }
function compactAxisTime(seconds) {
    if (seconds >= 3600) return t('ui.text.hoursShort', { count: Math.round(seconds / 3600) });
    if (seconds >= 60) return t('ui.text.minutesShort', { count: Math.round(seconds / 60) });
    return t('ui.text.secondsShort', { count: Math.round(seconds) });
}
customElements.define('task-visualization', TaskVisualization);
