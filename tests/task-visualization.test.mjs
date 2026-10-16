import {t, escapeHTML, uiLabel, i18n} from './i18n-test-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../webcomp/task-visualization.js', import.meta.url), 'utf8');
const functions = fs.readFileSync(new URL('../js/task-analytics.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export .*$/gm, '');
const component = source.slice(source.indexOf('class TaskVisualization'), source.indexOf('function canvasLabel('));
const now = new Date(2026, 9, 15, 12).getTime();
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
}
const { analyticsFor, TaskVisualization } = vm.runInNewContext(`${functions}\n${component}\n({ analyticsFor, TaskVisualization })`, {
    t, escapeHTML, uiLabel, window: {i18n},
    Date: Clock,
    canonicalType: value => value,
    TIMER_ACTORS: ['human', 'agent'],
    durationForTask: task => task.sessions.reduce((sum, session) => sum + session.durationSeconds, 0),
    HTMLElement: class {},
    COLOR_PALETTE: ['red', 'green', 'blue'],
    canvasLabel() {},
    compactAxisTime: String
});
const iso = (day, hour = 9) => new Date(2026, 9, day, hour).toISOString();
const task = (id, groups = [], sessions = []) => ({
    id, text: id, createdAt: iso(15),
    associations: groups.map(value => ({type: 'project', value})), sessions, activeTimers: {}
});
const session = (start, end) => ({actor: 'human', startedAt: start, endedAt: end, durationSeconds: (Date.parse(end) - Date.parse(start)) / 1000});
const sum = values => values.reduce((a, b) => a + b, 0);
const pileTotal = analytics => sum(analytics.pile.series.map(item => item.total));
const timelineTotal = analytics => sum(analytics.timeline.series.map(item => item.values.at(-1)));

test('dated charts retain every group and unassigned records beyond the old limits', () => {
    const tasks = Array.from({length: 12}, (_, i) => task(`task-${i}`, [`project-${i}`]));
    tasks.push(task('unassigned'));
    const analytics = analyticsFor(tasks, {measure: 'tasks', period: 'today'});
    assert.equal(analytics.timeline.series.length, 13);
    assert.equal(timelineTotal(analytics), 13);
    assert.equal(pileTotal(analytics), 13);
    const other = analytics.pile.series.find(item => item.label === 'Other');
    assert.equal(other.total, 6);
    assert.equal(other.associationValues.length, 6);
    assert.equal(analytics.pile.series.find(item => item.label === 'Unassigned').total, 1);
});

test('unassigned-only data produces populated charts', () => {
    const analytics = analyticsFor([task('unassigned', [], [session(iso(15, 9), iso(15, 10))])], {period: 'today'});
    assert.equal(pileTotal(analytics), 3600);
    assert.equal(timelineTotal(analytics), 3600);
});

test('cross-midnight sessions, running timers and multiple associations conserve time', () => {
    const tasks = [task('split', ['A', 'B'], [session(iso(14, 23), iso(15, 1))]), task('running')];
    tasks[1].activeTimers.agent = iso(15, 10);
    const analytics = analyticsFor(tasks, {period: 'this-week'});
    assert.equal(pileTotal(analytics), 4 * 3600);
    assert.equal(timelineTotal(analytics), 4 * 3600);
    assert.equal(analytics.pile.series.find(item => item.label === 'A').total, 3600);
    assert.equal(sum(analytics.taskPile.days.flat().map(item => item.value)), 4 * 3600);
});

test('date window clips sessions and excludes task creations outside the window', () => {
    const tasks = [task('old', ['A'], [session(iso(14, 23), iso(15, 1))]), task('new', ['A'])];
    tasks[0].createdAt = iso(14);
    assert.equal(pileTotal(analyticsFor(tasks, {period: 'today'})), 3600);
    const analytics = analyticsFor(tasks, {period: 'today', measure: 'tasks'});
    assert.equal(pileTotal(analytics), 1);
    assert.equal(timelineTotal(analytics), 1);
    assert.equal(sum(analytics.partWhole.map(item => item.value)), 2);
});

test('single-day timeline draws visible points and lists every series once', () => {
    const analytics = analyticsFor([task('assigned', ['A']), task('unassigned')], {period: 'today', measure: 'tasks'});
    const arcs = [];
    let legend;
    const context = new Proxy({}, {get: (target, key) => target[key] ?? (key === 'arc' ? (...args) => arcs.push(args) : () => {})});
    TaskVisualization.prototype.drawLine.call({
        measure: 'tasks', groupBy: 'project', shadowRoot: {querySelector() {}},
        renderLegend(items) { legend = items; }, setEmpty(message) { assert.equal(message, ''); }
    }, context, {width: 400, height: 210}, analytics);
    assert.equal(arcs.length, 2);
    assert.equal(legend.length, 2);
    assert.equal(arcs[0][0], arcs[1][0]);
    assert.equal(context.strokeStyle, '#cfc8b8');
});
