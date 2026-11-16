// A small markdown reader for the two documents make.fun's API hands over as text: a
// bounty's description and its rules. It escapes first and then applies only the handful of
// constructs those documents use — headings, lists, fenced code, blockquotes, rules, tables,
// bold, italic, inline code and links — so nothing in an answer can become markup or a link
// to an origin other than one it names in plain https.

import { esc, SITE } from './util.js';

const SAFE_STRING = /^(https?:\/\/|\/)/;

function link(text, url) {
  // The text is escaped before it reaches here, so the URL is HTML-safe already.
  const target = SAFE_STRING.test(url) ? (url.startsWith('/') ? SITE + url : url) : null;
  if (!target || /[<>"]/.test(url)) return text;
  const outbound = !target.startsWith(SITE);
  return `<a href="${target}"${outbound ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
}

/**
 * Escaped text in, HTML out. Links and code spans are held aside first so that the automatic
 * link of a bare URL can never reach into markup this function just made: a held piece comes
 * back only after the URL pass has run over the text that was actually written by the author.
 */
function inline(text) {
  const held = [];
  const keep = (html) => {
    held.push(html);
    return '\u0000' + (held.length - 1) + '\u0000';
  };
  return text
    .replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => keep(link(label, url)))
    .replace(
      /https?:\/\/(?:(?!&(?:lt|gt|quot|amp|#39);)[^\s<>"])+/g,
      (url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`),
    )
    .replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)] ?? '');
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

/** Markdown to HTML. Every line is escaped before it is read, so no text of an answer
 *  can become markup of ours; the only tags in the output are the ones written here. */
export function renderMarkdown(source, { maxBlocks = 900 } = {}) {
  const lines = String(source ?? '').split(/\r?\n/);
  const out = [];
  let block = null; // { kind, items }
  let fenced = false;
  let fence = [];

  const close = () => {
    if (!block) return;
    if (block.kind === 'ul') out.push(`<ul>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    else if (block.kind === 'ol') out.push(`<ol>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`);
    else if (block.kind === 'quote') out.push(`<blockquote>${block.items.map((i) => inline(i)).join('<br>')}</blockquote>`);
    else if (block.kind === 'p') out.push(`<p>${inline(block.items.join(' '))}</p>`);
    else if (block.kind === 'table') {
      const [head, ...rows] = block.items;
      out.push(
        `<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
    }
    block = null;
  };

  for (const raw of lines) {
    if (out.length > maxBlocks) break;
    if (/^\s*```/.test(raw)) {
      if (!fenced) {
        close();
        fenced = true;
        fence = [];
      } else {
        out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
        fenced = false;
      }
      continue;
    }
    if (fenced) {
      fence.push(raw);
      continue;
    }
    // From here on the line is escaped text: nothing an answer says can become our markup.
    const line = esc(raw);
    if (!line.trim()) {
      close();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      close();
      const level = Math.min(6, heading[1].length + 2); // an H1 in a document is an H3 on the page
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      close();
      out.push('<hr>');
      continue;
    }
    if (isTableRow(line)) {
      if (isTableRule(line)) continue;
      if (block?.kind !== 'table') {
        close();
        block = { kind: 'table', items: [] };
      }
      block.items.push(cells(line));
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const kind = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (block?.kind !== kind) {
        close();
        block = { kind, items: [] };
      }
      block.items.push(bullet[1]);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      if (block?.kind !== 'quote') {
        close();
        block = { kind: 'quote', items: [] };
      }
      block.items.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }
    if (block?.kind !== 'p') {
      close();
      block = { kind: 'p', items: [] };
    }
    block.items.push(line.trim());
  }
  if (fenced) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  close();
  return out.join('\n');
}
