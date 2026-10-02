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

  // Dynamic rules survive worker restarts. Discard an old identity before a slow realm lookup.
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  if (!settings.enabled || paused || !email || current.some((r) => r.action.redirect?.transform?.queryTransform
    ?.addOrReplaceParams.some((p) => p.key === 'login_hint' && p.value !== email))) await setRules([]);

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

  const rules = state === 'active' ? await supported(buildRules({ ...settings, email })) : [];
  // A profile change during discovery must not reinstall the identity we just discarded.
  if (await getProfileEmail() !== email) {
    await setRules([]);
    sync();
    return;
  }
  await setRules(rules);
  if (paused) chrome.alarms.create('resume', { when: pausedUntil });
  else chrome.alarms.clear('resume');
  if (state === 'checking') chrome.alarms.create('retry', { delayInMinutes: 1 });
  else chrome.alarms.clear('retry');

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
    await publish({ ...status, email: await getProfileEmail(), state: 'error', error: String(error?.message ?? error) });
  }
}

async function setRules(rules) {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  if (JSON.stringify(current) === JSON.stringify(rules)) return;
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

// Domain discovery is an eligibility check, not proof of the profile's identity/account type.
// Only a placeholder name is sent, without cookies; keep one domain result. Ambiguous/error responses
// disable rules until discovery succeeds. Organization-approved allowedDomains bypass this lookup.
async function accountKind(domain) {
  const { realm } = await chrome.storage.local.get('realm');
  if (realm?.domain === domain) return realm.kind;
  try {
    const url = `https://login.microsoftonline.com/common/userrealm/?user=${encodeURIComponent(`user@${domain}`)}&api-version=2.1`;
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!res.ok || !['Managed', 'Federated', 'Unknown'].includes(data.NameSpaceType)) return 'checking';
    const personal = data.ConsumerDomain === true || data.IsViral === true || data.NameSpaceType === 'Unknown' ||
      /(^|\.)live\.com$/i.test(data.DomainName ?? '');
    const kind = personal ? 'personal' : 'work';
    await chrome.storage.local.set({ realm: { domain, kind } });
    return kind;
  } catch {
    return 'checking'; // offline, captive portal, proxy: retried by the 'retry' alarm
  }
}

// Never silently drop a safety guard or an exclusion. An unsupported rule disables the extension.
async function supported(rules) {
  const ok = await Promise.all(rules.map((r) => !r.condition.regexFilter ||
    chrome.declarativeNetRequest.isRegexSupported({ regex: r.condition.regexFilter,
      isCaseSensitive: r.condition.isUrlFilterCaseSensitive ?? false })
      .then((res) => res.isSupported)));
  if (ok.includes(false)) throw new Error('Edge could not compile a sign-in rule. Check excluded site names or report this issue.');
  return rules;
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

// Remove the old per-email cache and retired behaviour preferences on upgrade.
chrome.storage.local.remove(['realms', 'hintMode', 'accountPicker', 'includeFrames']);

// The profile account can change without an event we can rely on, so also re-check periodically.
chrome.alarms.create('resync', { periodInMinutes: RESYNC_MINUTES });
sync();
