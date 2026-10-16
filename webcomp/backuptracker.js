// Backup metadata is separate from application data and scoped by storage-key.
export function normalizeBackupTrackerState(value = {}) {
    const timestamp = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
    return {
        lastExportAt: timestamp(value?.lastExportAt),
        dirtySince: timestamp(value?.dirtySince)
    };
}

export function getBackupTrackerView(state, now = Date.now()) {
    const { lastExportAt, dirtySince } = normalizeBackupTrackerState(state);
    const age = Math.max(0, now - (lastExportAt ?? dirtySince ?? now));
    const dirty = dirtySince !== null;
    const due = dirty && age >= 86400000;
    const heartbeat = dirty && age >= 3 * 86400000;
    let text = t('ui.text.lastExportNever');
    if (lastExportAt !== null) {
        const elapsed = Math.max(0, now - lastExportAt);
        const [unit, duration] = elapsed >= 86400000 ? ['day', 86400000]
            : elapsed >= 3600000 ? ['hour', 3600000] : ['minute', 60000];
        const count = Math.floor(elapsed / duration);
        text = t('ui.text.lastExportCountUnitAgo', { count: count, unit: t('ui.text.' + unit + (count === 1 ? '' : 's')) });
    }
    return { text, dirty, due, heartbeat, buttonText: due ? t('ui.text.backupData') : t('ui.text.exportData') };
}

export function installBackupTracker(targetWindow = window) {
    const registry = targetWindow.customElements;
    if (registry.get('backup-tracker')) return registry.get('backup-tracker');

    class BackupTracker extends targetWindow.HTMLElement {
        constructor() {
            super();
            this._backupState = normalizeBackupTrackerState();
            this._storageUnavailable = false;
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: inline-flex; align-items: center; gap: 8px; }
                    .last-export { color: var(--muted, #697177); font: 650 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
                    button { min-height: 40px; padding: 0 13px; border: 1px solid var(--ink, #18242b); border-radius: 9px; background: var(--panel, #fffdf7); color: var(--ink, #18242b); font: inherit; cursor: pointer; }
                    button:hover { background: var(--accent, #D00E00); color: white; }
                    button:focus-visible { outline: 3px solid #315f9147; outline-offset: 2px; }
                    @keyframes backup-heartbeat {
                        0%, 35%, 100% { transform: scale(1); }
                        10%, 23% { transform: scale(1.06); }
                        16%, 29% { transform: scale(1); }
                    }
                    :host([heartbeat]) ::slotted([data-backup-action]), :host([heartbeat]) button { animation: backup-heartbeat 2.4s ease-in-out infinite; }
                    @media (prefers-reduced-motion: reduce) {
                        :host([heartbeat]) ::slotted([data-backup-action]), :host([heartbeat]) button { animation: none; outline: 2px solid var(--accent, #D00E00); outline-offset: 2px; }
                    }
                </style>
                <span class="last-export" part="status"></span>
                <slot name="before-button"></slot>
                <slot name="action"><button type="button" part="button">${escapeHTML(t('ui.text.exportData'))}</button></slot>`;
            this._handleChange = () => this.markChanged();
            this._handleRefresh = () => this.refresh();
            this._handleStorage = event => {
                if (event.key === this.storageKey || event.key === null) {
                    this._storageUnavailable = false;
                    this.readState();
                    this.refresh();
                }
            };
            this.addEventListener('click', event => {
                if (event.composedPath().includes(this.actionButton)) {
                    this.dispatchEvent(new targetWindow.CustomEvent('backup-request', { bubbles: true, composed: true }));
                }
            });
            this.shadowRoot.addEventListener('slotchange', this._handleRefresh);
        }

        get storageKey() { return this.getAttribute('storage-key') || 'backuptracker'; }
        get state() { return { ...this._backupState }; }
        get actionButton() { return this.querySelector('[slot="action"][data-backup-action]') || this.shadowRoot.querySelector('button'); }

        connectedCallback() {
            this.readState();
            this._changeEvent = this.getAttribute('change-event');
            if (this._changeEvent) this.ownerDocument.addEventListener(this._changeEvent, this._handleChange);
            this.ownerDocument.addEventListener('visibilitychange', this._handleRefresh);
            targetWindow.addEventListener('focus', this._handleRefresh);
            targetWindow.addEventListener('storage', this._handleStorage);
            this._refreshTimer = targetWindow.setInterval(this._handleRefresh, 60000);
            this.refresh();
        }

        disconnectedCallback() {
            if (this._changeEvent) this.ownerDocument.removeEventListener(this._changeEvent, this._handleChange);
            this.ownerDocument.removeEventListener('visibilitychange', this._handleRefresh);
            targetWindow.removeEventListener('focus', this._handleRefresh);
            targetWindow.removeEventListener('storage', this._handleStorage);
            targetWindow.clearInterval(this._refreshTimer);
        }

        readState() {
            if (this._storageUnavailable) return;
            try {
                const saved = targetWindow.localStorage.getItem(this.storageKey);
                this._backupState = normalizeBackupTrackerState(saved === null ? null : JSON.parse(saved));
            } catch { this._storageUnavailable = true; }
        }

        saveState() {
            try { targetWindow.localStorage.setItem(this.storageKey, JSON.stringify(this._backupState)); }
            catch { this._storageUnavailable = true; }
            this.refresh();
        }

        // Call on startup for existing data that predates the tracker.
        initializeData(hasData) {
            this.readState();
            if (hasData && this._backupState.lastExportAt === null && this._backupState.dirtySince === null) this.markChanged();
        }

        markChanged(now = Date.now()) {
            this.readState();
            if (this._backupState.dirtySince === null) {
                this._backupState.dirtySince = now;
                this.saveState();
            } else this.refresh();
        }

        // Call after the app successfully starts the export download.
        recordBackup(now = Date.now()) {
            this.readState();
            this._backupState = { lastExportAt: now, dirtySince: null };
            this.saveState();
        }

        refresh(now = Date.now()) {
            const view = getBackupTrackerView(this._backupState, now);
            const status = this.shadowRoot.querySelector('.last-export');
            status.textContent = view.text;
            status.title = view.dirty ? t('ui.text.changesSinceTheLastExportNeedABackup') : t('ui.text.noChangesWaitingForBackup');
            this.toggleAttribute('backup-due', view.due);
            this.toggleAttribute('heartbeat', view.heartbeat);
            this.actionButton.textContent = view.buttonText;
            this.actionButton.title = view.due ? t('ui.text.backUpYourChangesByExportingYourData') : t('ui.text.exportABackupOfYourData');
        }
    }
    registry.define('backup-tracker', BackupTracker);
    return BackupTracker;
}
