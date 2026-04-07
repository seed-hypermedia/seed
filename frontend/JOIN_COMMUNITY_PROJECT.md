# Join Community Project

## Problem

The Join button was released but got zero new members in 24 hours across power communities (xlavapies, seed, ethosfera, lunaticoin, semillabitcoin). Users don't understand that a Site is a Community they can join.

## Goal

Make joining more visible and intuitive. Three changes:

### 1. Move the Join button — replace the Subscribe button in the header

**Current state:**
- The header (`site-header.tsx`) has a green "Subscribe" button in the top-right that opens an email subscription dialog.
- The "Join" button currently lives in a floating footer (`FloatingAccountFooter`) at the bottom of the page — easy to miss.

**What to do:**
- Remove the "Subscribe" button from the header.
- Put the "Join" button in its place (top-right of the header).
- The Join button has 3 states depending on the user:
  1. **Not logged in** → Show "Join" button → triggers account creation flow
  2. **Logged in, not joined** → Show "Join" button + account avatar → triggers `joinSite()`
  3. **Logged in, already joined** → Show account avatar only (no Join button)

**Key files:**
- `frontend/packages/ui/src/site-header.tsx` — Header component. Lines 176-179 render the Subscribe button (center layout) and lines 203-211 (non-center layout). Replace these with the Join button.
- `frontend/packages/ui/src/join-button.tsx` — Existing shared JoinButton component.
- `frontend/apps/web/app/web-utils.tsx` — `WebAccountFooter` has the 3-state join logic (lines 94-112). This logic needs to move to the header. The `rightActions` prop on `SiteHeader` is likely the insertion point.
- `frontend/packages/ui/src/floating-account-footer.tsx` — Current floating footer with join/account buttons. May be removed or simplified once Join moves to header.

---

### 2. Add Members Box (facepile) to the homepage

**Current state:**
- Site members are listed in the "People" tab (`collaborators-page.tsx`) as a vertical list.
- No compact member display exists on the home page.

**What to do:**
- Add a wide banner at the top of the site home page content area showing:
  - Overlapping avatar circles of community members (facepile)
  - Member count + descriptive text (e.g. "+86 Designed for collaboration, allowing people to link ideas and build shared knowledge.")
  - This should be prominent/intrusive — the goal is to signal "this is a community with real people"

**Key files:**
- `frontend/packages/ui/src/resource-page-common.tsx` — Main page renderer. The facepile banner should go above the content/tabs area on the site home page.
- `frontend/packages/shared/src/models/entity.ts` — `useSiteMembers()` hook (line ~659) returns `grantedMembers` and `members` arrays.
- `frontend/packages/ui/src/collaborators-page.tsx` — Existing member list rendering, can reference for member data shape.
- `frontend/packages/ui/src/avatar.tsx` — `UIAvatar` component for rendering member avatars.

**Design reference (from screenshots):**
- Wide bar spanning the content width
- 3 overlapping circular avatars on the left
- "+86" count in bold, followed by the site description text
- Light background, subtle border

---

### 3. Add Subscribe Box inline in published content

**Important: This is NOT a block** (not a BlockNote editor block). It's a UI element injected into the published content stream for non-members.

**Current state:**
- Email subscription only exists as a modal dialog (`subscribe-dialog.tsx`) triggered from the header button.
- No inline subscribe prompt exists in published content.

**What to do:**
- When a non-member scrolls through published content on any document page, show an inline subscribe card between content blocks.
- The card should have:
  - Prompt text: "Do you like what you are reading? Subscribe to receive updates."
  - Email input field + Subscribe button
  - "Unsubscribe anytime" note
  - Warm/inviting styling (yellow/beige background in the design)
- Should appear roughly after the first few content blocks (not at the very top, not at the very bottom).
- Only shown to users who haven't joined the site.

**Key files:**
- `frontend/packages/ui/src/blocks-content.tsx` — Published content renderer. The subscribe box needs to be injected between rendered blocks here (but it's NOT a block type — it's a UI injection).
- `frontend/packages/ui/src/subscribe-dialog.tsx` — Existing subscribe logic/mutation (`useSubscribeToNotifications`). Reuse the same API call.
- `frontend/packages/shared/src/models/email-notifications.ts` — The `useSubscribeToNotifications()` mutation hook.

---

## Manual Testing Steps

### Prerequisites

1. Start the daemon:
   ```bash
   ./dev run-backend
   ```
2. Start the web app (separate terminal):
   ```bash
   ./dev run-web
   ```
3. Open `http://localhost:3000` in your browser.

**Important:** The default dev scripts (`./dev run-web`, `pnpm web:standalone`) do NOT set `NOTIFY_SERVICE_HOST`. This means the inline subscribe box will NOT appear by default. To test the subscribe box, you need to start the web app with that env var set:

```bash
# Option A: Point to the real notification service
NOTIFY_SERVICE_HOST=https://hyper.media ./dev run-web

# Option B: Run the notify service locally (separate terminal)
# See `pnpm notify:standalone` for the full command
```

If you don't need to test the subscribe box (e.g., just testing Join button and facepile), the normal dev setup works fine.

---

### Step 1: Test the Join Button (3 states)

#### State 1: Not logged in, not joined
1. Open an **incognito/private** browser window.
2. Navigate to a site home page (e.g., `http://localhost:3000`).
3. **Look at the header top-right area.**
4. **Expected:** A green "Join" button appears where the old "Subscribe" button used to be. No account avatar anywhere.
5. The old "Subscribe" button should NOT be in the header.

#### State 1b: Click Join (account creation)
1. Click the "Join" button.
2. **Expected:** The account creation dialog opens.
   - On web with vault enabled: redirects to `hyper.media` for sign-up.
   - On web with local keys (7-tap): shows the local account creation form.
3. Complete the account creation flow.

#### State 2: Logged in, not joined
1. After creating an account in State 1b, you're now logged in.
2. If account creation auto-joined you, clear site data (DevTools → Application → Storage → Clear site data) and recreate an account using the 7-tap local key method (this won't auto-join).
3. **Expected:** The header shows BOTH:
   - The green "Join" button
   - Your account avatar (small circle)
4. Click "Join" → should join the site immediately (no redirect).

#### State 3: Logged in, already joined
1. After joining in State 2, stay on that site.
2. **Expected:** The header shows ONLY your account avatar. The "Join" button is gone.

#### Verify on non-home pages
1. Navigate to a child document (e.g., `http://localhost:3000/some-doc`).
2. The same Join/avatar logic should apply in the header on every page, not just the home page.

#### Verify on the feed page
1. Navigate to the feed (clock icon in the header nav).
2. The Join button / avatar should also appear in the feed page header.

---

### Step 2: Test the Members Facepile

#### Setup: Need at least 1 member
1. You need a site with at least one joined member. Complete the Join flow from Step 1.
2. The member who joined should now appear in the facepile.

#### Test
1. Go to the site's **home page** (the root URL, e.g., `http://localhost:3000`).
2. **Look below the cover image (if any) and above the Content/People/Comments tabs.**
3. **Expected:** A bordered banner appears showing:
   - Overlapping circular avatars (up to 3)
   - Member count text, e.g., "+5 Designed for collaboration..." (using the site's summary text)
   - If no summary, shows "N members collaborating"
4. Open an incognito window (no account) and visit the same home page.
5. **Expected:** The facepile still appears (it's informational, not gated by login).

#### Edge cases
- **0 members:** The facepile banner should NOT appear.
- **1 member:** Shows 1 avatar + "1 member collaborating".
- **Non-home pages:** The facepile should NOT appear on child documents, only on the site home (root path).

---

### Step 3: Test the Inline Subscribe Box

**Prerequisite:** You must start the web app with `NOTIFY_SERVICE_HOST` set (see Prerequisites above). Without it, the subscribe box will never appear — this is intentional.

#### Test (not logged in)
1. Start web with: `NOTIFY_SERVICE_HOST=https://hyper.media ./dev run-web`
2. Open an **incognito window** (not logged in).
3. Navigate to a document page that has **at least 4 content blocks** (headings, paragraphs, images, etc.).
4. Scroll down.
5. **Expected:** After the 3rd content block, an amber/warm-colored card appears:
   - Text: "Do you like what you are reading? Subscribe to receive updates."
   - Email input field + green "Subscribe" button
   - "Unsubscribe anytime" note below
6. Enter an email (e.g., `test@example.com`) and click Subscribe.
7. **Expected:** The card changes to a green success message confirming the email.

#### Test (logged in, not joined)
1. Create an account (but don't join the site).
2. Navigate to the same document.
3. **Expected:** The subscribe box still appears (you haven't joined).

#### Test (logged in, joined)
1. Join the site.
2. Navigate to the same document.
3. **Expected:** The subscribe box does NOT appear.

#### Edge cases
- **Document with fewer than 3 blocks:** The subscribe box should NOT appear (not enough content to interrupt).
- **`NOTIFY_SERVICE_HOST` not set:** The subscribe box should NOT appear at all (graceful degradation).
- **Home page vs child pages:** The subscribe box appears on any document with enough blocks, not just the home page.

---

### Quick Reference: Simulating Different Users

| State | How to simulate |
|-------|----------------|
| **Anonymous (no account)** | Incognito/private window |
| **Logged in, not joined** | Create account via 7-tap local key, don't click Join |
| **Logged in, joined** | Create account, then click the Join button |
| **Reset to anonymous** | DevTools → Application → Storage → Clear site data |
| **Second user** | Different browser (Chrome vs Firefox) or second incognito profile |

### Environment Reference

| Service | URL |
|---------|-----|
| Web app | `http://localhost:3000` (or `:3099` for `web:standalone`) |
| Daemon HTTP | `http://localhost:58001` |
| Daemon gRPC | `localhost:56002` |
| Vault (identity) | `https://hyper.media` (requires internet) |

### What changed (files)

| File | Change |
|------|--------|
| `packages/ui/src/site-header.tsx` | Removed Subscribe button and dialog |
| `packages/ui/src/join-button.tsx` | Added `variant` prop (header vs floating) |
| `apps/web/app/web-utils.tsx` | New `WebHeaderActions` component, simplified `WebAccountFooter` |
| `apps/web/app/web-resource-page.tsx` | Wires `rightActions` + `inlineInsert` into ResourcePage |
| `apps/web/app/web-feed-page.tsx` | Wires `rightActions` into FeedPage |
| `packages/ui/src/feed-page-common.tsx` | Added `rightActions` prop |
| `packages/ui/src/members-facepile.tsx` | New component |
| `packages/ui/src/resource-page-common.tsx` | Facepile on homepage + `inlineInsert` threading |
| `packages/ui/src/inline-subscribe-box.tsx` | New component |
| `packages/ui/src/blocks-content.tsx` | `inlineInsert` context + injection in block rendering |
