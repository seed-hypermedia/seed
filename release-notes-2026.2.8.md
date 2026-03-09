## ✨ Features
- Implement desktop notification system with notification server syncing
- Add navigation guard system with leave-draft dialog on unsaved changes
- Add comment deletion functionality with confirmation dialog and ownership checks
- Rename `:discussions` route to `:comments` with context-aware comment URLs
- Add duplicate document functionality with auto-focus on title
- Redesign DocumentCard footer with action buttons and DocumentActionsContext
- Add ShadCN-style sidebar components and subscription UX improvements
- Add action buttons and improved styles to DocumentListItem
- Implement `useIsLatest` hook to determine document version status
- Preserve panel query params across all view-term routes
- Improve mobile panel sheet accessibility with URL routing integration
- Integrate vault into HM sites with session management and account key UI
- Support `path="*"` wildcard in ListCapabilities for site-wide collaborator listing
- Add "started a discussion" notification type with email notifications for new discussions
- Rename "Delete Draft" to "Discard Changes" with updated icon
- Add document visibility selection in markdown import
- Editor refactor: rename PM nodes, flatten DOM, add editor commands unit tests
- Notification read/unread toggle with LWW timestamp sync fix
- Show notification count in title bar

## 🐛 Bug Fixes
- Add tiebreaker for same-millisecond ordering in backend
- Handle redirect errors more robustly in `getErrorMessage`
- Include `parent` in subscription check for SubscriptionButton
- Fix stale email validation UI
- Fix sometimes missing doc title in mention notifications
- Fix invalidation when changing email notification service
- Improve notifications page visuals for unverified email
- Reduce excessive notification state invalidation
- Graceful degradation on semantic search failure in hybrid mode
- Fix false `SlowQuery` warnings from stale transaction tracking in SQLite
- Handle `SQLITE_BUSY` in P2P connection address persistence
- Hide Subscribe button on desktop app
- Fix `suppressHydrationWarning` on SizableText and paragraph elements
- Restore web site import button on desktop
- Fix CI: add missing GGUF model download, Docker build context, macOS Metal target, and llama-go go.mod copy
- Add `libgomp1` to Docker runtime image for OpenMP support
- Add `-buildvcs=false` to seed-daemon build for sandbox compatibility
- Improved short date format to always show time
- Fix notification timestamp display to match sort order

[Full Changelog: 2026.2.6...2026.2.8](https://github.com/seed-hypermedia/seed/compare/2026.2.6...2026.2.8)
