import { DEFAULT_SETTINGS } from '../src/shared.js';

const $ = (id) => document.getElementById(id);

const fmt = (n) =>
  Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString('ru-RU') : '—';

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveSettings(patch) {
  const settings = { ...(await loadSettings()), ...patch };
  await chrome.storage.sync.set({ settings });
}

function renderGrades(res) {
  const list = $('subjects');
  list.replaceChildren();
  $('error').hidden = true;

  if (!res?.ok) {
    $('who').textContent = 'Не получилось загрузить баллы.';
    $('error').textContent = res?.error ?? 'Неизвестная ошибка';
    $('error').hidden = false;
    return;
  }

  if (!res.wantedName) {
    $('who').textContent =
      'Откройте my.itmo.ru, чтобы расширение узнало ваше имя, или укажите его ниже.';
  } else if (res.subjects.length === 0) {
    $('who').textContent = `«${res.wantedName}» не найден ни в одной из ${res.sourcesCount} таблиц.`;
    $('manual').open = true;
  } else {
    const row = res.subjects[0];
    $('who').textContent = `${row.name}, ${row.group}`;
  }

  for (const a of res.ambiguous ?? []) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = `${a.title}: ${a.count} тёзки — укажите группу`;
    list.append(li);
    $('manual').open = true;
  }

  for (const s of res.subjects) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = s.url;
    link.target = '_blank';
    link.textContent = s.subjectName;
    link.title = s.title;
    const total = document.createElement('span');
    total.className = 'total';
    total.textContent = `${fmt(s.total)} / ${s.maxTotal}`;
    li.append(link, total);
    list.append(li);
  }

  if (res.error) {
    $('error').textContent = `Показаны сохранённые баллы: ${res.error}`;
    $('error').hidden = false;
  }
  $('updated').textContent = res.fetchedAt
    ? `Обновлено ${new Date(res.fetchedAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '';
}

async function refresh(force = false) {
  $('refresh').disabled = true;
  try {
    renderGrades(await chrome.runtime.sendMessage({ type: 'getGrades', force }));
  } catch (err) {
    renderGrades({ ok: false, error: String(err?.message ?? err) });
  } finally {
    $('refresh').disabled = false;
  }
}

async function init() {
  const settings = await loadSettings();
  $('enabled').checked = settings.enabled;
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === settings.mode;
    radio.addEventListener('change', () => saveSettings({ mode: radio.value }));
  }
  $('enabled').addEventListener('change', (e) =>
    saveSettings({ enabled: e.target.checked }),
  );
  for (const id of ['nameOverride', 'groupOverride']) {
    $(id).value = settings[id];
    $(id).addEventListener('change', async (e) => {
      await saveSettings({ [id]: e.target.value.trim() });
      refresh();
    });
  }
  if (settings.nameOverride || settings.groupOverride) $('manual').open = true;
  $('refresh').addEventListener('click', () => refresh(true));
  await refresh();
}

init();
