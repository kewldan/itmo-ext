import { DEFAULT_SETTINGS, normalizeName } from './shared.js';

const API = 'https://m3105.ru/api/v1/grades';
const CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeGroup(s) {
  return String(s ?? '').toUpperCase().replaceAll('M', 'М').trim();
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`m3105.ru ответил ${res.status}`);
  return res.json();
}

async function fetchAllSources() {
  const first = await fetchJson(API);
  const sources = first.sources.filter((s) => s.id > 0 && !s.stream);
  return Promise.all(
    sources.map(async (s) => {
      const r =
        first.source?.id === s.id
          ? first
          : await fetchJson(`${API}?source=${s.id}`);
      return { source: r.source ?? s, rows: r.rows ?? [] };
    }),
  );
}

async function getSources(force) {
  const { cache } = await chrome.storage.local.get('cache');
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const fresh = { fetchedAt: Date.now(), sources: await fetchAllSources() };
    await chrome.storage.local.set({ cache: fresh });
    return fresh;
  } catch (err) {
    if (cache) return { ...cache, stale: true, error: String(err.message) };
    throw err;
  }
}

function findRow(rows, wantedName, wantedGroup) {
  const mine = rows.find((r) => r.me);
  if (mine) return { row: mine };
  if (!wantedName) return { row: null };
  const name = normalizeName(wantedName);
  let found = rows.filter((r) => normalizeName(r.name) === name);
  if (found.length > 1 && wantedGroup) {
    const group = normalizeGroup(wantedGroup);
    found = found.filter((r) => normalizeGroup(r.group) === group);
  }
  if (found.length > 1) return { row: null, ambiguous: found.length };
  return { row: found[0] ?? null };
}

function toSubject(source, row) {
  return {
    sourceId: source.id,
    title: source.title,
    subjectName: source.subjectName,
    maxTotal: source.maxTotal,
    syncedAt: source.syncedAt,
    changedAt: row.changedAt,
    url: `https://m3105.ru/grades?source=${source.id}`,
    total: row.total,
    group: row.group,
    name: row.name,
    parts: source.columns.map((c) => ({
      key: c.key,
      label: c.label,
      max: c.max,
      value: row.parts?.[c.key] ?? null,
      lab: row.labs?.[c.key] ?? null,
    })),
  };
}

async function getGrades({ identity, force }) {
  const settings = await getSettings();
  if (identity?.fullName) {
    await chrome.storage.local.set({ identity });
  }
  const stored = identity ?? (await chrome.storage.local.get('identity')).identity;
  const wantedName = settings.nameOverride || stored?.fullName || '';
  const wantedGroup = settings.groupOverride || '';

  const cache = await getSources(force);
  const subjects = [];
  const ambiguous = [];
  for (const { source, rows } of cache.sources) {
    const { row, ambiguous: n } = findRow(rows, wantedName, wantedGroup);
    if (row) subjects.push(toSubject(source, row));
    else if (n) ambiguous.push({ title: source.title, count: n });
  }
  return {
    ok: true,
    settings,
    wantedName,
    subjects,
    ambiguous,
    sourcesCount: cache.sources.length,
    fetchedAt: cache.fetchedAt,
    stale: Boolean(cache.stale),
    error: cache.error ?? null,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'getGrades') return false;
  (async () => {
    try {
      sendResponse(await getGrades(message));
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message ?? err) });
    }
  })();
  return true;
});
