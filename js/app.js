// Wiring: header, undo, notebooks, and the outline / export / settings dialogs.

import { store, newDoc, normalizeDoc, defaultSettings, DEFAULT_TYPES, uid } from './state.js';
import { initEditor, loadEditor, renderPens, syncClips, refreshMarks, esc, typeName } from './editor.js';
import { initMargins, renderMargins, flash, focusGroupName } from './margins.js';
import { buildOutline, outlineHtml, outlineMarkdown } from './outline.js';
import { buildLatex, compileTexLiveNet, openInOverleaf } from './latex.js';

const $ = s => document.querySelector(s);
const editor = $('#editor');
const history = [];

const api = { commit, undo, save, render, toast, flash, focusGroup: focusGroupName };

// ---------- core ----------

function commit(fn) {
  syncClips();
  history.push(JSON.stringify(store.doc));
  if (history.length > 50) history.shift();
  fn();
  syncClips();
  save();
  render();
}

function undo() {
  const prev = history.pop();
  if (!prev) return toast('Nothing to undo');
  store.doc = normalizeDoc(JSON.parse(prev));
  loadEditor();
  save();
  render();
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    $('#save-state').textContent = store.save() ? '' : 'Not saved';
  }, 250);
}

function render() {
  renderMargins();
  document.title = (store.doc.title ? store.doc.title + ' · ' : '') + 'Margins';
}

function loadDoc() {
  const d = store.doc;
  $('#title').value = d.title;
  $('#source').value = d.source;
  $('#date').value = d.date;
  $('#summary').textContent = d.summary;
  history.length = 0;
  loadEditor();
  syncClips();
  render();
}

let toastTimer;
function toast(msg, withUndo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button>Undo</button>' : ''}`;
  t.hidden = false;
  t.querySelector('button')?.addEventListener('click', () => { undo(); t.hidden = true; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function applyLook() {
  const s = store.settings;
  document.documentElement.style.setProperty('--note-size', s.fontSize + 'px');
  document.documentElement.dataset.font = s.font;
  renderPens();
  refreshMarks();
}

// ---------- header ----------

function initHeader() {
  for (const k of ['title', 'source', 'date']) {
    $('#' + k).addEventListener('input', e => { store.doc[k] = e.target.value; save(); if (k === 'title') render(); });
  }
  $('#summary').addEventListener('input', e => { store.doc.summary = e.target.innerText.trim(); save(); });
  $('#outline-btn').addEventListener('click', openOutline);
  $('#export-btn').addEventListener('click', openExport);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#menu-btn').addEventListener('click', toggleMenu);
  document.addEventListener('click', e => {
    if (!e.target.closest('#notebook-menu, #menu-btn')) $('#notebook-menu').hidden = true;
  });
  document.addEventListener('keydown', e => {
    const inText = e.target.closest?.('input, textarea, [contenteditable]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inText) { e.preventDefault(); undo(); }
  });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  }));
}

// ---------- notebooks ----------

function toggleMenu() {
  const m = $('#notebook-menu');
  if (!m.hidden) { m.hidden = true; return; }
  const fmt = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  m.innerHTML = `
    <div class="menu-actions">
      <button data-nb="new">New</button>
      <button data-nb="import">Open…</button>
      <button data-nb="save">Save…</button>
    </div>
    <ul class="nb-list">${store.index.map(e => `
      <li class="${e.id === store.doc.id ? 'current' : ''}">
        <button data-open="${e.id}"><b>${esc(e.title || 'Untitled')}</b><small>${fmt(e.updated)}</small></button>
      </li>`).join('')}</ul>
    <div class="menu-actions">
      <button data-nb="delete" class="danger">Delete</button>
    </div>`;
  m.hidden = false;
  m.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) { syncClips(); store.save(); store.open(b.dataset.open); loadDoc(); }
    const act = b.dataset.nb;
    if (act === 'new') { syncClips(); store.save(); store.create(); loadDoc(); editor.focus(); }
    if (act === 'save') download(fileBase() + '.margins.json', JSON.stringify(store.doc, null, 2), 'application/json');
    if (act === 'import') importFile();
    if (act === 'delete') {
      if (b.dataset.armed) {
        const gone = store.doc.id;
        store.remove(gone);
        if (!store.index.length || !store.open(store.index[0].id)) store.create();
        loadDoc();
        toast('Notebook deleted');
      } else { b.dataset.armed = '1'; b.textContent = 'Confirm delete'; return; }
    }
    m.hidden = true;
  };
}

function importFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      if (typeof d.html !== 'string') throw new Error('not a notebook');
      d.id = store.index.some(e => e.id === d.id) ? uid() : (d.id || uid());
      syncClips(); store.save();
      store.create(d);
      loadDoc();
      toast('Opened ' + (d.title || 'notebook'));
    } catch { toast('That file is not a Margins notebook'); }
  };
  inp.click();
}

function fileBase() {
  return (store.doc.title || 'notes').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notes';
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- outline ----------

function openOutline() {
  syncClips();
  const o = buildOutline(store.doc, store.settings);
  const d = $('#outline-dlg');
  d.querySelector('.dlg-body').innerHTML = `<h2 class="o-title">${esc(o.title)}</h2>
    ${o.source || o.date ? `<p class="o-meta">${esc([o.source, o.date].filter(Boolean).join(' · '))}</p>` : ''}
    ${outlineHtml(o, esc)}`;
  d.querySelector('[data-md-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(outlineMarkdown(o)); toast('Outline copied as Markdown'); }
    catch { toast('Copy failed; use Download instead'); }
  };
  d.querySelector('[data-md-dl]').onclick = () => download(fileBase() + '-outline.md', outlineMarkdown(o), 'text/markdown');
  d.showModal();
}

// ---------- export ----------

function openExport() {
  syncClips();
  const d = $('#export-dlg');
  const opt = store.settings.latex;
  const checks = [
    ['notes', 'Notes'], ['summary', 'Summary'], ['outline', 'Outline'],
    ['map', 'Concept map'], ['connections', 'Connections'],
  ];
  d.querySelector('.export-opts').innerHTML = `
    <fieldset><legend>Include</legend>${checks.map(([k, label]) =>
      `<label><input type="checkbox" data-opt="${k}"${opt[k] ? ' checked' : ''}> ${label}</label>`).join('')}</fieldset>
    <fieldset class="out"><legend>Format</legend>
      <select name="paper">${[['letterpaper', 'US Letter'], ['a4paper', 'A4']].map(([v, l]) => `<option value="${v}"${opt.paper === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select data-opt="engine">${['lualatex', 'xelatex', 'pdflatex'].map(e => `<option${opt.engine === e ? ' selected' : ''}>${e}</option>`).join('')}</select>
    </fieldset>`;
  const tex = () => buildLatex(store.doc, store.settings);
  const refresh = () => { d.querySelector('.tex-preview').value = tex(); };
  d.querySelector('.export-opts').onchange = e => {
    const t = e.target;
    if (t.name === 'paper') opt.paper = t.value;
    else if (t.dataset.opt === 'engine') opt.engine = t.value;
    else if (t.dataset.opt) opt[t.dataset.opt] = t.checked;
    store.saveSettings();
    refresh();
  };
  d.querySelector('[data-x="pdf"]').onclick = () => compileTexLiveNet(tex(), opt.engine);
  d.querySelector('[data-x="overleaf"]').onclick = () => openInOverleaf(tex(), opt.engine, fileBase() + '.tex');
  d.querySelector('[data-x="tex"]').onclick = () => download(fileBase() + '.tex', tex(), 'application/x-tex');
  d.querySelector('[data-x="print"]').onclick = () => { d.close(); printView(); };
  refresh();
  d.showModal();
}

// Browser-only fallback: print the outline and notes without LaTeX.
function printView() {
  const o = buildOutline(store.doc, store.settings);
  $('#print-view').innerHTML = `
    <h1>${esc(o.title)}</h1>
    <p class="o-meta">${esc([o.source, o.date].filter(Boolean).join(' · '))}</p>
    <div class="print-notes">${store.doc.html}</div>
    ${o.summary ? `<h2>Summary</h2><p>${esc(o.summary)}</p>` : ''}
    <h2>Outline</h2>${outlineHtml(o, esc)}`;
  $('#print-view').querySelectorAll('mark[data-clip]').forEach(m =>
    m.style.setProperty('--c', (store.settings.types.find(t => t.id === m.dataset.type) || {}).color || '#999'));
  window.print();
}

// ---------- settings ----------

function openSettings() {
  const d = $('#settings-dlg');
  const s = store.settings;
  const draw = () => {
    d.querySelector('.dlg-body').innerHTML = `
      <h3>Highlights</h3>
      <p class="hint">Write what each colour means to you, or leave it blank.</p>
      <table class="types">
        <thead><tr><th>Colour</th><th>Key</th><th></th></tr></thead>
        <tbody>${s.types.map((t, i) => `
          <tr data-i="${i}">
            <td><input type="color" data-f="color" value="${t.color}"></td>
            <td><input data-f="label" value="${esc(t.label)}" placeholder="${esc(typeName({ color: t.color }))}"></td>
            <td class="row-acts">
              <button class="ic" data-move="-1" title="Move up"${i ? '' : ' disabled'}>↑</button>
              <button class="ic" data-move="1" title="Move down"${i < s.types.length - 1 ? '' : ' disabled'}>↓</button>
              <button class="ic" data-del title="Delete colour">×</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="row"><button data-add>+ Colour</button><button data-reset-types>Reset</button></div>
      <h3>Writing</h3>
      <div class="row">
        <label>Typeface <select data-s="font">
          <option value="serif"${s.font === 'serif' ? ' selected' : ''}>Serif</option>
          <option value="sans"${s.font === 'sans' ? ' selected' : ''}>Sans</option>
          <option value="mono"${s.font === 'mono' ? ' selected' : ''}>Mono</option></select></label>
        <label>Size <input type="number" min="13" max="28" data-s="fontSize" value="${s.fontSize}"> px</label>
      </div>`;
  };
  d.querySelector('.dlg-body').oninput = e => {
    const t = e.target, row = t.closest('tr');
    if (row && t.dataset.f) {
      s.types[+row.dataset.i][t.dataset.f] = t.value;
    }
    if (t.dataset.s === 'font') s.font = t.value;
    if (t.dataset.s === 'fontSize') s.fontSize = Math.max(13, Math.min(28, +t.value || 18));
    store.saveSettings();
    applyLook();
    renderMargins();
  };
  d.querySelector('.dlg-body').onchange = d.querySelector('.dlg-body').oninput;
  d.querySelector('.dlg-body').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = +b.closest('tr')?.dataset.i;
    if (b.dataset.add != null) {
      s.types.push({ id: 'c' + uid(), label: '', color: '#b8b8b8' });
    }
    if (b.dataset.del != null) s.types.splice(i, 1);
    if (b.dataset.move) {
      const j = i + +b.dataset.move;
      [s.types[i], s.types[j]] = [s.types[j], s.types[i]];
    }
    if (b.dataset.resetTypes != null) s.types = structuredClone(DEFAULT_TYPES);
    store.saveSettings();
    applyLook();
    renderMargins();
    draw();
  };
  draw();
  d.showModal();
}

// ---------- start ----------

store.load();
if (!store.doc) store.create(newDoc());
if (!store.settings) store.settings = defaultSettings();
initEditor(api);
initMargins(api);
initHeader();
applyLook();
loadDoc();
if (!store.doc.html) editor.focus();
