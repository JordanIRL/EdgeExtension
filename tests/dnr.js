// A small model of Chromium's declarativeNetRequest matching, for the subset of features rules.js uses:
// - rules without resourceTypes never match main_frame; conditions are ANDed
// - requestDomains / initiatorDomains include subdomains; no initiator never matches initiatorDomains
// - regexFilter is case-insensitive by default
// - the highest (priority, action) wins, with allow > redirect at equal priority
// - addOrReplaceParams replaces the first exact key in place or appends; values are URL-encoded
// - a redirect to the same URL is dropped, and a redirected URL is matched again (max 20 hops)

const hostOf = (url) => (/^[a-z]+:\/\/([^/:?#]+)/i.exec(url) || [])[1]?.toLowerCase() ?? '';
const domainMatch = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));
const RANK = { allow: 5, allowAllRequests: 4, block: 3, upgradeScheme: 2, redirect: 1, modifyHeaders: 0 };

function matches(rule, req) {
  const c = rule.condition;
  if (c.urlFilter) throw new Error('urlFilter is not modelled; use regexFilter');
  if (!(c.resourceTypes ?? []).includes(req.type)) return false;
  if (c.requestMethods && !c.requestMethods.includes(req.method)) return false;
  if (c.requestDomains && !domainMatch(hostOf(req.url), c.requestDomains)) return false;
  if (c.initiatorDomains && !(req.initiator && domainMatch(hostOf(req.initiator), c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains && req.initiator && domainMatch(hostOf(req.initiator), c.excludedInitiatorDomains)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter, 'i').test(req.url)) return false;
  return true;
}

const encode = (s) => encodeURIComponent(s).replace(/%20/g, '+');

function transformQuery(url, { removeParams = [], addOrReplaceParams = [] }) {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf('?');
  const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const parts = qAt >= 0 ? noHash.slice(qAt + 1).split('&').filter((p) => p !== '') : [];
  const pending = [...addOrReplaceParams];
  const out = [];
  for (const part of parts) {
    const key = part.split('=')[0];
    if (removeParams.includes(key)) continue;
    const i = pending.findIndex((p) => p.key === key);
    if (i >= 0) {
      out.push(`${encode(key)}=${encode(pending[i].value)}`);
      pending.splice(i, 1);
    } else {
      out.push(part);
    }
  }
  for (const p of pending) if (!p.replaceOnly) out.push(`${encode(p.key)}=${encode(p.value)}`);
  return `${base}${out.length ? `?${out.join('&')}` : ''}${hash}`;
}

// Returns the matching rule (or null) and the redirect target (or null) for one request.
export function evaluate(rules, req) {
  let best = null;
  for (const rule of rules) {
    if (!matches(rule, req)) continue;
    const score = (rule.priority ?? 1) * 256 + RANK[rule.action.type];
    if (!best || score > best.score) best = { rule, score };
  }
  if (!best || best.rule.action.type !== 'redirect') return { rule: best?.rule ?? null, url: null };
  const target = transformQuery(req.url, best.rule.action.redirect.transform.queryTransform);
  return { rule: best.rule, url: target === req.url ? null : target };
}

// Follows redirects the way the browser would and returns the final URL and hop count.
export function navigate(rules, req) {
  let url = req.url;
  for (let hops = 0; hops <= 20; hops++) {
    const { url: next } = evaluate(rules, { ...req, url });
    if (!next) return { url, hops };
    url = next;
  }
  throw new Error(`redirect loop: ${req.url}`);
}
