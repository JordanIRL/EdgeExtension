// Pure DNR rule builder. Edge applies these rules without exposing requests to this extension.
import { MAX_EXCLUDED_SITES } from './settings.js';

export const ENTRA_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'sts.windows.net'];
export const ORIGINS = ENTRA_HOSTS.map((host) => `https://${host}/*`);
const AUTHORIZE = '^https://[^/]+/[^/?#]+/oauth2/(v2\\.0/)?authorize\\?';
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CALLBACK_KEYS = ['redirect_uri', 'wreply'];
const AUTHORITY = 'https?(:|%3a)(/|%2f){2}';
const returnsTo = (key, host, authority) => `[?&]${key}=${authority}([-a-z0-9.]*\\.)?${escapeRegex(host)}` +
  '\\.?([/:?&#%]|$)';

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
  // Silent authentication can also use a popup/top-level navigation when third-party cookies are blocked.
  allow({ regexFilter: '[?&]prompt=none&([^#]*&)?(login_hint|username)=[^&#]' });
  allow({ regexFilter: '[?&](login_hint|username)=[^&#][^#]*&prompt=none(&|#|$)' });
  for (const key of ['login_hint', 'username', 'prompt', 'domain_hint']) {
    allow({ regexFilter: `[?&](${uppercaseKey(key)})=`, isUrlFilterCaseSensitive: true });
  }
  allow({ regexFilter: '[?&](login%5fhint|domain%5fhint|id%5ftoken%5fhint)=' });
  allow({ regexFilter: '[?&]prompt=create(&|#|$)' });
  // A query transform removes every prompt key; ambiguous duplicates could discard required login/consent.
  allow({ regexFilter: '[?&]prompt=[^#]*&prompt=' });
  allow({ regexFilter: '[?&]wa=wsignout(cleanup)?1\\.0(&|#|$)' });
  // Consumer-only sign-ins are out of scope, including unusual encoded domain hints.
  allow({ regexFilter: '^https://[^/]+/(consumers|9188040d-6c67-4c5b-b112-36a304b66dad)/' });
  allow({ regexFilter: '[?&]domain_hint=consumers(&|#|$)' });
  allow({ regexFilter: '[?&]domain_hint=[^&#]*%' });
  allow({ regexFilter: '[?&]redirect%5furi=' });
  for (const key of CALLBACK_KEYS) {
    // Unusual encoded hostname bytes cannot be decoded by DNR. Leave them alone without matching encoded paths.
    // Exclude encoded authority delimiters (# / : ?) from this guard so normal callback URLs still work.
    allow({ regexFilter: `[?&]${key}=${AUTHORITY}[-a-z0-9.]*%(2[0-24-9a-e]|3[0-9b-e]|[014-9a-f][0-9a-f])` });
    // Leave unusual mixtures of raw/encoded authority delimiters alone too.
    allow({ regexFilter: `[?&]${key}=https?(:(%2f(/|%2f)|/%2f)|%3a(/(/|%2f)|%2f/))` });
    // Separate hosts, callback keys and standard URL encodings to stay within Edge's compiled 2 KB limit.
    for (const host of ['live.com', 'account.microsoft.com', ...excludedSites]) {
      for (const authority of ['https?://', 'https?%3a%2f%2f']) {
        allow({ regexFilter: returnsTo(key, host, authority) });
      }
    }
  }
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
