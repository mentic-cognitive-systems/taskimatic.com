// Register in each window so Mini Me and portable copies share the same component.
function installLockInControls(targetWindow = window) {
    const registry = targetWindow.customElements || customElements;
    if (registry.get('lock-in-controls')) return;
    const Element = targetWindow.HTMLElement || HTMLElement;
    class LockInControls extends Element {
        static observedAttributes = ['plan'];

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.shadowRoot.innerHTML = `
                <style>
                    :host { display: block; }
                    * { box-sizing: border-box; }
                    .protect-plan-group {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 14px;
                        flex-wrap: wrap;
                    }
                    .protect-plan-label {
                        font: 700 16px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                        color: var(--muted);
                        letter-spacing: .02em;
                        white-space: nowrap;
                    }
                    .protect-plan-toggles {
                        display: inline-flex;
                        align-items: center;
                        gap: 3px;
                        flex-wrap: wrap;
                    }
                    .protect-toggle {
                        min-height: 29px;
                        padding: 0 9px;
                        border: 1px solid var(--line, #cfc8b8);
                        border-radius: 7px;
                        background: var(--panel, #fffdf7);
                        color: var(--muted, #697177);
                        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                        white-space: nowrap;
                        cursor: pointer;
                        transition: all 120ms ease;
                    }
                    .protect-toggle:hover {
                        border-color: var(--chalk, #ffffff);
                        color: var(--ink, #18242b);
                    }
                    .protect-toggle.active {
                        border-color: var(--ink, #18242b);
                        background: rgba(24, 36, 43, 0.08);
                        color: var(--ink, #18242b);
                        font-weight: 800;
                    }
                    .protect-toggle[data-plan]:not([data-plan="no"]).active {
                        border-color: var(--accent, #D00E00);
                        background: rgba(208, 14, 0, 0.08);
                        color: var(--accent, #D00E00);
                    }
                    .protect-toggle:focus-visible {
                        outline: 3px solid rgba(208, 14, 0, 0.28);
                        outline-offset: 2px;
                    }

                </style>
                <div class="protect-plan-group" role="group" aria-label="${escapeHTML(t('ui.text.lockIn'))}">
                    <span class="protect-plan-label">${escapeHTML(t('ui.text.lockIn2'))}</span>
                    <div class="protect-plan-toggles">
                        <button type="button" class="protect-toggle" data-plan="no" aria-pressed="false">?</button>
                        <button type="button" class="protect-toggle" data-plan="now" data-duration="480" aria-pressed="false">${escapeHTML(t('ui.text.now8min'))}</button>
                        <button type="button" class="protect-toggle" data-plan="sprint" data-duration="1320" aria-pressed="false">${escapeHTML(t('ui.text.sprint22min'))}</button>
                        <button type="button" class="protect-toggle" data-plan="focus" data-duration="2640" aria-pressed="false">${escapeHTML(t('ui.text.focus44min'))}</button>
                        <button type="button" class="protect-toggle" data-plan="flow" data-duration="5280" aria-pressed="false">${escapeHTML(t('ui.text.flow88min'))}</button>
                    </div>
                </div>
            `;
            this.shadowRoot.addEventListener('click', event => {
                const button = event.target.closest('button[data-plan]');
                if (!button) return;
                this.plan = button.dataset.plan;
                this.dispatchEvent(new targetWindow.CustomEvent('lock-in:change', {
                    detail: { plan: this.plan }, bubbles: true, composed: true
                }));
            });
        }

        get plan() { return this.getAttribute('plan') || 'no'; }
        set plan(value) { this.setAttribute('plan', value); }

        connectedCallback() { this.updateButtons(); }
        attributeChangedCallback() { this.updateButtons(); }

        updateButtons() {
            this.shadowRoot.querySelectorAll('button[data-plan]').forEach(button => {
                const active = button.dataset.plan === this.plan;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
            });
        }
    }
    registry.define('lock-in-controls', LockInControls);
}

export { installLockInControls };
