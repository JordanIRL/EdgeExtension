// Pure DNR rule builder. Edge applies these rules without exposing requests to this extension.
import { MAX_EXCLUDED_SITES } from './settings.js';

export const ENTRA_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'sts.windows.net'];
export const ORIGINS = ENTRA_HOSTS.map((host) => `https://${host}/*`);
const AUTHORIZE = '^https://[^/]+/[^/?#]+/oauth2/(v2\\.0/)?authorize\\?';
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const returnsTo = (host) => `(uri|wreply)=https?(:|%3a)(/|%2f)(/|%2f)([-a-z0-9.]*\\.)?${host}([/:?&#%]|$)`;

// Query transforms use exact, case-sensitive keys. Guard nonstandard capitalization rather than
// add a second hint. Each alternative requires the first uppercase letter at this position.
const uppercaseKey = (key) => [...key].flatMap((c, i) => /[a-z]/.test(c) ?
  [key.slice(0, i) + c.toUpperCase() + key.slice(i + 1).replace(/[a-z]/g, (v) => `[${v}${v.toUpperCase()}]`)] : []).join('|');

export function buildRules({ email, excludedSites = [] }) {
  if (excludedSites.length > MAX_EXCLUDED_SITES) throw new Error(`Use at most ${MAX_EXCLUDED_SITES} excluded sites.`);
  const rules = [];
  const add = (priority, action, condition) => rules.push({ id: rules.length + 1, priority, action,
    condition: { requestDomains: ENTRA_HOSTS, resourceTypes: ['main_frame', 'sub_frame'], ...condition } });
  const allow = (condition) => add(10, { type: 'allow' }, condition);
  const hint = (prompt) => ({ type: 'redirect', redirect: { transform: { queryTransform: {
    // Remove ALL old account hints before adding one; duplicate hints can make Entra reject a request.
    removeParams: ['login_hint', 'username', 'domain_hint', ...(prompt !== undefined ? ['prompt'] : [])],
    addOrReplaceParams: [...(prompt ? [{ key: 'prompt', value: prompt }] : []), { key: 'login_hint', value: email }],
  } } } });

  // Session-bound renewals must not change principal mid-session. sid + login_hint can also fail.
  allow({ regexFilter: '[?&](sid|id_token_hint)=[^&#]' });
  allow({ regexFilter: '[?&](login_hint|username)=[^&#]', resourceTypes: ['sub_frame'] });
  for (const key of ['login_hint', 'username', 'prompt', 'domain_hint']) {
    allow({ regexFilter: `[?&](${uppercaseKey(key)})=`, isUrlFilterCaseSensitive: true });
  }
  allow({ regexFilter: '[?&](login%5fhint|domain%5fhint|id%5ftoken%5fhint)=' });
  allow({ regexFilter: '[?&]prompt=create(&|#|$)' });
  // Consumer-only sign-ins are out of scope, including unusual encoded domain hints.
  allow({ regexFilter: '^https://[^/]+/(consumers|9188040d-6c67-4c5b-b112-36a304b66dad)/' });
  allow({ regexFilter: `[?&]domain_hint=consumers(&|#|$)|${returnsTo('(live\\.com|account\\.microsoft\\.com)')}` });
  allow({ regexFilter: '[?&]domain_hint=[^&#]*%' });
  for (const site of excludedSites) allow({ regexFilter: returnsTo(escapeRegex(site)) });
  if (excludedSites.length) allow({ initiatorDomains: excludedSites });

  // Remove only the account selector, never required login or consent. Support normal URL space encodings.
  const sep = '(\\+|%20)';
  const picker = 'select(_|%5f)account';
  add(2, hint(''), { requestMethods: ['get'], regexFilter: `${AUTHORIZE}([^#]*&)?prompt=${picker}(&|#|$)` });
  for (const required of ['login', 'consent']) {
    // Separate orders keep each compiled regex below Edge's 2 KB limit.
    for (const values of [`${picker}${sep}${required}`, `${required}${sep}${picker}`]) {
      add(2, hint(required), { requestMethods: ['get'],
        regexFilter: `${AUTHORIZE}([^#]*&)?prompt=${values}(&|#|$)` });
    }
  }
  add(1, hint(), { requestMethods: ['get'], regexFilter: AUTHORIZE });
  // SAML POST uses an internal 307 redirect, preserving the body. Token/credential POSTs are not matched.
  add(1, hint(), { requestMethods: ['get', 'post'], regexFilter: '^https://[^/]+/[^/?#]+/(saml2|wsfed)(\\?|$)' });
  return rules;
}
