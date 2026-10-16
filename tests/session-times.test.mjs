import {t, escapeHTML, uiLabel, i18n} from './i18n-test-context.mjs';
globalThis.t = t;
globalThis.escapeHTML = escapeHTML;
globalThis.uiLabel = uiLabel;

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDraft, sessionTimestamps, installSessionTimes } from '../webcomp/session-times.js';

class Node {
    children = [];
    nodes = new Map();
    listeners = {};
    classList = { add() {} };
    validity = { valid: true };
    querySelector(selector) {
        if (!this.nodes.has(selector)) this.nodes.set(selector, new Node());
        return this.nodes.get(selector);
    }
    append(child) { this.children.push(child); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute() {}
    setRange(value) { this.range = value; }
    focus() {}
    select() {}
}
let Component;
const targetWindow = {
    HTMLElement: class {
        ownerDocument = { createElement: () => new Node() };
        attachShadow() { this.shadowRoot = new Node(); }
        dispatchEvent(event) { this.lastEvent = event; }
    },
    customElements: { get() {}, define(name, component) { Component = component; } },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }
};
installSessionTimes(seconds => `${seconds}s`, targetWindow);
const session = hours => ({id: 'session-1', startedAt: '2026-10-01T09:00:00.123-07:00', endedAt: new Date(Date.parse('2026-10-01T09:00:00.123-07:00') + hours * 3600000).toISOString()});
const render = sessions => {
    const component = new Component();
    component.data = {taskId: 'task-1', sessions};
    return {component, rows: component.shadowRoot.querySelector('.sessions').children};
};

test('sessions up to and including 24 hours use dual sliders; longer sessions use day controls', () => {
    for (const hours of [0, 2, 23, 24]) {
        const {rows} = render([session(hours)]);
        assert.match(rows[0].innerHTML, /dual-range-slider/);
        assert.doesNotMatch(rows[0].innerHTML, /class="days"/);
    }
    const {rows} = render([session(24 + 1/3600)]);
    assert.match(rows[0].innerHTML, /class="days"/);
    assert.doesNotMatch(rows[0].innerHTML, /dual-range-slider/);
});

test('day count can shorten a multi-day session to zero days without shifting its start', () => {
    const original = session(50);
    const {component, rows} = render([original]);
    const row = rows[0];
    const days = row.querySelector('.days-input');
    days.value = '0';
    days.listeners.input();
    row.querySelector('.confirm').listeners.click();
    assert.equal(component.lastEvent.type, 'task-session-update');
    assert.equal(component.lastEvent.detail.id, 'task-1');
    assert.equal(component.lastEvent.detail.startedAt, new Date(original.startedAt).toISOString());
    assert.equal(Date.parse(component.lastEvent.detail.endedAt) - Date.parse(original.startedAt), 2 * 3600000);
});

test('stop before start on zero days cannot be saved', () => {
    const {component, rows} = render([session(47)]);
    const row = rows[0];
    row.querySelector('.days-input').value = '0';
    row.querySelector('.days-input').listeners.input();
    assert.equal(row.querySelector('.confirm').disabled, true);
    row.querySelector('.confirm').listeners.click();
    assert.equal(component.lastEvent, undefined);
});

test('all sessions render, with no five-entry limit', () => {
    assert.equal(render(Array.from({length: 12}, () => session(2))).rows.length, 12);
});

test('timestamps round-trip across midnight, month boundaries, DST and millisecond precision', () => {
    for (const [startedAt, endedAt] of [
        ['2026-10-01T23:00:00.123-07:00', '2026-10-02T01:00:00.456-07:00'],
        ['2026-10-30T09:00:00-07:00', '2026-11-02T12:00:00-08:00'],
        ['2026-11-01T01:30:00-07:00', '2026-11-01T01:30:00-08:00'],
        ['2026-03-07T12:00:00-08:00', '2026-03-09T12:00:00-07:00']
    ]) {
        assert.deepEqual(sessionTimestamps(sessionDraft({startedAt, endedAt})), {start: Date.parse(startedAt), end: Date.parse(endedAt)});
    }
});
