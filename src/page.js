(() => {
  if (window.__m3105GradesInstalled) return;
  window.__m3105GradesInstalled = true;

  const MODULE = 'modules/points/points';
  const ROW_PREFIX = 'm3105-';
  const META = Symbol('m3105');

  let grades = null;
  let store = null;

  const normalize = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[^a-zа-я0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const fmt = (n) =>
    Number.isFinite(n)
      ? (Math.round(n * 100) / 100).toLocaleString('ru-RU')
      : '—';

  function pointsState() {
    return store?.state?.[MODULE] ?? store?.state?.modules?.points?.points;
  }

  function enabled() {
    return Boolean(grades?.ok && grades.settings?.enabled);
  }

  function subjectFor(disciplineName) {
    if (!enabled()) return null;
    const name = normalize(disciplineName);
    if (!name) return null;
    const subjects = grades.subjects ?? [];
    const exact = subjects.find(
      (s) => normalize(s.subjectName) === name || normalize(s.title) === name,
    );
    if (exact) return exact;
    return (
      subjects.find((s) => {
        const subj = normalize(s.subjectName);
        return subj.length >= 6 && (name.includes(subj) || subj.includes(name));
      }) ?? null
    );
  }

  function meta(obj, original) {
    if (!obj[META]) {
      Object.defineProperty(obj, META, {
        value: { orig: original, subj: null, replaced: false },
        enumerable: false,
      });
    }
    return obj[META];
  }

  function mergedScore(official, subj) {
    if (!subj) return official;
    const table = Number(subj.total);
    if (!Number.isFinite(table) || table <= 0) return official;
    if (grades.settings.mode === 'table') return table;
    return Math.max(Number(official) || 0, table);
  }

  function applyDisciplines(st, active) {
    for (const d of st.disciplines ?? []) {
      if (!Array.isArray(d.current_score)) continue;
      const m = meta(d, d.current_score[0] ?? null);
      m.subj = active ? subjectFor(d.name) : null;
      const next = mergedScore(m.orig, m.subj);
      m.replaced = m.subj !== null && next !== m.orig;
      if (d.current_score[0] !== next) d.current_score.splice(0, 1, next);
    }
  }

  function labNote(lab) {
    if (!lab) return '';
    if (lab.status === 'accepted') {
      return lab.potential
        ? ` — принята, после теормина ≈ ${fmt(lab.potential)}`
        : ' — принята, ждёт теормина';
    }
    if (lab.status !== 'done') return '';
    const notes = [];
    if (lab.bonus) notes.push(`${lab.bonus > 0 ? '+' : ''}${fmt(lab.bonus)} плюсики`);
    if (lab.lateLoss) notes.push(`−${fmt(lab.lateLoss)} просрочка`);
    return notes.length ? ` (${notes.join(', ')})` : '';
  }

  const NO_TEACHER = { surname: '', name: '', patronymic: '' };

  function buildRows(subj) {
    const rootId = `${ROW_PREFIX}${subj.sourceId}`;
    const rows = [
      {
        id: rootId,
        parent_id: null,
        control_name: `Таблица преподавателя (m3105.ru): ${subj.title}`,
        required: false,
        lower_value: 0,
        max_value: subj.maxTotal || '',
        rate: Number(subj.total) || 0,
        date: subj.syncedAt ?? null,
        teacher: NO_TEACHER,
      },
    ];
    for (const part of subj.parts) {
      const hasValue = part.value !== null && part.value !== 0;
      const lab = part.lab;
      if (!hasValue && lab?.status !== 'accepted' && lab?.status !== 'done') {
        continue;
      }
      rows.push({
        id: `${rootId}-${part.key}`,
        parent_id: rootId,
        control_name: part.label + labNote(lab),
        required: false,
        lower_value: 0,
        max_value: part.max || '',
        rate: Number(part.value) || 0,
        date: null,
        teacher: NO_TEACHER,
      });
    }
    return rows;
  }

  function applyDetails(st) {
    const details = st.details;
    if (!details) return;
    let changed = false;
    for (const estId of Object.keys(details)) {
      const list = details[estId];
      if (!Array.isArray(list)) continue;
      const d = (st.disciplines ?? []).find((x) => String(x.est_id) === estId);
      const subj = d?.[META]?.subj ?? null;
      const base = list.filter((r) => !String(r?.id).startsWith(ROW_PREFIX));
      const next = subj ? base.concat(buildRows(subj)) : base;
      if (JSON.stringify(next) === JSON.stringify(list)) continue;
      details[estId] = next;
      changed = true;
    }
    if (changed) st.details = { ...details };
  }

  function applyAll() {
    const st = pointsState();
    if (!st) return;
    try {
      applyDisciplines(st, enabled());
      applyDetails(st);
    } catch (err) {
      console.warn('[m3105] не удалось дополнить зачётку', err);
    }
  }

  function identity() {
    const user = window.$nuxt?.$auth?.user ?? store?.state?.auth?.user;
    if (!user) return null;
    const fullName = [user.family_name, user.given_name]
      .filter(Boolean)
      .join(' ');
    return fullName ? { fullName } : null;
  }

  function hookStore() {
    store.subscribe((mutation) => {
      if (!mutation.type.startsWith(`${MODULE}/`)) return;
      applyAll();
    });
  }

  document.addEventListener('m3105:grades', (event) => {
    try {
      grades = JSON.parse(event.detail);
    } catch {
      grades = null;
    }
    if (grades && !grades.ok) {
      console.warn('[m3105] баллы не загрузились:', grades.error);
    }
    applyAll();
  });

  function waitForApp() {
    let hooked = false;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      store ??= window.$nuxt?.$store ?? null;
      if (store && !hooked) {
        hooked = true;
        hookStore();
      }
      const who = store ? identity() : null;
      if (who || tries > 240) {
        clearInterval(timer);
        if (!store) return;
        document.dispatchEvent(
          new CustomEvent('m3105:hello', {
            detail: JSON.stringify({ identity: who }),
          }),
        );
      }
    }, 250);
  }

  waitForApp();
})();
