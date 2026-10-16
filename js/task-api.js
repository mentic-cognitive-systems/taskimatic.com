import { APP_VERSION, cloneValue } from './task-model.js';
import { analyticsFor } from './task-analytics.js';
import { WORKSPACE_COLLECTIONS } from './task-planning-model.js';

export function installTaskimaticAPI() {
    const apiManifest = Object.freeze({
        name: 'Taskimatic',
        version: APP_VERSION,
        description: 'JSON-friendly local task and time management API for people, browser automation, and MCP tools.',
        storage: 'OPFS with IndexedDB fallback',
        dataModel: { schemaVersion: 3, collections: [...WORKSPACE_COLLECTIONS], relationships: { 'tasks.planId': 'Optional Plan ID', 'plans.wantId': 'Optional Want ID', 'tasks.agentId': 'Optional named Agent ID' }, rollups: 'listPlans/listWants expose derived effectiveAssociations; exports preserve own associations and parent links.' },
        methods: {
            createAgent: { input: '{ name }', returns: 'Named Agent' },
            listAgents: { input: 'none', returns: 'Named Agent[]' },
            deleteAgent: { input: 'id; allowed only with no assigned tasks', returns: '{ id, deleted }' },
            createPlan: { input: '{ text, myThinking?, aiThinking?, wantId?, associations? }', returns: 'Plan' },
            updatePlan: { input: 'id, { text?, myThinking?, aiThinking?, wantId?, associations? }', returns: 'Plan' },
            listPlans: { input: '{ wantId?, search?, association? }', returns: 'Plan[] with effectiveAssociations' },
            deletePlan: { input: 'id; keeps and unlinks tasks', returns: '{ id, deleted }' },
            createWant: { input: '{ text, notes?, associations? }', returns: 'Want' },
            updateWant: { input: 'id, { text?, notes?, associations? }', returns: 'Want' },
            listWants: { input: '{ search?, association? }', returns: 'Want[] with effectiveAssociations' },
            deleteWant: { input: 'id; keeps and unlinks plans', returns: '{ id, deleted }' },
            createTask: { input: '{ text, notes?, prompts?, estimatedMinutes?: 10 | 30 | 60 | 90 | null, agentId?, planId?, today?, tabled?, associations?: [{ type, value }] }', returns: 'Task' },
            updateTask: { input: 'id, { text?, notes?, prompts?, estimatedMinutes?: 10 | 30 | 60 | 90 | null, agentId?, planId?, status?, today?, tabled?, associations? }', returns: 'Task' },
            listTasks: { input: '{ status?: "open"|"tabled"|"done"|"all", today?: boolean, planId?: string|null, agentId?: string|null, search?, association?: { type, value } }', returns: 'Task[]' },
            deleteTask: { input: 'id', returns: '{ id, deleted }' },
            startTimer: { input: 'id, actor?: "human"|"agent"', returns: 'Task' },
            stopTimer: { input: 'id, actor?: "human"|"agent"', returns: 'Task' },
            addAssociation: { input: 'id, { type, value }', returns: 'Task' },
            removeAssociation: { input: 'id, { type, value }', returns: 'Task' },
            getAnalytics: { input: '{ groupBy?, measure?: "time"|"tasks", days? }', returns: 'Analytics' },
            exportData: { input: 'none', returns: 'taskimatic export object' },
            importData: { input: 'export object|string, { strategy?: "merge"|"replace" }', returns: 'Import summary' },
            downloadApp: { input: 'none', returns: 'Download summary' }
        },
        events: ['taskimatic:ready', 'taskimatic:change']
    });

    const getWorkspace = async () => {
        await customElements.whenDefined('task-workspace');
        const workspace = document.querySelector('task-workspace');
        if (!workspace) throw new Error(t('error.messages.taskimaticWorkspaceIsNotMounted'));
        await workspace.ready;
        return workspace;
    };

    window.taskimatic = Object.freeze({
        version: APP_VERSION,
        manifest: apiManifest,
        describe: () => cloneValue(apiManifest),
        createAgent: async input => (await getWorkspace()).createAgent(input),
        listAgents: async () => cloneValue((await getWorkspace()).agents),
        deleteAgent: async id => (await getWorkspace()).deleteAgent(id),
        createPlan: async input => (await getWorkspace()).createPlanning('plans', input),
        updatePlan: async (id, patch) => (await getWorkspace()).updatePlanning('plans', id, patch),
        listPlans: async (query = {}) => (await getWorkspace()).listPlanning('plans', query),
        deletePlan: async id => (await getWorkspace()).deletePlanning('plans', id),
        createWant: async input => (await getWorkspace()).createPlanning('wants', input),
        updateWant: async (id, patch) => (await getWorkspace()).updatePlanning('wants', id, patch),
        listWants: async (query = {}) => (await getWorkspace()).listPlanning('wants', query),
        deleteWant: async id => (await getWorkspace()).deletePlanning('wants', id),
        createTask: async (input) => (await getWorkspace()).createTask(input),
        updateTask: async (id, patch) => (await getWorkspace()).updateTask(id, patch),
        listTasks: async (query = {}) => (await getWorkspace()).listTasks(query),
        deleteTask: async (id) => (await getWorkspace()).deleteTask(id),
        startTimer: async (id, actor = 'human') => (await getWorkspace()).startTimer(id, actor),
        stopTimer: async (id, actor = 'human') => (await getWorkspace()).stopTimer(id, actor),
        addAssociation: async (id, association) => (await getWorkspace()).addAssociation(id, association),
        removeAssociation: async (id, association) => (await getWorkspace()).removeAssociation(id, association),
        getAnalytics: async (options = {}) => analyticsFor((await getWorkspace()).tasks, options),
        exportData: async () => (await getWorkspace()).exportData(),
        importData: async (input, options = {}) => (await getWorkspace()).importData(input, options),
        downloadApp: async () => (await getWorkspace()).downloadApp()
    });
}
