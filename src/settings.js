// Settings shared by the service worker, popup and options page.
// Local settings belong to this Edge profile. An administrator can enforce any of them
// with policy (see schema.json); enforced values win and are shown as locked in the UI.

export const DEFAULTS = {
  enabled: true,
  excludedSites: [],
};
export const MAX_EXCLUDED_SITES = 100;

// Microsoft's sign-out page. It ends the Microsoft sign-in sessions in this Edge profile and signs out of sites
// that support single sign-out. Edge's own sign-in to the profile isn't affected.
export const SIGN_OUT_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout';
export const clearSignInSessions = () => chrome.tabs.create({ url: SIGN_OUT_URL });

// Only settable by policy.
const POLICY_DEFAULTS = { allowPause: true, allowedDomains: [] };

export async function loadSettings() {
  const local = await chrome.storage.local.get(DEFAULTS);
  let policy = {};
  try {
    policy = await chrome.storage.managed.get(); // Edge only passes through values that match schema.json
  } catch {
    // No managed storage (for example an unpacked build on an unmanaged device).
  }
  // Ignore retired settings and unknown policy keys: sign-in behaviour is no longer configurable.
  const keys = { ...DEFAULTS, ...POLICY_DEFAULTS };
  policy = Object.fromEntries(Object.entries(policy).filter(([key]) => Object.hasOwn(keys, key)));
  const settings = { ...keys, ...local, ...policy };
  settings.excludedSites = cleanHosts(settings.excludedSites).valid;
  if (settings.excludedSites.length > MAX_EXCLUDED_SITES) throw new Error(`Use at most ${MAX_EXCLUDED_SITES} excluded sites.`);
  // Any allowedDomains entry, even an invalid or blank one, restricts the extension to the valid entries.
  settings.restrictDomains = Array.isArray(settings.allowedDomains) && settings.allowedDomains.length > 0;
  settings.allowedDomains = cleanHosts(settings.allowedDomains).valid;
  return { settings, managed: Object.keys(policy) };
}

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

// Accepts "contoso.com", "*.contoso.com", "@contoso.com", "*@contoso.com" or a pasted URL
// and returns the bare host name.
export function cleanHost(value) {
  const host = String(value).trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*?[.@]/, '').replace(/[/:?#].*$/, '').replace(/\.$/, '');
  return host.length <= 253 && host.includes('.') && host.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? host : '';
}

export function cleanHosts(list) {
  const valid = [], invalid = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!String(item).trim()) continue;
    const host = cleanHost(item);
    if (!host) invalid.push(String(item).trim());
    else if (!valid.includes(host)) valid.push(host);
  }
  return { valid, invalid };
}

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// [headline, detail] for the status the service worker stores in chrome.storage.session.
export function describe(s) {
  switch (s?.state) {
    case 'active':
      return s.hasAccess
        ? [`Ready to sign in as ${s.email}`, 'Profile account for new work sign-ins']
        : ['Needs access to sign-in pages', 'Edge isn’t letting the extension work on Microsoft sign-in pages.'];
    case 'paused':
      return [`Paused until ${time(s.pausedUntil)}`, 'Sign-ins work as they normally would until then.'];
    case 'off':
      return ['Turned off', 'Microsoft sign-ins work as they normally would.'];
    case 'no-account':
      return ['No account to use', 'This Edge profile isn’t signed in. Sign in to it with a work or school account.'];
    case 'not-allowed':
      return ['Not used for this account', 'Your organization hasn’t turned this on for this account.'];
    case 'checking':
      return ['Checking your account', 'Couldn’t reach Microsoft to confirm this is a work or school account. Trying again in a minute.'];
    case 'personal':
      return ['Not used for personal accounts', ''];
    case 'error':
      return ['Something went wrong', s.error];
    default:
      return ['Starting…', ''];
  }
}
