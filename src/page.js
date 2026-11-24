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

  function isActualSemester(st) {
    const plan = st.plans?.find((p) => p.main_plan === st.currentPlan);
    const sem = plan?.semesters?.find((s) => s.semester === st.currentSemester);
    return sem ? sem.actual !== false : true;
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

  function applyWidget(st) {
    for (const d of st.widgetDisciplines ?? []) {
      if (Array.isArray(d.current_score)) continue;
      const m = meta(d, d.current_score ?? null);
      m.subj = subjectFor(d.name);
      const next = mergedScore(m.orig, m.subj);
      m.replaced = m.subj !== null && next !== m.orig;
      if (d.current_score !== next) d.current_score = next;
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

  // копия ListItem.details с my.itmo.ru: после вложенной строки она пропускает следующую
  function itmoTree(list) {
    const data = list.map((x) => ({ ...x }));
    const roots = [];
    const attach = (el, nodes, at) => {
      for (const node of nodes) {
        if (el.parent_id === node.id) {
          node.children.push(el);
          data.splice(at, 1);
          break;
        }
        attach(el, node.children, at);
      }
    };
    for (let pass = 0; data.length > 0 && pass < 10; pass += 1) {
      for (let i = 0; i < data.length; i += 1) {
        const el = data[i];
        el.children = [];
        if (el.parent_id !== null) {
          attach(el, roots, i);
        } else {
          roots.push(el);
          data.splice(i, 1);
          i -= 1;
        }
      }
    }
    return roots;
  }

  function arrangeForTree(base, rows) {
    const [root, ...children] = rows;
    if (children.length < 2) return rows;
    const probe = children.map((c, slot) => ({ ...c, slot }));
    const tree = itmoTree([...base, root, ...probe]);
    const slots = tree.find((n) => n.id === root.id)?.children.map((n) => n.slot);
    if (!slots || slots.length !== children.length) return rows;
    const arranged = new Array(children.length);
    slots.forEach((slot, j) => {
      arranged[slot] = children[j];
    });
    return [root, ...arranged];
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
      const next = subj
        ? base.concat(arrangeForTree(base, buildRows(subj)))
        : base;
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
      applyDisciplines(st, enabled() && isActualSemester(st));
      applyDetails(st);
      applyWidget(st);
    } catch (err) {
      console.warn('[m3105] не удалось дополнить зачётку', err);
    }
    scheduleBadges();
  }

  const STYLE = `
    .m3105-badge {
      display: inline-flex; align-items: center; gap: 4px;
      margin-left: 8px; padding: 1px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 600; line-height: 18px;
      vertical-align: middle; white-space: nowrap; text-decoration: none;
      color: #1946ba; background: #e8efff; border: 1px solid #c9d8ff;
    }
    .m3105-badge:hover { background: #dbe6ff; text-decoration: none; }
    .m3105-badge--replaced { color: #0b6b3a; background: #e3f6ea; border-color: #b9e6c9; }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'm3105-style';
    style.textContent = STYLE;
    (document.head ?? document.documentElement).append(style);
  }

  function badgeFor(subj, m) {
    const a = document.createElement('a');
    a.className = 'm3105-badge';
    a.href = subj.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.m3105 = String(subj.sourceId);
    const official = Number(m.orig) || 0;
    if (m.replaced) a.classList.add('m3105-badge--replaced');
    if (!m.replaced) a.textContent = `таблица: ${fmt(subj.total)}`;
    else if (official) a.textContent = `из таблицы · в ИСУ ${fmt(official)}`;
    else a.textContent = 'из таблицы';
    const synced = subj.syncedAt
      ? new Date(subj.syncedAt).toLocaleString('ru-RU')
      : 'неизвестно';
    a.title =
      `${subj.title}: ${fmt(subj.total)} из ${subj.maxTotal}\n` +
      `В ИСУ: ${official ? fmt(official) : 'пусто'}\n` +
      `Таблица синхронизирована: ${synced}\n` +
      'Открыть на m3105.ru';
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }

  function renderBadges() {
    const st = pointsState();
    const byName = new Map();
    for (const d of [...(st?.disciplines ?? []), ...(st?.widgetDisciplines ?? [])]) {
      const m = d[META];
      if (m?.subj) byName.set(normalize(d.name), { subj: m.subj, m });
    }
    for (const item of document.querySelectorAll('.list-item')) {
      const title = item.querySelector('.font-weight-bold');
      if (!title) continue;
      const existing = title.querySelector('.m3105-badge');
      const own = existing ? existing.textContent : '';
      const name = normalize((title.textContent ?? '').replace(own, ''));
      const hit = byName.get(name);
      if (!hit) {
        existing?.remove();
        continue;
      }
      const fresh = badgeFor(hit.subj, hit.m);
      if (
        existing &&
        existing.textContent === fresh.textContent &&
        existing.title === fresh.title
      ) {
        continue;
      }
      existing?.remove();
      title.append(fresh);
    }
  }

  let badgesQueued = false;
  function scheduleBadges() {
    if (badgesQueued) return;
    badgesQueued = true;
    requestAnimationFrame(() => {
      badgesQueued = false;
      renderBadges();
    });
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
    new MutationObserver(scheduleBadges).observe(document.body, {
      childList: true,
      subtree: true,
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
      if (store && !hooked && document.body) {
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

  injectStyle();
  waitForApp();
})();
