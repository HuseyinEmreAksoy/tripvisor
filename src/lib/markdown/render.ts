/**
 * renderMarkdown — linear-pass Markdown tokenizer (ADR-0008)
 *
 * Supported grammar (closed — no extensions without a new ADR):
 *   **bold**          → { kind: 'bold', text }
 *   *italic*          → { kind: 'italic', text }
 *   - at line start   → { kind: 'list-item-ul', children }
 *   1. at line start  → { kind: 'list-item-ol', children }
 *   [text](url)       → { kind: 'link', text, href } — protocol allow-list below
 *   anything else     → { kind: 'text', text }
 *
 * SAFETY: Link hrefs are validated against a protocol allow-list
 * (http://, https://, mailto:). Any other protocol — including javascript: —
 * is rejected and the entire `[text](url)` is emitted as a plain text node.
 * This is the sole XSS boundary; no dangerouslySetInnerHTML is used anywhere.
 *
 * The tokenizer is a character-by-character walker, never a single unbounded
 * regex, to avoid catastrophic backtracking on adversarial input.
 */

export type MarkdownNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'list-item-ul'; children: MarkdownNode[] }
  | { kind: 'list-item-ol'; children: MarkdownNode[] };

// SAFETY: Only these protocols are permitted in link hrefs. Anything else
// (especially javascript:, data:, vbscript:) falls through as literal text.
const ALLOWED_PROTOCOLS = ['https://', 'http://', 'mailto:'];

function isSafeHref(href: string): boolean {
  const lower = href.toLowerCase().trimStart();
  return ALLOWED_PROTOCOLS.some((p) => lower.startsWith(p));
}

/**
 * Tokenize inline content (bold, italic, links, plain text).
 * Operates on a single line's text (list prefixes have already been stripped).
 */
function tokenizeInline(line: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let i = 0;
  let textBuf = '';

  function flushText() {
    if (textBuf.length > 0) {
      nodes.push({ kind: 'text', text: textBuf });
      textBuf = '';
    }
  }

  while (i < line.length) {
    // ── Bold: **text** ────────────────────────────────────────────────────
    if (line[i] === '*' && line[i + 1] === '*') {
      const start = i + 2;
      const end = line.indexOf('**', start);
      if (end !== -1 && end > start) {
        flushText();
        nodes.push({ kind: 'bold', text: line.slice(start, end) });
        i = end + 2;
        continue;
      }
    }

    // ── Italic: *text* ────────────────────────────────────────────────────
    // Only match a single * that is not followed by another * (bold is above).
    if (line[i] === '*' && line[i + 1] !== '*') {
      const start = i + 1;
      // Find closing *, but skip if it would be ** (the bold marker).
      let end = -1;
      for (let j = start; j < line.length; j++) {
        if (line[j] === '*' && line[j + 1] !== '*') {
          end = j;
          break;
        }
      }
      if (end !== -1 && end > start) {
        flushText();
        nodes.push({ kind: 'italic', text: line.slice(start, end) });
        i = end + 1;
        continue;
      }
    }

    // ── Link: [text](url) ─────────────────────────────────────────────────
    if (line[i] === '[') {
      const textEnd = line.indexOf(']', i + 1);
      if (textEnd !== -1 && line[textEnd + 1] === '(') {
        const hrefStart = textEnd + 2;
        const hrefEnd = line.indexOf(')', hrefStart);
        if (hrefEnd !== -1) {
          const linkText = line.slice(i + 1, textEnd);
          const href = line.slice(hrefStart, hrefEnd);
          // SAFETY: reject any href that isn't http/https/mailto.
          if (isSafeHref(href)) {
            flushText();
            nodes.push({ kind: 'link', text: linkText, href });
            i = hrefEnd + 1;
            continue;
          } else {
            // Render the entire construct as literal text.
            textBuf += line.slice(i, hrefEnd + 1);
            i = hrefEnd + 1;
            continue;
          }
        }
      }
    }

    // ── Plain character ───────────────────────────────────────────────────
    textBuf += line[i];
    i++;
  }

  flushText();
  return nodes;
}

/** Pattern: one or more digits followed by `. ` at the start of the string. */
const OL_RE = /^\d+\.\s/;

/**
 * Parse the input string into a flat array of MarkdownNode values.
 * Each line is processed independently; line breaks between non-list
 * paragraphs are preserved as `{ kind: 'text', text: '\n' }` nodes so the
 * renderer can choose how to handle them.
 */
export function renderMarkdown(input: string): MarkdownNode[] {
  if (!input) return [];

  const lines = input.split('\n');
  const nodes: MarkdownNode[] = [];

  for (let li = 0; li < lines.length; li++) {
    // lines comes from String.prototype.split which always returns string[],
    // but strict noUncheckedIndexedAccess types array access as T | undefined.
    const line: string = lines[li] ?? '';

    // ── Unordered list: line starting with "- " ───────────────────────────
    if (line.startsWith('- ')) {
      const content = line.slice(2);
      nodes.push({ kind: 'list-item-ul', children: tokenizeInline(content) });
      continue;
    }

    // ── Ordered list: line starting with digits + ". " ───────────────────
    const olMatch = OL_RE.exec(line);
    if (olMatch) {
      const content = line.slice(olMatch[0].length);
      nodes.push({ kind: 'list-item-ol', children: tokenizeInline(content) });
      continue;
    }

    // ── Normal paragraph line ─────────────────────────────────────────────
    const inlineNodes = tokenizeInline(line);
    nodes.push(...inlineNodes);

    // Preserve the line break between lines (but not after the last line).
    if (li < lines.length - 1) {
      nodes.push({ kind: 'text', text: '\n' });
    }
  }

  return nodes;
}
