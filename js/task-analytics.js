import { TIMER_ACTORS, canonicalType, durationForTask } from './task-model.js';
function localDateKey(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function analysisWindow(period = '30', now = Date.now()) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    let rangeLabel;
    let shortPeriod = false;

    if (period === 'today') {
        start.setHours(0, 0, 0, 0);
        rangeLabel = t('ui.text.today');
        shortPeriod = true;
    } else if (period === 'this-week') {
        const daysSinceMonday = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - daysSinceMonday);
        start.setHours(0, 0, 0, 0);
        rangeLabel = t('ui.text.thisWeek');
        shortPeriod = true;
    } else {
        const days = Math.min(365, Math.max(1, Number(period) || 30));
        start.setDate(start.getDate() - days + 1);
        start.setHours(0, 0, 0, 0);
        rangeLabel = days === 365 ? t('ui.text.lastYear') : t('ui.text.lastValue0Days', { value0: days });
    }

    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return { start, end, dates, rangeLabel, shortPeriod };
}

function analyticsFor(tasks, options = {}) {
    const taskView = options.groupBy === '';
    const groupBy = taskView ? '' : canonicalType(options.groupBy || 'project');
    const groupedBy = groupBy || 'project';
    const measure = options.measure === 'tasks' ? 'tasks' : 'time';
    const period = String(options.period ?? options.days ?? '30');
    const windowRange = analysisWindow(period);
    const { start, end, dates } = windowRange;
    const totals = new Map();
    const dailyByGroup = new Map();
    const dailyTasks = dates.map(() => new Map());
    const dateIndexes = new Map(dates.map((date, index) => [localDateKey(date), index]));
    const allocations = (task) => {
        const values = task.associations.filter((item) => item.type === groupedBy).map((item) => item.value);
        return values.length ? values : ['Unassigned'];
    };
    const dailyValues = (name) => {
        if (!dailyByGroup.has(name)) dailyByGroup.set(name, new Array(dates.length).fill(0));
        return dailyByGroup.get(name);
    };
    const addDailyAmount = (values, index, amount) => {
        if (index === undefined || index < 0 || index >= dates.length || amount <= 0) return;
        for (const value of values) dailyValues(value)[index] += amount / values.length;
    };
    const addDailyTask = (task, index, amount, firstAt) => {
        if (index === undefined || index < 0 || index >= dates.length || amount <= 0) return;
        const bucket = dailyTasks[index];
        const existing = bucket.get(task.id) || { taskId: task.id, label: task.text, value: 0, firstAt };
        existing.value += amount;
        existing.firstAt = Math.min(existing.firstAt, firstAt);
        bucket.set(task.id, existing);
    };

    for (const task of tasks) {
        const values = allocations(task);
        const amount = measure === 'tasks' ? 1 : durationForTask(task);
        for (const value of values) totals.set(value, (totals.get(value) || 0) + amount / values.length);

        if (measure === 'tasks') {
            const taskDate = new Date(task.createdAt);
            if (!Number.isNaN(taskDate.getTime())) {
                const index = dateIndexes.get(localDateKey(taskDate));
                addDailyAmount(values, index, 1);
                addDailyTask(task, index, 1, taskDate.getTime());
            }
            continue;
        }

        const sessions = [...task.sessions];
        for (const actor of TIMER_ACTORS) {
            const startedAt = task.activeTimers?.[actor];
            if (startedAt) sessions.push({ actor, startedAt, endedAt: new Date().toISOString() });
        }
        for (const session of sessions) {
            const startedAt = Date.parse(session.startedAt);
            const explicitEnd = Date.parse(session.endedAt);
            const endedAt = !Number.isNaN(explicitEnd)
                ? explicitEnd
                : startedAt + Number(session.durationSeconds || 0) * 1000;
            const rangeEnd = end.getTime() + 1;
            if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= start.getTime() || startedAt >= rangeEnd) continue;
            const dayCursor = new Date(Math.max(startedAt, start.getTime()));
            dayCursor.setHours(0, 0, 0, 0);
            while (dayCursor.getTime() < Math.min(endedAt, rangeEnd)) {
                const dayStart = dayCursor.getTime();
                const nextDay = new Date(dayCursor);
                nextDay.setDate(nextDay.getDate() + 1);
                const overlap = Math.max(0, Math.min(endedAt, rangeEnd, nextDay.getTime()) - Math.max(startedAt, dayStart)) / 1000;
                const index = dateIndexes.get(localDateKey(dayCursor));
                addDailyAmount(values, index, overlap);
                addDailyTask(task, index, overlap, Math.max(startedAt, dayStart));
                dayCursor.setDate(dayCursor.getDate() + 1);
            }
        }
    }

    if (!dailyByGroup.size) dailyByGroup.set('Unassigned', new Array(dates.length).fill(0));
    const rankedDailySeries = [...dailyByGroup.entries()]
        .map(([label, values]) => ({ label, values, total: values.reduce((sum, value) => sum + value, 0) }))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    const assignedDailySeries = rankedDailySeries.filter(item => item.label !== 'Unassigned');
    const unassignedSeries = rankedDailySeries.find(item => item.label === 'Unassigned');
    const visiblePileSeries = assignedDailySeries.slice(0, 6);
    if (assignedDailySeries.length > visiblePileSeries.length) {
        const otherValues = new Array(dates.length).fill(0);
        for (const item of assignedDailySeries.slice(visiblePileSeries.length)) {
            item.values.forEach((value, index) => { otherValues[index] += value; });
        }
        visiblePileSeries.push({ label: 'Other', values: otherValues, total: otherValues.reduce((sum, value) => sum + value, 0), associationValues: assignedDailySeries.slice(visiblePileSeries.length).map(item => item.label) });
        visiblePileSeries.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    }

    // Every group contributes to both dated charts, including unassigned work.
    if (unassignedSeries) visiblePileSeries.push(unassignedSeries);
    const timelineSeries = [...assignedDailySeries, ...(unassignedSeries ? [unassignedSeries] : [])].map((item) => {
        const values = [...item.values];
        for (let index = 1; index < values.length; index += 1) values[index] += values[index - 1];
        return { label: item.label, values };
    });
    const labels = dates.map(localDateKey);
    const tasksByDay = dailyTasks.map((bucket) => [...bucket.values()]
        .sort((a, b) => a.firstAt - b.firstAt || a.label.localeCompare(b.label)));

    return {
        groupBy,
        taskView,
        measure,
        period,
        days: dates.length,
        rangeLabel: windowRange.rangeLabel,
        shortPeriod: windowRange.shortPeriod,
        partWhole: [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
        pile: { labels, series: visiblePileSeries, unassigned: unassignedSeries },
        taskPile: { labels, days: tasksByDay },
        timeline: { labels, series: timelineSeries, unassigned: unassignedSeries }
    };
}

export { localDateKey, analysisWindow, analyticsFor };
