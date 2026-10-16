import { normalizeAssociations } from './task-planning-model.js';

const DB_NAME = 'taskimatic-local';
const DB_VERSION = 4;
const STORE_NAME = 'tasks';
const APP_VERSION = '2.1.0';
const COMMON_PROPERTIES = ['project', 'initiative', 'sub-system', 'feature', 'client', 'domain', 'work-area', 'dependent-task'];
const TIMER_ACTORS = ['human', 'agent'];
const COLOR_PALETTE = ['#315f91', '#e65135', '#28785c', '#8a5a94', '#b47720', '#277b84', '#9b3f57'];

const cloneValue = (value) => typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const uid = (prefix = 'task') => {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const nowISO = () => new Date().toISOString();
const cleanString = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const canonicalType = (value) => cleanString(value, 60).toLowerCase().replace(/\s+/g, '-');
const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
};
const basenameFromPathLike = (value) => {
    const trimmed = cleanString(value, 4096);
    if (!trimmed) return '';
    const normalized = trimmed.endsWith('/') || trimmed.endsWith('\\') ? trimmed.slice(0, -1) : trimmed;
    const parts = normalized.split(/[\\/]/);
    return parts[parts.length - 1] || normalized;
};
const extractTaskLinks = (task) => {
    const links = [];
    const seen = new Set();
    const addLink = (href, label) => {
        if (!href || seen.has(href)) return;
        seen.add(href);
        links.push({ href, label: cleanString(label, 180) || href });
    };

    for (const association of task.associations || []) {
        if (association.type === 'domain' && association.value.includes('.')) {
            const domain = cleanString(association.value, 255);
            if (!domain) continue;
            addLink(`http://${domain}`, domain);
        }
    }

    const notes = task.notes || '';
    for (const match of notes.matchAll(/http:\/\/\S+/g)) {
        const url = match[0];
        addLink(url, basenameFromPathLike(url));
    }
    for (const match of notes.matchAll(/\[([^\]]+)\]/g)) {
        const path = cleanString(match[1], 4096);
        if (!path) continue;
        addLink(`file://${path}`, basenameFromPathLike(path));
    }

    return links;
};

const durationCache = {
    totals: new Map(),
    today: new Map(),
    dayKey: '',
    todayStart: 0,
    version: 0
};

function currentDay(now = Date.now()) {
    const date = new Date(now);
    const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (durationCache.dayKey !== dayKey) {
        date.setHours(0, 0, 0, 0);
        durationCache.dayKey = dayKey;
        durationCache.todayStart = date.getTime();
        durationCache.today.clear();
        durationCache.version += 1;
    }
    return { key: durationCache.dayKey, start: durationCache.todayStart };
}

function invalidateDurationCache(taskId = null) {
    durationCache.version += 1;
    if (taskId) {
        durationCache.totals.delete(taskId);
        durationCache.today.delete(taskId);
        return;
    }
    durationCache.totals.clear();
    durationCache.today.clear();
}

function completedDurationsForTask(task) {
    let totals = durationCache.totals.get(task.id);
    if (totals) return totals;
    totals = { human: 0, agent: 0 };
    for (const session of task.sessions) {
        if (TIMER_ACTORS.includes(session.actor)) totals[session.actor] += Number(session.durationSeconds || 0);
    }
    durationCache.totals.set(task.id, totals);
    return totals;
}

function completedDurationsTodayForTask(task, now = Date.now()) {
    const { start: todayStart } = currentDay(now);
    let totals = durationCache.today.get(task.id);
    if (totals) return totals;
    totals = { human: 0, agent: 0 };
    for (const session of task.sessions) {
        if (!TIMER_ACTORS.includes(session.actor)) continue;
        const startedAt = Date.parse(session.startedAt);
        const endedAt = session.endedAt
            ? Date.parse(session.endedAt)
            : startedAt + Number(session.durationSeconds || 0) * 1000;
        if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) continue;
        totals[session.actor] += Math.max(0, Math.min(endedAt, now) - Math.max(startedAt, todayStart)) / 1000;
    }
    durationCache.today.set(task.id, totals);
    return totals;
}

function normalizeTask(input = {}) {
    const createdAt = input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : nowISO();
    const sessions = Array.isArray(input.sessions) ? input.sessions.flatMap((session) => {
        const startedAt = session?.startedAt ?? session?.datetime;
        const durationSeconds = Math.max(0, Number(session?.durationSeconds ?? session?.duration ?? 0) || 0);
        if (!startedAt || Number.isNaN(Date.parse(startedAt))) return [];
        const endedAt = session.endedAt && !Number.isNaN(Date.parse(session.endedAt))
            ? session.endedAt
            : new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString();
        const actor = TIMER_ACTORS.includes(session.actor) ? session.actor : 'human';
        return [{ id: cleanString(session.id, 100) || uid('session'), actor, startedAt, endedAt, durationSeconds }];
    }) : [];

    const legacyTimer = input.activeTimerStartedAt && !Number.isNaN(Date.parse(input.activeTimerStartedAt))
        ? input.activeTimerStartedAt
        : null;
    const activeTimers = Object.fromEntries(TIMER_ACTORS.map((actor) => {
        const value = input.activeTimers?.[actor] ?? (actor === 'human' ? legacyTimer : null);
        return [actor, value && !Number.isNaN(Date.parse(value)) ? value : null];
    }));
    const tabled = input.tabled === true;
    const priority = Number.isInteger(Number(input.priority)) && Number(input.priority) > 0
        ? Number(input.priority)
        : null;
    const tabledAt = tabled
        ? (input.tabledAt && !Number.isNaN(Date.parse(input.tabledAt))
            ? input.tabledAt
            : (input.updatedAt && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : createdAt))
        : null;

    return {
        id: cleanString(input.id, 120) || uid(),
        text: cleanString(input.text ?? input.name, 1000) || t('ui.text.untitledTask'),
        notes: cleanString(input.notes, 10000),
        prompts: String(input.prompts ?? '').slice(0, 50000),
        estimatedMinutes: [10, 30, 60, 90].includes(Number(input.estimatedMinutes)) ? Number(input.estimatedMinutes) : null,
        agentId: cleanString(input.agentId, 120) || null,
        status: input.status === 'done' || input.completed === true ? 'done' : 'open',
        planId: cleanString(input.planId, 120) || null,
        today: input.today === true,
        tabled,
        tabledAt,
        priority,
        createdAt,
        updatedAt: input.updatedAt && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : createdAt,
        completedAt: input.completedAt && !Number.isNaN(Date.parse(input.completedAt)) ? input.completedAt : null,
        associations: normalizeAssociations(input.associations ?? input.groups ?? []),
        sessions,
        activeTimers: tabled ? { human: null, agent: null } : activeTimers
    };
}

function parseQuickTask(raw) {
    const associations = [];
    const tokenPattern = /#([\w-]+):(?:"([^"]+)"|([^\s#]+))/g;
    const text = String(raw).replace(tokenPattern, (_, type, quoted, plain) => {
        associations.push({ type, value: quoted ?? plain });
        return '';
    }).replace(/\s{2,}/g, ' ').trim();
    return { text, associations: normalizeAssociations(associations) };
}

function durationForTask(task, actor = null, includeActive = true, now = Date.now()) {
    const completed = completedDurationsForTask(task);
    const stored = actor ? completed[actor] : TIMER_ACTORS.reduce((sum, timerActor) => sum + completed[timerActor], 0);
    if (!includeActive) return stored;
    const actors = actor ? [actor] : TIMER_ACTORS;
    return stored + actors.reduce((sum, timerActor) => {
        const startedAt = task.activeTimers?.[timerActor];
        return sum + (startedAt ? Math.max(0, (now - Date.parse(startedAt)) / 1000) : 0);
    }, 0);
}

function durationTodayForTask(task, actor = null, now = Date.now()) {
    const { start: todayStart } = currentDay(now);
    const completed = completedDurationsTodayForTask(task, now);
    const stored = actor ? completed[actor] : TIMER_ACTORS.reduce((sum, timerActor) => sum + completed[timerActor], 0);
    const actors = actor ? [actor] : TIMER_ACTORS;
    return stored + actors.reduce((sum, timerActor) => {
        const startedAt = Date.parse(task.activeTimers?.[timerActor]);
        if (Number.isNaN(startedAt)) return sum;
        return sum + Math.max(0, now - Math.max(startedAt, todayStart)) / 1000;
    }, 0);
}

function formatAge(createdAt, now = new Date()) {
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime()) || created >= now) return t('ui.text.0Months0Days0Hours0Minutes');
    let cursor = new Date(created);
    let months = (now.getFullYear() - cursor.getFullYear()) * 12 + now.getMonth() - cursor.getMonth();
    const candidate = new Date(cursor);
    candidate.setMonth(candidate.getMonth() + months);
    if (candidate > now) months -= 1;
    cursor = new Date(created);
    cursor.setMonth(cursor.getMonth() + months);
    const remainderMinutes = Math.max(0, Math.floor((now - cursor) / 60000));
    const days = Math.floor(remainderMinutes / 1440);
    const hours = Math.floor((remainderMinutes % 1440) / 60);
    const minutes = remainderMinutes % 60;
    return t('ui.text.ageDuration', { months, days, hours, minutes });
}

function formatDuration(seconds, compact = false) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (compact) {
        if (hours) return t('ui.text.value0HValue1M', { value0: hours, value1: minutes });
        if (minutes) return t('ui.text.value0MValue1S', { value0: minutes, value1: secs });
        return t('ui.text.secondsShort', { count: secs });
    }
    return hours
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatProtectTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function colorFor(value) {
    let hash = 0;
    for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

export { DB_NAME, DB_VERSION, STORE_NAME, APP_VERSION, COMMON_PROPERTIES, TIMER_ACTORS, COLOR_PALETTE, cloneValue, uid, nowISO, cleanString, canonicalType, setText, basenameFromPathLike, extractTaskLinks, durationCache, currentDay, invalidateDurationCache, completedDurationsForTask, completedDurationsTodayForTask, normalizeTask, parseQuickTask, durationForTask, durationTodayForTask, formatAge, formatDuration, formatProtectTime, colorFor };
