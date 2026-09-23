// Run with tests/run.sh (JavaScriptCore on macOS). Prints generated regexes for the RE2 size check.
import { buildRules, ORIGINS, ENTRA_HOSTS } from '../src/rules.js';
import { DEFAULTS, cleanHost, cleanHosts, normalizeEmail } from '../src/settings.js';
import { navigate } from './dnr.js';

const log = globalThis.print ?? console.log;
let passed = 0, failed = 0;
const regexes = new Set();

function check(name, ok, info = '') {
  if (ok) passed++;
  else { failed++; log(`FAIL ${name}${info ? `\n     ${info}` : ''}`); }
}

const MARY = 'mary@example.com';
const HINT = 'login_hint=mary%40example.com';
const rulesFor = (overrides = {}) => {
  const rules = buildRules({ ...DEFAULTS, email: MARY, ...overrides });
  for (const r of rules) if (r.condition.regexFilter) regexes.add(r.condition.regexFilter);
  return rules;
};

// expect: 'same' (untouched) or a function(finalUrl) => boolean
function run(name, settings, url, expect, req = {}) {
  const rules = rulesFor(settings);
  const { url: final, hops } = navigate(rules, { url, type: 'main_frame', method: 'get', ...req });
  const ok = expect === 'same' ? final === url : expect(final);
  check(name, ok && hops <= 1, `hops=${hops}\n     in:  ${url}\n     out: ${final}`);
}
const has = (...parts) => (u) => parts.every((p) => u.includes(p));
const count = (u, s) => u.split(s).length - 1;

const V2 = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=c44b4083&scope=openid&response_mode=fragment';
const V1 = 'https://login.microsoftonline.com/0c8f0000-aaaa-bbbb-cccc-000000000000/oauth2/authorize?client%5Fid=00000003&response%5Fmode=form_post';

// --- OAuth / OIDC, work account ---
run('v2 authorize gets login_hint', {}, V2, (u) => u === `${V2}&${HINT}`);
run('v1 tenant authorize gets login_hint', {}, V1, has(HINT));
run('common endpoint', {}, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x', has(HINT));
run('empty login_hint replaced in place (no duplicate)', {}, `${V2}&login_hint=&state=abc`,
  (u) => u === `${V2}&${HINT}&state=abc` && count(u, 'login_hint') === 1);
check('default is to use the profile account', DEFAULTS.hintMode === 'always');
run('default replaces a site hint for another account', {}, `${V2}&login_hint=bob%40example.com`,
  (u) => u === `${V2}&${HINT}`);
run('keep mode: existing hint kept', { hintMode: 'missing' }, `${V2}&login_hint=bob%40example.com`, 'same');
run('keep mode: existing username kept', { hintMode: 'missing' }, `${V2}&username=bob%40example.com`, 'same');
run('always mode replaces other hint', { hintMode: 'always' }, `${V2}&login_hint=bob%40example.com`,
  (u) => u.includes(HINT) && !u.includes('bob') && count(u, 'login_hint') === 1);
run('always mode, already ours: no redirect', { hintMode: 'always' }, `${V2}&${HINT}`, 'same');
run('always mode replaces username', { hintMode: 'always' }, `${V2}&username=bob%40example.com`,
  (u) => u === `${V2}&${HINT}`);
run('sid kept (sid + login_hint is AADSTS90005)', {}, `${V2}&sid=abc123`, 'same');
run('sid kept in always mode', { hintMode: 'always' }, `${V2}&sid=abc123`, 'same');
run('id_token_hint kept', {}, `${V2}&id_token_hint=eyJ0`, 'same');
run('encoded login%5Fhint left alone', {}, `${V2}&login%5Fhint=`, 'same');
run('encoded login%5Fhint left alone (always)', { hintMode: 'always' }, `${V2}&login%5fhint=bob`, 'same');
run('keep mode: keys are case-insensitive for the guard', { hintMode: 'missing' }, `${V2}&LOGIN_HINT=bob`, 'same');
run('sign-up (prompt=create) left alone', {}, `${V2}&prompt=create`, 'same');
run('prompt=login still hinted', {}, `${V2}&prompt=login`, has(HINT, 'prompt=login'));
run('prompt=none (silent) hinted', {}, `${V2}&prompt=none`, has(HINT, 'prompt=none'));

// --- Account picker (Outlook on the web sends prompt=select_account) ---
const OWA = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9199bf20&prompt=select_account&state=x';
run('select_account removed and hinted', {}, OWA,
  (u) => u === `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9199bf20&state=x&${HINT}`);
run('select_account as last param', {}, `${V2}&prompt=select_account`, (u) => u === `${V2}&${HINT}`);
run('select_account kept when set to show picker', { accountPicker: 'site' }, OWA, 'same');
run('keep mode: select_account with site hint kept', { hintMode: 'missing' }, `${OWA}&login_hint=bob%40example.com`, 'same');
run('select_account + empty hint', {}, `${OWA}&login_hint=`, (u) => !u.includes('prompt=') && count(u, 'login_hint') === 1 && u.includes(HINT));
run('select_account in always mode', { hintMode: 'always' }, `${OWA}&login_hint=bob`, (u) => !u.includes('prompt=') && u.includes(HINT) && !u.includes('bob'));
run('other prompt value untouched', {}, `${V2}&prompt=consent`, has(HINT, 'prompt=consent'));
run('prompt with several values kept (never drops prompt=login)', {}, `${V2}&prompt=login+select_account`,
  has(HINT, 'prompt=login+select_account'));

// --- Personal-account sign-ins in a work profile are left alone ---
const CONSUMER_OWA = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9199bf20&redirect_uri=https%3A%2F%2Foutlook.live.com%2Fmail%2F&prompt=select_account';
run('consumer Outlook (outlook.live.com) untouched', {}, CONSUMER_OWA, 'same');
run('consumer OneDrive return untouched', {}, `${V2}&redirect_uri=https%3A%2F%2Fonedrive.live.com%2F`, 'same');
run('work Outlook still hinted', {}, OWA.replace('client_id=9199bf20', 'client_id=9199bf20&redirect_uri=https%3A%2F%2Foutlook.office.com%2Fmail%2F'), has(HINT));
run('domain_hint=consumers untouched', {}, `${V2}&domain_hint=consumers`, 'same');
run('domain_hint=organizations still hinted', {}, `${V2}&domain_hint=organizations`, has(HINT));
run('look-alike live.com host still hinted', {}, `${V2}&redirect_uri=https%3A%2F%2Fnotlive.com%2F`, has(HINT));
run('live.com in a path still hinted', {}, `${V2}&redirect_uri=https%3A%2F%2Fcontoso.com%2Fdocs.live.com%2Fauth`, has(HINT));
const MSA_PORTAL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=81feaced&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-signin-oauth&prompt=login&msaoauth2=true';
run('Microsoft account site (account.microsoft.com) untouched', {}, MSA_PORTAL, 'same');
run('work account portal (myaccount.microsoft.com) still hinted', {},
  MSA_PORTAL.replace('account.microsoft.com', 'myaccount.microsoft.com'), has(HINT));

// --- Hosts and paths ---
run('login.windows.net alias', {}, 'https://login.windows.net/common/oauth2/authorize?client_id=x', has(HINT));
run('login.microsoft.com wsfed', {}, 'https://login.microsoft.com/common/wsfed?wa=wsignin1.0&wtrealm=x', has(HINT));
run('sts.windows.net', {}, 'https://sts.windows.net/contoso.com/oauth2/authorize?client_id=x', has(HINT));
run('uppercase path still matches', {}, 'https://login.microsoftonline.com/Common/OAuth2/V2.0/Authorize?client_id=x', has(HINT));
run('consumers endpoint left alone for work', {}, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=x', 'same');
run('MSA tenant id left alone for work', {}, 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/oauth2/v2.0/authorize?client_id=x', 'same');
run('personal-account site login.live.com untouched', {}, 'https://login.live.com/oauth20_authorize.srf?client_id=x', 'same');
run('personal-account login.srf untouched', {}, 'https://login.live.com/login.srf?wa=wsignin1.0', 'same');
run('credential POST untouched', {}, 'https://login.microsoftonline.com/common/login', 'same', { method: 'post' });
for (const path of ['common/reprocess?ctx=x', 'kmsi', 'common/oauth2/v2.0/logout?x=1', 'common/adminconsent?client_id=x',
  'common/oauth2/deviceauth', 'common/oauth2/v2.0/token', 'login.srf?wa=wsignin1.0', '?whr=contoso.com', 'tfp/t/p/oauth2/v2.0/authorize?x=1']) {
  run(`not a sign-in start: /${path}`, {}, `https://login.microsoftonline.com/${path}`, 'same');
}
run('B2C host untouched', {}, 'https://contoso.b2clogin.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize?p=b2c_1&client_id=x', 'same');
run('look-alike host untouched', {}, 'https://login.microsoftonline.com.evil.test/common/oauth2/v2.0/authorize?client_id=x', 'same');
run('POST to authorize untouched', {}, V2, 'same', { method: 'post' });
run('XHR untouched', {}, V2, 'same', { type: 'xmlhttprequest' });
run('hidden frame hinted by default', {}, `${V2}&prompt=none`, has(HINT), { type: 'sub_frame' });
run('hidden frame skipped when off', { includeFrames: false }, `${V2}&prompt=none`, 'same', { type: 'sub_frame' });
run('always mode keeps an app hint in hidden frames', { hintMode: 'always' }, `${V2}&prompt=none&login_hint=bob`, 'same', { type: 'sub_frame' });
run('always mode still fills an empty hint in hidden frames', { hintMode: 'always' }, `${V2}&prompt=none&login_hint=`, has(HINT), { type: 'sub_frame' });
run('always mode keeps an app username in hidden frames', { hintMode: 'always' }, `${V2}&prompt=none&username=bob`, 'same', { type: 'sub_frame' });

// --- SAML / WS-Fed ---
const SAML = 'https://login.microsoftonline.com/0c8f0000-aaaa-bbbb-cccc-000000000000/saml2';
run('SAML redirect binding', {}, `${SAML}?SAMLRequest=fZJb&RelayState=x`, has(HINT, 'SAMLRequest=fZJb'));
run('SAML POST binding gets query', {}, SAML, (u) => u === `${SAML}?${HINT}`, { method: 'post' });
run('keep mode: WS-Fed with hint kept', { hintMode: 'missing' }, `https://login.microsoftonline.com/common/wsfed?wa=wsignin1.0&login_hint=bob`, 'same');
run('default: WS-Fed hint replaced', {}, `https://login.microsoftonline.com/common/wsfed?wa=wsignin1.0&login_hint=bob`,
  (u) => u.includes(HINT) && !u.includes('bob') && count(u, 'login_hint') === 1);

run('other clouds untouched', {}, 'https://login.microsoftonline.us/common/oauth2/v2.0/authorize?client_id=x', 'same');

// --- Excluded sites ---
const EX = { excludedSites: ['dev.azure.com', 'contoso.sharepoint.com'] };
const withRedirect = (r) => `${V2}&redirect_uri=${encodeURIComponent(r)}`;
run('excluded by redirect_uri', EX, withRedirect('https://dev.azure.com/'), 'same');
run('excluded by redirect_uri subdomain', EX, withRedirect('https://app.dev.azure.com/cb'), 'same');
run('excluded by redirect%5Furi (SharePoint)', EX, `${V1}&redirect%5Furi=https%3A%2F%2Fcontoso.sharepoint.com%2F_forms%2Fdefault.aspx`, 'same');
run('excluded by redirect_uri with port', EX, withRedirect('https://dev.azure.com:443/x'), 'same');
run('excluded by initiator', EX, V2, 'same', { initiator: 'https://contoso.sharepoint.com' });
run('excluded by initiator subdomain', { excludedSites: ['azure.com'] }, V2, 'same', { initiator: 'https://portal.azure.com' });
run('not excluded: other site', EX, withRedirect('https://portal.azure.com/'), has(HINT), { initiator: 'https://portal.azure.com' });
run('not excluded: look-alike host', EX, withRedirect('https://dev.azure.com.evil.test/'), has(HINT));
run('not excluded: excluded host in the path', EX, withRedirect('https://evil.test/x.dev.azure.com/cb'), has(HINT));
run('not excluded: excluded host in an unencoded path', EX, `${V2}&redirect_uri=https://evil.test/x.dev.azure.com/cb`, has(HINT));
run('not excluded: typed URL', EX, V2, has(HINT));
run('excluded by unencoded redirect_uri', EX, `${V2}&redirect_uri=https://dev.azure.com/cb`, 'same');
run('excluded by WS-Fed wreply', EX, 'https://login.microsoftonline.com/common/wsfed?wa=wsignin1.0&wreply=https%3a%2f%2fcontoso.sharepoint.com%2f_trust%2f', 'same');
run('not excluded: host prefix only', EX, withRedirect('https://olddev.azure.com/'), has(HINT));
run('excluded: query right after host', EX, withRedirect('https://dev.azure.com?x=1'), 'same');
run('not excluded: longer TLD', EX, withRedirect('https://dev.azure.company/'), has(HINT));
{
  const many = Array.from({ length: 1200 }, (_, i) => `site${i}.example.com`);
  const rules = buildRules({ ...DEFAULTS, email: MARY, excludedSites: many });
  check('regex rules stay under the 1000 limit', rules.filter((r) => r.condition.regexFilter).length <= 1000);
  check('initiator exclusion keeps every site', rules.some((r) => r.condition.initiatorDomains?.length === 1200));
}
{
  const rules = buildRules({ ...DEFAULTS, email: 'o\'neil+test@example.com' });
  const { url } = navigate(rules, { url: V2, type: 'main_frame', method: 'get' });
  check('special characters encoded', url.endsWith("login_hint=o'neil%2Btest%40example.com"), url);
}

// --- Rule shape (an invalid rule rejects the whole update) ---
for (const settings of [{}, { hintMode: 'missing', accountPicker: 'site', includeFrames: false }, { ...EX, hintMode: 'missing' },
  { ...EX, hintMode: 'always', accountPicker: 'site' }]) {
  const rules = rulesFor(settings);
  const ids = rules.map((r) => r.id);
  check('ids unique positive ints', ids.every((id, i) => Number.isInteger(id) && id === i + 1), JSON.stringify(ids));
  for (const r of rules) {
    const c = r.condition;
    check('priority int >= 1', Number.isInteger(r.priority) && r.priority >= 1);
    check('lists a frame type', c.resourceTypes.length && c.resourceTypes.every((t) => t === 'main_frame' || t === 'sub_frame'));
    check('one filter kind', !(c.regexFilter && c.urlFilter));
    check('no tabIds in dynamic rules', !c.tabIds && !c.excludedTabIds);
    check('methods lowercase', !c.requestMethods || c.requestMethods.every((m) => m === m.toLowerCase()));
    check('regex ASCII, no lookaround/backrefs', !c.regexFilter || (/^[\x20-\x7e]+$/.test(c.regexFilter) && !/\(\?[=!<]|\\[1-9]/.test(c.regexFilter)), c.regexFilter);
    check('non-empty domain lists', ['requestDomains', 'initiatorDomains'].every((k) => !c[k] || c[k].length));
    check('hint value is raw email', r.action.type !== 'redirect' || r.action.redirect.transform.queryTransform.addOrReplaceParams[0].value === MARY);
  }
}

// --- Hosts / permissions ---
check('origins match hosts', JSON.stringify(ORIGINS) === JSON.stringify(ENTRA_HOSTS.map((h) => `https://${h}/*`)));

// --- Settings helpers ---
check('normalizeEmail trims/lowercases', normalizeEmail('  Mary@Example.COM ') === MARY);
check('normalizeEmail rejects junk', ['', 'mary', 'mary@', '@example.org', 'a b@example.com', null, undefined].every((v) => normalizeEmail(v) === ''));
check('cleanHost URL', cleanHost('https://Dev.Azure.com/org/project') === 'dev.azure.com');
check('cleanHost wildcard', cleanHost('*.sharepoint.com') === 'sharepoint.com');
check('cleanHost email-domain forms', ['@contoso.com', '*@contoso.com', 'contoso.com.', ' Contoso.COM '].every((v) => cleanHost(v) === 'contoso.com'));
check('cleanHost port', cleanHost('intranet.contoso.com:8443') === 'intranet.contoso.com');
check('cleanHost rejects', ['localhost', 'a b.com', 'contoso', '', '.com'].every((v) => cleanHost(v) === ''));
{
  const { valid, invalid } = cleanHosts(['dev.azure.com', 'DEV.azure.com', 'bad host', '', 'x.y']);
  check('cleanHosts dedupes and reports', JSON.stringify(valid) === '["dev.azure.com","x.y"]' && JSON.stringify(invalid) === '["bad host"]');
}
check('cleanHosts tolerates non-arrays', cleanHosts('dev.azure.com').valid.length === 0);

// A long excluded host, to check the per-rule regex size limit in the RE2 step (longer ones are dropped at runtime).
rulesFor({ excludedSites: [`${'a'.repeat(25)}.${'b'.repeat(22)}.example.com`] }); // 60 characters

log(`\n${passed} passed, ${failed} failed`);
for (const r of regexes) log(`REGEX ${r}`);
if (failed) throw new Error(`${failed} test(s) failed`);
