# Phase 6: Cleanup and Final Testing

## Objective
Remove legacy implementations, clean up temporary code, and perform comprehensive final testing.

## Pre-Conditions
- Phases 1-5 complete
- All features working on both platforms
- No known regressions

---

## Cleanup Tasks

### 6.1: Remove Legacy Files

Once everything is confirmed working:

```bash
# Desktop legacy
rm frontend/apps/desktop/src/pages/desktop-legacy-document.tsx

# Web legacy
rm frontend/apps/web/app/web-legacy-document.tsx
```

### 6.2: Update Imports

Ensure no imports reference legacy files:

```bash
# Search for any remaining references
grep -r "desktop-legacy-document" frontend/
grep -r "web-legacy-document" frontend/
grep -r "document.tsx" frontend/apps/desktop/src/
grep -r "document.tsx" frontend/apps/web/app/
```

### 6.3: Clean Up Type Exports

Consolidate type exports:
- Move any types from legacy to shared location
- Remove duplicate type definitions
- Update imports across codebase

### 6.4: Update Main.tsx Route Mapping

In `frontend/apps/desktop/src/pages/main.tsx`, update:

```typescript
// Change from:
var Document = lazy(() => import('./document'))

// To:
var Document = lazy(() => import('./desktop-resource'))
```

Or rename `desktop-resource.tsx` to `document.tsx` once legacy is removed.

### 6.5: Code Quality

- Remove commented-out code
- Remove TODO comments that were addressed
- Remove console.log statements added for debugging
- Run linter and fix warnings
- Run formatter

```bash
yarn format:write
yarn typecheck
```

---

## Final Testing

### Comprehensive Desktop Testing

1. **Fresh Start**
   - [ ] Delete app data/cache
   - [ ] Launch app from scratch
   - [ ] No errors on startup

2. **Document Viewing**
   - [ ] Load document from library
   - [ ] Load document via URL
   - [ ] Load document via navigation
   - [ ] All metadata displays correctly
   - [ ] Cover images work
   - [ ] Outline displays

3. **View Terms**
   - [ ] Activity page works
   - [ ] Discussions page works
   - [ ] Directory page works
   - [ ] Collaborators page works
   - [ ] Feed page works

4. **Panels**
   - [ ] All panels open/close
   - [ ] Panel content correct
   - [ ] Panel sizing works
   - [ ] Width persistence works
   - [ ] Keyboard shortcuts work

5. **Editing**
   - [ ] Edit button appears
   - [ ] Create draft works
   - [ ] Resume draft works
   - [ ] Create sub-document works

6. **Comments**
   - [ ] Post comment works
   - [ ] Reply to comment works
   - [ ] Block quote works
   - [ ] Citations show

7. **Navigation**
   - [ ] Back/forward works
   - [ ] Breadcrumbs work
   - [ ] Block scroll works
   - [ ] URL copy works

8. **Error States**
   - [ ] Not found page shows
   - [ ] Error page shows
   - [ ] Discovery page shows
   - [ ] Redirect handling works

### Comprehensive Web Testing

1. **Page Load**
   - [ ] Fresh load (no cache)
   - [ ] SSR content visible in source
   - [ ] No hydration errors
   - [ ] SEO meta tags correct

2. **Document Viewing**
   - [ ] Content renders
   - [ ] Metadata displays
   - [ ] Cover images work
   - [ ] Outline displays

3. **View Terms**
   - [ ] `:activity` URL works
   - [ ] `:discussions` URL works
   - [ ] `:directory` URL works
   - [ ] `:collaborators` URL works

4. **Panels**
   - [ ] `?panel=` param works
   - [ ] Panel opens/closes
   - [ ] Panel content correct
   - [ ] Width persistence works

5. **Mobile Layout**
   - [ ] Responsive breakpoint works
   - [ ] Mobile bar shows
   - [ ] Mobile sheet works
   - [ ] Auto-hide header works
   - [ ] Scroll works (SHM-2096)

6. **Comments**
   - [ ] Comment editor shows
   - [ ] Can post (with account)
   - [ ] Citations show

7. **Navigation**
   - [ ] Client navigation works
   - [ ] Browser back/forward works
   - [ ] Block URLs work
   - [ ] Copy URL works

8. **Error States**
   - [ ] 404 page works
   - [ ] Error page works
   - [ ] Discovery works

### Performance Testing

1. **Desktop**
   - [ ] App launch time reasonable
   - [ ] Document load time reasonable
   - [ ] No memory leaks (check over time)
   - [ ] Smooth scrolling

2. **Web**
   - [ ] First contentful paint reasonable
   - [ ] Time to interactive reasonable
   - [ ] Lighthouse score acceptable
   - [ ] No layout shifts

### Regression Testing

Compare specific behaviors against original:

1. **Desktop**
   - [ ] Same keyboard shortcuts work
   - [ ] Same panel behavior
   - [ ] Same editing flow

2. **Web**
   - [ ] Same mobile behavior
   - [ ] Same URL patterns
   - [ ] Same SEO

---

## Documentation Updates

### Update BRANCH_NOTES.md

Add documentation about the unification:

```markdown
## Document Unification (SHM-2101)

Unified `document.tsx` implementations for web and desktop into shared `resource-page-common.tsx`.

### Architecture
- Shared core in `@shm/ui/resource-page-common.tsx`
- Platform wrappers provide platform-specific dependencies
- Panel system unified with platform-specific layouts

### Files Changed
- New: `frontend/packages/ui/src/resource-page-common.tsx`
- New: `frontend/packages/ui/src/resource-page-*.tsx` (panel layouts)
- Modified: `frontend/apps/desktop/src/pages/document.tsx`
- Modified: `frontend/apps/web/app/routes/$.tsx`
- Removed: Legacy implementations
```

### Update README if Needed

If there are new development commands or patterns.

---

## Linear Task Completion

### SHM-2101: Unify document.tsx

Mark as complete when:
- [ ] Both platforms use shared implementation
- [ ] All features working
- [ ] Legacy files removed
- [ ] Tests passing

### SHM-2096: Web cannot scroll on feed or discussions

Verify fixed:
- [ ] Feed scrolls on mobile web
- [ ] Discussions scroll on mobile web
- [ ] No scroll issues on desktop web

---

## Rollback Procedure

If issues found after cleanup:

1. **Git Recovery**
   ```bash
   # Restore legacy files from git history
   git checkout HEAD~N -- frontend/apps/desktop/src/pages/document.tsx
   git checkout HEAD~N -- frontend/apps/web/app/document.tsx
   ```

2. **Update Imports**
   - Revert main.tsx to use legacy document
   - Revert route files to use DocumentPage

3. **Keep New Code**
   - Don't delete the new shared implementation
   - Debug issues while legacy is running
   - Fix and re-migrate

---

## Success Criteria

Phase 6 is complete when:
1. Legacy files removed
2. No import errors
3. All tests pass
4. Full feature parity confirmed
5. No console errors
6. Performance acceptable
7. Documentation updated
8. Linear tasks closed
