class DualRangeSlider extends HTMLElement {
    static observedAttributes = [
        'min',
        'max',
        'step',
        'start',
        'end',
        'disabled',
        'start-label',
        'end-label',
        'hide-labels'
    ];

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._valueFormatter = value => String(value);
        this._syncingAttributes = false;
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    --dual-range-track-color: #334155;
                    --dual-range-selection-color: #a78bfa;
                    --dual-range-active-color: #22d3ee;
                    --dual-range-thumb-color: #f8fafc;
                    --dual-range-thumb-border-color: #020617;
                    --dual-range-label-color: #94a3b8;
                    display: flex;
                    flex-direction: column;
                    gap: .55rem;
                    min-width: 0;
                }

                *, *::before, *::after { box-sizing: border-box; }

                .labels {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: .65rem;
                }

                .labels[hidden] { display: none; }

                label {
                    min-width: 0;
                    color: var(--dual-range-label-color);
                    display: flex;
                    justify-content: space-between;
                    gap: .5rem;
                    font: .85rem/1.2 system-ui, sans-serif;
                }

                label:last-child { text-align: right; }

                .control {
                    position: relative;
                    height: 34px;
                }

                .control::before,
                .selection {
                    position: absolute;
                    top: 50%;
                    height: 6px;
                    border-radius: 999px;
                    transform: translateY(-50%);
                    pointer-events: none;
                }

                .control::before {
                    content: '';
                    inset-inline: 0;
                    background: var(--dual-range-track-color);
                }

                .selection {
                    left: var(--start-percent, 0%);
                    right: calc(100% - var(--end-percent, 100%));
                    background: var(--dual-range-selection-color);
                }

                input[type='range'] {
                    -webkit-appearance: none;
                    appearance: none;
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 34px;
                    margin: 0;
                    background: transparent;
                    pointer-events: none;
                    z-index: 2;
                }

                input[type='range']::-webkit-slider-runnable-track {
                    height: 6px;
                    background: transparent;
                    border: 0;
                }

                input[type='range']::-moz-range-track {
                    height: 6px;
                    background: transparent;
                    border: 0;
                }

                input[type='range']::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 20px;
                    height: 20px;
                    margin-top: -7px;
                    border: 2px solid var(--dual-range-thumb-border-color);
                    border-radius: 50%;
                    background: var(--dual-range-thumb-color);
                    box-shadow: 0 0 0 2px var(--dual-range-selection-color);
                    cursor: grab;
                    pointer-events: all;
                }

                input[type='range']::-moz-range-thumb {
                    width: 20px;
                    height: 20px;
                    border: 2px solid var(--dual-range-thumb-border-color);
                    border-radius: 50%;
                    background: var(--dual-range-thumb-color);
                    box-shadow: 0 0 0 2px var(--dual-range-selection-color);
                    cursor: grab;
                    pointer-events: all;
                }

                input[type='range']:active::-webkit-slider-thumb {
                    cursor: grabbing;
                    box-shadow: 0 0 0 3px var(--dual-range-active-color);
                }

                input[type='range']:active::-moz-range-thumb {
                    cursor: grabbing;
                    box-shadow: 0 0 0 3px var(--dual-range-active-color);
                }

                input[type='range']:disabled::-webkit-slider-thumb {
                    cursor: default;
                    opacity: .45;
                }

                input[type='range']:disabled::-moz-range-thumb {
                    cursor: default;
                    opacity: .45;
                }

                #start { z-index: 3; }
            </style>
            <div class="labels">
                <label for="start"><span id="startLabel"></span><span id="startValue"></span></label>
                <label for="end"><span id="endLabel"></span><span id="endValue"></span></label>
            </div>
            <div class="control">
                <div class="selection"></div>
                <input type="range" id="start" aria-label="${escapeHTML(t('ui.text.start'))}">
                <input type="range" id="end" aria-label="${escapeHTML(t('ui.text.end'))}">
            </div>
        `;
        this._startInput = this.shadowRoot.getElementById('start');
        this._endInput = this.shadowRoot.getElementById('end');
    }

    connectedCallback() {
        this._upgradeProperty('valueFormatter');
        this._upgradeProperty('startValue');
        this._upgradeProperty('endValue');
        this._startInput.addEventListener('input', this._onInput);
        this._endInput.addEventListener('input', this._onInput);
        this._startInput.addEventListener('change', this._onChange);
        this._endInput.addEventListener('change', this._onChange);
        this._update();
    }

    disconnectedCallback() {
        this._startInput.removeEventListener('input', this._onInput);
        this._endInput.removeEventListener('input', this._onInput);
        this._startInput.removeEventListener('change', this._onChange);
        this._endInput.removeEventListener('change', this._onChange);
    }

    attributeChangedCallback() {
        if (!this._syncingAttributes) this._update();
    }

    get min() { return this._numberAttribute('min', 0); }
    set min(value) { this.setAttribute('min', value); }
    get max() { return this._numberAttribute('max', 100); }
    set max(value) { this.setAttribute('max', value); }
    get step() { return this._numberAttribute('step', 1); }
    set step(value) { this.setAttribute('step', value); }
    get startValue() { return this._numberAttribute('start', this.min); }
    set startValue(value) { this.setAttribute('start', value); }
    get endValue() { return this._numberAttribute('end', this.max); }
    set endValue(value) { this.setAttribute('end', value); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }

    get valueFormatter() { return this._valueFormatter; }
    set valueFormatter(formatter) {
        this._valueFormatter = typeof formatter === 'function' ? formatter : value => String(value);
        this._updateLabels();
    }

    setRange({ min = this.min, max = this.max, step = this.step, start = this.startValue, end = this.endValue, disabled = this.disabled } = {}) {
        this._syncingAttributes = true;
        this.setAttribute('min', min);
        this.setAttribute('max', max);
        this.setAttribute('step', step);
        this.setAttribute('start', start);
        this.setAttribute('end', end);
        this.toggleAttribute('disabled', Boolean(disabled));
        this._syncingAttributes = false;
        this._update();
    }

    _onInput = event => {
        event.stopPropagation();
        const changed = event.currentTarget === this._startInput ? 'start' : 'end';
        this._commitInput(changed);
        this.dispatchEvent(new CustomEvent('input', {
            bubbles: true,
            composed: true,
            detail: { start: this.startValue, end: this.endValue, changed }
        }));
    };

    _onChange = event => {
        event.stopPropagation();
        const changed = event.currentTarget === this._startInput ? 'start' : 'end';
        this.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            composed: true,
            detail: { start: this.startValue, end: this.endValue, changed }
        }));
    };

    _commitInput(changed) {
        let start = Number(this._startInput.value);
        let end = Number(this._endInput.value);
        if (changed === 'start') start = Math.min(start, end);
        if (changed === 'end') end = Math.max(end, start);
        this._syncingAttributes = true;
        this.setAttribute('start', start);
        this.setAttribute('end', end);
        this._syncingAttributes = false;
        this._update();
    }

    _update() {
        if (!this._startInput) return;
        this.shadowRoot.querySelector('.labels').hidden = this.hasAttribute('hide-labels');
        const min = this.min;
        const max = Math.max(this.max, min);
        const step = this.step > 0 ? this.step : 1;
        const start = Math.min(Math.max(this.startValue, min), max);
        const end = Math.min(Math.max(this.endValue, start), max);
        this._syncingAttributes = true;
        this.setAttribute('start', start);
        this.setAttribute('end', end);
        this._syncingAttributes = false;
        for (const input of [this._startInput, this._endInput]) {
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.disabled = this.disabled;
        }
        this._startInput.value = String(start);
        this._endInput.value = String(end);
        this._startInput.setAttribute('aria-label', this.getAttribute('start-label') || t('ui.text.start'));
        this._endInput.setAttribute('aria-label', this.getAttribute('end-label') || t('ui.text.end'));
        const span = max - min;
        const startPercent = span > 0 ? ((start - min) / span) * 100 : 0;
        const endPercent = span > 0 ? ((end - min) / span) * 100 : 0;
        this.style.setProperty('--start-percent', `${startPercent}%`);
        this.style.setProperty('--end-percent', `${endPercent}%`);
        this._updateLabels(start, end);
    }

    _updateLabels(start = this.startValue, end = this.endValue) {
        if (!this.shadowRoot) return;
        this.shadowRoot.getElementById('startLabel').textContent = this.getAttribute('start-label') || t('ui.text.start');
        this.shadowRoot.getElementById('endLabel').textContent = this.getAttribute('end-label') || t('ui.text.end');
        this.shadowRoot.getElementById('startValue').textContent = this._valueFormatter(start);
        this.shadowRoot.getElementById('endValue').textContent = this._valueFormatter(end);
    }

    _numberAttribute(name, fallback) {
        const attribute = this.getAttribute(name);
        if (attribute === null || attribute.trim() === '') return fallback;
        const value = Number(attribute);
        return Number.isFinite(value) ? value : fallback;
    }

    _upgradeProperty(name) {
        if (!Object.prototype.hasOwnProperty.call(this, name)) return;
        const value = this[name];
        delete this[name];
        this[name] = value;
    }
}

if (!customElements.get('dual-range-slider')) {
    customElements.define('dual-range-slider', DualRangeSlider);
}
