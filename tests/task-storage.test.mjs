import {t, escapeHTML, uiLabel, i18n} from './i18n-test-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/task-repository.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('class TaskRepository {'), source.indexOf('export {'));
const kinds = ['tasks', 'plans', 'wants', 'agents'];
const empty = () => Object.fromEntries(kinds.map(kind => [kind, []]));
function environment({available = true, writable = true, initial = '', idbAvailable = true} = {}) {
    const files = new Map([['workspace.json', initial]]);
    const data = Object.fromEntries([...kinds, '__storage'].map(kind => [kind, new Map()]));
    let failWrite = false;
    let lockQueue = Promise.resolve();
    const db = {
        close() {},
        transaction() {
            const transaction = {objectStore(kind) {
                return {
                    getAll: () => request([...data[kind].values()]),
                    get: id => request(data[kind].get(id)),
                    put: record => {data[kind].set(record.id, structuredClone(record)); return request(record.id);},
                    delete: id => {data[kind].delete(id); return request();},
                    clear: () => {data[kind].clear(); return request();}
                };
            }};
            function request(result) {
                const req = {result, onsuccess: null};
                queueMicrotask(() => req.onsuccess?.());
                return req;
            }
            queueMicrotask(() => queueMicrotask(() => transaction.oncomplete?.()));
            return transaction;
        }
    };
    const directory = {
        async getFileHandle(name) {
            if (!files.has(name)) files.set(name, '');
            return {
                getFile: async () => ({text: async () => files.get(name)}),
                ...(writable ? {async createWritable() {
                    let pending;
                    return {async write(text) {if (failWrite) throw Error('disk full'); pending = text;}, async close() {files.set(name, pending);}, async abort() {}};
                }} : {})
            };
        },
        async removeEntry(name) {files.delete(name);}
    };
    const context = {
        t, escapeHTML, uiLabel,
        WORKSPACE_COLLECTIONS: kinds, STORE_NAME: 'tasks', DB_NAME: 'test', DB_VERSION: 3,
        cloneValue: structuredClone, normalizeTask: structuredClone, normalizeAgent: structuredClone,
        normalizePlanningRecord: (kind, record) => structuredClone(record),
        normalizeWorkspaceSnapshot: () => empty(), validateWorkspaceLinks() {},
        console: {warn() {}}, isSecureContext: true,
        document: {getElementById() {return null;}},
        navigator: {
            storage: available ? {async getDirectory() {return {async getDirectoryHandle() {return directory;}};}} : {},
            locks: {request(name, operation) {
                const result = lockQueue.then(operation);
                lockQueue = result.catch(() => {});
                return result;
            }}
        },
        ...(idbAvailable ? {indexedDB: {open() {
            const req = {result: db};
            queueMicrotask(() => req.onsuccess());
            return req;
        }}} : {})
    };
    const Repository = vm.runInNewContext(code + '\nTaskRepository', context);
    const getDirectory = context.navigator.storage.getDirectory;
    return {Repository, files, data, setFailWrite: () => {failWrite = true;},
        setAvailable(value) {context.navigator.storage.getDirectory = value ? getDirectory : undefined;}};
}

test('prefers OPFS after a real read/write check and migrates all IndexedDB collections', async () => {
    const env = environment();
    for (const kind of kinds) env.data[kind].set(kind, {id: kind});
    const repo = await new env.Repository().init();
    assert.equal(repo.mode, 'opfs');
    assert.equal(env.files.has('write-probe'), false);
    for (const kind of kinds) assert.equal((await repo.all(kind))[0].id, kind);
    assert.equal(JSON.parse(env.files.get('workspace.json')).version, 1);
});

test('missing OPFS or missing writable support falls back to IndexedDB and preserves records', async () => {
    for (const options of [{available: false}, {writable: false}]) {
        const env = environment(options);
        env.data.tasks.set('existing', {id: 'existing'});
        const repo = await new env.Repository().init();
        assert.equal(repo.mode, 'indexeddb');
        assert.equal((await repo.get('existing')).id, 'existing');
        await repo.put({id: 'new'});
        assert.equal((await repo.all()).length, 2);
    }
});

test('OPFS persists CRUD and workspace replacement and refreshes the IndexedDB backup', async () => {
    const env = environment();
    const repo = await new env.Repository().init();
    await repo.put({id: 'task', text: 'first'});
    await repo.put({id: 'task', text: 'edited'});
    assert.equal((await repo.get('task')).text, 'edited');
    assert.equal(env.data.tasks.get('task').text, 'edited');
    const reload = await new env.Repository().init();
    assert.equal((await reload.get('task')).text, 'edited');
    await reload.delete('task');
    assert.equal(await reload.get('task'), null);
    const snapshot = empty();
    snapshot.plans.push({id: 'plan'});
    await reload.replaceWorkspace(snapshot);
    assert.equal((await repo.all('plans'))[0].id, 'plan');
    assert.equal(env.data.plans.get('plan').id, 'plan');
});

test('concurrent repositories preserve separate updates through shared locks', async () => {
    const env = environment();
    const a = await new env.Repository().init();
    const b = await new env.Repository().init();
    await Promise.all(Array.from({length: 20}, (_, i) => (i % 2 ? a : b).put({id: String(i)})));
    assert.equal((await a.all()).length, 20);
    assert.equal(env.data.tasks.size, 20);
});

test('failed writes reject and retain the last committed OPFS snapshot', async () => {
    const env = environment();
    const repo = await new env.Repository().init();
    await repo.put({id: 'saved'});
    env.setFailWrite();
    await assert.rejects(repo.put({id: 'unsaved'}), /disk full/);
    assert.equal((await repo.all()).length, 1);
    assert.equal(env.data.tasks.size, 1);
});

test('unreadable OPFS is preserved and existing IndexedDB data remains accessible', async () => {
    const env = environment({initial: '{broken'});
    env.data.tasks.set('backup', {id: 'backup'});
    const repo = await new env.Repository().init();
    assert.equal(repo.mode, 'indexeddb');
    assert.equal((await repo.get('backup')).id, 'backup');
    assert.equal(env.files.get('workspace.json'), '{broken');
});

test('OPFS works without IndexedDB; session memory is used only when neither store works', async () => {
    const opfs = environment({idbAvailable: false});
    const repo = await new opfs.Repository().init();
    assert.equal(repo.mode, 'opfs');
    await repo.put({id: 'saved'});
    assert.equal((await new opfs.Repository().init().then(repo => repo.all())).length, 1);
    const fallback = environment({available: false, idbAvailable: false});
    assert.equal((await new fallback.Repository().init()).mode, 'memory');
});


test('edits made in IndexedDB fallback take precedence when OPFS becomes available again', async () => {
    const env = environment();
    const first = await new env.Repository().init();
    await first.put({id: 'task', text: 'original'});
    env.setAvailable(false);
    const fallback = await new env.Repository().init();
    assert.equal(fallback.mode, 'indexeddb');
    await fallback.put({id: 'task', text: 'edited in fallback'});
    await fallback.put({id: 'new'});
    env.setAvailable(true);
    const recovered = await new env.Repository().init();
    assert.equal(recovered.mode, 'opfs');
    assert.equal((await recovered.get('task')).text, 'edited in fallback');
    assert.equal((await recovered.get('new')).id, 'new');
    assert.equal(JSON.parse(env.files.get('workspace.json')).workspace.tasks.length, 2);
});
