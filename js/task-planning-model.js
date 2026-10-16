// Wants can produce plans, and plans can produce tasks. Both parent links are optional.
export const WORKSPACE_COLLECTIONS = Object.freeze(['tasks', 'plans', 'wants', 'agents']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const recordId = kind => `${kind}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;

export function normalizeAssociations(input = []) {
    const pairs = [];
    if (Array.isArray(input)) {
        for (const item of input) {
            if (typeof item === 'string' && item.includes(':')) {
                const [type, ...rest] = item.split(':');
                pairs.push({ type, value: rest.join(':') });
            } else if (item && typeof item === 'object') {
                pairs.push({ type: item.type ?? item.property, value: item.value ?? item.name });
            }
        }
    } else if (input && typeof input === 'object') {
        for (const [type, values] of Object.entries(input)) {
            for (const value of Array.isArray(values) ? values : [values]) pairs.push({ type, value });
        }
    }
    const seen = new Set();
    return pairs.flatMap(({ type, value }) => {
        const association = { type: text(type, 60).toLowerCase().replace(/\s+/g, '-'), value: text(value, 120) };
        const key = `${association.type}\u0000${association.value.toLowerCase()}`;
        if (!association.type || !association.value || seen.has(key)) return [];
        seen.add(key);
        return [association];
    });
}

export function normalizePlanningRecord(kind, input = {}) {
    if (!['plans', 'wants'].includes(kind)) throw new Error('Expected plans or wants.');
    const createdAt = input.createdAt && Number.isFinite(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
    const record = {
        id: text(input.id, 120) || recordId(kind === 'plans' ? 'plan' : 'want'),
        text: text(input.text ?? input.title ?? input.name, 1000) || (kind === 'plans' ? 'Untitled plan' : 'Untitled want'),
        notes: text(input.notes, 10000),
        associations: normalizeAssociations(input.associations ?? input.groups ?? []),
        createdAt,
        updatedAt: input.updatedAt && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : createdAt
    };
    if (kind === 'plans') {
        record.wantId = text(input.wantId, 120) || null;
        record.myThinking = String(input.myThinking ?? input.notes ?? '').slice(0, 50000);
        record.aiThinking = String(input.aiThinking ?? '').slice(0, 50000);
        delete record.notes;
    }
    return record;
}

export function normalizeAgent(input = {}) {
    const createdAt = input.createdAt && Number.isFinite(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
    return {
        id: text(input.id, 120) || recordId('agent'),
        name: text(input.name, 120),
        createdAt,
        updatedAt: input.updatedAt && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : createdAt
    };
}

export function agentTaskReferences(tasks, agentId) {
    return tasks.filter(task => task.agentId === agentId);
}

export function normalizeWorkspaceSnapshot(input, normalizeTask) {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    const source = Array.isArray(parsed) ? { tasks: parsed } : parsed;
    if (!source || typeof source !== 'object' || !WORKSPACE_COLLECTIONS.some(kind => Array.isArray(source[kind]))) {
        throw new Error('Expected a workspace export or an array of tasks.');
    }
    return Object.fromEntries(WORKSPACE_COLLECTIONS.map(kind => {
        if (source[kind] !== undefined && !Array.isArray(source[kind])) throw new Error(`${kind} must be an array.`);
        const ids = new Set();
        const records = (source[kind] || []).map(inputRecord => {
            if (!inputRecord || typeof inputRecord !== 'object' || Array.isArray(inputRecord)) throw new Error(`Invalid ${kind} record.`);
            const record = kind === 'tasks' ? normalizeTask(inputRecord) : kind === 'agents' ? normalizeAgent(inputRecord) : normalizePlanningRecord(kind, inputRecord);
            if (kind === 'agents' && !record.name) throw new Error('An agent name is required.');
            if (ids.has(record.id)) throw new Error(`Duplicate ${kind} ID: ${record.id}`);
            ids.add(record.id);
            return record;
        });
        return [kind, records];
    }));
}

export function validateWorkspaceLinks({ tasks, plans, wants, agents = [] }) {
    const planIds = new Set(plans.map(plan => plan.id));
    const agentIds = new Set(agents.map(agent => agent.id));
    const wantIds = new Set(wants.map(want => want.id));
    for (const task of tasks) if (task.planId && !planIds.has(task.planId)) throw new Error(`Plan not found: ${task.planId}`);
    for (const task of tasks) if (task.agentId && !agentIds.has(task.agentId)) throw new Error(`Agent not found: ${task.agentId}`);
    for (const plan of plans) if (plan.wantId && !wantIds.has(plan.wantId)) throw new Error(`Want not found: ${plan.wantId}`);
}

// Rollups are derived, so reassignment or association edits never leave stale copies.
export function planningAssociations(kind, record, { tasks, plans }) {
    const inherited = kind === 'plans'
        ? tasks.filter(task => task.planId === record.id).flatMap(task => task.associations || [])
        : plans.filter(plan => plan.wantId === record.id).flatMap(plan => planningAssociations('plans', plan, { tasks, plans }));
    return normalizeAssociations([...(record.associations || []), ...inherited]);
}
