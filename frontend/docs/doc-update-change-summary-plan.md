# Plan: Document Change Summary for Email Notifications

## Current State

The `site-doc-update` notification type currently carries no information about _what_ changed in a document. The `createDocUpdateEmail` template accepts an optional `changes?: string[]` field, but it's never populated — the "What changed" box is simply omitted.

The `notifyOwnedDocChange` feature is also not yet wired for email (there's a TODO at `email-notifier.ts:960`).

## What Data Exists Today

When a document change event arrives (a `Ref` blob), `loadRefEvent` in `email-notifier.ts` already loads:

- **Full document content** (all blocks with text, annotations, etc.)
- **Document metadata** (`name`, `summary`, `icon`, etc.)
- **Change dependencies** (`deps` CIDs pointing to previous versions)
- **Whether it's a new document** (`deps.length === 0`)
- **Author of the change**

The Ref blob itself (CBOR-encoded) contains granular `DocumentChange` operations:
- `MoveBlock` — block created or moved
- `ReplaceBlock` — block content replaced
- `DeleteBlock` — block removed
- `SetAttribute` — block or document attribute changed
- `SetMetadata` — document metadata changed

These operations are decoded but only used to detect new mentions. The rest is discarded.

## Approach: Three Options (increasing complexity)

### Option A: Metadata-level diff (low effort)
Compare the previous version's metadata with the new version to detect high-level changes.

**What it can detect:**
- "Title changed" (name field changed)
- "Summary updated"
- "Cover image updated"
- "New document created"

**How:**
1. In `evaluateDocUpdateForNotifications`, fetch the previous version using `deps[0]` CID
2. Compare `previousMeta.name !== currentMeta.name`, etc.
3. Build a `changes: string[]` from the diffs
4. Pass to `createDocUpdateEmail`

**Pros:** Simple, fast, no new APIs needed
**Cons:** Can't tell you what content changed, only metadata fields

### Option B: Block-level diff summary (medium effort)
Parse the `DocumentChange` operations from the Ref blob to summarize structural changes.

**What it can detect:**
- "3 paragraphs added"
- "1 heading modified"
- "2 blocks deleted"
- "Document restructured (5 blocks moved)"
- All metadata changes from Option A

**How:**
1. The CBOR-decoded Ref blob already contains `DocumentChange` ops
2. In `loadRefEvent` or a new helper, categorize ops by type:
   - Count `MoveBlock` ops (new blocks or reorders)
   - Count `ReplaceBlock` ops (content edits)
   - Count `DeleteBlock` ops
   - Count `SetAttribute`/`SetMetadata` ops
3. Generate human-readable summaries: "Added 3 new sections, edited 2 paragraphs"
4. Pass as `changes: string[]`

**Pros:** Gives meaningful structural info, uses data already loaded
**Cons:** Summaries are generic ("2 paragraphs edited" not "updated the pricing section")

### Option C: AI-powered change summary (high effort, best UX)
Use an LLM to generate a natural-language summary of what changed.

**What it can produce:**
- "Updated the pricing section with new tier information"
- "Rewrote the introduction paragraph"
- "Added a new FAQ section with 5 questions"

**How:**
1. Fetch previous document version content (using `deps[0]`)
2. Fetch current document version content
3. Diff the two content trees to get changed blocks
4. Send the before/after of changed blocks to an LLM with a prompt like: "Summarize what changed in this document update in 1-3 bullet points"
5. Cache the summary alongside the notification

**Pros:** Best user experience, meaningful context
**Cons:** Adds LLM dependency, latency, cost per notification, needs caching

## Recommended Path

**Start with Option A** (metadata diff) — it's a few lines of code and covers the most visible changes (title, summary). Then **move to Option B** when the `notifyOwnedDocChange` feature is fully implemented — the Ref blob operations are already decoded and available. Option C can be explored later as an enhancement.

## Implementation Sketch for Option A

```typescript
// In evaluateDocUpdateForNotifications or loadRefEvent:
function buildChangeSummary(
  prevMeta: HMMetadata | null,
  currentMeta: HMMetadata | null,
  isNewDocument: boolean,
): string[] {
  if (isNewDocument) return ['New document created']
  const changes: string[] = []
  if (prevMeta?.name !== currentMeta?.name) changes.push('Title updated')
  if (prevMeta?.summary !== currentMeta?.summary) changes.push('Summary updated')
  if (prevMeta?.cover !== currentMeta?.cover) changes.push('Cover image changed')
  if (prevMeta?.icon !== currentMeta?.icon) changes.push('Icon changed')
  if (changes.length === 0) changes.push('Content updated')
  return changes
}
```

The `changes` array would then flow into `createDocUpdateEmail({ changes })`.

## Prerequisite

The `notifyOwnedDocChange` TODO at `email-notifier.ts:960` needs to be implemented first — without it, `site-doc-update` email notifications are never sent regardless of whether we have change data.
