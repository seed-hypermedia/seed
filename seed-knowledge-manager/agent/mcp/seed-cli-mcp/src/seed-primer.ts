/**
 * Shared "how Seed's markdown works" primer that gets injected into every
 * LLM system prompt the agent generates content for. Without this, the
 * model emits bare hm:// URLs that don't render as links/embeds, or
 * wraps lists inside extra Paragraph parents because of leading prose.
 *
 * Keep it short — every cadence/agent prompt pays for these tokens.
 */
export const SEED_MARKDOWN_PRIMER = `## Seed Hypermedia markdown primer (READ THIS BEFORE WRITING)

You are writing for Seed Hypermedia, which uses a constrained Markdown.
Follow these rules exactly — non-conforming output will be rendered as broken text:

1. **Inline links to docs** — use \`[Title](hm://...)\` — NEVER paste a bare hm:// URL in prose; it will render as raw text, not a link.
2. **Embeds / mention chips** — use autolink syntax \`<hm://...>\` on its own to insert a navigable chip. Use this when the reference IS the content (e.g. a "Recommended reading" item, an author chip).
3. **Account mentions** — use \`<hm://<accountUid>>\` (autolink). This renders as a person chip.
4. **Lists must not have a EMPTY wrapping intro paragraph.** A heading is itself the list's parent. Do NOT write:
   - WRONG:
     \`\`\`
     ## Decisions
     
     - decision 1
     \`\`\`
   - RIGHT:
     \`\`\`
     ## Decisions
     - decision 1
     \`\`\`
5. **Cite every reference** — if you name a doc, person, or thread, include an inline link \`[Title](hm://...)\` or an embed \`<hm://...>\`. No uncited claims.
6. **Headings start at H2 (##).** Do not use H1 — the document title is injected separately as metadata.
7. **No code fences around the whole document.** Emit raw Markdown.
`
