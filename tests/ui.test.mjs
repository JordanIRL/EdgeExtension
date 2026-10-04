// Shared settings and UI policy/validation checks. No browser or network calls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSettings, parseExcludedSites } from '../src/settings.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const tooManySites = Array.from({ length: 101 }, (_, i) => `site${i}.example.com`);

class Element {
  constructor(attributes = '') {
    this.listeners = {};
    this.disabled = /\bdisabled(?:\s|$)/.test(attributes);
    this.hidden = /\bhidden(?:\s|$)/.test(attributes);
    this.checked = false;
    this.value = '';
    this.textContent = '';
    this.href = /href="([^"]*)"/.exec(attributes)?.[1] ?? '';
    this.dataset = {};
    const classes = new Set();
    this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name) };
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  closest() { return this.section; }
  async trigger(type) {
    const e = { target: this, preventDefault() {} };
    await Promise.all((this.listeners[type] ?? []).map((fn) => fn(e)));
  }
  dispatchEvent(e) { this.pending = this.trigger(e.type); return true; }
}

async function setup(page, local = {}, policy = {}, status = {}) {
  const html = await readFile(new URL(`../src/${page}.html`, import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)]
    .map((match) => [match[1], new Element(match[0].slice(0, -1))]));
  const section = new Element();
  if (elements.has('excludedSites')) elements.get('excludedSites').section = section;
  const links = [...html.matchAll(/<a\s[^>]*href="edge:[^"]*"[^>]*>/g)]
    .map((match) => elements.get(/\bid="([^"]+)"/.exec(match[0])?.[1]) ?? new Element(match[0]));
  const state = { local, policy, status, writes: [], rejectWrite: false, policyGate: null };
  globalThis.document = {
    getElementById: (id) => elements.get(id), activeElement: null,
    querySelectorAll: (selector) => selector === '.locked' ?
      (section.classList.contains('locked') ? [section] : []) : links,
  };
  const pageEvents = event();
  globalThis.addEventListener = (type, fn) => pageEvents.listeners.push({ type, fn });
  globalThis.window = { close() {} };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') return { [keys]: state.local[keys] };
          return Object.fromEntries(Object.entries(keys).map(([key, value]) =>
            [key, Object.hasOwn(state.local, key) ? state.local[key] : value]));
        },
        async set(values) {
          if (state.rejectWrite) throw new Error('Storage unavailable');
          state.writes.push(structuredClone(values));
          Object.assign(state.local, structuredClone(values));
        },
      },
      managed: { async get() { if (state.policyGate) await state.policyGate; return structuredClone(state.policy); } },
      session: { async get() { return { status: structuredClone(state.status) }; } },
      onChanged: event(),
    },
    runtime: { id: 'test-extension', async sendMessage() {}, async openOptionsPage() {} },
    tabs: { async create() {} }, permissions: { async request() {} },
  };
  state.get = (id) => elements.get(id);
  state.change = (area, changes = {}) => {
    for (const fn of chrome.storage.onChanged.listeners) fn(changes, area);
  };
  state.pagehide = () => {
    for (const listener of pageEvents.listeners.filter((e) => e.type === 'pagehide')) listener.fn();
  };
  return state;
}

let state = await setup('options', { excludedSites: ['https://Contoso.com/path', '*.contoso.com'] });
assert.deepEqual((await loadSettings()).settings.excludedSites, ['contoso.com']);
state.local.excludedSites = ['valid.example.com', 'bad site'];
await assert.rejects(loadSettings(), /Not a site name: bad site/,
  'invalid stored exclusions must disable rules rather than silently disappear');
assert.deepEqual((await loadSettings({ validateExcludedSites: false })).settings.excludedSites,
  state.local.excludedSites, 'the editor must receive invalid entries for repair');
state.local.excludedSites = tooManySites;
await assert.rejects(loadSettings(), /at most 100/);
state.policy = { excludedSites: ['bad site'] };
await assert.rejects(loadSettings(), /Not a site name/);
state.policy = { allowedDomains: ['bad domain'], hintMode: 'missing' };
state.local.excludedSites = [];
const restricted = await loadSettings();
assert.equal(restricted.settings.restrictDomains, true);
assert.deepEqual(restricted.settings.allowedDomains, []);
assert.deepEqual(restricted.managed, ['allowedDomains']);
assert.match(parseExcludedSites('example.com').error, /must be a list/);

state = await setup('options', { excludedSites: tooManySites });
let releasePolicy;
state.policyGate = new Promise((resolve) => { releasePolicy = resolve; });
await import('../src/options.js?test=repair');
assert.equal(state.get('excludedSites').disabled, true, 'the editor stays locked while policy loads');
releasePolicy();
await settle();
assert.equal(state.get('excludedSites').disabled, false, 'invalid local exclusions remain repairable');
assert.equal(state.get('excludedSites').value.split('\n').length, 101);
assert.match(state.get('sitesError').textContent, /at most 100/);
state.get('excludedSites').value = 'https://Contoso.com/path, *.contoso.com';
await state.get('excludedSites').trigger('change');
assert.deepEqual(state.local.excludedSites, ['contoso.com']);
assert.equal(state.get('sitesError').hidden, true);
state.rejectWrite = true;
state.get('excludedSites').value = 'other.example.com';
await state.get('excludedSites').trigger('change');
assert.equal(state.get('sitesError').hidden, false);
assert.match(state.get('sitesError').textContent, /Couldn’t save excluded sites/);
assert.deepEqual(state.local.excludedSites, ['contoso.com']);

state = await setup('options', { excludedSites: ['local.example.com'] }, { excludedSites: ['bad site'] });
await import('../src/options.js?test=managed');
await settle();
assert.equal(state.get('excludedSites').disabled, true);
assert.equal(state.get('excludedSites').value, 'bad site');
assert.match(state.get('sitesError').textContent, /Not a site name/);
document.activeElement = state.get('excludedSites');
state.pagehide();
await settle();
assert.equal(state.writes.length, 0, 'closing a locked editor must not copy policy into local settings');
state.policy = {};
state.change('managed');
await settle();
assert.equal(state.get('excludedSites').disabled, false);
assert.equal(state.get('excludedSites').value, 'local.example.com');
assert.equal(state.get('sitesError').hidden, true, 'policy updates clear obsolete validation errors');

state = await setup('popup', {}, { enabled: false, allowPause: false },
  { state: 'active', hasAccess: true, enabled: true, allowPause: true, managed: [] });
state.policyGate = new Promise((resolve) => { releasePolicy = resolve; });
await import('../src/popup.js?test=managed');
assert.equal(state.get('enabled').disabled, true, 'the switch starts locked before status/policy loads');
releasePolicy();
await settle();
assert.equal(state.get('enabled').checked, false, 'policy wins over stale worker status');
assert.equal(state.get('enabled').disabled, true);
assert.equal(state.get('pause').hidden, true);
await state.get('enabled').trigger('change');
assert.equal(state.writes.length, 0);
state.policy = {};
state.change('managed');
await settle();
assert.equal(state.get('enabled').disabled, false);
assert.equal(state.get('enabled').checked, true);
state.policy = { enabled: false };
state.change('managed');
assert.equal(state.get('enabled').disabled, true, 'new policy locks immediately while settings reload');
await settle();
assert.equal(state.get('enabled').checked, false);
assert.equal(state.get('pause').hidden, true, 'a policy-disabled extension cannot offer a stale pause action');

console.log('Settings validation, editable recovery and UI policy-lock checks: passed');
