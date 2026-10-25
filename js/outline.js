// Turns the notebook into a structured outline. The outline view, Markdown, print, and
// LaTeX exports all read from this one model, so they always agree.
//
// Nothing here assigns tags or topics: it only arranges what the user already labelled.

import { locate, refLabel } from './state.js';
import { typeName } from './editor.js';

// Clip ids in the order they appear in the text, then any orphans.
export function textOrder(doc) {
  const body = new DOMParser().parseFromString(`<body>${doc.html}</body>`, 'text/html').body;
  const ids = [];
  body.querySelectorAll('mark[data-clip]').forEach(m => { if (!ids.includes(m.dataset.clip)) ids.push(m.dataset.clip); });
  for (const id of Object.keys(doc.clips)) if (!ids.includes(id)) ids.push(id);
  return ids.filter(id => doc.clips[id]);
}

export function buildOutline(doc, settings) {
  const types = settings.types;
  const known = new Set(types.map(t => t.id));

  const sections = clips => {
    const out = types.map(t => ({ name: typeName(t), clips: clips.filter(c => c.type === t.id) }));
    const other = clips.filter(c => !known.has(c.type));
    if (other.length) out.push({ name: 'Other', clips: other });
    return out.filter(s => s.clips.length);
  };

  const linksFor = refs => doc.links
    .filter(l => refs.has(l.from) || refs.has(l.to))
    .map(l => ({
      out: refs.has(l.from),
      other: refLabel(doc, refs.has(l.from) ? l.to : l.from, 80),
      self: refLabel(doc, refs.has(l.from) ? l.from : l.to, 80),
      rel: l.rel,
    }));

  const topics = [];
  const grouped = new Set();
  for (const col of ['left', 'right']) {
    for (const it of doc.columns[col].items) {
      const g = it[0] === 'g' && doc.groups[it.slice(2)];
      if (!g) continue;
      const clips = g.items.map(id => doc.clips[id]).filter(Boolean);
      clips.forEach(c => grouped.add(c.id));
      const refs = new Set(['g:' + g.id, ...clips.map(c => 'c:' + c.id)]);
      topics.push({ id: g.id, name: g.name || 'Untitled topic', col, clips, sections: sections(clips), links: linksFor(refs) });
    }
  }

  const loose = textOrder(doc).filter(id => !grouped.has(id)).map(id => doc.clips[id]);
  const ungrouped = loose.length
    ? { name: 'Ungrouped', clips: loose, sections: sections(loose), links: linksFor(new Set(loose.map(c => 'c:' + c.id))) }
    : null;

  return { title: doc.title || 'Untitled notes', source: doc.source, date: doc.date, topics, ungrouped, summary: doc.summary };
}

// Graph for the concept map: topics are nodes; links between clips are lifted to their
// topics. Loose clips that take part in a link become nodes of their own.
export function buildMap(doc) {
  const nodes = new Map();
  const nodeFor = ref => {
    if (ref[0] === 'c') {
      const at = locate(doc, ref.slice(2));
      if (at?.group) ref = 'g:' + at.group;
    }
    if (!nodes.has(ref)) nodes.set(ref, { ref, label: refLabel(doc, ref, 40), topic: ref[0] === 'g' });
    return ref;
  };
  for (const col of ['left', 'right'])
    for (const it of doc.columns[col].items) if (it[0] === 'g') nodeFor(it);

  const edges = new Map();
  for (const l of doc.links) {
    const a = nodeFor(l.from), b = nodeFor(l.to);
    if (a === b) continue;
    const key = a + '>' + b;
    const e = edges.get(key) || { from: a, to: b, rels: [] };
    if (l.rel && !e.rels.includes(l.rel)) e.rels.push(l.rel);
    edges.set(key, e);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// ---------- plain renderings ----------

export function outlineHtml(o, esc) {
  const item = c => `<li>${esc(c.text)}${c.note ? ` <span class="o-note">— ${esc(c.note)}</span>` : ''}</li>`;
  const block = t => `
    <section class="o-topic"><h3>${esc(t.name)}</h3>
      ${t.sections.map(s => `<h4>${esc(s.name)}</h4><ul>${s.clips.map(item).join('')}</ul>`).join('')}
      ${t.links.length ? `<h4>Connections</h4><ul>${t.links.map(l =>
        `<li>${esc(l.self)} ${l.out ? '→' : '←'} ${esc(l.other)}${l.rel ? ` <span class="o-note">(${esc(l.rel)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    </section>`;
  return `
    ${o.topics.map(block).join('')}
    ${o.ungrouped ? block(o.ungrouped) : ''}`;
}

export function outlineMarkdown(o) {
  const L = [];
  L.push(`# ${o.title}`);
  const meta = [o.source, o.date].filter(Boolean).join(' · ');
  if (meta) L.push(`_${meta}_`);
  const item = c => `- ${c.text}${c.note ? ` — ${c.note}` : ''}`;
  const block = t => {
    L.push('', `## ${t.name}`);
    for (const s of t.sections) L.push('', `**${s.name}**`, ...s.clips.map(item));
    if (t.links.length) L.push('', '**Connections**', ...t.links.map(l => `- ${l.self} ${l.out ? '→' : '←'} ${l.other}${l.rel ? ` (${l.rel})` : ''}`));
  };
  o.topics.forEach(block);
  if (o.ungrouped) block(o.ungrouped);
  if (o.summary) L.push('', '## Summary', '', o.summary);
  return L.join('\n') + '\n';
}
