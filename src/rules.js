// Builds the declarativeNetRequest rules that add the profile account to Microsoft sign-in requests.
// No chrome.* calls here, so the rules can be unit tested (see tests/).
//
// Work and school (Microsoft Entra ID) accounts only.
//
// How it works: Microsoft's sign-in service picks the account from the login_hint query parameter.
// A redirect rule adds login_hint=<email> to sign-in requests. Higher-priority "allow" rules leave a
// request alone when adding the hint would be wrong. Once the hint is there, the allow rule matches
// the redirected request, so each sign-in gets exactly one extra internal redirect.

export const ENTRA_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'sts.windows.net'];

// Tenant path segments that only accept personal Microsoft accounts; left alone.
const MSA_TENANTS = 'consumers|9188040d-6c67-4c5b-b112-36a304b66dad';
// Matches a sign-in that returns to (redirect_uri, redirect%5Furi, wreply) the given host pattern or a subdomain.
// The subdomain part only allows host name characters, so a path such as /x.live.com/ doesn't match.
const returnsTo = (host) => `(uri|wreply)=https?(:|%3a)(/|%2f)(/|%2f)([-a-z0-9.]*\\.)?${host}([/:?&#%]|$)`;
// Personal-account sites that sign in through the work-account endpoints (/common).
const CONSUMER_SITES = '(live\\.com|account\\.microsoft\\.com)';
const MAX_SITE_RULES = 900; // Edge allows 1000 regex rules in total

const ALLOW = 10;       // allow rules beat every redirect
const SKIP_PICKER = 2;  // beats the plain hint rule on the same URL (no fall-through inside a matcher)
const HINT = 1;

export const ORIGINS = ENTRA_HOSTS.map((host) => `https://${host}/*`);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// settings: effective settings plus the resolved work-account `email`.
// Regex rules are matched case-insensitively (the DNR default).
export function buildRules(s) {
  const resourceTypes = s.includeFrames ? ['main_frame', 'sub_frame'] : ['main_frame'];
  const rules = [];
  const add = (priority, action, condition) =>
    rules.push({ id: rules.length + 1, priority, action, condition: { requestDomains: ENTRA_HOSTS, resourceTypes, ...condition } });
  const allow = (condition) => add(ALLOW, { type: 'allow' }, condition);
  // Chromium URL-encodes the value itself, and replaces an existing (even empty) login_hint in place.
  // In "always" mode a site's username hint is replaced too, so Microsoft gets only one account.
  const hint = (removeParams = []) => {
    if (s.hintMode === 'always') removeParams = [...removeParams, 'username'];
    return {
      type: 'redirect',
      redirect: { transform: { queryTransform: { ...(removeParams.length && { removeParams }), addOrReplaceParams: [{ key: 'login_hint', value: s.email }] } } },
    };
  };

  // Leave the request alone if the site already chose an account (sid + login_hint is an error)...
  const chosen = ['sid', 'id_token_hint', ...(s.hintMode === 'always' ? [] : ['login_hint', 'username'])];
  allow({ regexFilter: `[?&](${chosen.join('|')})=[^&#]` });
  // ...uses an encoded login_hint key we can't replace in place (a second login_hint is an error), or is a sign-up.
  allow({ regexFilter: '[?&](login%5fhint|prompt=create)' });
  if (s.accountPicker === 'site') allow({ regexFilter: '[?&]prompt=select_account' });
  // Keep an app's own hint in hidden-frame renewals, even in "always" mode, so an app never switches user silently.
  if (s.hintMode === 'always') allow({ regexFilter: '[?&](login_hint|username)=[^&#]', resourceTypes: ['sub_frame'] });
  // Personal-account sign-ins: personal-only endpoints, requests asking for a personal account, and
  // consumer sites such as outlook.live.com (which use /common with prompt=select_account).
  allow({ regexFilter: `^https://[^/]+/(${MSA_TENANTS})/` });
  allow({ regexFilter: `[?&]domain_hint=consumers(&|#|$)|${returnsTo(CONSUMER_SITES)}` });
  // Excluded sites: match where the sign-in returns to and the page that started it. One rule per site keeps
  // each regex under Edge's 2 KB compiled-size limit, which fits host names up to about 60 characters;
  // background.js drops longer ones and the initiator rule still covers them.
  for (const site of s.excludedSites.slice(0, MAX_SITE_RULES)) allow({ regexFilter: returnsTo(escapeRegex(site)) });
  if (s.excludedSites.length) allow({ initiatorDomains: s.excludedSites });

  // OAuth / OpenID Connect sign-in (v1 and v2 endpoints, any tenant).
  const authorize = '^https://[^/]+/[^/?#]+/oauth2/(v2\\.0/)?authorize\\?';
  if (s.accountPicker !== 'site') {
    // login_hint doesn't work together with prompt=select_account, so drop the prompt.
    add(SKIP_PICKER, hint(['prompt']),
      { requestMethods: ['get'], regexFilter: `${authorize}([^#]*&)?prompt=select_account(&|#|$)` });
  }
  add(HINT, hint(), { requestMethods: ['get'], regexFilter: authorize });
  // SAML and WS-Federation apps. SAML may POST; the internal 307 redirect keeps the body.
  add(HINT, hint(), { requestMethods: ['get', 'post'], regexFilter: '^https://[^/]+/[^/?#]+/(saml2|wsfed)(\\?|$)' });
  return rules;
}
