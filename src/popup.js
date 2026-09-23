import { describe } from './settings.js';

const $ = (id) => document.getElementById(id);
let status = {};

async function render() {
  ({ status = {} } = await chrome.storage.session.get('status'));
  const [headline, detail] = describe(status);
  const paused = status.state === 'paused';
  const managed = status.managed ?? [];

  $('status').dataset.state = status.state === 'active' && !status.hasAccess ? 'warn' : status.state ?? '';
  $('headline').textContent = headline;
  $('detail').textContent = detail;
  $('grant').hidden = status.state !== 'active' || status.hasAccess;
  $('enabled').checked = status.enabled ?? true;
  $('enabled').disabled = managed.includes('enabled');
  $('pause').hidden = !status.allowPause || !['active', 'paused'].includes(status.state);
  $('pauseHint').hidden = $('pause').hidden || paused;
  for (const b of document.querySelectorAll('[data-minutes]')) b.hidden = paused;
  $('resume').hidden = !paused;
  $('managed').hidden = !managed.length;
}

$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
for (const button of document.querySelectorAll('[data-minutes]')) {
  button.addEventListener('click', () =>
    chrome.storage.local.set({ pausedUntil: Date.now() + Number(button.dataset.minutes) * 60_000 }));
}
$('resume').addEventListener('click', () => chrome.storage.local.set({ pausedUntil: 0 }));
$('grant').addEventListener('click', () => chrome.permissions.request({ origins: status.origins }));
$('settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) render();
});
render();
chrome.runtime.sendMessage('sync').catch(() => {}); // re-read the profile account every time the popup opens
