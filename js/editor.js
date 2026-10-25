// The central typing area: formatting, highlighting, and dragging text out to the margins.

import { store, ui, uid, locate, place, createGroup, deleteClip, groupCol } from './state.js';

let api;            // { commit, render, toast, flash }
let editor, pop;
let mouseDown = false;
let structural = false;   // last editor change was a highlight op, so Ctrl+Z should use our undo

export const typeOf = id =>
  store.settings.types.find(t => t.id === id) || { id, label: id || '?', plural: id || '?', color: '#999999', noteLabel: 'note' };

export function initEditor(hooks) {
  api = hooks;
  editor = document.getElementById('editor');
  pop = document.getElementById('popover');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

  editor.addEventListener('input', () => { structural = false; scheduleSync(); });
  editor.addEventListener('paste', onPaste);
  editor.addEventListener('keydown', onKey);
  editor.addEventListener('click', onClick);
  editor.addEventListener('dragstart', onDragStart);
  editor.addEventListener('mouseover', e => hoverClip(e.target.closest?.('mark[data-clip]')?.dataset.clip));
  editor.addEventListener('mouseout', () => hoverClip(null));
  editor.addEventListener('mousedown', () => { mouseDown = true; hidePopover(); });
  document.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; setTimeout(onSelection, 0); } });
  document.addEventListener('selectionchange', () => { if (!mouseDown) debounce(onSelection, 250); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePopover(true); });
  window.addEventListener('scroll', hidePopover, { passive: true });

  document.querySelector('.toolbar').addEventListener('mousedown', e => {
    // keep the editor's selection when pressing toolbar buttons
    if (e.target.closest('button')) e.preventDefault();
  });
  document.querySelector('.toolbar').addEventListener('click', onToolbar);
}

export function loadEditor() {
  editor.innerHTML = store.doc.html;
  refreshMarks();
}

// ---------- toolbar ----------

export function renderPens() {
  const box = document.getElementById('pens');
  box.innerHTML = store.settings.types.map((t, i) =>
    `<button class="pen${t.id === ui.pen ? ' on' : ''}" data-pen="${t.id}" style="--c:${t.color}"
       title="${esc(t.label)}"><i></i>${esc(t.label)}</button>`).join('');
  if (!store.settings.types.some(t => t.id === ui.pen)) ui.pen = store.settings.types[0]?.id;
}

function onToolbar(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pen) {
    ui.pen = b.dataset.pen;
    renderPens();
    const r = editorRange();
    if (r) highlight(r, ui.pen);
    return;
  }
  editor.focus();
  const cmd = b.dataset.cmd, val = b.dataset.val;
  if (cmd === 'formatBlock') {
    const cur = document.queryCommandValue('formatBlock').toLowerCase();
    document.execCommand('formatBlock', false, cur === val ? 'p' : val);
  } else if (cmd === 'removeFormat') {
    document.execCommand('removeFormat');
    document.execCommand('formatBlock', false, 'p');
  } else {
    document.execCommand(cmd, false, val || null);
  }
}

function onKey(e) {
  if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
    const t = store.settings.types[+e.code.slice(5) - 1];
    const r = editorRange();
    if (t && r) { e.preventDefault(); ui.pen = t.id; renderPens(); highlight(r, t.id); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && structural) {
    e.preventDefault();
    structural = false;
    api.undo();
    return;
  }
  hidePopover();
}

// Paste as plain text so the notes stay clean; line breaks become paragraphs.
function onPaste(e) {
  const text = e.clipboardData?.getData('text/plain');
  if (text == null) return;
  e.preventDefault();
  const html = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  document.execCommand(text.includes('\n') ? 'insertHTML' : 'insertText', false, text.includes('\n') ? html : text);
}

// ---------- highlighting ----------

function editorRange() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  return editor.contains(r.commonAncestorContainer) && r.toString().trim() ? r : null;
}

function textNodesIn(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) return [root];
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (range.intersectsNode(n)) out.push(n);
  return out;
}

// Wrap each text segment in the range so selections may cross paragraphs or formatting.
export function wrapRange(range, type) {
  const id = uid();
  const nodes = textNodesIn(range);
  const sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
  let first = null;
  for (let node of nodes) {
    const start = node === sc ? so : 0;
    const end = node === ec ? eo : node.length;
    if (end <= start || !node.nodeValue.slice(start, end).trim()) continue;
    if (end < node.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    const m = document.createElement('mark');
    m.dataset.clip = id;
    m.dataset.type = type;
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
    first ||= m;
  }
  if (!first) return null;
  getSelection().removeAllRanges();
  store.doc.clips[id] = { id, type, text: '', note: '' };
  refreshMarks();
  return id;
}

export function highlight(range, type) {
  let id = null;
  api.commit(() => { id = wrapRange(range, type); });
  structural = true;
  hidePopover();
  return id;
}

export function unwrap(cid) {
  editor.querySelectorAll(`mark[data-clip="${cid}"]`).forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
    parent.normalize();
  });
}

export function removeHighlight(cid) {
  api.commit(() => { unwrap(cid); deleteClip(store.doc, cid); });
  structural = true;
}

export function setType(cid, type) {
  store.doc.clips[cid].type = type;
  editor.querySelectorAll(`mark[data-clip="${cid}"]`).forEach(m => { m.dataset.type = type; });
}

// Marks get their colour inline so custom types need no generated CSS.
export function refreshMarks() {
  editor.querySelectorAll('mark[data-clip]').forEach(m => {
    m.style.setProperty('--c', typeOf(m.dataset.type).color);
    m.draggable = true;
  });
}

// Read clip text back out of the editor; clips whose marks were deleted become orphans.
export function syncClips() {
  const doc = store.doc;
  doc.html = editor.innerHTML;
  const marks = {};
  editor.querySelectorAll('mark[data-clip]').forEach(m => (marks[m.dataset.clip] ||= []).push(m));
  for (const [id, ms] of Object.entries(marks)) {
    if (!doc.clips[id]) doc.clips[id] = { id, type: ms[0].dataset.type, text: '', note: '' };
    const r = document.createRange();
    r.setStartBefore(ms[0]);
    r.setEndAfter(ms[ms.length - 1]);
    doc.clips[id].text = r.toString().replace(/\s+/g, ' ').trim();
    doc.clips[id].orphan = false;
  }
  for (const c of Object.values(doc.clips)) if (!marks[c.id]) c.orphan = true;
}

let syncTimer;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncClips(); api.render({ editorOnly: true }); api.save(); }, 300);
}

let debTimer;
function debounce(fn, ms) { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }

// ---------- linking hover / focus ----------

export function hoverClip(cid) {
  document.querySelectorAll('.hot').forEach(n => n.classList.remove('hot'));
  if (!cid) return;
  editor.querySelectorAll(`mark[data-clip="${cid}"]`).forEach(m => m.classList.add('hot'));
  document.querySelector(`.card[data-clip="${cid}"]`)?.classList.add('hot');
}

export function revealClip(cid) {
  const ms = editor.querySelectorAll(`mark[data-clip="${cid}"]`);
  if (!ms.length) return;
  ms[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  ms.forEach(m => { m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash'); });
}

// ---------- drag out of the text ----------

function onDragStart(e) {
  const r = editorRange();
  const t = e.target.nodeType === 3 ? e.target.parentElement : e.target;
  const mark = t.closest?.('mark[data-clip]');
  if (r && !(mark && r.toString().trim() === mark.textContent.trim())) {
    ui.drag = { kind: 'selection', range: r.cloneRange() };
    e.dataTransfer.effectAllowed = 'copy';
  } else if (mark) {
    ui.drag = { kind: 'clip', id: mark.dataset.clip, from: 'text' };
    e.dataTransfer.effectAllowed = 'copyMove';
  } else return;
  e.dataTransfer.setData('text/plain', r ? r.toString() : mark.textContent);
  hidePopover();
  document.body.classList.add('dragging');
}

// ---------- popovers ----------

function onSelection() {
  if (ui.drag) return;
  const r = editorRange();
  if (!r) { if (pop.dataset.mode === 'select') hidePopover(); return; }
  const types = store.settings.types;
  pop.dataset.mode = 'select';
  pop.innerHTML = `<div class="pop-row">${types.map(t =>
    `<button class="pen" data-hl="${t.id}" style="--c:${t.color}"><i></i>${esc(t.label)}</button>`).join('')}</div>`;
  pop.onmousedown = ev => ev.preventDefault();
  pop.onclick = ev => {
    const b = ev.target.closest('[data-hl]');
    const rr = editorRange();
    if (b && rr) { ui.pen = b.dataset.hl; renderPens(); highlight(rr, b.dataset.hl); }
  };
  showAt(r.getBoundingClientRect());
}

function onClick(e) {
  const mark = e.target.closest('mark[data-clip]');
  if (!mark || !getSelection().isCollapsed) return;
  showMarkPopover(mark);
}

function showMarkPopover(mark) {
  const doc = store.doc;
  const cid = mark.dataset.clip;
  const clip = doc.clips[cid];
  if (!clip) return;
  const at = locate(doc, cid);
  const where = at ? (at.group ? `in “${esc(doc.groups[at.group].name || 'Untitled topic')}”` : `in ${esc(doc.columns[at.col].name)}`) : '';
  const groups = ['left', 'right'].flatMap(col => doc.columns[col].items.filter(i => i.startsWith('g:')).map(i => doc.groups[i.slice(2)]));
  pop.dataset.mode = 'mark';
  pop.innerHTML = `
    <div class="pop-row">
      <select data-act="type" aria-label="Tag">${store.settings.types.map(t =>
        `<option value="${t.id}"${t.id === clip.type ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      <span class="pop-where">${where}</span>
    </div>
    <div class="pop-row">
      <button data-act="left">← ${esc(doc.columns.left.name)}</button>
      <button data-act="right">${esc(doc.columns.right.name)} →</button>
      <select data-act="topic" aria-label="Add to topic">
        <option value="">Topic…</option>
        ${groups.map(g => `<option value="${g.id}"${at?.group === g.id ? ' selected' : ''}>${esc(g.name || 'Untitled topic')}</option>`).join('')}
        <option value="new:left">+ ${esc(doc.columns.left.name)}</option>
        <option value="new:right">+ ${esc(doc.columns.right.name)}</option>
      </select>
    </div>
    <div class="pop-row"><button data-act="remove" class="danger">Remove</button></div>`;
  pop.onmousedown = null;
  pop.onclick = ev => {
    const act = ev.target.closest('button')?.dataset.act;
    if (act === 'left' || act === 'right') { api.commit(() => place(doc, cid, { col: act, group: null })); hidePopover(true); api.flash(cid); }
    if (act === 'remove') { removeHighlight(cid); hidePopover(true); }
  };
  pop.onchange = ev => {
    const s = ev.target;
    if (s.dataset.act === 'type') { api.commit(() => setType(cid, s.value)); refreshMarks(); }
    if (s.dataset.act === 'topic' && s.value) {
      let gid = s.value;
      api.commit(() => {
        if (gid.startsWith('new:')) { gid = createGroup(doc, gid.slice(4)); api.focusGroup(gid); }
        place(doc, cid, { col: groupCol(doc, gid), group: gid });
      });
      hidePopover(true);
      api.flash(cid);
    }
  };
  showAt(mark.getBoundingClientRect());
}

function showAt(rect) {
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let top = rect.top - h - 8;
  if (top < 8) top = rect.bottom + 8;
  const left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

export function hidePopover(force = false) {
  if (pop && !pop.hidden && (force || !pop.contains(document.activeElement))) { pop.hidden = true; pop.dataset.mode = ''; }
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

