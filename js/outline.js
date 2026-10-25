// Turns the notebook into a structured outline. The outline view, Markdown, print, and
// LaTeX exports all read from this one model, so they always agree.
//
// Nothing here assigns tags or topics: it only arranges what the user already labelled.

import { locate, refLabel } from './state.js';

export const PROMPTS = [
  'Which terms can you not yet define in your own words?',
  'Can you state the main claim of each topic in one sentence?',
  'Which connections are you assuming but have not checked against the source?',
  'What would you ask the author or lecturer if you could?',
];

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
  const bottomTypes = new Set(types.filter(t => t.outline === 'bottom').map(t => t.id));

  const sections = clips => {
    const out = types.filter(t => !bottomTypes.has(t.id))
      .map(t => ({ type: t, clips: clips.filter(c => c.type === t.id) }));
    const other = clips.filter(c => !known.has(c.type));
    if (other.length) out.push({ type: { id: 'other', label: 'Other', plural: 'Other' }, clips: other });
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

  const topicName = c => { const at = locate(doc, c.id); return at?.group ? (doc.groups[at.group].name || 'Untitled topic') : ''; };
  const all = textOrder(doc).map(id => doc.clips[id]);
  const clarify = {
    flagged: all.filter(c => bottomTypes.has(c.type)).map(c => ({ ...c, topic: topicName(c) })),
    openQuestions: all.filter(c => c.type === 'question' && !c.note).map(c => ({ ...c, topic: topicName(c) })),
    undefinedTerms: all.filter(c => c.type === 'term' && !c.note).map(c => ({ ...c, topic: topicName(c) })),
    prompts: settings.prompts ? PROMPTS : [],
  };

  return { title: doc.title || 'Untitled notes', source: doc.source, date: doc.date, topics, ungrouped, clarify, summary: doc.summary };
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
  const item = c => `<li>${c.type === 'clause' ? `“${esc(c.text)}”` : esc(c.text)}${c.note ? ` <span class="o-note">— ${esc(c.note)}</span>` : ''}</li>`;
  const block = t => `
    <section class="o-topic"><h3>${esc(t.name)}</h3>
      ${t.sections.map(s => `<h4>${esc(s.type.plural)}</h4><ul>${s.clips.map(item).join('')}</ul>`).join('')}
      ${t.links.length ? `<h4>Connections</h4><ul>${t.links.map(l =>
        `<li>${esc(l.self)} ${l.out ? '→' : '←'} ${esc(l.other)}${l.rel ? ` <span class="o-note">(${esc(l.rel)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    </section>`;
  const c = o.clarify;
  const tagged = x => `${esc(x.text)}${x.note ? ` — ${esc(x.note)}` : ''}${x.topic ? ` <span class="o-note">(${esc(x.topic)})</span>` : ''}`;
  const list = (title, xs) => xs.length ? `<h4>${title}</h4><ul class="checks">${xs.map(x => `<li>${tagged(x)}</li>`).join('')}</ul>` : '';
  return `
    ${o.topics.map(block).join('')}
    ${o.ungrouped ? block(o.ungrouped) : ''}
    <section class="o-topic o-clarify"><h3>To clarify</h3>
      ${list('Flagged', c.flagged)}
      ${list('Open questions', c.openQuestions)}
      ${list('Terms without a definition', c.undefinedTerms)}
      ${c.prompts.length ? `<h4>Ask yourself</h4><ul class="checks">${c.prompts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

export function outlineMarkdown(o) {
  const L = [];
  L.push(`# ${o.title}`);
  const meta = [o.source, o.date].filter(Boolean).join(' · ');
  if (meta) L.push(`_${meta}_`);
  const item = c => `- ${c.type === 'clause' ? `“${c.text}”` : c.text}${c.note ? ` — ${c.note}` : ''}`;
  const block = t => {
    L.push('', `## ${t.name}`);
    for (const s of t.sections) L.push('', `**${s.type.plural}**`, ...s.clips.map(item));
    if (t.links.length) L.push('', '**Connections**', ...t.links.map(l => `- ${l.self} ${l.out ? '→' : '←'} ${l.other}${l.rel ? ` (${l.rel})` : ''}`));
  };
  o.topics.forEach(block);
  if (o.ungrouped) block(o.ungrouped);
  if (o.summary) L.push('', '## Summary', '', o.summary);
  const c = o.clarify;
  L.push('', '## To clarify');
  const tagged = x => `- [ ] ${x.text}${x.note ? ` — ${x.note}` : ''}${x.topic ? ` (${x.topic})` : ''}`;
  if (c.flagged.length) L.push('', '**Flagged**', ...c.flagged.map(tagged));
  if (c.openQuestions.length) L.push('', '**Open questions**', ...c.openQuestions.map(tagged));
  if (c.undefinedTerms.length) L.push('', '**Terms without a definition**', ...c.undefinedTerms.map(tagged));
  if (c.prompts.length) L.push('', '**Ask yourself**', ...c.prompts.map(p => `- [ ] ${p}`));
  return L.join('\n') + '\n';
}
