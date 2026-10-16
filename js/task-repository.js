import { DB_NAME, DB_VERSION, STORE_NAME, cloneValue, normalizeTask } from './task-model.js';
import { WORKSPACE_COLLECTIONS, normalizePlanningRecord, normalizeAgent, normalizeWorkspaceSnapshot, validateWorkspaceLinks } from './task-planning-model.js';

class TaskRepository {
    constructor() {
        this.db = null;
        this.memories = Object.fromEntries(WORKSPACE_COLLECTIONS.map(kind => [kind, new Map()]));
        this.mode = 'indexeddb';
        this.opfsFile = null;
    }

    async init() {
        try {
            if (!('indexedDB' in globalThis)) throw new Error(t('error.messages.indexedDBUnavailable'));
            this.db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('__storage')) db.createObjectStore('__storage', { keyPath: 'id' });
                    for (const kind of WORKSPACE_COLLECTIONS) if (!db.objectStoreNames.contains(kind)) {
                        const store = db.createObjectStore(kind, { keyPath: 'id' });
                        if (kind === 'tasks') store.createIndex('status', 'status', { unique: false });
                        store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }
                };
                request.onsuccess = () => {
                    request.result.onversionchange = () => request.result.close();
                    resolve(request.result);
                };
                request.onerror = () => reject(request.error);
                request.onblocked = () => {
                    const label = document.querySelector('.storage-label');
                    if (label) label.textContent = t('ui.text.closeOtherTaskimaticTabsToFinishTheStorageUpgrade');
                };
            });
        } catch (error) {
            console.warn('taskimatic is using session memory because IndexedDB could not open.', error);
            this.mode = 'memory';
        }

        // Test the actual write path, not just the presence of getDirectory().
        // Web Locks serialize snapshot updates across tabs and Mini Me.
        if (globalThis.isSecureContext && navigator.storage?.getDirectory && navigator.locks?.request) {
            try {
                await navigator.locks.request('taskimatic-workspace-storage', async () => {
                    const root = await navigator.storage.getDirectory();
                    const directory = await root.getDirectoryHandle('taskimatic', { create: true });
                    const probe = await directory.getFileHandle('write-probe', { create: true });
                    await this.writeOpfsFile(probe, 'ready');
                    if (await (await probe.getFile()).text() !== 'ready') throw new Error(t('error.messages.oPFSReadCheckFailed'));
                    await directory.removeEntry('write-probe');
                    this.opfsFile = await directory.getFileHandle('workspace.json', { create: true });
                    const text = await (await this.opfsFile.getFile()).text();
                    const backend = this.db ? await this.request('readonly', store => store.get('backend'), '__storage') : null;
                    if (text && backend?.value !== 'indexeddb') {
                        this.parseOpfsWorkspace(text); // Never overwrite an unreadable saved file.
                    } else {
                        const snapshot = Object.fromEntries(await Promise.all(WORKSPACE_COLLECTIONS.map(async kind => [kind, await this.all(kind)])));
                        await this.writeOpfsWorkspace(snapshot);
                    }
                    this.mode = 'opfs';
                    // Refresh the recovery copy even when this load makes no edits.
                    if (this.db) await this.replaceIndexedDbWorkspace(await this.readOpfsWorkspace(), 'opfs');
                });
            } catch (error) {
                this.opfsFile = null;
                this.mode = this.db ? 'indexeddb' : 'memory';
                console.warn('OPFS could not open for reading and writing; using the fallback store.', error);
            }
        }

        const counts = await Promise.all(WORKSPACE_COLLECTIONS.map(kind => this.all(kind)));
        if (counts.every(records => !records.length)) {
            try {
                const seed = JSON.parse(document.getElementById('taskimatic-seed')?.textContent || '[]');
                const snapshot = normalizeWorkspaceSnapshot(seed, normalizeTask);
                validateWorkspaceLinks(snapshot);
                await this.replaceWorkspace(snapshot);
            } catch (error) { console.warn('Portable workspace snapshot could not be read.', error); }
        }
        return this;
    }

    async writeOpfsFile(handle, text) {
        const writable = await handle.createWritable();
        try {
            await writable.write(text);
            await writable.close(); // Commit the replacement only when the stream closes.
        } catch (error) {
            try { await writable.abort(); } catch { /* The stream may already be closed. */ }
            throw error;
        }
    }

    parseOpfsWorkspace(text) {
        const saved = JSON.parse(text);
        if (saved.version !== 1 || !saved.workspace || !WORKSPACE_COLLECTIONS.every(kind =>
            Array.isArray(saved.workspace[kind]) && saved.workspace[kind].every(record => record && typeof record.id === 'string'))) {
            throw new Error(t('error.messages.invalidOPFSWorkspace'));
        }
        validateWorkspaceLinks(saved.workspace);
        return saved.workspace;
    }

    async readOpfsWorkspace() {
        return this.parseOpfsWorkspace(await (await this.opfsFile.getFile()).text());
    }

    async writeOpfsWorkspace(snapshot) {
        await this.writeOpfsFile(this.opfsFile, JSON.stringify({ version: 1, workspace: snapshot }));
    }

    async mutateOpfsWorkspace(operation) {
        return navigator.locks.request('taskimatic-workspace-storage', async () => {
            const backend = this.db ? await this.request('readonly', store => store.get('backend'), '__storage') : null;
            const snapshot = backend?.value === 'indexeddb'
                ? Object.fromEntries(await Promise.all(WORKSPACE_COLLECTIONS.map(async kind => [kind, await this.request('readonly', store => store.getAll(), kind)])))
                : await this.readOpfsWorkspace();
            operation(snapshot);
            await this.writeOpfsWorkspace(snapshot);
            // Retain a complete IndexedDB recovery copy for browsers where OPFS
            // becomes unavailable. A failed backup is reported as a save error.
            if (this.db) await this.replaceIndexedDbWorkspace(snapshot, 'opfs');
        });
    }

    request(mode, operation, kind = STORE_NAME) {
        if (this.mode === 'memory') return Promise.resolve(operation(null));
        const execute = () => new Promise((resolve, reject) => {
            const transaction = this.db.transaction(mode === 'readwrite' ? [kind, '__storage'] : kind, mode);
            if (mode === 'readwrite') transaction.objectStore('__storage').put({ id: 'backend', value: 'indexeddb' });
            const store = transaction.objectStore(kind);
            let request;
            let result;
            try { request = operation(store); } catch (error) { reject(error); return; }
            if (request && 'onsuccess' in request) request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('error.messages.databaseTransactionAborted')));
        });
        return mode === 'readwrite' && navigator.locks?.request
            ? navigator.locks.request('taskimatic-workspace-storage', execute) : execute();
    }

    async all(kind = STORE_NAME) {
        if (this.mode === 'opfs') return navigator.locks.request('taskimatic-workspace-storage', async () => cloneValue((await this.readOpfsWorkspace())[kind]));
        if (this.mode === 'memory') return [...this.memories[kind].values()].map(cloneValue);
        return this.request('readonly', store => store.getAll(), kind);
    }

    async get(id, kind = STORE_NAME) {
        if (this.mode === 'opfs') return (await this.all(kind)).find(record => record.id === id) ?? null;
        if (this.mode === 'memory') return cloneValue(this.memories[kind].get(id) ?? null);
        return this.request('readonly', store => store.get(id), kind);
    }

    async put(record, kind = STORE_NAME) {
        const normalized = kind === 'tasks' ? normalizeTask(record) : kind === 'agents' ? normalizeAgent(record) : normalizePlanningRecord(kind, record);
        if (this.mode === 'opfs') await this.mutateOpfsWorkspace(snapshot => {
            const index = snapshot[kind].findIndex(item => item.id === normalized.id);
            if (index < 0) snapshot[kind].push(cloneValue(normalized));
            else snapshot[kind][index] = cloneValue(normalized);
        });
        else if (this.mode === 'memory') this.memories[kind].set(normalized.id, cloneValue(normalized));
        else await this.request('readwrite', store => store.put(normalized), kind);
        return cloneValue(normalized);
    }

    async delete(id, kind = STORE_NAME) {
        if (this.mode === 'opfs') await this.mutateOpfsWorkspace(snapshot => {
            snapshot[kind] = snapshot[kind].filter(record => record.id !== id);
        });
        else if (this.mode === 'memory') this.memories[kind].delete(id);
        else await this.request('readwrite', store => store.delete(id), kind);
    }

    async replaceWorkspace(snapshot) {
        if (this.mode === 'opfs') {
            await this.mutateOpfsWorkspace(current => {
                for (const kind of WORKSPACE_COLLECTIONS) current[kind] = cloneValue(snapshot[kind]);
            });
            return;
        }
        if (this.mode === 'memory') {
            for (const kind of WORKSPACE_COLLECTIONS) this.memories[kind] = new Map(snapshot[kind].map(record => [record.id, cloneValue(record)]));
            return;
        }
        if (navigator.locks?.request) await navigator.locks.request('taskimatic-workspace-storage', () => this.replaceIndexedDbWorkspace(snapshot));
        else await this.replaceIndexedDbWorkspace(snapshot);
    }

    async replaceIndexedDbWorkspace(snapshot, backend = 'indexeddb') {
        // One transaction makes relationships and their records import atomically.
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([...WORKSPACE_COLLECTIONS, '__storage'], 'readwrite');
            transaction.objectStore('__storage').put({ id: 'backend', value: backend });
            for (const kind of WORKSPACE_COLLECTIONS) {
                const store = transaction.objectStore(kind);
                store.clear();
                for (const record of snapshot[kind]) store.put(record);
            }
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('error.messages.workspaceSaveAborted')));
        });
    }
}

export { TaskRepository };
