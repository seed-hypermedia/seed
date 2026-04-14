# Vault Settings Redesign — Design Proposals

## Problem

The current vault settings UI exposes cryptographic terminology (keys, principals, mnemonics, delegations) that confuses normal users. We need to redesign the vault settings screens with fully simplified language and intuitive metaphors that feel familiar to mainstream users.

## Terminology Mapping

| Current (Crypto) | Proposed (Simplified) |
|---|---|
| Key | Account |
| Principal | Account ID |
| Passkey | Biometric Login |
| Session key / Delegation | Connected Site |
| Import key | Add from Backup |
| Export key | Back Up Account |
| Mnemonics / Recovery phrase | *(deprecated — backup file flow instead)* |

## Information Hierarchy

The vault has two distinct levels that every approach must respect:

- **Vault level** (applies to ALL accounts): Biometric Login, Master Password, Email Address
- **Account level** (per individual account): Profile, Account ID, Connected Sites, Back Up Account, Delete Account

We do NOT know backup status — never display "backed up" / "not backed up" badges.

## Implementation Notes

- All wireframes use **shadcn/ui** component patterns (cards, buttons, inputs, badges, sidebar, drawer)
- **Typography**: Inter (headings/body), Geist Mono (Account IDs)
- **Frame sizes**: Desktop 1280x800, Mobile 390x844

---

## Approach 1: Digital Wallet

**Mental model**: A wallet holding identity cards. You open it, see your cards, tap one for details.

**Navigation pattern**: Grid browse → detail view (back arrow to return)

**Structure**:
- **Home screen**: Card grid showing all accounts. Each card displays avatar, name, truncated Account ID, and connected sites count. "Settings" button in the header opens vault-level settings (biometric, password, email).
- **Account detail**: Two-column layout — profile card on the left (name, description, Account ID, actions), connected sites list on the right. Actions: Edit Profile, Back Up Account, Delete.
- **Mobile**: Cards stack vertically. Detail becomes single-column scroll.

**What makes it different**:
- Accounts are browseable as physical-feeling cards with subtle shadows
- Each card is a self-contained preview — you can see at a glance how many sites use it
- The vault settings (biometric/password/email) are accessed via a separate "Settings" button, keeping them clearly separated from per-account settings
- Best for users who think of their identities as distinct "things" they carry

**Tradeoffs**:
- (+) Strongest visual metaphor — wallet cards are universally understood
- (+) Each account feels like a distinct, tangible object
- (-) Requires navigation to see account details (no glanceable detail)
- (-) Vault settings hidden behind a button — users might not discover them

---

## Approach 2: Profile Hub

**Mental model**: Social media profile page with account switching.

**Navigation pattern**: Horizontal chip switcher → inline profile + settings below

**Structure**:
- **Main view**: Account chips at the top (horizontal pills). Selected account shows large centered avatar, name, description, Account ID, and action buttons. Right column shows connected sites list with device icons and dates.
- **Vault settings**: Separate "settings" screen (gear icon) with auth methods (biometric, password) and email address. Accessible from main view header.
- **Mobile**: Chips become horizontally scrollable. Content stacks vertically.

**What makes it different**:
- Profile-centric — the avatar is the dominant visual element, making it feel personal
- Chip switcher makes multi-account management feel like switching between social profiles (Instagram-like pattern)
- Connected sites are always visible alongside the profile, showing the relationship between identity and where it's used
- Account actions (Edit Profile, Back Up) live directly on the profile card

**Tradeoffs**:
- (+) Most familiar pattern for mainstream users (social media settings)
- (+) Profile-first design makes the "who am I" question immediately answerable
- (+) Chip switcher scales well for 3-5 accounts
- (-) Chip switcher could get crowded with 10+ accounts (horizontal scroll needed)
- (-) Vault settings require navigating to a separate screen

---

## Approach 3: Unified Dashboard

**Mental model**: Mission control / control room. Everything visible at once.

**Navigation pattern**: Three-column layout — all information on one screen, no navigation needed

**Structure**:
- **Desktop**: Three columns side by side:
  - **Left**: Account list sidebar with avatars + names. Create Account and Add from Backup buttons at bottom.
  - **Center**: Selected account detail — profile header, action buttons (Edit Profile, Back Up, Delete), and connected sites list below.
  - **Right**: Vault Settings panel — Biometric Login and Master Password as toggle rows, plus Account Email below.
- **Mobile**: Replaced by a 3-tab layout (Accounts | Details | Vault) with each tab showing one column's content.

**What makes it different**:
- The only approach where vault settings AND account details are visible simultaneously on desktop
- Zero navigation clicks to see everything — ideal for users who manage multiple accounts frequently
- The three-column layout creates clear visual separation between the "what" (accounts list), the "who" (account detail), and the "how" (vault security)
- Mobile tabs maintain the same mental model, just serialized

**Tradeoffs**:
- (+) Most information-dense — power users see everything at a glance
- (+) Clear spatial separation of concerns (accounts / detail / security)
- (+) No modals, drawers, or secondary screens on desktop
- (-) Busiest layout — could feel overwhelming for non-technical users
- (-) Three columns require a wide viewport; mobile experience is fundamentally different (tabs)
- (-) Less breathing room per section

---

## Approach 4: Sidebar Navigation

**Mental model**: Native app settings (Notion, Slack, VS Code). Sidebar = table of contents.

**Navigation pattern**: Persistent sidebar with navigation categories → spacious content area on the right

**Structure**:
- **Sidebar**: Account switcher dropdown at top, then two groups:
  - **ACCOUNT**: Profile, Connected Sites, Backup & Restore
  - **VAULT**: Sign-in & Security, Email
- **Content area**: Full-width, generous padding. Shows the selected section:
  - Profile: avatar, display name input, description input, Account ID display, Save/Cancel
  - Sign-in & Security: Biometric Login + Master Password rows with Active badges and Manage/Change actions, plus Email Address row
- **Mobile**: Sidebar collapses. Navigation becomes a stacked list or hamburger menu.

**What makes it different**:
- The sidebar explicitly labels the hierarchy: "ACCOUNT" group vs "VAULT" group — the structure itself teaches users the difference
- Each section gets full breathing room with generous whitespace
- Scales infinitely — adding new settings sections just adds sidebar items
- The content area feels like a real form/settings page, not a card or dashboard
- Account switcher dropdown works well regardless of account count

**Tradeoffs**:
- (+) Most scalable — adding future settings sections doesn't change the layout
- (+) Sidebar labels make the vault/account hierarchy self-documenting
- (+) Familiar pattern from every native app settings page
- (+) Account switcher dropdown handles any number of accounts gracefully
- (-) Requires multiple clicks to navigate between sections
- (-) Only one section visible at a time — no cross-referencing
- (-) Mobile sidebar patterns (hamburger/sheet) have known discoverability issues

---

## Approach 5: Guided Layers

**Mental model**: Apple-like progressive disclosure. Simple surface, detail on demand.

**Navigation pattern**: Tile grid (home) → slide-over drawer (detail). Drawer closes to return.

**Structure**:
- **Home surface**: Account tiles in a relaxed grid (avatar + name), a summary card showing "3 accounts in your vault" plus vault security status (biometric active, password set). "Vault Settings" button in header. Create Account and Add from Backup buttons below.
- **Account drawer**: Slide-over panel from the right showing full account detail — name, description, Account ID, Edit Profile and Back Up buttons, connected sites list, Delete Account at bottom. Background dims to show layering.
- **Mobile**: Tiles become compact vertical list. Drawer becomes full-screen sheet.

**What makes it different**:
- Lowest cognitive load on first view — the home surface shows just tiles and a summary, nothing intimidating
- Progressive disclosure: complexity only appears when you ask for it (tap a tile → drawer opens)
- The drawer pattern means you never "leave" the home view — closing the drawer returns you to the same place
- Vault settings summary is visible on the home surface (biometric active, password set) without requiring navigation
- The dimmed background when a drawer is open creates a clear visual hierarchy

**Tradeoffs**:
- (+) Most approachable — non-technical users won't feel overwhelmed
- (+) Drawer pattern is forgiving — close = return to safety
- (+) Home surface provides a vault-level health overview at a glance
- (+) Works equally well on desktop and mobile (drawer → sheet)
- (-) Requires a tap to see any account details
- (-) Drawer overlays the home surface, so you can't see the overview while in detail
- (-) Vault security stats on home surface could become stale or misleading

---

## Structural Comparison

| Dimension | 1. Wallet | 2. Hub | 3. Dashboard | 4. Sidebar | 5. Layers |
|---|---|---|---|---|---|
| **Account browsing** | Card grid | Chip switcher | Sidebar list | Dropdown | Tile grid |
| **Account detail** | Separate page | Inline below chips | Middle column | Content area | Slide-over drawer |
| **Vault settings location** | Header button | Separate screen | Right column | Sidebar section | Header button + summary |
| **Clicks to see account detail** | 1 (tap card) | 1 (tap chip) | 1 (tap sidebar item) | 1 (tap sidebar item) | 1 (tap tile) |
| **Clicks to vault settings** | 1 (settings button) | 2 (gear → screen) | 0 (always visible) | 1 (tap sidebar item) | 1 (settings button) |
| **Max accounts before scroll** | ~6 (grid) | ~5 (chips) | ~8 (sidebar list) | unlimited (dropdown) | ~6 (grid) |
| **Desktop navigation model** | Browse → detail | Switch → inline | All-at-once | Category nav | Browse → drawer |
| **Mobile adaptation** | Stack cards | Scroll chips | Tabs | Collapsed nav | Full-screen sheet |
| **Information density** | Low-medium | Medium | High | Medium | Low |
| **Vault/account separation** | Implicit (button) | Separate screen | Spatial (columns) | Labeled groups | Summary + button |

## Recommendation

All 5 approaches are viable. The choice depends on user research:

- **Most familiar**: Approach 2 (Profile Hub) or Approach 4 (Sidebar Nav) — users have seen these patterns before
- **Most powerful**: Approach 3 (Unified Dashboard) — everything visible at once, zero navigation
- **Most approachable**: Approach 5 (Guided Layers) — lowest cognitive load, progressive disclosure
- **Most distinctive**: Approach 1 (Digital Wallet) — strongest metaphor, most "product-y" feel
- **Most scalable**: Approach 4 (Sidebar Nav) — handles growth in settings and accounts gracefully

**Key question for the team**: How many accounts will a typical user have? If 1-3, approaches 1/2/5 work great. If 10+, approaches 3/4 handle scale better.

Consider testing Approach 5 (Guided Layers) with non-technical users and Approach 4 (Sidebar Nav) with power users.
