/**
 * MarkdownText
 *
 * Walks a MarkdownNode[] produced by renderMarkdown() and renders React Native
 * primitives (Text / View). No dangerouslySetInnerHTML. No HTML pass-through.
 *
 * Usage:
 *   import { MarkdownText } from '@/components';
 *   <MarkdownText source={place.notes} />
 *
 * Platform notes:
 *   - Links use Linking.openURL on native and on web (RN Web maps it to
 *     window.open). accessibilityRole="link" gives browsers a real <a>-like
 *     element for keyboard navigation and Ctrl-click. A true <a href> with
 *     Ctrl-click / middle-click support would require a .web.tsx split; that
 *     trade-off is documented in ADR-0008 as acceptable for MVP.
 *   - Bold / italic use fontWeight / fontStyle on Text — supported by RN Web.
 *   - List items use View rows with bullet / number prefix — flex-based, works
 *     identically on iOS, Android, and Web.
 */
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { renderMarkdown, type MarkdownNode } from '@/lib/markdown/render';
import { useTheme } from '@/theme';

export interface MarkdownTextProps {
  /** Raw Markdown string. Null / undefined / empty renders nothing. */
  source: string | null | undefined;
  /** Optional override for the base text style (color, fontSize, etc.). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
}

export function MarkdownText({ source, style }: MarkdownTextProps) {
  const t = useTheme();

  const nodes = useMemo(
    () => (source ? renderMarkdown(source) : []),
    [source],
  );

  if (!nodes.length) return null;

  // Collect nodes into paragraphs. A '\n' text node signals a line break;
  // we flush the current inline run into a <Text> block and start a new one.
  // List items are always standalone <View> rows.
  const blocks = groupIntoBlocks(nodes);

  return (
    <View style={styles.container}>
      {blocks.map((block, bi) => {
        if (block.type === 'list-ul') {
          return (
            <View key={bi} style={styles.listItem} accessibilityRole="text">
              <Text
                style={[t.typography.body, { color: t.colors.text }, style, styles.bullet]}
                selectable
              >
                {'•'}
              </Text>
              <View style={styles.listContent}>
                {renderInlineNodes(block.children, t, style, `${bi}`)}
              </View>
            </View>
          );
        }
        if (block.type === 'list-ol') {
          return (
            <View key={bi} style={styles.listItem} accessibilityRole="text">
              <Text
                style={[t.typography.body, { color: t.colors.text }, style, styles.bullet]}
                selectable
              >
                {`${block.index}.`}
              </Text>
              <View style={styles.listContent}>
                {renderInlineNodes(block.children, t, style, `${bi}`)}
              </View>
            </View>
          );
        }
        // Inline paragraph
        return (
          <Text key={bi} style={[t.typography.body, { color: t.colors.text }, style]} selectable>
            {block.nodes.map((node, ni) =>
              renderSingleInlineNode(node, t, style, `${bi}-${ni}`),
            )}
          </Text>
        );
      })}
    </View>
  );
}

// ── Block grouping ────────────────────────────────────────────────────────────

type InlineBlock = { type: 'inline'; nodes: MarkdownNode[] };
type UlBlock = { type: 'list-ul'; children: MarkdownNode[] };
type OlBlock = { type: 'list-ol'; index: number; children: MarkdownNode[] };
type Block = InlineBlock | UlBlock | OlBlock;

function groupIntoBlocks(nodes: MarkdownNode[]): Block[] {
  const blocks: Block[] = [];
  let inlineAccum: MarkdownNode[] = [];
  let olCounter = 1;

  function flushInline() {
    if (inlineAccum.length > 0) {
      // Strip leading/trailing newline nodes before flushing.
      const trimmed = trimNewlineNodes(inlineAccum);
      if (trimmed.length > 0) blocks.push({ type: 'inline', nodes: trimmed });
      inlineAccum = [];
    }
  }

  for (const node of nodes) {
    if (node.kind === 'list-item-ul') {
      flushInline();
      olCounter = 1; // reset ol counter when a ul appears
      blocks.push({ type: 'list-ul', children: node.children });
    } else if (node.kind === 'list-item-ol') {
      flushInline();
      blocks.push({ type: 'list-ol', index: olCounter++, children: node.children });
    } else {
      // Check if this is a newline separator between paragraphs.
      if (node.kind === 'text' && node.text === '\n') {
        // If the accumulator has real content, flush and start a new paragraph.
        const hasContent = inlineAccum.some(
          (n) => n.kind !== 'text' || n.text !== '\n',
        );
        if (hasContent) {
          flushInline();
        }
      } else {
        inlineAccum.push(node);
      }
    }
  }

  flushInline();
  return blocks;
}

function isNewlineNode(node: MarkdownNode | undefined): boolean {
  return node !== undefined && node.kind === 'text' && node.text === '\n';
}

function trimNewlineNodes(nodes: MarkdownNode[]): MarkdownNode[] {
  let start = 0;
  let end = nodes.length - 1;
  while (start <= end && isNewlineNode(nodes[start])) start++;
  while (end >= start && isNewlineNode(nodes[end])) end--;
  return nodes.slice(start, end + 1);
}

// ── Inline node renderers ─────────────────────────────────────────────────────

function renderInlineNodes(
  nodes: MarkdownNode[],
  t: ReturnType<typeof useTheme>,
  style: unknown,
  keyPrefix: string,
): React.ReactNode {
  return (
    <Text style={[t.typography.body, { color: t.colors.text }, style as object]} selectable>
      {nodes.map((node, i) =>
        renderSingleInlineNode(node, t, style, `${keyPrefix}-${i}`),
      )}
    </Text>
  );
}

function renderSingleInlineNode(
  node: MarkdownNode,
  t: ReturnType<typeof useTheme>,
  style: unknown,
  key: string,
): React.ReactNode {
  switch (node.kind) {
    case 'text':
      return (
        <Text key={key} style={[t.typography.body, { color: t.colors.text }, style as object]}>
          {node.text}
        </Text>
      );

    case 'bold':
      return (
        <Text
          key={key}
          style={[t.typography.bodyStrong, { color: t.colors.text }, style as object]}
        >
          {node.text}
        </Text>
      );

    case 'italic':
      return (
        <Text
          key={key}
          style={[t.typography.body, { color: t.colors.text, fontStyle: 'italic' }, style as object]}
        >
          {node.text}
        </Text>
      );

    case 'link':
      return (
        <Text
          key={key}
          accessibilityRole="link"
          accessibilityLabel={node.text}
          style={[
            t.typography.body,
            { color: t.colors.primaryInk, textDecorationLine: 'underline' },
            style as object,
          ]}
          onPress={() => {
            // SAFETY: href was already validated by renderMarkdown's allow-list.
            Linking.openURL(node.href).catch(() => {
              // Silently ignore — openURL rejects on desktop if no handler.
            });
          }}
        >
          {node.text}
        </Text>
      );

    default:
      // list-item-* should never arrive here (they're handled at block level).
      return null;
  }
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bullet: {
    // Fixed-width so bullets align regardless of number length.
    minWidth: 18,
  },
  listContent: { flex: 1 },
});
