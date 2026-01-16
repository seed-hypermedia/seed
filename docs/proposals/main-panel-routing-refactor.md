# Technical Proposal: Main Panel + Accessory Routing Refactor

## Problem Statement

Currently, document/draft routes have an implicit assumption: the document "content" always occupies the main panel, and accessories (Activity, Discussions, Directory, etc.) can only appear in the side panel.

We want to:
1. Open any panel (Activity, Discussions, etc.) as the **main content**
2. Treat document content as a sibling panel option (named "content")
3. Keep the accessory side panel functionality intact

## Current Schema

```typescript
// routes.ts - current
export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptNotifs: z.boolean().optional(),
  accessory: documentAccessorySchema.nullable().optional(),  // side panel only
})
```

**Limitation**: No way to express "show Activity in main area" or "show Discussions full-width".

## Proposed Schema

```typescript
// New: explicit main panel control
const documentContentPanelSchema = z.object({
  key: z.literal('content'),
})

// Reuse existing accessory schemas for main panel options
const documentMainPanelSchema = z.discriminatedUnion('key', [
  documentContentPanelSchema,              // Document content (default)
  documentActivityAccessorySchema,         // Activity as main
  documentDiscussionsAccessorySchema,      // Discussions as main
  documentDirectoryAccessorySchema,        // Directory as main
  documentCollaboratorsAccessorySchema,    // Collaborators as main
  documentContactsAccessorySchema,         // Contacts as main
])

export type DocumentMainPanel = z.infer<typeof documentMainPanelSchema>

export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptNotifs: z.boolean().optional(),
  mainPanel: documentMainPanelSchema.optional(),              // NEW
  accessory: documentAccessorySchema.nullable().optional(),   // unchanged
})
```

**Same pattern applies to `draftRouteSchema` and `feedRouteSchema`.**

## Route Examples

```typescript
// Default: document content in main (backwards compatible)
{ key: 'document', id: {...} }
// Explicit equivalent:
{ key: 'document', id: {...}, mainPanel: { key: 'content' } }

// Activity as main panel
{ key: 'document', id: {...}, mainPanel: { key: 'activity' } }

// Discussions as main panel, Activity in side accessory
{
  key: 'document',
  id: {...},
  mainPanel: { key: 'discussions', targetBlockId: '123' },
  accessory: { key: 'activity' }
}

// Directory as main, content in accessory (if desired)
{
  key: 'document',
  id: {...},
  mainPanel: { key: 'directory' },
  accessory: { key: 'content' }  // would need schema update to allow this
}
```

## Implementation Details

### 1. Schema Changes (`frontend/packages/shared/src/routes.ts`)

Add new types and update route schemas:

```typescript
// Add content panel schema
export const documentContentPanelSchema = z.object({
  key: z.literal('content'),
})
export type DocumentContentPanel = z.infer<typeof documentContentPanelSchema>

// Create main panel union (reuses existing accessory schemas)
export const documentMainPanelSchema = z.discriminatedUnion('key', [
  documentContentPanelSchema,
  documentActivityAccessorySchema,
  documentDiscussionsAccessorySchema,
  documentDirectoryAccessorySchema,
  documentCollaboratorsAccessorySchema,
  documentContactsAccessorySchema,
])
export type DocumentMainPanel = z.infer<typeof documentMainPanelSchema>
export type MainPanelKey = DocumentMainPanel['key']

// Update document route
export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptNotifs: z.boolean().optional(),
  mainPanel: documentMainPanelSchema.optional(),
  accessory: documentAccessorySchema.nullable().optional(),
})
```

### 2. Layout Component (`frontend/apps/desktop/src/components/accessory-sidebar.tsx`)

Update `AccessoryLayout` to accept main panel info:

```typescript
export function AccessoryLayout<Options extends DocAccessoryOption[]>({
  children,
  mainPanel,           // NEW: what to show in main area
  mainPanelKey,        // NEW: current main panel key
  accessory,
  accessoryKey,
  ...
}: {
  children: React.ReactNode           // fallback/default content
  mainPanel?: React.ReactNode         // explicit main panel content
  mainPanelKey?: MainPanelKey
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  ...
}) {
  return (
    <PanelGroup direction="horizontal">
      <Panel id="main" minSize={50}>
        {mainPanel || children}  // use mainPanel if provided, else children
      </Panel>
      {accessoryKey !== undefined && <PanelResizeHandle />}
      <Panel id="accessory" hidden={accessoryKey === undefined}>
        {accessory}
      </Panel>
    </PanelGroup>
  )
}
```

### 3. Panel Component Extraction

Create reusable panel components that work in both main and accessory positions:

```typescript
// frontend/apps/desktop/src/components/panels/index.ts
export { ActivityPanel } from './activity-panel'
export { DiscussionsPanel } from './discussions-panel'  // already exists
export { DirectoryPanel } from './directory-panel'      // already exists
export { CollaboratorsPanel } from './collaborators-panel' // already exists
export { ContentPanel } from './content-panel'          // new wrapper
```

### 4. Hook for Main Panel Resolution

```typescript
// frontend/apps/desktop/src/components/document-panels.tsx
export function useDocumentMainPanel({
  docId,
  mainPanelKey,
}: {
  docId: UnpackedHypermediaId | null
  mainPanelKey?: MainPanelKey
}): React.ReactNode {
  const route = useNavRoute()
  const effectiveKey = mainPanelKey ?? 'content'

  switch (effectiveKey) {
    case 'content':
      return null  // caller should use children/default
    case 'activity':
      return <ActivityPanel docId={docId} accessory={route.mainPanel} />
    case 'discussions':
      return <DiscussionsPanel docId={docId} accessory={route.mainPanel} />
    case 'directory':
      return <DirectoryPanel docId={docId} />
    case 'collaborators':
      return <CollaboratorsPanel docId={docId} />
    case 'contacts':
      return <ContactsPanel docId={docId} />
    default:
      return null
  }
}
```

### 5. Page Component Updates (`frontend/apps/desktop/src/pages/document.tsx`)

```typescript
export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id

  const mainPanelKey = route.mainPanel?.key ?? 'content'
  const accessoryKey = route.accessory?.key

  const mainPanel = useDocumentMainPanel({ docId, mainPanelKey })
  const { accessory, accessoryOptions } = useDocumentAccessory({ docId })

  return (
    <AccessoryLayout
      mainPanel={mainPanel}
      mainPanelKey={mainPanelKey}
      accessory={accessory}
      accessoryKey={accessoryKey}
    >
      {/* Default content shown when mainPanelKey === 'content' */}
      <MainDocumentPage ... />
    </AccessoryLayout>
  )
}
```

### 6. Main Panel Selector UI

Option A: Tabs above main content
```
┌─────────────────────────────────────────────────┐
│ [Content] [Activity] [Discussions] [Directory]  │
├─────────────────────────────────────────────────┤
│                                                 │
│              Main Panel Content                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

Option B: Extend DocumentTools toolbar with main panel buttons

```typescript
// document-tools.tsx additions
<ButtonTool
  active={mainPanel === 'content'}
  onClick={() => setMainPanel('content')}
  label="Content"
  icon={FileText}
/>
<ButtonTool
  active={mainPanel === 'activity'}
  onClick={() => setMainPanel('activity')}
  label="Activity"
  icon={HistoryIcon}
/>
// ... etc
```

### 7. Navigation Helpers

```typescript
// Add to routing utilities
export function useMainPanelNavigation() {
  const route = useNavRoute()
  const replace = useNavigate('replace')

  const setMainPanel = (key: MainPanelKey) => {
    if (route.key === 'document' || route.key === 'draft' || route.key === 'feed') {
      replace({ ...route, mainPanel: { key } })
    }
  }

  const toggleAccessory = (key: AccessoryOptions | undefined) => {
    if (route.key === 'document' || route.key === 'draft' || route.key === 'feed') {
      replace({
        ...route,
        accessory: key === route.accessory?.key ? null : { key },
      })
    }
  }

  return { setMainPanel, toggleAccessory }
}
```

## Backwards Compatibility

1. **Routes without `mainPanel`** default to `{key: 'content'}` - no breaking changes
2. **Existing accessory behavior** unchanged
3. **URL structure** remains compatible (mainPanel encoded in route params)
4. **Deep links** work as before, new `mainPanel` param is additive

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/packages/shared/src/routes.ts` | Add mainPanel schemas |
| `frontend/apps/desktop/src/components/accessory-sidebar.tsx` | Accept mainPanel prop |
| `frontend/apps/desktop/src/components/document-accessory.tsx` | Extract panel logic |
| `frontend/apps/desktop/src/pages/document.tsx` | Read mainPanel from route |
| `frontend/apps/desktop/src/pages/draft.tsx` | Same updates |
| `frontend/apps/desktop/src/pages/feed.tsx` | Same updates |
| `frontend/packages/ui/src/document-tools.tsx` | Add main panel selector UI |
| `frontend/packages/shared/src/routing.tsx` | Update routeToHref if needed |

## Testing Plan

1. **Type checking**: `yarn workspace @shm/shared build:types && yarn typecheck`
2. **Unit tests**: Add tests for new schema validation
3. **Manual testing**:
   - Document loads with content by default
   - Switch main panel to Activity → Activity shows full-width
   - Switch main panel to Discussions → Discussions shows full-width
   - Open accessory while Activity is main → both panels visible
   - Navigate away and back → state persists
   - Test with draft routes
   - Test with feed routes
4. **E2E tests**: `yarn desktop:test:only`

## Open Questions

1. **Should `content` be allowed in accessory?** If yes, need to add `documentContentPanelSchema` to `documentAccessorySchema` union.

2. **URL encoding**: How should `mainPanel` appear in URLs? Options:
   - Query param: `?mainPanel=activity`
   - Path segment: `/doc/123/activity`
   - Keep internal only (not reflected in URL)

3. **Persistence**: Should main panel selection persist per-document or be transient?

4. **Mobile/responsive**: How does this affect narrow viewport layouts where we can only show one panel?