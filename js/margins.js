// The two Cornell columns: cards, topics, drag and drop, and links between them.

import { store, ui, place, detach, createGroup, moveGroup, deleteGroup, addLink, refLabel } from './state.js';
import { typeOf, esc, wrapRange, removeHighlight, revealClip, hoverClip } from './editor.js';

let api;
let line;   // drop indicator

export function initMargins(hooks) {
  api = hooks;
  line = document.createElement('div');
  line.className = 'drop-line';
  const sheet = document.querySelector('.sheet');
  sheet.addEventListener('click', onClick);
  sheet.addEventListener('input', onInput);
  sheet.addEventListener('keydown', onKeydown);
  sheet.addEventListener('dragstart', onDragStart);
  sheet.addEventListener('mouseover', e => { const c = e.target.closest('.card'); if (c) hoverClip(c.dataset.clip); });
  sheet.addEventListener('mouseout', e => { if (e.target.closest('.card')) hoverClip(null); });
  // a card can't be dragged while you're selecting text in its note
  sheet.addEventListener('mousedown', e => {
    const note = e.target.closest('.card-note, .link-rel');
    if (note) note.closest('.card').draggable = false;
  });
  document.addEventListener('mouseup', () => document.querySelectorAll('.card[draggable="false"]').forEach(c => { c.draggable = true; }));
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  document.addEventListener('dragend', endDrag);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.linking) stopLinking(); });
  document.getElementById('linkbar').addEventListener('click', e => { if (e.target.closest('button')) stopLinking(); });
}

// ---------- render ----------

export function renderMargins() {
  for (const col of ['left', 'right']) renderColumn(col);
}

function renderColumn(col) {
  const doc = store.doc;
  const el = document.querySelector(`.col[data-col="${col}"]`);
  const c = doc.columns[col];
  el.innerHTML = `
    <div class="col-list" data-drop="col" data-col="${col}"></div>
    <div class="newtopic" data-drop="newtopic" data-col="${col}" role="button" tabindex="0">+ Topic</div>`;
  const list = el.querySelector('.col-list');
  for (const it of c.items) {
    const id = it.slice(2);
    if (it[0] === 'g' && doc.groups[id]) list.append(groupEl(doc.groups[id]));
    if (it[0] === 'c' && doc.clips[id]) list.append(cardEl(doc.clips[id]));
  }
}

function groupEl(g) {
  const doc = store.doc;
  const el = document.createElement('section');
  el.className = 'group' + (g.collapsed ? ' collapsed' : '');
  el.dataset.group = g.id;
  el.innerHTML = `
    <header class="group-head" data-ref="g:${g.id}">
      <span class="grip" draggable="true" aria-hidden="true">⠿</span>
      <h3 contenteditable="plaintext-only" data-placeholder="Topic" data-gname="${g.id}">${esc(g.name)}</h3>
      <span class="count">${g.items.length}</span>
      <button class="ic" data-act="link" title="Link">⤳</button>
      <button class="ic" data-act="collapse" title="Collapse">${g.collapsed ? '▸' : '▾'}</button>
      <button class="ic" data-act="ungroup" title="Delete topic">×</button>
    </header>
    ${linksHtml('g:' + g.id)}
    <div class="group-body" data-drop="group" data-group="${g.id}"></div>`;
  const body = el.querySelector('.group-body');
  for (const cid of g.items) if (doc.clips[cid]) body.append(cardEl(doc.clips[cid]));
  return el;
}

function cardEl(c) {
  const t = typeOf(c.type);
  const el = document.createElement('article');
  el.className = 'card' + (c.orphan ? ' orphan' : '');
  el.draggable = true;
  el.dataset.clip = c.id;
  el.dataset.ref = 'c:' + c.id;
  el.style.setProperty('--c', t.color);
  el.innerHTML = `
    <div class="card-top">
      <button class="ic" data-act="link" title="Link">⤳</button>
      <button class="ic" data-act="unplace" title="Unpin">↩</button>
      <button class="ic" data-act="delete" title="Remove">×</button>
    </div>
    <div class="card-text">${esc(c.text) || '<em>empty</em>'}</div>
    ${c.orphan ? `` : ''}
    <div class="card-note" contenteditable="plaintext-only" data-placeholder="note">${esc(c.note)}</div>
    ${linksHtml('c:' + c.id)}`;
  return el;
}

function linksHtml(ref) {
  const doc = store.doc;
  const rows = doc.links.map((l, i) => {
    if (l.from === ref) return `<li><span class="arrow">→</span><span class="link-target" data-goto="${l.to}">${esc(refLabel(doc, l.to, 40))}</span>
      <span class="link-rel" contenteditable="plaintext-only" data-link="${i}" data-placeholder="relation">${esc(l.rel)}</span>
      <button class="ic" data-unlink="${i}" title="Remove link">×</button></li>`;
    if (l.to === ref) return `<li class="incoming"><span class="arrow">←</span><span class="link-target" data-goto="${l.from}">${esc(refLabel(doc, l.from, 40))}</span>
      ${l.rel ? `<span class="link-rel ro">${esc(l.rel)}</span>` : ''}</li>`;
    return '';
  }).join('');
  return rows ? `<ul class="links">${rows}</ul>` : '';
}

export function flash(cid) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.card[data-clip="${cid}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
}

export function focusGroupName(gid) {
  requestAnimationFrame(() => document.querySelector(`[data-gname="${gid}"]`)?.focus());
}

// ---------- events ----------

function onClick(e) {
  const doc = store.doc;
  if (ui.linking) {
    const target = e.target.closest('[data-ref]');
    if (target && !target.closest('.editor-wrap')) {
      e.preventDefault();
      const from = ui.linking, to = target.dataset.ref;
      stopLinking();
      if (from !== to) api.commit(() => addLink(doc, from, to));
    }
    return;
  }
  const btn = e.target.closest('button[data-act], [data-unlink]');
  const card = e.target.closest('.card');
  const group = e.target.closest('.group');
  if (btn?.dataset.unlink != null) { api.commit(() => doc.links.splice(+btn.dataset.unlink, 1)); return; }
  if (btn) {
    const act = btn.dataset.act;
    if (act === 'link') return startLinking(card && btn.closest('.card-top') ? 'c:' + card.dataset.clip : 'g:' + group.dataset.group);
    if (act === 'unplace') return api.commit(() => detach(doc, card.dataset.clip));
    if (act === 'delete') { removeHighlight(card.dataset.clip); api.toast('Highlight removed', true); return; }
    if (act === 'collapse') return api.commit(() => { doc.groups[group.dataset.group].collapsed ^= true; });
    if (act === 'ungroup') { api.commit(() => deleteGroup(doc, group.dataset.group)); api.toast('Topic deleted', true); return; }
  }
  const go = e.target.closest('[data-goto]');
  if (go) {
    const ref = go.dataset.goto;
    if (ref[0] === 'c') { revealClip(ref.slice(2)); flash(ref.slice(2)); }
    else document.querySelector(`[data-group="${ref.slice(2)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (e.target.closest('.card-text') && card) revealClip(card.dataset.clip);
  const nt = e.target.closest('.newtopic');
  if (nt) { let gid; api.commit(() => { gid = createGroup(doc, nt.dataset.col); }); focusGroupName(gid); }
}

function onKeydown(e) {
  const t = e.target;
  if (t.matches?.('[data-gname], .link-rel') && e.key === 'Enter') { e.preventDefault(); t.blur(); }
  if (t.matches?.('.newtopic') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
}

// Text fields in the margins update the model in place, without re-rendering.
function onInput(e) {
  const t = e.target, doc = store.doc;
  if (t.dataset.gname) doc.groups[t.dataset.gname].name = t.textContent.trim();
  else if (t.dataset.link) doc.links[+t.dataset.link].rel = t.textContent.trim();
  else if (t.matches('.card-note')) doc.clips[t.closest('.card').dataset.clip].note = t.textContent.trim();
  else return;
  api.save();
}

function startLinking(ref) {
  ui.linking = ref;
  document.body.classList.add('linking');
  const bar = document.getElementById('linkbar');
  bar.querySelector('span').textContent = `${refLabel(store.doc, ref, 40)} →`;
  bar.hidden = false;
}

function stopLinking() {
  ui.linking = null;
  document.body.classList.remove('linking');
  document.getElementById('linkbar').hidden = true;
}

// ---------- drag and drop ----------

function onDragStart(e) {
  const grip = e.target.closest?.('.grip');
  const card = e.target.closest?.('.card');
  if (grip) {
    const g = grip.closest('.group');
    ui.drag = { kind: 'group', id: g.dataset.group, el: g };
  } else if (card) {
    ui.drag = { kind: 'clip', id: card.dataset.clip, from: 'card', el: card };
  } else return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ui.drag.kind === 'clip' ? store.doc.clips[ui.drag.id]?.text || '' : '');
  requestAnimationFrame(() => ui.drag?.el?.classList.add('lifted'));
  document.body.classList.add('dragging');
}

function accepts(zone, d) {
  const kind = zone.dataset.drop;
  if (d.kind === 'group') return kind === 'col';
  if (kind === 'editor') return d.kind === 'clip' && d.from === 'card';
  return true;
}

function findZone(target) {
  let el = target.nodeType === 3 ? target.parentElement : target;
  for (let z = el?.closest('[data-drop]'); z; z = z.parentElement?.closest('[data-drop]')) {
    if (accepts(z, ui.drag)) return z;
  }
  return null;
}

function onDragOver(e) {
  if (!ui.drag) return;
  const zone = findZone(e.target);
  document.querySelectorAll('.over').forEach(z => z !== zone && z.classList.remove('over'));
  if (!zone) { line.remove(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = ui.drag.kind === 'selection' ? 'copy' : 'move';
  zone.classList.add('over');
  if (zone.dataset.drop === 'col' || zone.dataset.drop === 'group') {
    const kids = [...zone.children].filter(c => c.matches('.card, .group') && c !== ui.drag.el);
    let i = kids.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (i < 0) i = kids.length;
    ui.dropIndex = i;
    if (kids[i]) zone.insertBefore(line, kids[i]); else zone.append(line);
  } else line.remove();
}

function onDrop(e) {
  if (!ui.drag) return;
  e.preventDefault();   // never let the browser move text or follow links
  const d = ui.drag, zone = findZone(e.target), index = ui.dropIndex ?? Infinity;
  endDrag();
  if (!zone) return;
  const doc = store.doc, kind = zone.dataset.drop;
  let gid = null;
  api.commit(() => {
    if (d.kind === 'group') return moveGroup(doc, d.id, zone.dataset.col, index);
    const cid = d.kind === 'selection' ? wrapRange(d.range, ui.pen) : d.id;
    if (!cid) return;
    if (kind === 'editor') return detach(doc, cid);
    if (kind === 'col') place(doc, cid, { col: zone.dataset.col, group: null, index });
    if (kind === 'group') place(doc, cid, { group: zone.dataset.group, index });
    if (kind === 'newtopic') { gid = createGroup(doc, zone.dataset.col); place(doc, cid, { group: gid }); }
    flash(cid);
  });
  if (gid) focusGroupName(gid);
}

function endDrag() {
  if (ui.drag?.el) ui.drag.el.classList.remove('lifted');
  ui.drag = null;
  ui.dropIndex = null;
  line.remove();
  document.querySelectorAll('.over').forEach(z => z.classList.remove('over'));
  document.body.classList.remove('dragging');
}
