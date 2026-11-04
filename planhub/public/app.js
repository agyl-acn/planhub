'use strict';
/* Planhub client. Vanilla JS, hash routing, one render function per view. */

const COLS = ['kpis', 'items', 'projects', 'tasks', 'entries', 'dumps', 'logs'];
const S = Object.fromEntries(COLS.map(c => [c, []]));
const ui = {
  project: null, dumpFilter: 'new', calView: innerWidth < 768 ? 'day' : 'week', calDate: new Date(), showActual: true,
  kpiFilter: 'active', kpiCat: 'all', kpiOpen: new Set(), sideTab: 'tasks', timeRange: 'week', openGroups: new Set(),
};
const DAY_START = 6, DAY_END = 23, MIN_FREE = 30;

/* ---------- data ---------- */
async function req(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${url} failed (${r.status})`);
  return r.status === 204 ? null : r.json();
}
const db = {
  async load() { await Promise.all(COLS.map(async c => { S[c] = await req('GET', `/api/${c}`); })); },
  async add(c, row) { const x = await req('POST', `/api/${c}`, row); S[c].push(x); return x; },
  async put(c, id, patch) { const x = await req('PUT', `/api/${c}/${id}`, patch); S[c] = S[c].map(r => r.id === id ? x : r); return x; },
  async del(c, id) {
    await req('DELETE', `/api/${c}/${id}`);
    S[c] = S[c].filter(r => r.id !== id);
    if (c === 'kpis') S.items = S.items.filter(i => i.kpi_id !== id);
    if (c === 'items') S.tasks.forEach(t => { if (t.item_id === id) t.item_id = null; });
    if (c === 'projects') S.tasks.forEach(t => { if (t.project_id === id) t.project_id = null; });
    if (c === 'tasks' || c === 'dumps') S.entries = S.entries.filter(e => e.source_id !== id);
  },
};
const byId = (c, id) => S[c].find(r => r.id === id);

/* ---------- helpers ---------- */
const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const fmtDate = (s, opt = { day: 'numeric', month: 'short' }) => parseYmd(s).toLocaleDateString('en-GB', opt);
const fmtDur = ms => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
const fmtHMS = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m ${pad(s % 60)}s`; };
const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const isoAt = (date, time) => new Date(`${date}T${time}:00`).toISOString();
const hm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const firstLine = s => String(s || '').split('\n')[0].slice(0, 90);

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 2400);
}

const P = {
  flag: '<path d="M5 21V4"/><path d="M5 4c3-1.5 5 1.5 8 0s4-1 6 0v9c-2-1-3-1.5-6 0s-5-1.5-8 0"/>',
  kanban: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 9z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/>',
};
const ic = (n, label) => `<svg class="ic" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[n]}</svg>`;
const chev = `<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true">${P.right}</svg>`;

/* ---------- derived ---------- */
const itemsOf = kpiId => S.items.filter(i => i.kpi_id === kpiId);
function kpiProgress(k) {
  const items = itemsOf(k.id); const done = items.filter(i => i.done).length;
  const progress = items.length ? done / items.length : 0;
  const s = parseYmd(k.start_date), e = addDays(parseYmd(k.end_date), 1), now = new Date();
  const elapsed = Math.min(1, Math.max(0, (now - s) / (e - s)));
  return { done, total: items.length, progress, elapsed, behind: items.length > 0 && progress + 0.1 < elapsed && elapsed < 1 };
}
function kpiState(k) { const t = today(); return t < k.start_date ? 'upcoming' : t > k.end_date ? 'finished' : 'active'; }
const categories = () => [...new Set(S.kpis.map(k => (k.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
function entryTitle(e) {
  if (e.source_type === 'task') return byId('tasks', e.source_id)?.title ?? '(deleted task)';
  if (e.source_type === 'dump') return firstLine(byId('dumps', e.source_id)?.content) || '(deleted note)';
  if (e.source_type === 'item') return byId('items', e.source_id)?.title ?? '(deleted item)';
  return e.title || 'Untitled';
}
const entryClass = e => ({ task: 'c-task', dump: 'c-dump', item: 'c-item' }[e.source_type] || 'c-manual');
const activeLog = () => S.logs.find(l => !l.ended_at);
function logTask(l) {
  if (l.task_id) return byId('tasks', l.task_id);
  const e = l.entry_id && byId('entries', l.entry_id);
  return e && e.source_type === 'task' ? byId('tasks', e.source_id) : null;
}
function logLabel(l) {
  const t = logTask(l); if (t) return t.title;
  if (l.task_id) return '(deleted task)';
  if (l.entry_id) { const e = byId('entries', l.entry_id); return e ? entryTitle(e) : '(deleted entry)'; }
  return l.label || 'Untitled';
}
// Same activity = same task, or same label (case-insensitive) for one-off work.
function logKey(l) {
  const t = logTask(l); if (t) return `t:${t.id}`;
  if (l.task_id) return `t:${l.task_id}`;
  return `l:${logLabel(l).trim().toLowerCase()}`;
}
const logDur = l => new Date(l.ended_at || Date.now()) - new Date(l.started_at);
const lastCol = p => p.columns[p.columns.length - 1];
const taskDone = t => { const p = byId('projects', t.project_id); return p ? t.column === lastCol(p) : !!t.done; };

// Gaps of at least MIN_FREE minutes between timed entries. For today, time already gone is not "free".
function freeSlots(date) {
  let from = DAY_START * 60;
  if (date === today()) { const n = new Date(); from = Math.max(from, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15); }
  if (date < today()) return [];
  const busy = S.entries.filter(e => e.date === date && e.start).map(e => [toMin(e.start), toMin(e.end)]).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = from;
  for (const [s, e] of busy) { if (s - cur >= MIN_FREE) out.push([cur, s]); cur = Math.max(cur, e); }
  if (DAY_END * 60 - cur >= MIN_FREE) out.push([cur, DAY_END * 60]);
  return out;
}

/* ---------- modal form ---------- */
const dlg = $('#dlg');
function openForm({ title, fields, values = {}, submit = 'Save', onSubmit, extra = [], note = '' }) {
  const f = dlg.querySelector('form');
  const field = x => {
    const v = values[x.name] ?? x.value ?? '';
    const req = x.required ? 'required' : '';
    let input;
    if (x.type === 'textarea') input = `<textarea name="${x.name}" ${req}>${esc(v)}</textarea>`;
    else if (x.type === 'select') input = `<select name="${x.name}" ${req}>${x.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    else if (x.type === 'multi') input = `<select name="${x.name}" multiple size="${Math.min(6, Math.max(3, x.options.length))}">${x.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${(v || []).includes(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    else {
      const list = x.suggest ? `list="dl-${x.name}"` : '';
      input = `<input name="${x.name}" type="${x.type || 'text'}" value="${esc(v)}" ${req} ${list} autocomplete="off" ${x.placeholder ? `placeholder="${esc(x.placeholder)}"` : ''}>`
        + (x.suggest ? `<datalist id="dl-${x.name}">${x.suggest.map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : '');
    }
    return `<label>${esc(x.label)}${input}${x.hint ? `<span class="muted small">${esc(x.hint)}</span>` : ''}</label>`;
  };
  const rows = fields.map(x => Array.isArray(x) ? `<div class="grid2">${x.map(field).join('')}</div>` : field(x)).join('');
  f.innerHTML = `<h2>${esc(title)}</h2>${rows}${note}<p class="err" aria-live="polite"></p>
    <div class="actions"><div class="row">${extra.map((b, i) => `<button type="button" class="btn ghost sm ${b.danger ? 'danger' : ''}" data-x="${i}">${b.icon ? ic(b.icon) : ''}${esc(b.label)}</button>`).join('')}</div>
    <div class="row"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">${esc(submit)}</button></div></div>`;
  f.onclick = async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) dlg.close();
    if (b.dataset.fill) { const [s, e] = b.dataset.fill.split('-'); f.elements.start.value = s; f.elements.end.value = e; }
    if (b.dataset.x !== undefined) { await extra[+b.dataset.x].run(); dlg.close(); render(); }
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const data = {};
    fields.flat().forEach(x => {
      const elx = f.elements[x.name];
      data[x.name] = x.type === 'multi' ? [...elx.selectedOptions].map(o => o.value) : elx.value.trim();
    });
    try {
      const msg = await onSubmit(data);
      if (typeof msg === 'string') { f.querySelector('.err').textContent = msg; return; }
      dlg.close(); render();
    } catch (e) { f.querySelector('.err').textContent = e.message; }
  };
  dlg.showModal();
  f.querySelector(values.focus ? `[name="${values.focus}"]` : 'input,textarea,select')?.focus();
}

/* ---------- shared forms ---------- */
const kpiOptions = (blank = 'None') => [['', blank], ...S.kpis.map(k => [k.id, k.title])];
const projOptions = (blank = 'None') => [['', blank], ...S.projects.map(p => [p.id, p.title])];
const itemOptions = (blank = 'None') => [['', blank], ...S.items.map(i => [i.id, `${byId('kpis', i.kpi_id)?.title ?? ''} / ${i.title}`])];
function timeCheck(d) {
  if ((d.start && !d.end) || (!d.start && d.end)) return 'Fill both start and end, or leave both empty for an untimed to-do.';
  if (d.start && toMin(d.end) <= toMin(d.start)) return 'End time has to be after start time.';
}

function entryForm(entry, preset = {}) {
  const isNew = !entry; const e = entry || { date: today(), ...preset };
  const linked = e.source_type && e.source_type !== 'manual';
  const fields = [
    ...(linked ? [] : [{ name: 'title', label: 'Activity', required: true, placeholder: 'e.g. Weekly sync with team' }]),
    { name: 'date', label: 'Date', type: 'date', required: true, hint: 'Leave start and end empty to keep it as a to-do without a time slot.' },
    [{ name: 'start', label: 'Start', type: 'time' }, { name: 'end', label: 'End', type: 'time' }],
    ...(isNew ? [] : [{ name: 'done', label: 'Status', type: 'select', options: [['', 'Open'], ['1', 'Done']] }]),
  ];
  // Offer the free gaps of that day as one-tap fills.
  const gaps = freeSlots(e.date).slice(0, 8);
  const note = gaps.length ? `<div class="stack" style="gap:.3rem"><span class="small muted">Free on ${fmtDate(e.date)}, tap to fill:</span><div class="free-list">${gaps.map(([s, en]) => {
    const end = Math.min(en, s + 60);
    return `<button type="button" class="free-pill" data-fill="${fromMin(s)}-${fromMin(end)}" title="Free until ${fromMin(en)}">${fromMin(s)} to ${fromMin(en)}</button>`;
  }).join('')}</div></div>` : '';
  const extra = [];
  if (!isNew) {
    extra.push({ label: 'Start timer', icon: 'play', run: () => startTimer({ entry_id: e.id }) });
    extra.push({ label: 'Remove', icon: 'trash', danger: true, run: () => db.del('entries', e.id) });
  }
  openForm({
    title: isNew ? (linked ? `Schedule: ${entryTitle(e)}` : 'New activity') : entryTitle(e),
    fields, note, values: { ...e, done: e.done ? '1' : '' }, extra, submit: isNew ? 'Add to calendar' : 'Save',
    async onSubmit(d) {
      const bad = timeCheck(d); if (bad) return bad;
      const row = { date: d.date, start: d.start || null, end: d.end || null, done: d.done === '1' };
      if (!linked) row.title = d.title;
      if (isNew) {
        await db.add('entries', { source_type: e.source_type || 'manual', source_id: e.source_id || null, ...row });
        if (e.source_type === 'dump') await db.put('dumps', e.source_id, { status: 'scheduled' });
        toast(`Added to ${fmtDate(d.date)}${d.start ? ' ' + d.start : ''}`);
      } else await db.put('entries', e.id, row);
    },
  });
}

function taskForm(task, preset = {}) {
  const isNew = !task; const t = task || { priority: 'normal', ...preset };
  const proj = byId('projects', t.project_id);
  const fields = [
    { name: 'title', label: 'Task', required: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    [{ name: 'project_id', label: 'Project', type: 'select', options: projOptions('No project') },
     { name: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] }],
    ...(proj ? [{ name: 'column', label: 'Column', type: 'select', options: proj.columns.map(c => [c, c]) }] : []),
    { name: 'item_id', label: 'Counts toward KPI item', type: 'select', options: itemOptions() },
  ];
  const extra = isNew ? [] : [
    { label: 'Schedule', icon: 'cal', run: () => setTimeout(() => entryForm(null, { source_type: 'task', source_id: t.id })) },
    { label: 'Delete', icon: 'trash', danger: true, run: () => db.del('tasks', t.id) },
  ];
  openForm({
    title: isNew ? 'New task' : 'Edit task', fields, values: t, extra,
    async onSubmit(d) {
      const p = byId('projects', d.project_id);
      const column = p ? (p.columns.includes(d.column) ? d.column : p.columns.includes(t.column) ? t.column : p.columns[0]) : null;
      const row = { ...d, project_id: d.project_id || null, item_id: d.item_id || null, column };
      return isNew ? db.add('tasks', row) : db.put('tasks', t.id, row);
    },
  });
}

/* ---------- timer ---------- */
async function startTimer(ref) {
  const a = activeLog(); if (a) await db.put('logs', a.id, { ended_at: new Date().toISOString() });
  await db.add('logs', { ...ref, started_at: new Date().toISOString(), ended_at: null, method: 'timer' });
  render();
}
async function stopTimer() {
  const a = activeLog(); if (!a) return;
  const x = await db.put('logs', a.id, { ended_at: new Date().toISOString() });
  toast(`Logged ${fmtHMS(logDur(x))}`); render();
}
function paintTimer() {
  const a = activeLog(); const bar = $('#timerbar');
  bar.classList.toggle('on', !!a);
  // Live totals on the Time page: closed time is baked in, the running session is added on each tick.
  document.querySelectorAll('[data-closed]').forEach(el => {
    const run = el.dataset.run && a && a.id === el.dataset.run ? Date.now() - new Date(a.started_at) : 0;
    el.textContent = fmtHMS(+el.dataset.closed + run);
  });
  if (!a) return;
  bar.querySelector('.what').textContent = logLabel(a);
  bar.querySelector('.clock').textContent = fmtClock(Date.now() - new Date(a.started_at));
}
setInterval(paintTimer, 1000);
$('#timerbar').addEventListener('click', e => { if (e.target.closest('[data-stop]')) stopTimer(); });

/* ---------- calendar grid, shared by Today and Calendar ---------- */
function dayGrid(days, { todoRow = true, showFree = false } = {}) {
  const hours = DAY_END - DAY_START; const t = today();
  const H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 52;
  const top = m => (m - DAY_START * 60) / 60 * H;
  const planned = d => S.entries.filter(e => e.date === d && e.start).reduce((s, e) => s + toMin(e.end) - toMin(e.start), 0);
  const tracked = d => S.logs.filter(l => ymd(new Date(l.started_at)) === d).reduce((s, l) => s + logDur(l), 0);

  const heads = days.map(d => `<div class="cal-head ${d === t ? 'is-today' : ''}">${parseYmd(d).toLocaleDateString('en-GB', { weekday: 'short' })}<b>${parseYmd(d).getDate()}</b>
    <span class="hrs" title="Planned / tracked">${(planned(d) / 60).toFixed(1)}h / ${(tracked(d) / 3600000).toFixed(1)}h</span></div>`).join('');
  const todos = todoRow ? `<div class="todo-label">To-do</div>` + days.map(d => `<div class="todo-cell" data-drop="todo" data-date="${d}">${S.entries.filter(e => e.date === d && !e.start).map(e =>
    `<div class="chip ${entryClass(e)} ${e.done ? 'done' : ''}" draggable="true" data-drag="entry" data-id="${e.id}" data-act="open-entry" tabindex="0" role="button"><span>${esc(entryTitle(e))}</span></div>`).join('')}</div>`).join('') : '';

  const cols = days.map(d => {
    // Overlapping blocks share the column side by side instead of stacking on top of each other.
    const dayEvs = S.entries.filter(e => e.date === d && e.start).sort((a, b) => a.start.localeCompare(b.start));
    const laneOf = new Map(), widthOf = new Map();
    let lanes = [], group = [], groupEnd = -1;
    const closeGroup = () => { group.forEach(id => widthOf.set(id, lanes.length)); lanes = []; group = []; };
    dayEvs.forEach(e => {
      if (toMin(e.start) >= groupEnd) { closeGroup(); groupEnd = -1; }
      let i = lanes.findIndex(end => end <= toMin(e.start)); if (i < 0) i = lanes.push(0) - 1;
      lanes[i] = toMin(e.end); laneOf.set(e.id, i); group.push(e.id); groupEnd = Math.max(groupEnd, toMin(e.end));
    });
    closeGroup();
    const evs = dayEvs.map(e => {
      const s = Math.max(toMin(e.start), DAY_START * 60), en = Math.min(toMin(e.end), DAY_END * 60);
      if (en <= s) return '';
      const n = widthOf.get(e.id), i = laneOf.get(e.id);
      return `<div class="ev ${entryClass(e)} ${e.done ? 'done' : ''}" style="top:${top(s)}px;height:${Math.max(18, top(en) - top(s) - 2)}px;left:calc(${i / n * 100}% + 3px);right:auto;width:calc(${100 / n}% - 6px)" draggable="true" data-drag="entry" data-id="${e.id}" data-act="open-entry" tabindex="0" role="button">
        <b>${esc(entryTitle(e))}</b><span class="mono">${e.start}-${e.end}</span></div>`;
    }).join('');
    const free = showFree ? freeSlots(d).map(([s, en]) => `<div class="free" style="top:${top(s) + 1}px;height:${top(en) - top(s) - 3}px" data-act="free-slot" data-date="${d}" data-s="${s}" data-e="${en}" tabindex="0" role="button">Free ${fromMin(s)} to ${fromMin(en)}</div>`).join('') : '';
    const acts = ui.showActual ? S.logs.filter(l => ymd(new Date(l.started_at)) === d).map(l => {
      const a = new Date(l.started_at), b = new Date(l.ended_at || Date.now());
      const s = Math.max(a.getHours() * 60 + a.getMinutes(), DAY_START * 60), en = Math.min(b.getHours() * 60 + b.getMinutes() + (ymd(b) > d ? 1440 : 0), DAY_END * 60);
      return en > s ? `<div class="ev actual" style="top:${top(s)}px;height:${Math.max(4, top(en) - top(s))}px" title="Tracked: ${esc(logLabel(l))}"></div>` : '';
    }).join('') : '';
    const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
    const line = d === t && nm >= DAY_START * 60 && nm <= DAY_END * 60 ? `<div class="now-line" style="top:${top(nm)}px"></div>` : '';
    return `<div class="day-col" data-drop="slot" data-date="${d}" style="height:${hours * H}px">${free}${evs}${acts}${line}</div>`;
  }).join('');
  const hourLabels = Array.from({ length: hours }, (_, i) => `<div>${pad(DAY_START + i)}:00</div>`).join('');
  return `<div class="cal" style="--days:${days.length};min-width:${days.length > 1 ? 720 : 0}px"><div></div>${heads}${todos}<div class="hours">${hourLabels}</div>${cols}</div>`;
}

/* ---------- views ---------- */
const views = {};

views.today = () => {
  const t = today();
  const ents = S.entries.filter(e => e.date === t);
  const untimed = ents.filter(e => !e.start);
  const timed = ents.filter(e => e.start);
  const gaps = freeSlots(t);
  const freeMin = gaps.reduce((s, [a, b]) => s + b - a, 0);
  const plannedMin = timed.reduce((s, e) => s + toMin(e.end) - toMin(e.start), 0);
  const fresh = S.dumps.filter(d => d.status === 'new').length;
  const active = S.kpis.filter(k => kpiState(k) === 'active');
  const todo = e => `<li draggable="true" data-drag="entry" data-id="${e.id}">
      <input type="checkbox" class="check" data-act="toggle-entry" data-id="${e.id}" ${e.done ? 'checked' : ''} aria-label="Mark done">
      <span class="grow ${e.done ? 'done-text' : ''}">${esc(entryTitle(e))}</span>
      <button class="btn ghost sm" data-act="set-time" data-id="${e.id}" type="button">${ic('clock')}Set time</button>
      <button class="btn ghost icon" data-act="timer-entry" data-id="${e.id}" type="button">${ic('play', 'Start timer')}</button></li>`;
  return `
  <div class="page-head"><div><h1>${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
    <p class="muted">${(plannedMin / 60).toFixed(1)}h planned, ${(freeMin / 60).toFixed(1)}h still open${fresh ? `, ${fresh} notes waiting in the mind dump` : ''}.</p></div></div>
  <div class="today-grid">
    <div class="stack today-left">
      <section class="card stack today-todo">
        <h2>To-do today</h2>
        <form class="capture" data-form="todo-add"><input name="t" aria-label="Add to today" placeholder="Add to today, e.g. Laundry" autocomplete="off"><button class="btn">${ic('plus')}Add</button></form>
        <div class="todo-drop" data-drop="todo" data-date="${t}">
          ${untimed.length ? `<ul class="plain todo-list">${untimed.map(todo).join('')}</ul>` : '<p class="muted small" style="padding:.4rem">Nothing waiting for a slot. Drag a block here from the timeline to unschedule it.</p>'}
        </div>
        <p class="muted small">Drag a to-do onto the timeline, or press Set time and pick one of the free gaps.</p>
      </section>
      <section class="card stack">
        <h2>Catch a thought</h2>
        <form class="capture" data-form="capture"><input name="c" aria-label="New mind dump note" autocomplete="off" placeholder="Goes to the mind dump. #tags work."><button class="btn">Save</button></form>
      </section>
      <section class="card stack">
        <div class="row" style="justify-content:space-between"><h2>Active KPIs</h2><a href="#/kpi" class="small">All KPIs</a></div>
        ${active.length ? active.map(k => { const p = kpiProgress(k); return `<div class="stack" style="gap:.35rem">
          <div class="row" style="justify-content:space-between"><b>${esc(k.title)}</b><span class="status ${p.behind ? 'behind' : 'ok'}">${p.behind ? 'Behind' : 'On track'}</span></div>
          <div class="meter" aria-label="${Math.round(p.progress * 100)} percent done"><span style="width:${p.progress * 100}%"></span><i style="left:${p.elapsed * 100}%"></i></div>
          <span class="muted small">${p.done} of ${p.total} items, ${Math.round(p.elapsed * 100)}% of the period gone</span></div>`; }).join('')
        : '<p class="muted small">No KPI running right now.</p>'}
      </section>
    </div>
    <section class="card stack today-timeline">
      <div class="today-cal-head"><h2>Timeline</h2>
        <div class="row"><label class="row small" style="display:flex;font-weight:500"><input type="checkbox" class="check" data-act="toggle-actual" ${ui.showActual ? 'checked' : ''}>Show tracked</label>
        <a class="btn ghost sm" href="#/calendar">Week view</a></div></div>
      <p class="muted small">Green dashed blocks are free. Click one to fill it.</p>
      ${dayGrid([t], { todoRow: false, showFree: true })}
    </section>
  </div>`;
};

views.kpi = () => {
  const cats = categories();
  if (ui.kpiCat !== 'all' && ui.kpiCat !== '' && !cats.includes(ui.kpiCat)) ui.kpiCat = 'all';
  const list = S.kpis
    .filter(k => ui.kpiFilter === 'all' || kpiState(k) === ui.kpiFilter)
    .filter(k => ui.kpiCat === 'all' || (k.category || '') === ui.kpiCat)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const f = (v, l) => `<button type="button" class="btn ghost sm" data-act="kpi-filter" data-v="${v}" aria-pressed="${ui.kpiFilter === v}">${l}</button>`;
  const allOpen = list.length && list.every(k => ui.kpiOpen.has(k.id));

  const card = k => {
    const p = kpiProgress(k); const open = ui.kpiOpen.has(k.id);
    const items = itemsOf(k.id);
    const head = `<button type="button" class="kpi-sum" data-act="kpi-toggle" data-id="${k.id}" aria-expanded="${open}">
      ${chev}
      <span class="ttl"><b>${esc(k.title)}</b><span class="mono muted">${fmtDate(k.start_date)} to ${fmtDate(k.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
      <span class="bar-cell"><span class="meter" style="display:block"><span style="width:${p.progress * 100}%"></span><i style="left:${p.elapsed * 100}%"></i></span></span>
      <span class="right">${k.category ? `<span class="tag cat-t">${esc(k.category)}</span>` : ''}<span class="mono">${p.done}/${p.total}</span>
        <span class="status ${p.behind ? 'behind' : 'ok'}">${p.total ? (p.behind ? 'Behind' : 'On track') : 'No items'}</span></span>
    </button>`;
    if (!open) return `<article class="card kpi" data-open="false">${head}</article>`;
    return `<article class="card kpi" data-open="true">${head}
      <div class="kpi-body">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="stack" style="gap:.2rem">${k.target ? `<span class="small">Target: ${esc(k.target)}</span>` : ''}${k.description ? `<p class="muted small">${esc(k.description)}</p>` : ''}
          <span class="small muted">${Math.round(p.elapsed * 100)}% of the period used</span></div>
          <button class="btn ghost sm" data-act="edit-kpi" data-id="${k.id}" type="button">${ic('edit')}Edit</button></div>
        <ul class="trail">${items.map(i => {
          const tasks = S.tasks.filter(t => t.item_id === i.id);
          const projs = [...new Set(tasks.map(t => t.project_id).filter(Boolean))].map(id => byId('projects', id)).filter(Boolean);
          return `<li class="${i.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="toggle-item" data-id="${i.id}" ${i.done ? 'checked' : ''} aria-label="Mark ${esc(i.title)} done">
            <span class="grow ${i.done ? 'done-text' : ''}">${esc(i.title)} ${tasks.length ? `<span class="muted small">(${tasks.filter(taskDone).length}/${tasks.length} tasks)</span>` : ''}
            ${projs.map(pp => `<a class="tag proj-t" href="#/projects/${pp.id}">${esc(pp.title)}</a>`).join(' ')}</span>
            <button class="btn ghost icon" data-act="sched-item" data-id="${i.id}" type="button">${ic('cal', 'Schedule')}</button>
            <button class="btn ghost icon" data-act="del-item" data-id="${i.id}" type="button">${ic('trash', 'Delete item')}</button></li>`;
        }).join('')}</ul>
        <form class="capture" data-form="add-item" data-id="${k.id}"><input name="t" aria-label="New actionable item" placeholder="Add an actionable item" autocomplete="off"><button class="btn ghost">${ic('plus')}Add</button></form>
      </div></article>`;
  };

  // Group by category only when showing everything; a single-category filter doesn't need headings.
  let body;
  if (!list.length) body = `<div class="card empty">${ic('flag')}<p>No KPI in this filter. Start with one target and the steps that get you there.</p><button class="btn" data-act="new-kpi" type="button">New KPI</button></div>`;
  else if (ui.kpiCat === 'all' && cats.length) {
    const groups = [...cats, ''].map(c => [c, list.filter(k => (k.category || '') === c)]).filter(([, l]) => l.length);
    body = groups.map(([c, l]) => `<h3 class="kpi-group-title">${esc(c || 'Uncategorized')} <span class="mono">${l.length}</span></h3>${l.map(card).join('')}`).join('');
  } else body = list.map(card).join('');

  return `<div class="page-head"><div><h1>KPI</h1><p class="muted">Click a KPI to open its steps. The dark tick on each bar is where time is now.</p></div>
    <button class="btn" data-act="new-kpi" type="button">${ic('plus')}New KPI</button></div>
    <div class="kpi-tools">
      <div class="filters">${f('active', 'Running')}${f('upcoming', 'Upcoming')}${f('finished', 'Finished')}${f('all', 'All')}</div>
      <label>Category<select data-change="kpi-cat"><option value="all">All categories</option>${cats.map(c => `<option value="${esc(c)}" ${ui.kpiCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="" ${ui.kpiCat === '' ? 'selected' : ''}>Uncategorized</option></select></label>
      ${list.length ? `<button class="btn ghost sm" data-act="kpi-all" type="button" style="margin-left:auto">${allOpen ? 'Collapse all' : 'Expand all'}</button>` : ''}
    </div>
    <div class="stack" style="gap:.6rem">${body}</div>`;
};

views.projects = id => {
  if (id && byId('projects', id)) ui.project = id;
  if (!byId('projects', ui.project)) ui.project = S.projects[0]?.id;
  const p = byId('projects', ui.project);
  const tabs = S.projects.map(x => `<a class="btn ghost sm" href="#/projects/${x.id}" style="${x.id === ui.project ? 'background:var(--card);border-color:var(--night)' : ''}">${esc(x.title)}</a>`).join('');
  const head = `<div class="page-head"><div><h1>Projects</h1><p class="muted">Each project keeps its own board. Drag cards between columns.</p></div>
    <button class="btn" data-act="new-project" type="button">${ic('plus')}New project</button></div>`;
  if (!p) return head + `<div class="card empty">${ic('kanban')}<p>No project yet. A project groups tasks and can point to KPI items.</p><button class="btn" data-act="new-project" type="button">New project</button></div>`;
  const tasks = S.tasks.filter(t => t.project_id === p.id);
  const colOf = t => p.columns.includes(t.column) ? t.column : p.columns[0];
  const linked = (p.item_ids || []).map(i => byId('items', i)).filter(Boolean);
  const card = t => {
    const it = byId('items', t.item_id);
    const next = S.entries.filter(e => e.source_id === t.id && e.date >= today()).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))[0];
    return `<div class="task ${t.priority === 'high' ? 'prio-high' : t.priority === 'low' ? 'prio-low' : ''}" draggable="true" data-drag="task" data-id="${t.id}">
      <span class="title">${esc(t.title)}</span>
      <div class="meta">${it ? `<span class="tag kpi-t">${esc(it.title)}</span>` : ''}${next ? `<span class="mono">${fmtDate(next.date)}${next.start ? ' ' + next.start : ''}</span>` : ''}</div>
      <div class="row" style="gap:.25rem">
        <button class="btn ghost sm" data-act="timer-task" data-id="${t.id}" type="button">${ic('play')}Start</button>
        <button class="btn ghost sm" data-act="sched-task" data-id="${t.id}" type="button">${ic('cal')}Schedule</button>
        <button class="btn ghost icon" data-act="edit-task" data-id="${t.id}" type="button" style="margin-left:auto">${ic('edit', 'Edit task')}</button></div></div>`;
  };
  return head + `<nav class="proj-tabs" aria-label="Projects">${tabs}</nav>
    <section class="card stack" style="margin-bottom:1rem">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div class="stack" style="gap:.25rem"><h2>${esc(p.title)}</h2>${p.description ? `<p class="muted small">${esc(p.description)}</p>` : ''}
      <div class="row">${linked.length ? linked.map(i => `<span class="tag kpi-t">${esc(byId('kpis', i.kpi_id)?.title ?? '')} / ${esc(i.title)}</span>`).join('') : '<span class="muted small">Not linked to any KPI item</span>'}</div></div>
      <button class="btn ghost icon" data-act="edit-project" data-id="${p.id}" type="button">${ic('edit', 'Edit project')}</button></div>
    </section>
    <div class="board">${p.columns.map(c => {
      const list = tasks.filter(t => colOf(t) === c);
      return `<section class="col" data-drop="col" data-col="${esc(c)}"><div class="col-head"><span>${esc(c)} <span class="muted mono">${list.length}</span></span>
        <button class="btn ghost icon" data-act="new-task" data-col="${esc(c)}" type="button">${ic('plus', 'Add task to ' + c)}</button></div>${list.map(card).join('')}</section>`;
    }).join('')}</div>`;
};

views.dump = () => {
  const f = ui.dumpFilter;
  const list = S.dumps.filter(d => f === 'all' || d.status === f).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const counts = s => S.dumps.filter(d => d.status === s).length;
  const fb = (v, l) => `<button type="button" class="btn ghost sm" data-act="dump-filter" data-v="${v}" aria-pressed="${f === v}">${l}${v !== 'all' ? ` <span class="mono">${counts(v)}</span>` : ''}</button>`;
  const item = d => {
    const k = byId('kpis', d.kpi_id), p = byId('projects', d.project_id);
    return `<article class="card dump"><div class="stack" style="gap:.4rem"><p class="body">${esc(d.content)}</p>
      <div class="row small">${k ? `<span class="tag kpi-t">${esc(k.title)}</span>` : ''}${p ? `<span class="tag proj-t">${esc(p.title)}</span>` : ''}${(d.tags || []).map(t => `<span class="tag free-t">#${esc(t)}</span>`).join('')}
      <span class="muted mono">${new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${d.status !== 'new' ? `, ${d.status}` : ''}</span></div></div>
      <div class="row" style="gap:.2rem;justify-content:flex-end">
        <button class="btn ghost sm" data-act="tag-dump" data-id="${d.id}" type="button">${ic('edit')}Tag</button>
        <button class="btn ghost sm" data-act="sched-dump" data-id="${d.id}" type="button">${ic('cal')}Calendar</button>
        <button class="btn ghost sm" data-act="convert-dump" data-id="${d.id}" type="button">${ic('arrow')}Convert</button>
        ${d.status !== 'archived' ? `<button class="btn ghost icon" data-act="archive-dump" data-id="${d.id}" type="button">${ic('archive', 'Archive')}</button>` : `<button class="btn ghost icon danger" data-act="del-dump" data-id="${d.id}" type="button">${ic('trash', 'Delete')}</button>`}
      </div></article>`;
  };
  return `<div class="page-head"><div><h1>Mind dump</h1><p class="muted">Write it down first, sort it later. Tag a note to a KPI or project, put it on the calendar, or turn it into a task.</p></div></div>
    <form class="card capture" data-form="capture" style="margin-bottom:1rem"><textarea name="c" aria-label="New note" placeholder="Anything on your mind. #tags work here. Ctrl+Enter to save." style="min-height:56px"></textarea><button class="btn" style="align-self:end">Save</button></form>
    <div class="filters" style="margin-bottom:1rem">${fb('new', 'Unsorted')}${fb('scheduled', 'Scheduled')}${fb('converted', 'Converted')}${fb('archived', 'Archived')}${fb('all', 'All')}</div>
    <div class="dump-list">${list.length ? list.map(item).join('') : `<div class="card empty">${ic('cloud')}<p>${f === 'new' ? 'Inbox zero. Nothing left to sort.' : 'Nothing here.'}</p></div>`}</div>`;
};

views.calendar = () => {
  const base = new Date(ui.calDate);
  const start = ui.calView === 'week' ? addDays(base, -((base.getDay() + 6) % 7)) : base;
  const days = Array.from({ length: ui.calView === 'week' ? 7 : 1 }, (_, i) => ymd(addDays(start, i)));
  const label = ui.calView === 'week' ? `${fmtDate(days[0])} to ${fmtDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}` : fmtDate(days[0], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tab = (v, l) => `<button type="button" class="btn ghost sm" data-act="side-tab" data-v="${v}" aria-pressed="${ui.sideTab === v}">${l}</button>`;
  let picks = [];
  if (ui.sideTab === 'tasks') picks = S.tasks.filter(t => !taskDone(t)).map(x => ['task', x.id, x.title, byId('projects', x.project_id)?.title]);
  if (ui.sideTab === 'dumps') picks = S.dumps.filter(d => d.status === 'new').map(x => ['dump', x.id, firstLine(x.content)]);
  if (ui.sideTab === 'items') picks = S.items.filter(i => !i.done).map(x => ['item', x.id, x.title, byId('kpis', x.kpi_id)?.title]);
  return `<div class="page-head"><div><h1>Calendar</h1><p class="muted">${label}</p></div>
    <div class="row">
      <div class="seg"><button class="btn ghost sm" data-act="cal-view" data-v="day" aria-pressed="${ui.calView === 'day'}" type="button">Day</button><button class="btn ghost sm" data-act="cal-view" data-v="week" aria-pressed="${ui.calView === 'week'}" type="button">Week</button></div>
      <button class="btn ghost icon" data-act="cal-move" data-v="-1" type="button">${ic('left', 'Previous')}</button>
      <button class="btn ghost sm" data-act="cal-today" type="button">Today</button>
      <button class="btn ghost icon" data-act="cal-move" data-v="1" type="button">${ic('right', 'Next')}</button>
      <label class="row small" style="display:flex;font-weight:500"><input type="checkbox" class="check" data-act="toggle-actual" ${ui.showActual ? 'checked' : ''}>Show tracked</label>
      <button class="btn" data-act="new-entry" type="button">${ic('plus')}Activity</button></div></div>
  <div class="cal-wrap">
    <div style="overflow-x:auto">${dayGrid(days, { todoRow: true, showFree: ui.calView === 'day' })}</div>
    <aside class="side-pick stack"><div class="card stack">
      <h3>Drag onto the calendar</h3><div class="row" style="gap:.3rem">${tab('tasks', 'Tasks')}${tab('dumps', 'Notes')}${tab('items', 'KPI items')}</div>
      <div class="stack" style="gap:.4rem;max-height:60dvh;overflow:auto">${picks.length ? picks.map(([k, id, title, sub]) => `<div class="pick" draggable="true" data-drag="${k}" data-id="${id}">${esc(title)}${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div>`).join('') : '<p class="muted small">Nothing to place.</p>'}</div>
      <p class="muted small">Drop on the To-do row for an untimed item, or on the grid for a time block. Click an empty slot to add a one-off activity.</p></div></aside>
  </div>`;
};

views.time = () => {
  const now = new Date();
  const from = ui.timeRange === 'week' ? (() => { const d = addDays(now, -((now.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; })()
    : ui.timeRange === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(0);
  const logs = S.logs.filter(l => new Date(l.started_at) >= from);
  const run = activeLog();
  const total = logs.reduce((s, l) => s + logDur(l), 0);

  // One row per activity, with every session tucked underneath.
  const groups = new Map();
  logs.forEach(l => {
    const k = logKey(l);
    if (!groups.has(k)) groups.set(k, { key: k, label: logLabel(l), task: logTask(l), logs: [] });
    groups.get(k).logs.push(l);
  });
  const rows = [...groups.values()].map(g => {
    g.logs.sort((a, b) => b.started_at.localeCompare(a.started_at));
    g.closed = g.logs.filter(l => l.ended_at).reduce((s, l) => s + logDur(l), 0);
    g.running = g.logs.find(l => !l.ended_at);
    g.total = g.closed + (g.running ? logDur(g.running) : 0);
    g.project = byId('projects', g.task?.project_id);
    g.kpi = byId('kpis', byId('items', g.task?.item_id)?.kpi_id);
    return g;
  }).sort((a, b) => b.total - a.total);

  const grouped = (keyFn) => { const m = new Map(); rows.forEach(g => { const k = keyFn(g); m.set(k, (m.get(k) || 0) + g.total); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const bars = g => { const max = Math.max(1, ...g.map(x => x[1])); return g.length ? `<div class="bars">${g.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="meter"><span style="width:${v / max * 100}%"></span></div><span class="mono">${fmtDur(v)}</span></div>`).join('')}</div>` : '<p class="muted small">Nothing logged in this range.</p>'; };
  const rangeBtn = (v, l) => `<button class="btn ghost sm" data-act="time-range" data-v="${v}" aria-pressed="${ui.timeRange === v}" type="button">${l}</button>`;
  const rangeName = { week: 'this week', month: 'this month', all: 'all time' }[ui.timeRange];

  const group = g => `<details class="card act-group" data-key="${esc(g.key)}" ${ui.openGroups.has(g.key) ? 'open' : ''}>
    <summary>${chev}
      <span class="name">${g.running ? '<span class="running">Running</span> ' : ''}${esc(g.label)}</span>
      <span class="proj">${g.project ? `<span class="tag proj-t">${esc(g.project.title)}</span>` : '<span class="muted small">No project</span>'}${g.kpi ? ` <span class="tag kpi-t">${esc(g.kpi.title)}</span>` : ''}</span>
      <span class="cnt mono muted">${g.logs.length}x</span>
      <span class="total" data-closed="${g.closed}" ${g.running ? `data-run="${g.running.id}"` : ''}>${fmtHMS(g.total)}</span>
      <button class="btn ghost icon play" data-act="timer-again" data-key="${esc(g.key)}" type="button">${ic('play', 'Start again')}</button>
    </summary>
    <ul class="plain sessions">${g.logs.map(l => `<li><span class="mono">${new Date(l.started_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      <span class="mono">${hm(l.started_at)} to ${l.ended_at ? hm(l.ended_at) : 'now'}</span>
      <span class="mono">${l.ended_at ? fmtHMS(logDur(l)) : '<span class="running">running</span>'}</span>
      <span class="small muted how">${l.method}</span>
      <button class="btn ghost icon" data-act="edit-log" data-id="${l.id}" type="button">${ic('edit', 'Edit log')}</button></li>`).join('')}</ul>
  </details>`;

  return `<div class="page-head"><div><h1>Time</h1><p class="muted">Optional. Run a timer, or fill in start and end afterwards.</p></div>
    <button class="btn ghost" data-act="manual-log" type="button">${ic('plus')}Log time manually</button></div>
  <form class="card capture" data-form="quick-timer" style="margin-bottom:1rem"><label style="flex:1">What are you working on?
    <select name="task"><option value="">Something else (type below)</option>${S.tasks.filter(t => !taskDone(t)).map(t => `<option value="${t.id}">${esc(t.title)}${byId('projects', t.project_id) ? ` (${esc(byId('projects', t.project_id).title)})` : ''}</option>`).join('')}</select>
    <input name="label" placeholder="Label for a one-off activity" autocomplete="off"></label>
    <button class="btn" style="align-self:end">${ic('play')}Start</button></form>
  <div class="row" style="justify-content:space-between;margin-bottom:.75rem"><div class="seg">${rangeBtn('week', 'This week')}${rangeBtn('month', 'This month')}${rangeBtn('all', 'All')}</div>
    <span class="small">Total ${rangeName}: <b class="mono" data-closed="${total - (run && new Date(run.started_at) >= from ? logDur(run) : 0)}" ${run && new Date(run.started_at) >= from ? `data-run="${run.id}"` : ''}>${fmtHMS(total)}</b></span></div>
  <section class="stack" style="gap:.5rem;margin-bottom:1.25rem">
    <h2>By activity</h2>
    ${rows.length ? `<div class="act-head"><span></span><span>Activity</span><span>Project</span><span>Sessions</span><span>Total</span><span></span></div>${rows.map(group).join('')}`
      : `<div class="card empty">${ic('clock')}<p>No time logged ${rangeName}.</p></div>`}
  </section>
  <div class="split2">
    <section class="card stack"><h2>By project</h2>${bars(grouped(g => g.project?.title || 'No project'))}</section>
    <section class="card stack"><h2>By KPI</h2>${bars(grouped(g => g.kpi?.title || 'Not linked to a KPI'))}</section>
  </div>`;
};

/* ---------- routing + render ---------- */
function route() { const [, name = 'today', arg] = location.hash.split('/'); return { name: views[name] ? name : 'today', arg }; }
function render() {
  const { name, arg } = route();
  $('#view').innerHTML = views[name](arg);
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === name ? 'page' : 'false'));
  const n = S.dumps.filter(d => d.status === 'new').length;
  document.querySelectorAll('[data-count="dump"]').forEach(x => { x.textContent = n || ''; });
  paintTimer();
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

/* ---------- click actions ---------- */
const actions = {
  'new-entry': () => entryForm(null, { date: route().name === 'calendar' ? ymd(ui.calDate) : today() }),
  'open-entry': id => entryForm(byId('entries', id)),
  'set-time': id => { const e = byId('entries', id); entryForm(e); setTimeout(() => dlg.querySelector('[name="start"]')?.focus()); },
  'free-slot': (_, el) => { const s = +el.dataset.s; entryForm(null, { date: el.dataset.date, start: fromMin(s), end: fromMin(Math.min(s + 60, +el.dataset.e)) }); },
  'toggle-entry': async id => { const e = byId('entries', id); await db.put('entries', id, { done: !e.done }); },
  'timer-entry': id => startTimer({ entry_id: id }),
  'timer-task': id => startTimer({ task_id: id }),
  'timer-again': (_, el) => { const k = el.dataset.key; return startTimer(k.startsWith('t:') ? { task_id: k.slice(2) } : { label: S.logs.find(l => logKey(l) === k) ? logLabel(S.logs.find(l => logKey(l) === k)) : k.slice(2) }); },
  'sched-task': id => entryForm(null, { source_type: 'task', source_id: id }),
  'sched-item': id => entryForm(null, { source_type: 'item', source_id: id }),
  'edit-task': id => taskForm(byId('tasks', id)),
  'new-task': (_, el) => taskForm(null, { project_id: ui.project, column: el.dataset.col }),
  'kpi-filter': (_, el) => { ui.kpiFilter = el.dataset.v; },
  'kpi-toggle': id => { ui.kpiOpen.has(id) ? ui.kpiOpen.delete(id) : ui.kpiOpen.add(id); },
  'kpi-all': () => {
    const ids = [...document.querySelectorAll('.kpi-sum')].map(b => b.dataset.id);
    const allOpen = ids.every(id => ui.kpiOpen.has(id));
    ids.forEach(id => allOpen ? ui.kpiOpen.delete(id) : ui.kpiOpen.add(id));
  },
  'toggle-item': async id => { const i = byId('items', id); await db.put('items', id, { done: !i.done }); },
  'del-item': async id => { if (confirm('Delete this item? Linked tasks stay but lose the link.')) await db.del('items', id); },
  'new-kpi': () => kpiForm(), 'edit-kpi': id => kpiForm(byId('kpis', id)),
  'new-project': () => projectForm(), 'edit-project': id => projectForm(byId('projects', id)),
  'dump-filter': (_, el) => { ui.dumpFilter = el.dataset.v; },
  'tag-dump': id => dumpTagForm(byId('dumps', id)),
  'sched-dump': id => entryForm(null, { source_type: 'dump', source_id: id }),
  'convert-dump': id => convertForm(byId('dumps', id)),
  'archive-dump': id => db.put('dumps', id, { status: 'archived' }),
  'del-dump': async id => { if (confirm('Delete this note for good?')) await db.del('dumps', id); },
  'cal-view': (_, el) => { ui.calView = el.dataset.v; },
  'cal-move': (_, el) => { ui.calDate = addDays(ui.calDate, (ui.calView === 'week' ? 7 : 1) * +el.dataset.v); },
  'cal-today': () => { ui.calDate = new Date(); },
  'toggle-actual': () => { ui.showActual = !ui.showActual; },
  'side-tab': (_, el) => { ui.sideTab = el.dataset.v; },
  'time-range': (_, el) => { ui.timeRange = el.dataset.v; },
  'manual-log': () => logForm(), 'edit-log': id => logForm(byId('logs', id)),
};
const OPENS_DIALOG = new Set(['new-entry', 'open-entry', 'set-time', 'free-slot', 'sched-task', 'sched-item', 'edit-task', 'new-task', 'new-kpi', 'edit-kpi', 'new-project', 'edit-project', 'tag-dump', 'sched-dump', 'convert-dump', 'manual-log', 'edit-log']);

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) {
    e.stopPropagation();
    if (el.closest('summary')) e.preventDefault(); // buttons inside a summary should not fold the row
    try { await actions[el.dataset.act](el.dataset.id, el); if (!OPENS_DIALOG.has(el.dataset.act)) render(); }
    catch (err) { toast(err.message); }
    return;
  }
  const slot = e.target.closest('[data-drop="slot"]');
  if (slot && e.target === slot) {
    const H = slot.offsetHeight / (DAY_END - DAY_START);
    const m = DAY_START * 60 + Math.floor(e.offsetY / H * 2) * 30;
    entryForm(null, { date: slot.dataset.date, start: fromMin(m), end: fromMin(Math.min(m + 60, DAY_END * 60)) });
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset.change === 'kpi-cat') { ui.kpiCat = e.target.value; render(); }
});
document.addEventListener('toggle', e => {
  const d = e.target; if (!d.matches?.('details[data-key]')) return;
  d.open ? ui.openGroups.add(d.dataset.key) : ui.openGroups.delete(d.dataset.key);
}, true);
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('[data-form="capture"] textarea')) e.target.form.requestSubmit();
});

/* ---------- inline forms ---------- */
document.addEventListener('submit', async e => {
  const f = e.target; if (!f.dataset.form) return;
  e.preventDefault();
  try {
    if (f.dataset.form === 'capture') {
      const text = f.elements.c.value.trim(); if (!text) return;
      const tags = [...new Set([...text.matchAll(/#([\w-]+)/g)].map(m => m[1].toLowerCase()))];
      await db.add('dumps', { content: text, tags, status: 'new', kpi_id: null, project_id: null });
      f.reset(); toast('Saved to mind dump'); render();
    }
    if (f.dataset.form === 'todo-add') {
      const t = f.elements.t.value.trim(); if (!t) return;
      await db.add('entries', { source_type: 'manual', source_id: null, title: t, date: today(), start: null, end: null, done: false });
      render(); $('[data-form="todo-add"] input')?.focus();
    }
    if (f.dataset.form === 'add-item') {
      const t = f.elements.t.value.trim(); if (!t) return;
      await db.add('items', { kpi_id: f.dataset.id, title: t, done: false }); render();
      $(`[data-form="add-item"][data-id="${f.dataset.id}"] input`)?.focus();
    }
    if (f.dataset.form === 'quick-timer') {
      const task = f.elements.task.value, label = f.elements.label.value.trim();
      if (!task && !label) return toast('Pick a task or type a label first');
      await startTimer(task ? { task_id: task } : { label });
    }
  } catch (err) { toast(err.message); }
});

/* ---------- entity forms ---------- */
function kpiForm(k) {
  const t = new Date(); const qEnd = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3 + 3, 0);
  openForm({
    title: k ? 'Edit KPI' : 'New KPI', values: k || { start_date: today(), end_date: ymd(qEnd), category: ui.kpiCat !== 'all' ? ui.kpiCat : '' },
    fields: [{ name: 'title', label: 'KPI', required: true, placeholder: 'e.g. Finish WAFR review for REL and SEC' },
      { name: 'category', label: 'Category', suggest: categories(), placeholder: 'e.g. Work, Side project, Personal', hint: 'Pick an existing one or type a new name.' },
      { name: 'target', label: 'Target (optional)', placeholder: 'e.g. 2 pillars reviewed with MST' },
      [{ name: 'start_date', label: 'From', type: 'date', required: true }, { name: 'end_date', label: 'Until', type: 'date', required: true }],
      { name: 'description', label: 'Notes', type: 'textarea' }],
    extra: k ? [{ label: 'Delete KPI', icon: 'trash', danger: true, run: async () => { if (confirm('Delete this KPI and its items?')) await db.del('kpis', k.id); } }] : [],
    async onSubmit(d) {
      if (d.end_date < d.start_date) return 'The end date is before the start date.';
      // Reuse the existing spelling when only the case differs, so "work" and "Work" stay one group.
      const match = categories().find(c => c.toLowerCase() === d.category.toLowerCase());
      const row = { ...d, category: match || d.category };
      if (k) return db.put('kpis', k.id, row);
      const x = await db.add('kpis', row); ui.kpiOpen.add(x.id);
    },
  });
}
function projectForm(p) {
  openForm({
    title: p ? 'Edit project' : 'New project',
    values: p ? { ...p, columns: p.columns.join(', ') } : { columns: 'Backlog, To do, In progress, Done' },
    fields: [{ name: 'title', label: 'Project', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'columns', label: 'Board columns', hint: 'Comma separated. The last column counts as done.', required: true },
      { name: 'item_ids', label: 'Linked KPI items', type: 'multi', options: itemOptions().slice(1), hint: 'Ctrl or Cmd click to pick more than one.' }],
    extra: p ? [{ label: 'Delete project', icon: 'trash', danger: true, run: async () => { if (confirm('Delete this project? Its tasks move to No project.')) await db.del('projects', p.id); } }] : [],
    async onSubmit(d) {
      const columns = [...new Set(d.columns.split(',').map(s => s.trim()).filter(Boolean))];
      if (columns.length < 2) return 'Use at least two columns.';
      const row = { ...d, columns };
      if (p) return db.put('projects', p.id, row);
      const x = await db.add('projects', row); location.hash = `#/projects/${x.id}`;
    },
  });
}
function dumpTagForm(d) {
  openForm({
    title: 'Tag note', values: { ...d, tags: (d.tags || []).join(' ') },
    fields: [{ name: 'content', label: 'Note', type: 'textarea', required: true },
      [{ name: 'kpi_id', label: 'Related KPI', type: 'select', options: kpiOptions() }, { name: 'project_id', label: 'Related project', type: 'select', options: projOptions() }],
      { name: 'tags', label: 'Tags', hint: 'Space separated, no # needed' }],
    onSubmit: v => db.put('dumps', d.id, { content: v.content, kpi_id: v.kpi_id || null, project_id: v.project_id || null, tags: v.tags.split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean) }),
  });
}
function convertForm(d) {
  openForm({
    title: 'Convert note', submit: 'Convert', values: { kind: 'task', project_id: d.project_id || '', kpi_id: d.kpi_id || '', title: firstLine(d.content) },
    fields: [{ name: 'kind', label: 'Turn into', type: 'select', options: [['task', 'Project task'], ['item', 'KPI actionable item']] },
      { name: 'title', label: 'Title', required: true },
      [{ name: 'project_id', label: 'Project (for task)', type: 'select', options: projOptions('No project') }, { name: 'kpi_id', label: 'KPI (for item)', type: 'select', options: kpiOptions('Pick one') }]],
    async onSubmit(v) {
      let ref;
      if (v.kind === 'item') {
        if (!v.kpi_id) return 'Pick the KPI this item belongs to.';
        ref = await db.add('items', { kpi_id: v.kpi_id, title: v.title, done: false });
      } else {
        const p = byId('projects', v.project_id);
        ref = await db.add('tasks', { title: v.title, notes: d.content, project_id: v.project_id || null, column: p ? p.columns[0] : null, priority: 'normal', item_id: null, from_dump: d.id });
      }
      await db.put('dumps', d.id, { status: 'converted', converted_to: { type: v.kind, id: ref.id } });
      toast(v.kind === 'item' ? 'Added to KPI' : 'Task created');
    },
  });
}
function logForm(l) {
  const v = l ? { task_id: logTask(l)?.id || l.task_id || '', label: l.label || '', date: ymd(new Date(l.started_at)), start: hm(l.started_at), end: l.ended_at ? hm(l.ended_at) : '' } : { date: today() };
  openForm({
    title: l ? 'Edit time log' : 'Log time', values: v,
    fields: [{ name: 'task_id', label: 'Task', type: 'select', options: [['', 'None, use label'], ...S.tasks.map(t => [t.id, `${t.title}${byId('projects', t.project_id) ? ` (${byId('projects', t.project_id).title})` : ''}`])] },
      { name: 'label', label: 'Label', placeholder: 'For time not tied to a task', suggest: [...new Set(S.logs.filter(x => !logTask(x)).map(logLabel))] },
      { name: 'date', label: 'Date', type: 'date', required: true },
      [{ name: 'start', label: 'Start', type: 'time', required: true }, { name: 'end', label: 'End', type: 'time', required: true }]],
    extra: l ? [{ label: 'Delete', icon: 'trash', danger: true, run: () => db.del('logs', l.id) }] : [],
    async onSubmit(d) {
      if (!d.task_id && !d.label && !l?.entry_id) return 'Pick a task or write a label.';
      const a = isoAt(d.date, d.start); let b = isoAt(d.date, d.end);
      if (b <= a) b = isoAt(ymd(addDays(parseYmd(d.date), 1)), d.end); // crosses midnight
      const row = { task_id: d.task_id || null, label: d.label || null, started_at: a, ended_at: b };
      if (d.task_id || d.label) row.entry_id = null;
      return l ? db.put('logs', l.id, row) : db.add('logs', { ...row, method: 'manual' });
    },
  });
}

/* ---------- drag and drop ---------- */
let drag = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-drag]'); if (!el) return;
  drag = { kind: el.dataset.drag, id: el.dataset.id };
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.id);
});
document.addEventListener('dragover', e => {
  const z = e.target.closest('[data-drop]'); if (!z || !drag) return;
  e.preventDefault(); document.querySelectorAll('.over').forEach(x => x !== z && x.classList.remove('over')); z.classList.add('over');
});
document.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', async e => {
  const z = e.target.closest('[data-drop]'); if (!z || !drag) return;
  e.preventDefault(); z.classList.remove('over');
  const { kind, id } = drag; drag = null;
  try {
    if (z.dataset.drop === 'col') { if (kind === 'task') await db.put('tasks', id, { column: z.dataset.col }); return render(); }
    let start = null, end = null;
    if (z.dataset.drop === 'slot') {
      const H = z.offsetHeight / (DAY_END - DAY_START);
      const y = e.clientY - z.getBoundingClientRect().top;
      const old = kind === 'entry' && byId('entries', id);
      const len = old && old.start ? toMin(old.end) - toMin(old.start) : 60;
      const s = Math.min(DAY_START * 60 + Math.round(y / H * 4) * 15, DAY_END * 60 - 15);
      start = fromMin(s); end = fromMin(Math.min(s + len, DAY_END * 60));
    }
    const date = z.dataset.date;
    if (kind === 'entry') await db.put('entries', id, { date, start, end });
    else if (['task', 'dump', 'item'].includes(kind)) {
      await db.add('entries', { source_type: kind, source_id: id, date, start, end, done: false });
      if (kind === 'dump') await db.put('dumps', id, { status: 'scheduled' });
    }
    render();
  } catch (err) { toast(err.message); }
});
document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });

/* ---------- backup ---------- */
$('#export').addEventListener('click', async () => {
  const data = await req('GET', '/api/export');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `planhub-backup-${today()}.json`; a.click();
});
$('#import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  if (!confirm('Replace all current data with this backup?')) return;
  try { await req('POST', '/api/import', JSON.parse(await file.text())); await db.load(); render(); toast('Backup restored'); }
  catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
});

/* ---------- boot ---------- */
db.load().then(render).catch(err => { $('#view').innerHTML = `<div class="card empty"><p>Could not reach the server. ${esc(err.message)}</p></div>`; });
