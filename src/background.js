import { buildRules, ORIGINS } from './rules.js';
import { loadSettings, normalizeEmail, describe } from './settings.js';

const RESYNC_MINUTES = 5;
const ICONS = {
  on: { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png', 48: '/icons/icon-48.png', 128: '/icons/icon-128.png' },
  off: { 16: '/icons/icon-off-16.png', 32: '/icons/icon-off-32.png', 48: '/icons/icon-off-48.png', 128: '/icons/icon-off-128.png' },
};

// Every event funnels into one queued, idempotent sync so overlapping events can't race.
let queue = Promise.resolve();
function sync() {
  queue = queue.then(doSync).catch(fail).catch(() => {}); // never leave the queue rejected
  return queue;
}

async function doSync() {
  const { settings, managed } = await loadSettings();
  const { pausedUntil = 0 } = await chrome.storage.local.get('pausedUntil');
  const email = await getProfileEmail();
  const domain = email.split('@')[1];
  const paused = settings.allowPause && pausedUntil > Date.now();

  let state = 'active';
  if (!settings.enabled) state = 'off';
  else if (!email) state = 'no-account';
  else if (settings.restrictDomains && !settings.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) state = 'not-allowed';
  else {
    // Domains an administrator allowed are work domains, so they need no lookup.
    const kind = settings.restrictDomains ? 'work' : await accountKind(domain);
    if (kind !== 'work') state = kind; // 'personal' or 'checking'
    else if (paused) state = 'paused';
  }

  await setRules(state === 'active' ? await supported(buildRules({ ...settings, email })) : []);
  if (paused) chrome.alarms.create('resume', { when: pausedUntil });
  else chrome.alarms.clear('resume');
  if (state === 'checking') chrome.alarms.create('retry', { delayInMinutes: 1 });

  await publish({
    state, enabled: settings.enabled, email, pausedUntil,
    hasAccess: await chrome.permissions.contains({ origins: ORIGINS }),
    origins: ORIGINS, allowPause: settings.allowPause, managed,
  });
}

// If anything fails, remove every rule so a stale email is never used, then report the error.
async function fail(error) {
  try {
    await setRules([]);
  } finally {
    const { status } = await chrome.storage.session.get('status');
    await publish({ ...status, state: 'error', error: String(error?.message ?? error) });
  }
}

async function setRules(rules) {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.map((r) => r.id), addRules: rules });
}

// Always ask for the account whatever the sync state: without accountStatus 'ANY',
// Edge 140+ returns an empty email unless the profile syncs extensions.
async function getProfileEmail() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return normalizeEmail(info?.email);
  } catch {
    return ''; // identity unavailable
  }
}

// Only work or school accounts are used. Microsoft's public realm lookup says whether an email domain
// belongs to one: consumer domains (outlook.com, gmail.com, icloud.com...), self-service ("viral") tenants
// and domains with no tenant are personal. The answer depends only on the domain, so only the domain is
// sent, with a placeholder name. Only the answer for the current domain is kept. If the lookup fails,
// nothing is done until it succeeds.
async function accountKind(domain) {
  const { realm } = await chrome.storage.local.get('realm');
  if (realm?.domain === domain) return realm.kind;
  try {
    const url = `https://login.microsoftonline.com/common/userrealm/?user=${encodeURIComponent(`user@${domain}`)}&api-version=2.1`;
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!res.ok || typeof data.NameSpaceType !== 'string') return 'checking';
    const personal = data.ConsumerDomain === true || data.IsViral === true || data.NameSpaceType === 'Unknown' ||
      /(^|\.)live\.com$/i.test(data.DomainName ?? '');
    const kind = personal ? 'personal' : 'work';
    await chrome.storage.local.set({ realm: { domain, kind } });
    return kind;
  } catch {
    return 'checking'; // offline, captive portal, proxy: retried by the 'retry' alarm
  }
}

// One regex that Edge can't compile rejects the whole update, so drop any it won't accept
// (for example an excluded site with a very long host name).
async function supported(rules) {
  const ok = await Promise.all(rules.map((r) => !r.condition.regexFilter ||
    chrome.declarativeNetRequest.isRegexSupported({ regex: r.condition.regexFilter, isCaseSensitive: false })
      .then((res) => res.isSupported)));
  return rules.filter((_, i) => ok[i]).map((r, i) => ({ ...r, id: i + 1 }));
}

async function publish(status) {
  await chrome.storage.session.set({ status });
  const on = status.state === 'active';
  const warn = (on && !status.hasAccess) || ['no-account', 'checking', 'error'].includes(status.state);
  const [headline] = describe(status);
  await Promise.all([
    chrome.action.setIcon({ path: on ? ICONS.on : ICONS.off }),
    chrome.action.setBadgeText({ text: status.state === 'off' ? 'OFF' : warn ? '!' : '' }),
    chrome.action.setBadgeBackgroundColor({ color: warn ? '#C75000' : '#616161' }),
    chrome.action.setTitle({ title: `Use My Profile Account\n${headline}` }),
  ]);
}

// Listeners must be registered synchronously at the top level so events wake the service worker.
// (Install and update need no listener: the top-level sync() below runs then.)
chrome.runtime.onStartup.addListener(sync);
chrome.alarms.onAlarm.addListener(sync);
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
chrome.identity.onSignInChanged?.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed' || (area === 'local' && Object.keys(changes).some((k) => !k.startsWith('realm')))) sync();
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message !== 'sync') return false;
  sync().then(() => reply(true));
  return true;
});

chrome.storage.local.remove('realms'); // per-email cache written by version 1.0.0

// The profile account can change without an event we can rely on, so also re-check periodically.
chrome.alarms.get('resync').then((alarm) => alarm || chrome.alarms.create('resync', { periodInMinutes: RESYNC_MINUTES }));
sync();
