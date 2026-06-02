# Block Fragment Annotation Card Implementation Plan

## Goal

Implement Option C from the fragment annotation explorations: a reusable **BlockFragment** component that renders a selected paragraph fragment as a compact annotation card.

Current behavior renders the whole paragraph and highlights the selected range. This is clear, but too tall in comment panels and embeds. The new default for valid text-range comments should show the selected fragment as the primary content, with clear provenance and an affordance to reveal the full paragraph context.

Recommended product behavior:

> For text-selection comments, show an annotation card by default. Provide “Show context” to reveal the existing full block viewer.

## Relevant Files

Start by reading:

```txt
frontend/AGENTS.md
frontend/packages/ui/src/comments.tsx
frontend/packages/ui/src/blocks-content-utils.ts
frontend/packages/editor/src/readonly-viewer.tsx
frontend/packages/shared/src/readonly-viewer-context.tsx
frontend/packages/shared/src/document-to-text.ts
frontend/packages/client/src/hm-types.ts
```

Most relevant current component:

```tsx
// frontend/packages/ui/src/comments.tsx
export function QuotedDocBlock({
  docId,
  blockId,
  doc,
  blockRange,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  doc: HMDocument
  blockRange?: BlockRange
})
```

Current behavior renders the full block with `Viewer`, passing `focusBlockId` and `blockRange` so the selected text is highlighted inside the full paragraph.

## Proposed Files

Prefer one new presentational UI file:

```txt
frontend/packages/ui/src/block-fragment.tsx
```

If text extraction becomes non-trivial, add a small helper file:

```txt
frontend/packages/ui/src/block-fragment-utils.ts
```

Keep the implementation minimal. Avoid adding a new utility file unless it materially improves readability or testability.

## Component API

Create a presentational component with a doc comment because it is exported.

Suggested API:

```tsx
/** Renders a compact annotation card for a selected text fragment inside a block. */
export function BlockFragment({
  selectedText,
  sourceLabel = 'Paragraph fragment',
  sourceDescription,
  onShowContext,
  className,
}: {
  selectedText: string
  sourceLabel?: ReactNode
  sourceDescription?: ReactNode
  onShowContext?: () => void
  className?: string
})
```

The component should be dumb: pass already-extracted `selectedText` into it. Do not make this component know about document/block structures.

## Visual Direction

Option C “Annotation card” shape:

```txt
┌─────────────────────────────┐
│ “                           │
│ highlights only the         │
│ selected phrase             │
│                             │
│ Paragraph fragment          │
│ [Show context]              │
└─────────────────────────────┘
```

Design goals:

- Selected fragment is visually primary.
- The card clearly communicates “this is quoted selected text from a paragraph.”
- The card is shorter than rendering the whole paragraph.
- It fits narrow comment/accessory panels.
- It feels native to Seed’s existing UI.

Suggested styling:

- rounded card
- subtle border
- quote mark or quote icon
- warm highlighted/accented quote area
- small muted provenance label
- “Show context” as a small ghost/pill button

Use existing primitives where practical:

```tsx
Button
SizableText
cn
BlockQuote or lucide Quote icon
```

## Fragment Text Extraction

Add a small helper near `QuotedDocBlock` or in `block-fragment-utils.ts`.

Suggested signature:

```tsx
function getTextFragmentFromBlock(
  block: HMBlockNode,
  range: {start: number; end: number},
): string | null
```

Behavior:

1. Return `null` if the range is invalid.
2. Extract plain text from paragraph-like block content.
3. Slice by Unicode codepoint offsets, not UTF-16 offsets.
4. Trim whitespace.
5. Return `null` if the selected text is empty.

Codepoint slicing pattern:

```tsx
const codepoints = Array.from(text)
const selectedText = codepoints.slice(start, end).join('').trim()
```

Important: inspect the actual `HMBlockNode` shape before implementing. Reuse existing text extraction utilities if they already exist and are appropriate.

Fallback to current full block viewer when:

- there is no valid `{start, end}` range
- the block type is unsupported
- text extraction fails
- selected text is empty
- `blockRange` is a non-range variant such as `{expanded: true}`

## Integration in `QuotedDocBlock`

Modify:

```txt
frontend/packages/ui/src/comments.tsx
```

Current range detection:

```tsx
const fragmentRange = blockRange && 'start' in blockRange ? blockRange : undefined
```

Add local expand state:

```tsx
const [showFullContext, setShowFullContext] = useState(false)
```

Suggested flow:

```tsx
const selectedText = fragmentRange && blockContent
  ? getTextFragmentFromBlock(blockContent, fragmentRange)
  : null

if (fragmentRange && selectedText && !showFullContext) {
  return (
    <BlockFragment
      selectedText={selectedText}
      sourceLabel="Paragraph fragment"
      sourceDescription="Commenting on selected text"
      onShowContext={() => setShowFullContext(true)}
    />
  )
}

return existing full Viewer rendering
```

The existing full `Viewer` rendering should remain the expanded/fallback state.

For the first implementation, one-way expansion is acceptable. A “Hide context” control can be added later if it naturally fits.

## Example Styling Starting Point

This is only a starting point; adjust to nearby UI conventions.

```tsx
<div className={cn('bg-brand-50 dark:bg-brand-950 rounded-lg p-2', className)}>
  <div className="border-border bg-background rounded-lg border p-3">
    <div className="flex gap-3">
      <BlockQuote className="text-primary mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-base leading-snug font-semibold">
          {selectedText}
        </div>
        <div className="text-muted-foreground mt-2 text-xs">
          {sourceLabel}
        </div>
        {sourceDescription ? (
          <div className="text-muted-foreground mt-0.5 text-xs">
            {sourceDescription}
          </div>
        ) : null}
        {onShowContext ? (
          <Button variant="ghost" size="xs" className="mt-2" onClick={onShowContext}>
            Show context
          </Button>
        ) : null}
      </div>
    </div>
  </div>
</div>
```

## Tests

Add tests if practical.

Suggested component test file:

```txt
frontend/packages/ui/src/__tests__/block-fragment.test.tsx
```

Minimum component tests:

1. Renders selected fragment text.
2. Renders source label/description.
3. Calls `onShowContext` when the button is clicked.

If adding a utility helper, add tests such as:

```txt
frontend/packages/ui/src/__tests__/block-fragment-utils.test.ts
```

Utility test cases:

- extracts a simple range
- handles range at text boundaries
- handles emoji/codepoints correctly
- returns `null` for invalid ranges
- returns `null` for unsupported/missing text

## Acceptance Criteria

Implementation is done when:

- Text-selection comments show the Option C annotation card by default.
- The selected phrase is visually primary.
- The card clearly says it is a paragraph fragment or selected text quote.
- “Show context” reveals the existing full-paragraph rendering with range highlight.
- Existing non-fragment block comments still render unchanged.
- Unsupported fragments safely fall back to current behavior.
- Typecheck passes.

## Validation Commands

From `frontend/`:

```sh
pnpm typecheck
pnpm test
pnpm format:write
```

For full frontend CI parity before pushing:

```sh
npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token
```

## Implementation Order for New Session

1. Read `frontend/AGENTS.md`.
2. Inspect `HMBlockNode` shape and existing text extraction utilities.
3. Create `BlockFragment` presentational component.
4. Add minimal fragment text extraction helper.
5. Update `QuotedDocBlock` to render `BlockFragment` for valid text ranges.
6. Preserve current `Viewer` as fallback/expanded state.
7. Add focused tests.
8. Run frontend typecheck/tests/format.
9. Manually verify comment panel behavior for:
   - full block comment
   - text fragment comment
   - expanded context state
   - invalid/missing range fallback
