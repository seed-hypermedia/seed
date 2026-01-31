# Phase 5: Feature Parity

## Objective
Implement all remaining features from the legacy document implementations to achieve full feature parity, including editing, comments, notifications, and platform-specific functionality.

## Pre-Conditions
- Phases 1-4 complete
- Basic document viewing works
- View term routing works
- Panel system works
- Mobile layout works

## Scope

### In Scope
- Edit button and draft navigation
- Comment box integration
- Block citations and comment indicators
- Document outline/navigation sidebar
- Notification prompts (desktop)
- Block scroll/focus handling
- Copy reference URL
- Platform-specific features

### Out of Scope
- Major new features not in legacy implementations
- Performance optimizations (separate effort)

---

## Features to Implement

### 5.1: Edit Button and Draft Navigation

**Desktop features:**
- `EditDocButton` component with popover onboarding
- Resume editing existing draft
- Create new draft from current document
- Check capabilities (`useSelectedAccountCapability`)

**Web features:**
- Web doesn't have editing (read-only)
- May show "Edit on Desktop" prompt

**Implementation:**

```typescript
// ui/src/edit-doc-button.tsx
export function EditDocButton({
  docId,
  onEdit,
  existingDraft,
  canEdit,
}: EditDocButtonProps) {
  if (!canEdit) return null

  return (
    <Tooltip content={existingDraft ? 'Resume Editing' : 'Edit'}>
      <Button
        size="sm"
        variant={existingDraft ? undefined : 'ghost'}
        className={cn(existingDraft && 'bg-yellow-200')}
        onClick={onEdit}
      >
        <Pencil className="size-4" />
        {existingDraft ? 'Resume Editing' : 'Edit'}
      </Button>
    </Tooltip>
  )
}
```

Desktop wrapper provides:
- `useSelectedAccountCapability(docId)` for canEdit check
- `useExistingDraft(route)` for draft detection
- Navigation to draft route on click

### 5.2: Create Sub-Document Button

**Desktop only** - button to create new child document.

```typescript
// Already exists at desktop/src/components/create-doc-button.tsx
// Need to integrate into ResourcePage for desktop

// In resource-page-common.tsx
{platform === 'desktop' && (
  <div className="flex items-center gap-1">
    <EditDocButton {...editProps} />
    <CreateDocumentButton locationId={docId} />
  </div>
)}
```

### 5.3: Comment Box Integration

Comments need platform-specific implementations:

**Desktop:**
- `CommentBox` from `@/components/commenting`
- Supports replying to specific comments
- Supports quoting blocks

**Web:**
- `WebCommenting` from `./commenting`
- Uses `useLocalKeyPair()` for auth

**Implementation:**

```typescript
// Create abstraction
interface CommentEditorProps {
  docId: UnpackedHypermediaId
  replyCommentId?: string
  quotingBlockId?: string
  autoFocus?: boolean
}

// Desktop provides desktop CommentBox
// Web provides WebCommenting
// ResourcePage receives via props

export function ResourcePageCommon({
  // ...
  CommentEditor,
}: ResourcePageCommonProps) {
  // Pass to discussions panel/page
  const commentEditor = CommentEditor ? (
    <CommentEditor
      docId={docId}
      replyCommentId={discussionsState?.openComment}
      quotingBlockId={discussionsState?.targetBlockId}
    />
  ) : null

  // Use in DiscussionsPageContent
  <DiscussionsPageContent
    docId={docId}
    commentEditor={commentEditor}
    // ...
  />
}
```

### 5.4: Block Citations and Comment Indicators

Show inline comment/citation indicators in document content.

**Desktop:**
- Uses `useDocumentCitations(resource?.id)`
- `calculateBlockCitations(citations.data)`
- Passed to `BlocksContentProvider`

**Web:**
- Uses `interactionSummary.data?.blocks` for citations
- Similar pattern

**Implementation:**

```typescript
// In document content rendering
<BlocksContentProvider
  resourceId={docId}
  blockCitations={blockCitations}
  onBlockCitationClick={onBlockCitationClick}
  onBlockCommentClick={onBlockCommentClick}
  onBlockSelect={onBlockSelect}
>
  <BlocksContent blocks={document.content} />
</BlocksContentProvider>

// Where:
// - blockCitations comes from citations query
// - onBlockCitationClick opens discussions panel
// - onBlockCommentClick opens comment editor for block
// - onBlockSelect handles block selection/URL update
```

### 5.5: Document Outline/Navigation Sidebar

The left sidebar showing document outline.

**Desktop:**
- `DocNavigation` component
- Uses `useNodesOutline(document, id, embeddedDocs)`
- Shows when `showSidebarOutlineDirectory` is true

**Web:**
- `WebDocumentOutline` component
- Similar outline logic

**Already handled in Phase 1 structure** - just need to ensure:
- Outline data is fetched (embedded docs)
- Outline renders in sidebar position
- Click scrolls to block

```typescript
// In document content area (when activeView === 'content')
{showSidebars && (
  <div {...sidebarProps}>
    <DocumentOutline
      outline={outline}
      activeBlockId={blockRef}
      onActivateBlock={onActivateBlock}
    />
  </div>
)}
```

### 5.6: Notification Settings (Desktop Only)

Desktop shows notification prompt for new accounts.

```typescript
// Desktop-specific feature
const notifyServiceHost = useNotifyServiceHost()
const notifSettingsDialog = useAppDialog(NotifSettingsDialog)

// Check if should prompt
const immediatePromptNotifs =
  route.key === 'document' &&
  route.immediatelyPromptNotifs &&
  !route.id?.path?.length

useEffect(() => {
  if (immediatePromptNotifs && notifyServiceHost) {
    notifSettingsDialog.open({
      notifyServiceHost,
      accountUid: route.id.uid,
      title: 'Get Emailed when Important Things Happen Here',
    })
    // ... mark as prompted
  }
}, [immediatePromptNotifs, notifyServiceHost])
```

This stays in desktop wrapper, not shared.

### 5.7: Block Scroll and Focus Handling

Handle scrolling to specific blocks and URL updates.

**Both platforms need:**
- `useBlockScroll(blockRef)` hook
- URL/route updates when block selected
- Scroll restoration

```typescript
// Already exists at ui/src/use-block-scroll.ts
const { scrollToBlock } = useBlockScroll(blockRef)

// On block selection
const onBlockSelect = useCallback((blockId, blockRange) => {
  scrollToBlock(blockId)
  navigation.updateBlockRef(blockId, blockRange)
}, [scrollToBlock, navigation])
```

### 5.8: Copy Reference URL

Copy shareable URL for current view/block.

**Desktop:**
- `useDocumentUrl()` hook
- Copies hm:// URL to clipboard

**Web:**
- Direct URL copy
- Site host + path

```typescript
// Abstraction
interface CopyReferenceContext {
  copyUrl: (blockId?: string, blockRange?: BlockRange) => void
  content: ReactNode  // Toast/notification UI
}

// Desktop implementation uses useDocumentUrl
// Web implementation uses window.location + routeToHref
```

### 5.9: CommentsProvider Integration

Both platforms use `CommentsProvider` for comment interactions:

```typescript
<CommentsProvider
  onReplyClick={handleReplyClick}
  onReplyCountClick={handleReplyCountClick}
  // Desktop-specific:
  useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
>
  {/* Page content */}
</CommentsProvider>
```

Desktop needs the hacky subscriptions hook; web doesn't.

### 5.10: Keyboard Shortcuts (Desktop)

Desktop has keyboard shortcuts for accessory toggle:

```typescript
useListenAppEvent('toggle_accessory', (event) => {
  const targetSelection = selectionOptions[event.index]
  if (!targetSelection) return

  if (panelKey === targetSelection.key) {
    panelContext.closePanel()
  } else {
    panelContext.openPanel(targetSelection.key)
  }
})
```

Already handled in Phase 3 panel context.

### 5.11: Site Header Integration

Each platform has its own site header:

**Desktop:**
- `SiteHeader` component
- Uses `useSiteNavigationItems(siteHomeEntity)`
- Mobile menu toggle callback

**Web:**
- `WebSiteHeader` component
- Different props structure
- Auto-hide on scroll

Keep these platform-specific in wrappers.

### 5.12: Page Footer (Web)

Web shows footer with additional info:

```typescript
// Web only
<div className="mb-[80px] flex-none shrink-0 grow-0 md:mb-0">
  <PageFooter id={id} />
</div>
```

### 5.13: Account Bubble (Web)

Web shows floating account bubble:

```typescript
// Web only
<MyAccountBubble />
```

---

## Implementation Order

1. **Block interactions** (5.4, 5.7) - Foundation for other features
2. **Document outline** (5.5) - Visual completeness
3. **Comment editor** (5.3) - Core functionality
4. **Edit button** (5.1, 5.2) - Desktop editing
5. **Copy URL** (5.8) - Sharing
6. **Comments provider** (5.9) - Comment interactions
7. **Platform specifics** (5.6, 5.11, 5.12, 5.13) - Polish

---

## Testing Checklist

### Desktop Testing

1. **Editing**
   - [ ] Edit button shows for documents user can edit
   - [ ] Click creates/resumes draft correctly
   - [ ] Draft navigation works
   - [ ] Popover onboarding shows (first time)

2. **Create Sub-Document**
   - [ ] Button shows when user has permission
   - [ ] Creates document in correct location

3. **Comments**
   - [ ] Comment box renders in discussions
   - [ ] Can post new comment
   - [ ] Can reply to existing comment
   - [ ] Can quote block in comment

4. **Block Interactions**
   - [ ] Citation indicators show on blocks
   - [ ] Click indicator opens discussions panel
   - [ ] Block selection updates URL
   - [ ] Scroll to block works

5. **Document Outline**
   - [ ] Outline shows in sidebar
   - [ ] Click navigates to heading
   - [ ] Active heading highlighted

6. **Notifications**
   - [ ] Prompt shows for new accounts
   - [ ] Prompt marks as shown

7. **Copy URL**
   - [ ] Copy link copies correct URL
   - [ ] Block references included when selected

8. **Keyboard Shortcuts**
   - [ ] All accessory shortcuts work

### Web Testing

1. **Comments**
   - [ ] Comment editor shows
   - [ ] Can post comment (with account)
   - [ ] Can reply to comment

2. **Block Interactions**
   - [ ] Citation indicators show
   - [ ] Click opens panel
   - [ ] URL updates with block ref

3. **Document Outline**
   - [ ] Outline renders
   - [ ] Click scrolls to heading

4. **Copy URL**
   - [ ] Copy link works
   - [ ] Correct format for web

5. **Web-Specific**
   - [ ] Page footer shows
   - [ ] Account bubble shows
   - [ ] Site header works

### Cross-Platform Verification

- [ ] Same features available where applicable
- [ ] Consistent behavior
- [ ] No console errors

---

## Files Modified

| File | Change |
|------|--------|
| `ui/src/edit-doc-button.tsx` | New shared edit button |
| `ui/src/resource-page-common.tsx` | Feature integrations |
| `desktop/src/pages/desktop-resource.tsx` | Desktop features |
| `web/app/resource-web.tsx` | Web features |

---

## Success Criteria

Phase 5 is complete when:
1. Edit button works on desktop
2. Comments work on both platforms
3. Block interactions work (citations, selection, scroll)
4. Document outline works
5. Copy URL works
6. All platform-specific features work
7. Feature parity with legacy implementations
8. No console errors or regressions
