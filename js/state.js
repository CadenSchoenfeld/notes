// Data model, persistence, and the small set of mutations everything else uses.
//
// A notebook ("doc") holds:
//   html     the editor contents; highlights are <mark data-clip="id" data-type="yellow">
//   clips    one entry per highlight: { id, type, text, note, orphan }
//   groups   topics: { id, name, items: [clipId], collapsed }
//   columns  { left|right: { items: ['g:id' | 'c:id'] } }
//   links    [{ from: 'c:id'|'g:id', to: 'c:id'|'g:id', rel }]

export const uid = () => Math.random().toString(36).slice(2, 9);
export const today = () => new Date().toISOString().slice(0, 10);

const KEY_INDEX = 'margins.index';
const KEY_DOC = 'margins.doc.';
const KEY_SETTINGS = 'margins.settings';

// Highlight colours. `label` is the user's own key for what a colour means; blank until they set one.
export const DEFAULT_TYPES = [
  { id: 'yellow', label: '', color: '#f2c94c' },
  { id: 'green',  label: '', color: '#6fcf97' },
  { id: 'blue',   label: '', color: '#79a8f2' },
  { id: 'purple', label: '', color: '#c38ef0' },
  { id: 'red',    label: '', color: '#f2907e' },
  { id: 'orange', label: '', color: '#f5a65b' },
];

// Earlier versions shipped fixed meanings; map them onto the plain colours.
const LEGACY = {
  term: ['yellow', 'Term'], clause: ['green', 'Clause'], question: ['blue', 'Question'],
  link: ['purple', 'Linkage'], clarify: ['red', 'To clarify'],
};

function migrateTypes(types) {
  return types.map(({ plural, noteLabel, outline, ...t }) => {
    const old = LEGACY[t.id];
    return old ? { ...t, id: old[0], label: t.label === old[1] ? '' : t.label } : t;
  });
}

export function defaultSettings() {
  return {
    types: structuredClone(DEFAULT_TYPES),
    font: 'serif',
    fontSize: 18,
    latex: {
      paper: 'letterpaper', engine: 'lualatex',
      notes: true, summary: true, outline: true, map: true, connections: true,
    },
  };
}

export function newDoc() {
  return {
    id: uid(), title: '', source: '', date: today(), html: '', summary: '',
    clips: {}, groups: {}, links: [],
    columns: { left: { items: [] }, right: { items: [] } },
    updated: Date.now(),
  };
}

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

// Fill in anything an older or hand-edited file is missing.
export function normalizeDoc(d) {
  const base = newDoc();
  const doc = { ...base, ...d };
  doc.columns = {
    left: { ...base.columns.left, ...(d.columns?.left || {}) },
    right: { ...base.columns.right, ...(d.columns?.right || {}) },
  };
  doc.clips ||= {}; doc.groups ||= {}; doc.links ||= [];
  for (const c of Object.values(doc.clips)) if (LEGACY[c.type]) c.type = LEGACY[c.type][0];
  doc.html = (doc.html || '').replace(/data-type="(\w+)"/g, (m, t) => LEGACY[t] ? `data-type="${LEGACY[t][0]}"` : m);
  return doc;
}

export const store = {
  settings: null,
  doc: null,
  index: [],   // [{ id, title, updated }]

  load() {
    const s = read(KEY_SETTINGS, null);
    const def = defaultSettings();
    this.settings = s ? { ...def, ...s, latex: { ...def.latex, ...(s.latex || {}) } } : def;
    this.settings.types = migrateTypes(this.settings.types);
    this.index = read(KEY_INDEX, []);
    const last = this.index[0] && read(KEY_DOC + this.index[0].id, null);
    if (last) this.doc = normalizeDoc(last);
    return !!last;
  },

  save() {
    const d = this.doc;
    d.updated = Date.now();
    const ok = write(KEY_DOC + d.id, d);
    this.index = [{ id: d.id, title: d.title, updated: d.updated }, ...this.index.filter(e => e.id !== d.id)];
    write(KEY_INDEX, this.index);
    return ok;
  },

  saveSettings() { write(KEY_SETTINGS, this.settings); },

  open(id) {
    const d = read(KEY_DOC + id, null);
    if (!d) return false;
    this.doc = normalizeDoc(d);
    this.save();
    return true;
  },

  create(doc = newDoc()) {
    this.doc = normalizeDoc(doc);
    this.save();
  },

  remove(id) {
    try { localStorage.removeItem(KEY_DOC + id); } catch {}
    this.index = this.index.filter(e => e.id !== id);
    write(KEY_INDEX, this.index);
  },
};

// ---------- layout mutations ----------

export function locate(doc, cid) {
  for (const col of ['left', 'right']) {
    const index = doc.columns[col].items.indexOf('c:' + cid);
    if (index >= 0) return { col, group: null, index };
  }
  for (const g of Object.values(doc.groups)) {
    const index = g.items.indexOf(cid);
    if (index >= 0) return { col: groupCol(doc, g.id), group: g.id, index };
  }
  return null;
}

export function groupCol(doc, gid) {
  for (const col of ['left', 'right']) if (doc.columns[col].items.includes('g:' + gid)) return col;
  return null;
}

export function detach(doc, cid) {
  const at = locate(doc, cid);
  if (!at) return;
  if (at.group) doc.groups[at.group].items.splice(at.index, 1);
  else doc.columns[at.col].items.splice(at.index, 1);
}

// `index` is counted with the moving item already removed.
export function place(doc, cid, { col, group, index = Infinity }) {
  detach(doc, cid);
  const list = group ? doc.groups[group].items : doc.columns[col].items;
  list.splice(Math.min(index, list.length), 0, group ? cid : 'c:' + cid);
}

export function createGroup(doc, col, index = Infinity, name = '') {
  const id = uid();
  doc.groups[id] = { id, name, items: [], collapsed: false };
  const list = doc.columns[col].items;
  list.splice(Math.min(index, list.length), 0, 'g:' + id);
  return id;
}

export function moveGroup(doc, gid, col, index = Infinity) {
  const from = groupCol(doc, gid);
  if (from) doc.columns[from].items.splice(doc.columns[from].items.indexOf('g:' + gid), 1);
  const list = doc.columns[col].items;
  list.splice(Math.min(index, list.length), 0, 'g:' + gid);
}

// Deleting a topic leaves its highlights loose in the same spot.
export function deleteGroup(doc, gid) {
  const col = groupCol(doc, gid);
  const g = doc.groups[gid];
  if (col) {
    const list = doc.columns[col].items;
    list.splice(list.indexOf('g:' + gid), 1, ...g.items.map(id => 'c:' + id));
  }
  delete doc.groups[gid];
  doc.links = doc.links.filter(l => l.from !== 'g:' + gid && l.to !== 'g:' + gid);
}

export function deleteClip(doc, cid) {
  detach(doc, cid);
  delete doc.clips[cid];
  doc.links = doc.links.filter(l => l.from !== 'c:' + cid && l.to !== 'c:' + cid);
}

export function addLink(doc, from, to) {
  if (from === to) return false;
  if (doc.links.some(l => (l.from === from && l.to === to))) return false;
  doc.links.push({ from, to, rel: '' });
  return true;
}

export function topicOf(doc, cid) {
  const at = locate(doc, cid);
  return at?.group ? doc.groups[at.group] : null;
}

// Human-readable name for a link endpoint.
export function refLabel(doc, ref, max = 60) {
  const [kind, id] = [ref[0], ref.slice(2)];
  const s = kind === 'g' ? (doc.groups[id]?.name || 'Untitled topic') : (doc.clips[id]?.text || '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// Shared, non-persisted UI state.
export const ui = {
  pen: 'yellow',        // type used when dragging a raw selection
  drag: null,         // { kind: 'clip'|'selection'|'group', id?, range?, from? }
  linking: null,      // ref the next click links from
};
