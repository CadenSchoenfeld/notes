// LaTeX generation. The notes body is typeset Cornell-style: each paragraph carries its
// topics/cues in the left or right margin, matching where you dragged its highlights.

import { buildOutline, buildMap } from './outline.js';
import { locate } from './state.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\u0000')
    .replace(/([{}$&#_%])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/\u00a0/g, '~')
    .replace(/[\u200b\ufeff]/g, '');
}

const key = id => String(id).toLowerCase().replace(/[^a-z0-9]/g, '') || 'x';
const hex = c => (/^#?([0-9a-f]{6})$/i.exec(c)?.[1] || '999999').toUpperCase();

// Darken a highlight colour enough to read as text on white.
function ink(c) {
  const h = hex(c);
  const ch = i => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.55).toString(16).padStart(2, '0');
  return (ch(0) + ch(2) + ch(4)).toUpperCase();
}

// ---------- notes body ----------

function notesBody(doc, settings) {
  const root = new DOMParser().parseFromString(`<body>${doc.html}</body>`, 'text/html').body;
  let cues = { left: [], right: [] };

  const cueFor = cid => {
    const at = locate(doc, cid);
    if (!at) return null;
    const c = doc.clips[cid];
    const text = at.group
      ? `\\textbf{${esc(doc.groups[at.group].name || 'Untitled topic')}}`
      : (c?.note ? esc(c.note) : esc((c?.text || '').slice(0, 60)));
    return { side: at.col, text };
  };

  const inline = node => {
    if (node.nodeType === 3) return esc(node.nodeValue.replace(/\s+/g, ' '));
    if (node.nodeType !== 1) return '';
    const kids = () => [...node.childNodes].map(inline).join('');
    switch (node.tagName) {
      case 'B': case 'STRONG': return `\\textbf{${kids()}}`;
      case 'I': case 'EM': return `\\emph{${kids()}}`;
      case 'U': return `\\uline{${kids()}}`;
      case 'BR': return '\\hfill\\break ';
      case 'MARK': {
        const cid = node.dataset.clip;
        const cue = cid && cueFor(cid);
        if (cue && !cues[cue.side].includes(cue.text)) cues[cue.side].push(cue.text);
        const t = key(node.dataset.type);
        return `\\nhl{${t}}{${kids()}}`;
      }
      default: return kids();
    }
  };

  const takeCues = () => {
    const out = (cues.left.length ? `\\leftcue{${cues.left.join('\\\\[2pt]')}}` : '')
              + (cues.right.length ? `\\rightcue{${cues.right.join('\\\\[2pt]')}}` : '');
    cues = { left: [], right: [] };
    return out;
  };

  const isBlock = n => n.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE)$/.test(n.tagName);

  const blocks = el => {
    let out = '', buf = '';
    const flush = () => {
      if (buf.trim()) out += takeCues() + buf.trim() + '\n\n';
      else takeCues();
      buf = '';
    };
    for (const n of el.childNodes) {
      if (!isBlock(n)) { buf += inline(n); continue; }
      flush();
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const text = [...n.childNodes].map(inline).join('').trim();
        const cmd = tag === 'H1' ? 'section*' : tag === 'H2' ? 'subsection*' : 'subsubsection*';
        if (text) out += `\\${cmd}{${text}}\n${takeCues()}\n`;
      } else if (tag === 'UL' || tag === 'OL') {
        const items = [...n.children].filter(c => c.tagName === 'LI').map(li => blocks(li).trim()).filter(Boolean);
        const env = tag === 'UL' ? 'itemize' : 'enumerate';
        if (items.length) out += `\\begin{${env}}\n${items.map(i => `\\item{} ${i}`).join('\n')}\n\\end{${env}}\n\n`;
      } else if (tag === 'BLOCKQUOTE') {
        const inner = blocks(n).trim();
        if (inner) out += `\\begin{quote}\n${inner}\n\\end{quote}\n\n`;
      } else {
        out += blocks(n);
      }
    }
    flush();
    return out;
  };

  return blocks(root);
}

// ---------- outline and map ----------

function outlineTex(o) {
  const item = c => `\\item{} ${esc(c.text)}${c.note ? ` --- ${esc(c.note)}` : ''}`;
  const block = t => {
    let s = `\\subsection*{${esc(t.name)}}\n`;
    for (const sec of t.sections) {
      s += `\\paragraph{${esc(sec.name)}}\n\\begin{itemize}\n${sec.clips.map(item).join('\n')}\n\\end{itemize}\n`;
    }
    if (t.links.length) {
      s += `\\paragraph{Connections}\n\\begin{itemize}\n${t.links.map(l =>
        `\\item{} ${esc(l.self)} ${l.out ? '$\\rightarrow$' : '$\\leftarrow$'} ${esc(l.other)}${l.rel ? ` \\emph{(${esc(l.rel)})}` : ''}`).join('\n')}\n\\end{itemize}\n`;
    }
    return s;
  };
  const parts = [...o.topics, ...(o.ungrouped ? [o.ungrouped] : [])].filter(t => t.clips.length || t.links.length);
  if (!parts.length) return '';
  return `\\section*{Outline}\n${parts.map(block).join('\n')}\n`;
}

function mapTex(doc) {
  const { nodes, edges } = buildMap(doc);
  if (nodes.length < 2) return '';
  const n = nodes.length;
  const r = Math.max(3.2, n * 0.75);
  const id = i => `n${i}`;
  const idx = new Map(nodes.map((x, i) => [x.ref, i]));
  const placed = nodes.map((x, i) => {
    const a = 90 - (360 / n) * i;
    const style = x.topic ? 'topic' : 'clip';
    return `  \\node[${style}] (${id(i)}) at (${a.toFixed(1)}:${r.toFixed(2)}cm) {${esc(x.label)}};`;
  }).join('\n');
  const lines = edges.map(e => {
    const lab = e.rels.length ? ` node[rel] {${esc(e.rels.join('; ').slice(0, 50))}}` : '';
    return `  \\draw[edge] (${id(idx.get(e.from))}) to[bend left=8]${lab} (${id(idx.get(e.to))});`;
  }).join('\n');
  return `\\section*{Concept map}
\\begin{center}
\\resizebox{\\ifdim\\width>\\linewidth\\linewidth\\else\\width\\fi}{!}{%
\\begin{tikzpicture}[
  topic/.style={draw, rounded corners, fill=black!4, align=center, text width=3.2cm, font=\\small\\bfseries, inner sep=5pt},
  clip/.style={draw, dashed, rounded corners, align=center, text width=2.8cm, font=\\footnotesize, inner sep=4pt},
  edge/.style={-{Stealth[length=2.2mm]}, thick, black!60},
  rel/.style={midway, fill=white, font=\\scriptsize\\itshape, inner sep=1.5pt, align=center}]
${placed}
${lines}
\\end{tikzpicture}}
\\end{center}
`;
}

function connectionsTex(doc) {
  if (!doc.links.length) return '';
  const name = r => esc((r[0] === 'g' ? doc.groups[r.slice(2)]?.name : doc.clips[r.slice(2)]?.text) || '');
  const rows = doc.links.map(l => `\\item{} ${name(l.from)} $\\rightarrow$ ${name(l.to)}${l.rel ? ` \\emph{(${esc(l.rel)})}` : ''}`);
  return `\\section*{Connections}\n\\begin{itemize}\n${rows.join('\n')}\n\\end{itemize}\n`;
}

// ---------- document ----------

export function buildLatex(doc, settings) {
  const opt = settings.latex;
  const o = buildOutline(doc, settings);
  const usesLeft = Object.keys(doc.clips).some(id => locate(doc, id)?.col === 'left');
  const usesRight = Object.keys(doc.clips).some(id => locate(doc, id)?.col === 'right');
  const wide = '2.15in', narrow = '1in';
  const notesGeom = `left=${usesLeft ? wide : narrow},right=${usesRight ? wide : narrow},top=1in,bottom=1in,marginparwidth=1.55in,marginparsep=0.22in`;

  const palette = new Map(settings.types.map(t => [key(t.id), t.color]));
  for (const c of Object.values(doc.clips)) if (!palette.has(key(c.type))) palette.set(key(c.type), '#999999');
  const colors = [...palette].map(([k, c]) => `\\definecolor{ink${k}}{HTML}{${ink(c)}}`).join('\n');
  const meta = [esc(doc.source), esc(doc.date)].filter(Boolean).join(' \\hfill ');

  const body = opt.notes ? notesBody(doc, settings) : '';
  const after = [
    opt.outline ? outlineTex(o) : '',
    opt.map ? mapTex(doc) : '',
    opt.connections ? connectionsTex(doc) : '',
  ].filter(Boolean).join('\n');

  return `% Generated by Margins. Compile with LuaLaTeX, XeLaTeX or pdfLaTeX.
\\documentclass[11pt]{article}
\\usepackage{iftex}
\\ifPDFTeX
  \\usepackage[utf8]{inputenc}
  \\usepackage[T1]{fontenc}
  \\usepackage{lmodern}
\\else
  \\usepackage{fontspec}
  \\IfFontExistsTF{Libertinus Serif}{\\setmainfont{Libertinus Serif}}{}
\\fi
\\usepackage[${opt.paper},${notesGeom}]{geometry}
\\usepackage{xcolor}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage{amssymb}
\\usepackage{marginnote}
\\usepackage[normalem]{ulem}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta}
\\usepackage[hidelinks]{hyperref}
\\setlist{nosep, leftmargin=1.4em}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.6em}
\\renewcommand{\\marginfont}{\\footnotesize\\sffamily}
${colors}
\\newcommand{\\nhl}[2]{{\\color{ink#1}#2}}
\\newcommand{\\leftcue}[1]{{\\reversemarginpar\\marginnote{\\raggedleft #1}}}
\\newcommand{\\rightcue}[1]{{\\normalmarginpar\\marginnote{\\raggedright #1}}}

\\begin{document}
{\\LARGE\\bfseries ${esc(o.title)}\\par}
\\vspace{0.3em}
{\\small ${meta}\\par}
\\vspace{0.2em}\\hrule\\vspace{0.8em}

${body}
${opt.summary && doc.summary.trim() ? `\\vspace{1em}\\hrule\n\\section*{Summary}\n${esc(doc.summary.trim()).replace(/\n{2,}/g, '\n\n')}\n` : ''}
${after ? `\\newgeometry{margin=1in}\n${opt.notes ? '\\newpage\n' : ''}${after}` : ''}
\\end{document}
`;
}

// Post the .tex to a compile service in a new tab. Both services accept plain form posts,
// so this works from a static page with no server of our own.
export function compileTexLiveNet(tex, engine) {
  postForm('https://texlive.net/cgi-bin/latexcgi', {
    'filecontents[]': tex, 'filename[]': 'document.tex', engine, return: 'pdf',
  }, true);
}

export function openInOverleaf(tex, engine, name) {
  postForm('https://www.overleaf.com/docs', { snip: tex, snip_name: name, engine: engine === 'pdflatex' ? 'pdflatex' : engine });
}

function postForm(action, fields, multipart = false) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = action;
  f.target = '_blank';
  if (multipart) f.enctype = 'multipart/form-data';
  for (const [k, v] of Object.entries(fields)) {
    const t = document.createElement('textarea');
    t.name = k; t.value = v;
    f.append(t);
  }
  f.style.display = 'none';
  document.body.append(f);
  f.submit();
  f.remove();
}
