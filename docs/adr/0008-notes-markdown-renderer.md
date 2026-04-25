# ADR-0008: Notes render through a tiny in-repo Markdown subset

**Status**: Accepted
**Date**: 2026-04-25

## Context

Phase 9 ships per-place and per-day notes. The print page already renders `place.notes` as plain `<Text>`. Users want minimal formatting (highlight a meeting time, list the must-see stops, link to a Google Maps URL). We need to decide between pulling a Markdown library and writing a tiny in-repo renderer.

## Decision

1. Ship a ~80–120 LOC renderer at `src/lib/markdown/render.ts` plus a paired `<MarkdownText>` component in `src/components/MarkdownText.tsx`.
2. Supported subset (closed grammar):
   - `**bold**`
   - `*italic*`
   - `- ` unordered list items
   - `1. ` ordered list items
   - `[text](url)` links
   - Anything else falls through as literal plain text.
3. Link protocol allow-list: `http://`, `https://`, `mailto:`. Anything else (especially `javascript:`) is rendered as literal `[text](url)` text — never as an active link.
4. Linear-pass tokenizer (character-by-character walker), not a single mega-regex — avoids catastrophic backtracking on adversarial input.
5. On web, links use `<a href>` (React escapes; browser handles Ctrl-click for new tab). On native, links use `Linking.openURL`. Tokenizer stays shared; renderer may be platform-split.
6. NO `dangerouslySetInnerHTML` anywhere. NO HTML pass-through.

## Alternatives considered

- *`marked`.* Rejected — web-only DOM-injection library; would force a `react-native-markdown-display` companion on native and a platform split.
- *`react-native-markdown-display`.* Rejected — native-only; ~30 KB; would force a separate web library.
- *`react-markdown`.* Rejected — web-only; heavy; full CommonMark support is overkill for a notes field.
- *Universal CommonMark library (e.g. `markdown-it`).* Rejected — 50KB+; full CommonMark grammar exposes attack surface (raw HTML, image embeds) we don't want.
- *No formatting at all.* Rejected — print page wants minimal styling, and bare text loses utility for lists / highlights.

## Consequences

- Pros: zero new deps; ~100 LOC to maintain; closed grammar = no XSS surface; works identically on iOS / Android / Web; trivial to extend grammar one construct at a time.
- Cons: any user-requested construct (table, fenced code, blockquote, heading, image) requires a one-step follow-up phase. Acceptable trade-off — the realistic notes vocabulary is highlight + list + link.
- The closed grammar plus protocol allow-list means a malicious user could not inject scripts via their own notes (nor via shared trips, since shared trips render notes the same way).
