import {t, escapeHTML} from './i18n-test-context.mjs';
globalThis.t = t;
globalThis.escapeHTML = escapeHTML;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { installSearcherElement } from '../webcomp/searcher-element.js';
const source = fs.readFileSync(new URL('../webcomp/task-workspace.js', import.meta.url), 'utf8');
const tasks = [
    {id:'human',status:'open',activeTimers:{human:'2026-10-01T12:00:00Z'}},
    {id:'agent',status:'open',activeTimers:{agent:'2026-10-01T13:00:00Z'}},
    {id:'idle',status:'open',activeTimers:{}},
    {id:'tabled',tabled:true,status:'open',activeTimers:{agent:'2026-10-01T14:00:00Z'}}
].map(task => ({text:task.id,notes:'',prompts:'',associations:[],...task}));
const ids = items => Array.from(items, item => item.id).sort();

test('main On Now includes either running clock and combines with the selected task view', () => {
    const method = source.slice(source.indexOf('    filteredTasks() {'), source.indexOf('    associationFromHash('));
    const {filteredTasks} = vm.runInNewContext('({' + method + '})', {TIMER_ACTORS:['human','agent']});
    const app = {sortedTasks:()=>tasks,statusFilter:'all',onNow:true};
    assert.deepEqual(ids(filteredTasks.call(app)), ['agent','human','tabled']);
    app.statusFilter = 'open';
    assert.deepEqual(ids(filteredTasks.call(app)), ['agent','human']);
    app.onNow = false;
    assert.deepEqual(ids(filteredTasks.call(app)), ['agent','human','idle']);
});

test('Mini Me On Now filters out idle tasks instead of only sorting them', () => {
    const start = source.indexOf('        const sortTasksForPip =');
    const end = source.indexOf('        const activeTasks =',start);
    const sort = new Function('TIMER_ACTORS',source.slice(start,end) + 'return sortTasksForPip;').call({pipOnNow:true,sortedTasks:value=>value},['human','agent']);
    assert.deepEqual(ids(sort(tasks)), ['agent','human','tabled']);
});

test('searcher button toggles On Now and emits its active state', () => {
    let Component;
    const element = () => ({children:[],attributes:{},listeners:{},append(...items){this.children.push(...items)},setAttribute(k,v){this.attributes[k]=v},addEventListener(k,v){this.listeners[k]=v}});
    const target = {
        HTMLElement:class {
            ownerDocument={createElement:element};
            children=[];
            hasAttribute(name){return name==='on-now-filter'}
            getAttribute(){return null}
            append(node){this.children.push(node)}
            dispatchEvent(event){this.lastEvent=event}
        },
        customElements:{get(){},define(name,ctor){Component=ctor}},
        CustomEvent:class {constructor(type,options){this.type=type;Object.assign(this,options)}}
    };
    installSearcherElement(target);
    const searcher=new Component();
    searcher.connectedCallback();
    searcher.onNowButton.listeners.click();
    assert.equal(searcher.lastEvent.type,'searcher:on-now');
    assert.equal(searcher.lastEvent.detail.active,true);
    assert.equal(searcher.onNowButton.attributes['aria-pressed'],'true');
    searcher.onNowButton.listeners.click();
    assert.equal(searcher.lastEvent.detail.active,false);
});
