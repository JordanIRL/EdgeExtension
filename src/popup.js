import { describe, clearSignInSessions } from './settings.js';

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
  const canPause = status.allowPause && ['active', 'paused'].includes(status.state);
  $('pause').hidden = !canPause || paused;
  $('pauseHint').hidden = !canPause || paused;
  $('resume').hidden = !paused;
  $('managed').hidden = !managed.length;
}

$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('pause').addEventListener('click', () => chrome.storage.local.set({ pausedUntil: Date.now() + 15 * 60_000 }));
$('resume').addEventListener('click', () => chrome.storage.local.set({ pausedUntil: 0 }));
$('clearSessions').addEventListener('click', () => clearSignInSessions().then(() => window.close()));
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
