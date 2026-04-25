/**
 * Unit tests for src/lib/markdown/render.ts
 *
 * Covers the linear-pass tokenizer for:
 *   - Empty / null input
 *   - Bold (**text**)
 *   - Italic (*text*)
 *   - Links [text](url) — safe and unsafe protocols
 *   - Unordered list items (- ...)
 *   - Ordered list items (1. ...)
 *   - Multi-line input with newline preservation
 *   - Nested inline markup inside list items
 *   - Adversarial / edge cases (unclosed markers, empty markers)
 *
 * Per ADR-0008: the tokenizer is a closed grammar. Tests assert on the
 * MarkdownNode array shape, not on rendered output, so renderer changes
 * don't break tokenizer tests.
 */

import { renderMarkdown, type MarkdownNode } from '../markdown/render';

// Helper: assert a single text node
function textNode(text: string): MarkdownNode {
  return { kind: 'text', text };
}

describe('renderMarkdown', () => {
  // ─── Empty / null ─────────────────────────────────────────────────────────

  it('returns empty array for empty string', () => {
    expect(renderMarkdown('')).toEqual([]);
  });

  it('returns empty array for null/undefined (falsy)', () => {
    // The function signature takes string; we coerce to test the guard.
    expect(renderMarkdown(null as unknown as string)).toEqual([]);
    expect(renderMarkdown(undefined as unknown as string)).toEqual([]);
  });

  // ─── Plain text ───────────────────────────────────────────────────────────

  it('returns a single text node for a plain string', () => {
    expect(renderMarkdown('hello world')).toEqual([textNode('hello world')]);
  });

  it('preserves newlines between lines as text nodes', () => {
    const nodes = renderMarkdown('line one\nline two');
    expect(nodes).toEqual([
      textNode('line one'),
      textNode('\n'),
      textNode('line two'),
    ]);
  });

  it('does not add a trailing newline node', () => {
    const nodes = renderMarkdown('single line');
    const newlines = nodes.filter((n) => n.kind === 'text' && (n as { kind: 'text'; text: string }).text === '\n');
    expect(newlines).toHaveLength(0);
  });

  // ─── Bold ─────────────────────────────────────────────────────────────────

  it('tokenizes **bold** text', () => {
    const nodes = renderMarkdown('**hello**');
    expect(nodes).toEqual([{ kind: 'bold', text: 'hello' }]);
  });

  it('tokenizes bold inline with surrounding text', () => {
    const nodes = renderMarkdown('Visit **Lisbon** soon');
    expect(nodes).toEqual([
      textNode('Visit '),
      { kind: 'bold', text: 'Lisbon' },
      textNode(' soon'),
    ]);
  });

  it('does not treat unclosed ** as bold — emits as plain text', () => {
    const nodes = renderMarkdown('**unclosed');
    expect(nodes[0]).toEqual(textNode('**unclosed'));
  });

  it('does not treat empty **  ** as bold', () => {
    // end > start required; ** ** has start=2, end=2, not end > start
    const nodes = renderMarkdown('**** ');
    // Should not produce a bold node with empty text
    const boldNodes = nodes.filter((n) => n.kind === 'bold');
    expect(boldNodes).toHaveLength(0);
  });

  // ─── Italic ───────────────────────────────────────────────────────────────

  it('tokenizes *italic* text', () => {
    const nodes = renderMarkdown('*hello*');
    expect(nodes).toEqual([{ kind: 'italic', text: 'hello' }]);
  });

  it('tokenizes italic inline with surrounding text', () => {
    const nodes = renderMarkdown('say *yes* please');
    expect(nodes).toEqual([
      textNode('say '),
      { kind: 'italic', text: 'yes' },
      textNode(' please'),
    ]);
  });

  it('does not tokenize unclosed * as italic', () => {
    const nodes = renderMarkdown('*unclosed');
    expect(nodes[0]).toEqual(textNode('*unclosed'));
  });

  // ─── Links ────────────────────────────────────────────────────────────────

  it('tokenizes a safe https link', () => {
    const nodes = renderMarkdown('[Google](https://google.com)');
    expect(nodes).toEqual([{ kind: 'link', text: 'Google', href: 'https://google.com' }]);
  });

  it('tokenizes a safe http link', () => {
    const nodes = renderMarkdown('[Site](http://example.com)');
    expect(nodes).toEqual([{ kind: 'link', text: 'Site', href: 'http://example.com' }]);
  });

  it('tokenizes a safe mailto link', () => {
    const nodes = renderMarkdown('[Email](mailto:hi@example.com)');
    expect(nodes).toEqual([{ kind: 'link', text: 'Email', href: 'mailto:hi@example.com' }]);
  });

  it('SAFETY: rejects javascript: protocol — emits as plain text', () => {
    const raw = '[Click](javascript:alert(1))';
    const nodes = renderMarkdown(raw);
    const linkNodes = nodes.filter((n) => n.kind === 'link');
    expect(linkNodes).toHaveLength(0);
    // The whole construct should appear as a plain text node
    const texts = nodes.filter((n) => n.kind === 'text').map((n) => (n as { kind: 'text'; text: string }).text).join('');
    expect(texts).toContain('[Click](javascript:alert(1))');
  });

  it('SAFETY: rejects data: protocol', () => {
    const nodes = renderMarkdown('[X](data:text/html,<b>hi</b>)');
    const linkNodes = nodes.filter((n) => n.kind === 'link');
    expect(linkNodes).toHaveLength(0);
  });

  it('SAFETY: rejects javascript: with leading whitespace (trimStart)', () => {
    const nodes = renderMarkdown('[Evil]( javascript:alert(1))');
    const linkNodes = nodes.filter((n) => n.kind === 'link');
    expect(linkNodes).toHaveLength(0);
  });

  it('SAFETY: rejects JAVASCRIPT: in upper case', () => {
    const nodes = renderMarkdown('[Evil](JAVASCRIPT:void(0))');
    const linkNodes = nodes.filter((n) => n.kind === 'link');
    expect(linkNodes).toHaveLength(0);
  });

  // ─── Unordered lists ──────────────────────────────────────────────────────

  it('tokenizes an unordered list item', () => {
    const nodes = renderMarkdown('- Visit the castle');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe('list-item-ul');
    const item = nodes[0] as { kind: 'list-item-ul'; children: MarkdownNode[] };
    expect(item.children).toEqual([textNode('Visit the castle')]);
  });

  it('tokenizes inline markup inside a list item', () => {
    const nodes = renderMarkdown('- Visit **Lisbon**');
    const item = nodes[0] as { kind: 'list-item-ul'; children: MarkdownNode[] };
    expect(item.children).toEqual([
      textNode('Visit '),
      { kind: 'bold', text: 'Lisbon' },
    ]);
  });

  it('treats "- " without content as an empty list item', () => {
    const nodes = renderMarkdown('- ');
    expect(nodes[0]!.kind).toBe('list-item-ul');
    const item = nodes[0] as { kind: 'list-item-ul'; children: MarkdownNode[] };
    expect(item.children).toEqual([]);
  });

  it('does not treat "-" without space as a list item', () => {
    const nodes = renderMarkdown('-not a list');
    const listNodes = nodes.filter((n) => n.kind === 'list-item-ul');
    expect(listNodes).toHaveLength(0);
  });

  // ─── Ordered lists ────────────────────────────────────────────────────────

  it('tokenizes an ordered list item (1. prefix)', () => {
    const nodes = renderMarkdown('1. First stop');
    expect(nodes[0]!.kind).toBe('list-item-ol');
    const item = nodes[0] as { kind: 'list-item-ol'; children: MarkdownNode[] };
    expect(item.children).toEqual([textNode('First stop')]);
  });

  it('tokenizes ordered list items with multi-digit numbers', () => {
    const nodes = renderMarkdown('12. Twelfth stop');
    expect(nodes[0]!.kind).toBe('list-item-ol');
  });

  it('does not treat "1.no-space" as an ordered list item', () => {
    const nodes = renderMarkdown('1.no space');
    const olNodes = nodes.filter((n) => n.kind === 'list-item-ol');
    expect(olNodes).toHaveLength(0);
  });

  // ─── Multi-line / mixed ───────────────────────────────────────────────────

  it('parses a multi-line mixed document', () => {
    // List items use `continue` so they do NOT get a trailing \n node —
    // only normal paragraph lines inject a \n separator.
    const input = '**Day 1**\n- Museum\n- Restaurant\n1. Hotel check-in';
    const nodes = renderMarkdown(input);

    // Line 1: bold "Day 1" (paragraph line) + trailing \n
    expect(nodes[0]).toEqual({ kind: 'bold', text: 'Day 1' });
    expect(nodes[1]).toEqual(textNode('\n'));
    // Line 2: ul item "Museum" — NO trailing \n (continue in list branch)
    expect(nodes[2]!.kind).toBe('list-item-ul');
    // Line 3: ul item "Restaurant" — NO trailing \n
    expect(nodes[3]!.kind).toBe('list-item-ul');
    // Line 4: ol item "Hotel check-in" — last line, no trailing \n
    expect(nodes[4]!.kind).toBe('list-item-ol');
    expect(nodes).toHaveLength(5);
  });
});
