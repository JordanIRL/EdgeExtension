// Run with Node 22+. Uses fake browser APIs and example accounts; makes no network requests.
import assert from 'node:assert/strict';

const local = {}, session = {};
let policy = {}, email = 'mary@example.com', rules = [], writes = 0;
let supported = true, rejectUpdate = false, realm = { NameSpaceType: 'Managed' };
let requests = [], onFetch, installations = [];
const alarms = new Map();
let alarmCreates = 0, rejectAlarm;
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const area = (data) => ({
  async get(keys) {
    if (!keys) return structuredClone(data);
    if (typeof keys === 'string') return { [keys]: data[keys] };
    return Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, data[k] ?? v]));
  },
  async set(values) { Object.assign(data, structuredClone(values)); },
  async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
});
globalThis.chrome = {
  storage: { local: area(local), session: area(session), managed: { async get() { return policy; } }, onChanged: event() },
  identity: { async getProfileUserInfo(options) { assert.equal(options.accountStatus, 'ANY'); return { email }; }, onSignInChanged: event() },
  declarativeNetRequest: {
    // Edge returns object keys in its own order, rather than preserving insertion order.
    async getDynamicRules() { return structuredClone(rules.map(({ action, condition, id, priority }) => ({
      action, condition: Object.fromEntries(Object.entries(condition).reverse()), id, priority,
    }))); },
    async updateDynamicRules({ addRules = [] }) {
      if (rejectUpdate && addRules.length) throw new Error('test update rejected');
      if (addRules.length) installations.push(structuredClone(addRules));
      rules = structuredClone(addRules); writes++;
    },
    async isRegexSupported() { return { isSupported: supported }; },
  },
  permissions: { async contains() { return true; }, onAdded: event(), onRemoved: event() },
  alarms: {
    async get(name) { return alarms.get(name); },
    async create(name, info) {
      if (name === rejectAlarm) throw new Error('test alarm rejected');
      alarms.set(name, info); alarmCreates++;
    },
    async clear(name) { return alarms.delete(name); },
    onAlarm: event(),
  },
  action: Object.fromEntries(['setIcon', 'setBadgeText', 'setBadgeBackgroundColor', 'setTitle'].map((k) => [k, async () => {}])),
  runtime: { onStartup: event(), onMessage: event() },
};
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (onFetch) await onFetch();
  return { ok: true, async json() { return realm; } };
};
Object.assign(local, { hintMode: 'missing', accountPicker: 'site', includeFrames: false, realms: { 'old@example.com': 'work' } });
await import('../src/background.js');
const sync = () => new Promise((resolve) => chrome.runtime.onMessage.listeners[0]('sync', {}, resolve));
const activeEmail = () => rules.find((r) => r.action.type === 'redirect')?.action.redirect.transform.queryTransform
  .addOrReplaceParams.find((p) => p.key === 'login_hint').value;

await sync();
assert.equal(session.status.state, 'active');
assert.equal(activeEmail(), 'mary@example.com');
assert.ok(!('realms' in local) && !('hintMode' in local) && !('accountPicker' in local) && !('includeFrames' in local));
assert.equal(new URL(requests[0].url).searchParams.get('user'), 'user@example.com');
assert.equal(requests[0].options.credentials, 'omit');
assert.equal(local.realm.domain, 'example.com');
assert.equal(local.realm.kind, 'work');
assert.ok(Number.isFinite(local.realm.checkedAt));
assert.deepEqual(alarms.get('resync'), { periodInMinutes: 5 });
const unchangedWrites = writes;
const unchangedAlarms = alarmCreates;
await sync();
assert.equal(writes, unchangedWrites, 'unchanged sync must not rewrite rules');
assert.equal(alarmCreates, unchangedAlarms, 'refresh must not postpone an existing resync alarm');

// Discovery cache is bounded and malformed values cannot make the extension active.
const beforeExpiry = requests.length;
local.realm.checkedAt = Date.now() - 24 * 60 * 60_000;
onFetch = () => assert.equal(rules.length, 0, 'expired discovery must clear rules before lookup');
realm = { NameSpaceType: 'Unknown' };
await sync();
assert.equal(requests.length, beforeExpiry + 1);
assert.equal(session.status.state, 'personal');
local.realm = { domain: 'example.com', kind: 'active', checkedAt: Date.now() };
realm = { NameSpaceType: 'Managed' };
await sync();
assert.equal(local.realm.kind, 'work', 'malformed cached account kind must be rechecked');
assert.equal(session.status.state, 'active');
onFetch = undefined;

email = 'bob@other.example.com';
onFetch = () => assert.equal(rules.length, 0, 'old identity must be removed before realm discovery');
realm = { NameSpaceType: 'unexpected-response' };
await sync();
assert.equal(session.status.state, 'checking');
assert.equal(rules.length, 0);
assert.equal(local.realm.domain, 'example.com', 'invalid responses must not be cached');

onFetch = undefined;
realm = { NameSpaceType: 'Unknown' };
await sync();
assert.equal(session.status.state, 'personal');
assert.equal(rules.length, 0);

// A second profile change while a discovery request is in flight must not install its old hint.
delete local.realm;
realm = { NameSpaceType: 'Managed' };
email = 'first@new.example.com';
onFetch = () => { email = 'second@new.example.com'; };
await sync();
await sync();
assert.equal(activeEmail(), 'second@new.example.com');
onFetch = undefined;
email = 'bob@other.example.com';

// Settings changed while discovery is pending must not install the old settings' rules.
delete local.realm;
email = 'mary@race.example.com';
const beforeDisable = installations.length;
onFetch = () => {
  local.enabled = false;
  chrome.storage.onChanged.listeners[0]({ enabled: { newValue: false } }, 'local');
};
await sync();
await sync();
assert.equal(installations.length, beforeDisable, 'turning off during discovery must prevent installation');
assert.equal(session.status.state, 'off');
onFetch = undefined;
local.enabled = true;
email = 'bob@other.example.com';

policy = { allowedDomains: ['other.example.com'], hintMode: 'missing', accountPicker: 'site' };
const beforeRequests = requests.length;
await sync();
assert.equal(session.status.state, 'active');
assert.equal(activeEmail(), email);
assert.equal(requests.length, beforeRequests, 'trusted policy domains must skip discovery');
assert.deepEqual(session.status.managed, ['allowedDomains'], 'retired policy keys must be ignored');

supported = false;
await sync();
assert.equal(session.status.state, 'error');
assert.equal(rules.length, 0, 'unsupported safety rule must fail closed');
supported = true;
await sync();
assert.equal(session.status.state, 'active', 'queue must recover after errors');
email = 'changed@other.example.com';
rejectUpdate = true;
await sync();
assert.equal(session.status.state, 'error');
assert.equal(rules.length, 0, 'rejected replacement must not retain the old email');
rejectUpdate = false;
await sync();

local.pausedUntil = Date.now() + 60_000;
rejectAlarm = 'resume';
await sync();
assert.equal(session.status.state, 'error', 'alarm failures must be handled by the sync queue');
assert.equal(rules.length, 0);
rejectAlarm = undefined;
await sync();
assert.equal(session.status.state, 'paused');
assert.equal(rules.length, 0);
policy.allowPause = false;
await sync();
assert.equal(session.status.state, 'active');
policy.allowedDomains = ['bad domain'];
await sync();
assert.equal(session.status.state, 'not-allowed');
assert.equal(rules.length, 0);
policy = {};
local.enabled = false;
await sync();
assert.equal(session.status.state, 'off');
assert.equal(rules.length, 0);
local.enabled = true;
email = '';
await sync();
assert.equal(session.status.state, 'no-account');
assert.equal(rules.length, 0);

// A worker restart must reuse the existing periodic alarm rather than delay its scheduled refresh.
local.pausedUntil = 0;
const beforeRestart = alarmCreates;
for (const e of [chrome.runtime.onMessage, chrome.runtime.onStartup, chrome.storage.onChanged,
  chrome.alarms.onAlarm, chrome.permissions.onAdded, chrome.permissions.onRemoved, chrome.identity.onSignInChanged]) e.listeners.length = 0;
await import('../src/background.js?restart');
await sync();
assert.equal(alarmCreates, beforeRestart, 'worker startup must preserve an existing resync alarm');
assert.equal(session.status.state, 'no-account');
console.log('Background lifecycle, privacy, policy and fail-closed checks: passed');
