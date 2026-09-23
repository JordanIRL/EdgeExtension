import { loadSettings, cleanHosts } from './settings.js';

const $ = (id) => document.getElementById(id);
const save = (values) => chrome.storage.local.set(values);
const radios = (name) => document.querySelectorAll(`input[name="${name}"]`);

async function init() {
  const { settings, managed } = await loadSettings();
  for (const name of ['hintMode', 'accountPicker']) {
    for (const r of radios(name)) r.checked = r.value === settings[name];
  }
  $('includeFrames').checked = settings.includeFrames;
  $('excludedSites').value = settings.excludedSites.join('\n');

  for (const key of managed) {
    const el = $(key);
    if (!el) continue;
    el.disabled = true;
    el.closest('label, fieldset, section')?.classList.add('locked');
  }
  $('managedNote').hidden = !managed.length;
  renderStatus();
}

async function renderStatus() {
  const { status = {} } = await chrome.storage.session.get('status');
  if (!status.state) return; // no status until the first sync finishes
  $('profileEmail').textContent = status.email || 'Not signed in to this Edge profile';
}

for (const name of ['hintMode', 'accountPicker']) {
  for (const r of radios(name)) r.addEventListener('change', () => save({ [name]: r.value }));
}
$('includeFrames').addEventListener('change', (e) => save({ includeFrames: e.target.checked }));
$('excludedSites').addEventListener('change', (e) => {
  const { valid, invalid } = cleanHosts(e.target.value.split(/[\s,;]+/));
  $('sitesError').hidden = !invalid.length;
  $('sitesError').textContent = `Not a site name: ${invalid.join(', ')}`;
  save({ excludedSites: valid });
});

// 'change' only fires when the list loses focus, so save a half-edited list if the tab is closed.
addEventListener('pagehide', () => document.activeElement === $('excludedSites') &&
  $('excludedSites').dispatchEvent(new Event('change')));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) renderStatus();
});
init();
chrome.runtime.sendMessage('sync').catch(() => {});
