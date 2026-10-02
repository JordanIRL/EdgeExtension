import { loadSettings, cleanHosts, clearSignInSessions, MAX_EXCLUDED_SITES } from './settings.js';

const $ = (id) => document.getElementById(id);
const save = (values) => chrome.storage.local.set(values);

async function init() {
  let settings, managed;
  try { ({ settings, managed } = await loadSettings()); }
  catch (e) {
    $('sitesError').textContent = e.message;
    $('sitesError').hidden = false;
    await renderStatus();
    return;
  }
  $('excludedSites').disabled = managed.includes('excludedSites');
  document.querySelectorAll('.locked').forEach((el) => el.classList.remove('locked'));
  $('excludedSites').value = settings.excludedSites.join('\n');

  for (const key of managed) {
    const el = $(key);
    if (!el) continue;
    el.disabled = true;
    el.closest('section')?.classList.add('locked');
  }
  $('managedNote').hidden = !managed.length;
  renderStatus();
}

async function renderStatus() {
  const { status = {} } = await chrome.storage.session.get('status');
  if (!status.state) return; // no status until the first sync finishes
  $('profileEmail').textContent = status.email || 'Not signed in to this Edge profile';
}

$('excludedSites').addEventListener('change', (e) => {
  const { valid, invalid } = cleanHosts(e.target.value.split(/[\s,;]+/));
  const error = invalid.length ? `Not a site name: ${invalid.join(', ')}` :
    valid.length > MAX_EXCLUDED_SITES ? `Use at most ${MAX_EXCLUDED_SITES} excluded sites.` : '';
  $('sitesError').hidden = !error;
  $('sitesError').textContent = error;
  if (!error) save({ excludedSites: valid });
});

$('clearSessions').addEventListener('click', clearSignInSessions);

// Pages can't open edge:// addresses from a link, so open them in a new tab.
$('extensionDetails').href = `edge://extensions/?id=${chrome.runtime.id}`;
for (const a of document.querySelectorAll('a[href^="edge:"]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: a.href });
  });
}

// 'change' only fires when the list loses focus, so save a half-edited list if the tab is closed.
addEventListener('pagehide', () => document.activeElement === $('excludedSites') &&
  $('excludedSites').dispatchEvent(new Event('change')));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) renderStatus();
  if (area === 'managed') init();
});
init();
chrome.runtime.sendMessage('sync').catch(() => {});
