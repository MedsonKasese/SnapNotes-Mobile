import { parseDocument } from 'htmlparser2';

export type RichRun = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type RichLine = { runs: RichRun[]; bullet?: string };

interface HtmlNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
}
interface TextSegment { node: HtmlNode; text: string; offset: number }
interface InternalLine { rich: RichLine; segments: TextSegment[]; explicit: boolean; hasContent: boolean }

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'div', 'p', 'br', 'ul', 'ol', 'li', 'a']);
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript']);
const MAX_HTML_DEPTH = 100;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Accept only absolute, whitespace-free web and mail links. */
export function normalizeNoteLink(url: string): string | null {
  if (typeof url !== 'string' || !url || /[\s\u0000-\u001f\u007f]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!parsed.hostname || parsed.username || parsed.password) return null;
      return parsed.href;
    }
    if (parsed.protocol === 'mailto:' && parsed.pathname && !parsed.pathname.includes(' ')) return parsed.href;
  } catch { /* malformed or relative URL */ }
  return null;
}

function parsedNodes(html: string): HtmlNode[] {
  return (parseDocument(html, { decodeEntities: true }).children as unknown as HtmlNode[]);
}

function flattenedText(node: HtmlNode): string {
  const chunks: string[] = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.type === 'text') chunks.push(current.data ?? '');
    else if (!DROP_CONTENT.has((current.name ?? '').toLowerCase())) {
      const children = current.children ?? [];
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
  }
  return chunks.map(escapeText).join('');
}

function serializeNode(node: HtmlNode, depth = 0): string {
  if (node.type === 'text') return escapeText(node.data ?? '');
  if (depth >= MAX_HTML_DEPTH) return flattenedText(node);
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
    return (node.children ?? []).map(child => serializeNode(child, depth + 1)).join('');
  }
  const tag = (node.name ?? '').toLowerCase();
  if (DROP_CONTENT.has(tag)) return '';
  const children = (node.children ?? []).map(child => serializeNode(child, depth + 1)).join('');
  if (!ALLOWED.has(tag)) return children;
  if (tag === 'br') return '<br>';
  const href = tag === 'a' ? normalizeNoteLink(node.attribs?.href ?? '') : null;
  const attrs = href ? ` href="${escapeAttribute(href)}"` : '';
  return `<${tag}${attrs}>${children}</${tag}>`;
}

/** Sanitize an editor-produced HTML fragment to the small supported note vocabulary. */
export function sanitizeNoteHtml(html: string): string {
  if (typeof html !== 'string') return '';
  return parsedNodes(html).map(node => serializeNode(node)).join('');
}

function newLine(): InternalLine {
  return { rich: { runs: [] }, segments: [], explicit: false, hasContent: false };
}
function appendRun(line: InternalLine, text: string, bold: boolean, italic: boolean, href: string | undefined, node: HtmlNode, offset = 0): void {
  if (!text) return;
  const prev = line.rich.runs[line.rich.runs.length - 1];
  if (prev && Boolean(prev.bold) === bold && Boolean(prev.italic) === italic && prev.href === href) prev.text += text;
  else line.rich.runs.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(href ? { href } : {}) });
  const prior = line.segments[line.segments.length - 1];
  if (prior?.node === node && prior.offset + prior.text.length === offset) prior.text += text;
  else line.segments.push({ node, text, offset });
  line.hasContent = line.hasContent || text.length > 0;
}

function layoutNodes(nodes: HtmlNode[]): InternalLine[] {
  const lines: InternalLine[] = [newLine()];
  let pendingBlock = false;
  const current = () => lines[lines.length - 1];
  const breakLine = () => { lines.push(newLine()); };
  const consumePending = () => {
    if (!pendingBlock) return;
    if (current().hasContent || current().explicit) breakLine();
    pendingBlock = false;
  };
  const visit = (node: HtmlNode, bold = false, italic = false, href?: string, listBullet?: string): void => {
    if (node.type === 'text') {
      consumePending();
      const data = node.data ?? '';
      let offset = 0;
      for (const match of data.matchAll(/\r\n?|\n/g)) {
        appendRun(current(), data.slice(offset, match.index), bold, italic, href, node, offset);
        breakLine();
        current().explicit = true;
        offset = match.index + match[0].length;
      }
      appendRun(current(), data.slice(offset), bold, italic, href, node, offset);
      return;
    }
    const tag = node.name?.toLowerCase() ?? '';
    if (DROP_CONTENT.has(tag)) return;
    if (tag === 'br') {
      if (current().hasContent || current().explicit) breakLine();
      else current().explicit = true;
      return;
    }
    const block = tag === 'div' || tag === 'p' || tag === 'li';
    if (block) {
      consumePending();
      if (current().hasContent) breakLine();
    }
    const nextBold = bold || tag === 'b' || tag === 'strong';
    const nextItalic = italic || tag === 'i' || tag === 'em';
    const nextHref = tag === 'a' ? normalizeNoteLink(node.attribs?.href ?? '') ?? undefined : href;
    if (tag === 'li') {
      const bullet = listBullet ?? '• ';
      if (!current().hasContent && !current().rich.bullet) current().rich.bullet = bullet;
    }
    let childBullet = listBullet;
    if (tag === 'ul') childBullet = '• ';
    if (tag === 'ol') {
      let number = 1;
      (node.children ?? []).forEach(child => {
        if (child.name?.toLowerCase() === 'li') visit(child, nextBold, nextItalic, nextHref, `${number++}. `);
        else visit(child, nextBold, nextItalic, nextHref, childBullet);
      });
    } else {
      (node.children ?? []).forEach(child => visit(child, nextBold, nextItalic, nextHref, childBullet));
    }
    if (block) {
      if (!current().hasContent) current().explicit = true;
      pendingBlock = true;
    }
  };
  for (const node of nodes) visit(node);
  // Block semantics create no artificial final newline; explicit blank block lines survive.
  while (lines.length > 1 && !current().hasContent && !current().explicit) lines.pop();
  return lines;
}

function layout(html: string): InternalLine[] {
  return layoutNodes(parsedNodes(html));
}

function trimVisibleLines(lines: InternalLine[]): InternalLine[] {
  const lineText = (line: InternalLine) => line.rich.runs.map(run => run.text).join('');
  while (lines.length > 1 && !lineText(lines[0]).trim()) lines.shift();
  while (lines.length > 1 && !lineText(lines[lines.length - 1]).trim()) lines.pop();
  return lines;
}

function visibleLayout(html: string): InternalLine[] {
  return trimVisibleLines(layout(html));
}

/** Flatten a sanitized HTML note to visible text; list bullets are display-only. */
export function noteHtmlToText(html: string): string {
  return visibleLayout(sanitizeNoteHtml(html)).map(line => line.rich.runs.map(run => run.text).join('')).join('\n');
}

export function getNoteHtmlLines(html: string): RichLine[] {
  return visibleLayout(sanitizeNoteHtml(html)).map(line => line.rich);
}

export function plainTextToHtml(text: string): string {
  return text.replace(/\r/g, '').split('\n').map(line => `<div>${line ? escapeText(line) : '<br>'}</div>`).join('');
}

/** Update only the first checkbox marker on a flattened rich-text line. */
export function updateChecklistHtml(html: string, lineIndex: number, checked: boolean): string {
  if (!Number.isInteger(lineIndex) || lineIndex < 0) return sanitizeNoteHtml(html);
  const safe = sanitizeNoteHtml(html);
  const nodes = parsedNodes(safe);
  const lines = trimVisibleLines(layoutNodes(nodes));
  const line = lines[lineIndex];
  if (!line) return safe;
  const text = line.rich.runs.map(run => run.text).join('');
  const match = /^\s*[☐☑](?=\s|$)/.exec(text);
  if (!match) return safe;
  const markerIndex = match[0].length - 1;
  let cursor = 0;
  for (const segment of line.segments) {
    const end = cursor + segment.text.length;
    if (markerIndex >= cursor && markerIndex < end) {
      const data = segment.node.data ?? '';
      const localIndex = segment.offset + markerIndex - cursor;
      segment.node.data = data.slice(0, localIndex) + (checked ? '☑' : '☐') + data.slice(localIndex + 1);
      break;
    }
    cursor = end;
  }
  return nodes.map(node => serializeNode(node)).join('');
}
