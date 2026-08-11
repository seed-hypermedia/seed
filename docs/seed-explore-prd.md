# Seed Hypermedia — Explore Page PRD

## Overview

The Explore page is the primary search and discovery surface for a collaborative knowledge platform. It supports two
modes: **browsing** (no query entered, explore recently active content) and **searching** (query entered, results ranked
by relevance or recency). Users can filter results by content type, site location, author, and date range. Results are
displayed as a list — not cards — with each result answering six questions at a glance: what kind, where, who, when, why
it matched, and where exactly it opens.

## Content Types

Four content types are indexed and searchable:

| Type             | Description                              | Distinct result shape                                                 |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| **Document**     | A full page or file in the site          | Title, breadcrumb, author, date, excerpt                              |
| **Text block**   | A paragraph or section within a document | Grouped under parent document; each block shows excerpt + source link |
| **Conversation** | A threaded discussion                    | Participant avatars/names, message previews, thread link              |
| **Media**        | An image, video, or file                 | Thumbnail preview with type badge, file specs                         |

## Global UI Components

### Filter Bar

Horizontal row of compact pill-shaped dropdown buttons: `Type`, `In` (location), `Author`, `Date`. Each button opens a
dropdown panel. Active filters show a count badge next to the label. When one or more filters are active, the trigger
button gets a highlighted state.

### Active Filter Chips

When filters are active, removable chips appear below the filter bar. Each chip shows the filter category and value
(e.g. `Type: Documents`). A `×` button on each chip removes that specific filter. A "Clear all" link resets all filters
at once. Filter state persists with the query — it should be reflected in the URL.

### Content Type Tabs

A horizontal tab bar below filters: `All`, `Documents`, `Text blocks`, `Conversations`, `Media`. Each tab shows a count
of matching items in that category. Clicking a tab filters results to that type. The `All` tab is selected by default.

### Results Toolbar

A thin bar above the results list showing:

- **Left:** Summary text (total result count, and optionally the search query)
- **Right:** Sort dropdown with options: `Relevance` (when query is active), `Recently updated` (default when browsing),
  `Newest first`, `Oldest first`

### Sort Behavior

- When a search query is present, default sort is **Relevance**
- When browsing (no query), default sort is **Recently updated**
- User can override at any time

---

## Frame 1: Default Explore (Browse State)

**Trigger:** User lands on the page without entering a search query.

### Layout (top to bottom)

1. **Search input** — Empty, showing placeholder "Search documents, conversations, media…". A keyboard shortcut hint
   `⌘K` appears inside the input.

2. **Filter bar** — All four filters present, all inactive.

3. **Content type tabs** — `All` selected by default, showing total item count.

4. **Knowledge graph** _(collapsible panel)_ — A visual network showing nodes (documents, conversations, media, text
   blocks) connected by edges. Collapsed to ~160px by default; click the header bar to expand to ~460px. Legend shows
   node types with color-coding. Header shows node and connection counts.

5. **Results toolbar** — "143 items across all types" with sort set to "Recently updated".

6. **Sections** — Three content sections, each with a mono uppercase section header:
   - **Pinned** — Manually pinned items (e.g. a key architecture doc)
   - **Recently updated** — Items ordered by last-modified date, newest first. Shows a green dot + relative time
     ("Today", "Yesterday", "5d ago") next to each item.
   - **Recent meeting notes** — Meeting-specific documents

### Result Row (Document)

```
[Type badge: mono uppercase, e.g. DOCUMENT]
[Title: bold sans-serif, clickable link]
[Breadcrumb path: clickable segments separated by /] · [Author name] · [Date] · [green dot + relative time]
```

### Result Row (Conversation)

```
[Type badge: CONVERSATION]
[Title: clickable link]
[Breadcrumb] · [Date] · [green dot + time]
[Participant row: avatar initials in small circles, names, participant count, message count]
[Message previews: 2-3 message excerpts, each prefixed with author name in mono]
  Message 1: Taylor Wei — "Here are the benchmark results…"
  Message 2: Marcus Chen — "The cold-start recall on single-word…"
[Link: "Open full conversation" with arrow icon]
```

### Result Row (Media)

```
[Thumbnail: 140×88px with type badge overlay (MP4, PNG) and play icon placeholder]
[Type badge: MEDIA] [Title: clickable]
[Breadcrumb] · [Author] · [Date] · [green dot + time]
[File specs: MP4 | 12:04 | 1080p | Screen recording]
```

Video thumbnails show a play triangle icon and duration badge. Image thumbnails show an image icon.

### Result Row (Meeting Note / Document)

Same as document row above, but with an additional context field showing it belongs to "Meetings".

---

## Frame 2: Active Search State

**Trigger:** User has entered a search query ("search navigation") and applied filters.

### Layout

1. **Search input** — Pre-filled with "search navigation". Has a focused/highlighted border.

2. **Filter bar** — All four filters active, each showing a count badge:

   - Type: 2 active (Documents, Text blocks)
   - In: 3 active (Tech, Design, Notes)
   - Author: 1 active (Marcus Chen)
   - Date: 1 active (Past 6 months)

3. **Active chips** — Seven removable chips: `Type: Documents`, `Type: Text blocks`, `In: Tech`, `In: Design`,
   `In: Notes`, `Author: Marcus Chen`, `Date: Past 6 months`. Plus "Clear all" link.

4. **Content type tabs** — Updated counts reflecting filtered results. `All` selected, showing "12" total.

5. **Results toolbar** — "12 results for 'search navigation'" with sort set to "Relevance".

6. **Media tiles section** _(only visible when media matches the query)_ — A section above the text results showing
   matched media as horizontal thumbnail tiles. Header: "1 media result". Each tile is 172×108px with type badge, title,
   and metadata.

7. **Results list** — Ordered by relevance:

   a. **Document result** — Title with highlighted matching terms (`<mark>`). Breadcrumb. Author. Date. Snippet
   paragraph with additional highlighted terms.

   b. **Grouped text blocks** — Parent document shown with document icon, title, match-count badge ("2 matching
   blocks"), breadcrumb, author, date. Below the parent, indented child blocks connected by a tree-line:

   - Each child block: excerpt with highlighted matches + "Jump to source" link with external-link icon.
   - Children are separated by thin horizontal rules.

   c. **Conversation result** — Type badge: CONVERSATION. Title with highlighted terms. Breadcrumb, date. Participant
   row with avatar initials (TW, PN), names, message count. Three message excerpts with highlighted terms, each prefixed
   with author name in mono. "Open full conversation" link.

   d. **Document result** — Same shape as (a).

   e. **Standalone text block** — Not grouped because only one block matched from this document. Title, breadcrumb,
   author, date. Full excerpt with highlighted terms.

---

## Frame 3: No Results State

**Trigger:** A search query + filters produce zero matching results.

### Layout

1. **Search input** — Pre-filled with the query, highlighted border.

2. **Filter bar** — Active filters shown. Causal filters displayed as chips below.

3. **Content type tabs** — All show 0 count.

4. **Results toolbar** — "0 results for 'vector embedding performance on mobile'".

5. **Empty state** — Centered:
   - Heading: "No matching results"
   - Body: "Your search returned no results with the current filters. Try removing a filter or broadening your query."
   - Suggestion chips: clickable chips that remove the most restrictive filters (`Type: Media`, `In: Meetings`,
     `Date: Past month`, `Search all content types`). Each restrictive chip shows a `×` icon; the "Search all content
     types" chip is a positive action.

---

## Frame 4: Quick-Search Dropdown

**Trigger:** User types a partial query into the search input. The dropdown appears below the input while the user is
typing.

### Layout

1. **Search input** — Pre-filled with "search nav", highlighted border, bottom border removed so it flows into the
   dropdown.

2. **Dropdown panel** — Positioned directly below the input, same width, with a subtle shadow.

   a. **Recent searches section** — Header: "RECENT SEARCHES" (mono uppercase). Three recent queries, each with a clock
   icon. Clicking one fills the search input and executes the search.

   - "search navigation architecture"
   - "embedding index latency benchmarks"
   - "faceted search API pagination"

   b. **Results section** — Header: "RESULTS" (mono uppercase). Six compact result rows, each showing:

   - Type abbreviation (Doc, Txt, Conv, Media)
   - Title (single line, truncated with ellipsis)
   - Context line: breadcrumb path · author · date
   - Hover highlights the title
   - Text block results indicate "2 matching blocks" in the context

   c. **Footer** — A bar below the results with left-aligned "View all 12 results →" link and right-aligned "Ask Agent"
   button (with a sparkle icon). The Ask Agent action is visually and functionally separate from normal search — it
   opens the agent chat panel with the current query pre-filled.

3. **Background** — Content behind the dropdown is dimmed so the dropdown reads clearly.

### Behavior

- The dropdown opens as soon as the user types in the search input
- Clicking outside or pressing Esc dismisses it
- Arrow keys navigate between results
- Enter on a result opens it; Enter on "View all results" navigates to the full Explore page
- The shortcut hint `⌘K` is hidden when the input has text

---

## Knowledge Graph Panel

A collapsible visualization panel showing the relationship network of all indexed content.

### States

- **Collapsed** (default): ~160px tall, shows a compact graph view
- **Expanded**: ~460px tall, shows a larger graph view

### Content

- **Header bar:** Label "KNOWLEDGE GRAPH" with an accent-color dot. Right side shows node/connection counts and an
  expand/collapse chevron. Clicking the header toggles the panel.
- **Legend:** Four types with colored indicators — Documents (blue rounded rect), Conversations (accent-color circle),
  Media (green square), Text blocks (purple square).
- **Graph SVG:** Nodes rendered as shapes per type, connected by lines (edges). Three edge weights: solid (strong
  connection), thin (normal), dashed (weak). Nodes hover to brighten.

---

## Data Requirements

### Result item (all types)

```
{
  id: string
  type: "document" | "text_block" | "conversation" | "media"
  title: string
  breadcrumb: string[]          // e.g. ["Tech", "RFCs", "Search"]
  author: { name: string, initials: string }
  date: ISO date string
  updatedRelative: string       // "Today", "Yesterday", "3d ago"
  excerpt?: string              // snippet with matched terms
  highlightRanges?: [{start, end}] // positions for <mark> in title + excerpt
  url: string                   // destination link
}
```

### Document (extends base result)

```
{
  type: "document"
  // all base fields
}
```

### Text block (extends base result)

```
{
  type: "text_block"
  parentDocument: {
    id: string
    title: string
    breadcrumb: string[]
    author: { name, initials }
    date: ISO date string
  }
  isGrouped: boolean            // true if parent has multiple matching blocks
  matchCount?: number           // only when isGrouped is true
  sourceAnchor: string          // deep link to exact position within parent doc
}
```

### Conversation (extends base result)

```
{
  type: "conversation"
  participants: [{ name: string, initials: string }]
  totalParticipants: number
  messageCount: number
  messagePreviews: [{
    author: { name, initials }
    text: string                // excerpt with possible highlights
  }]
  threadUrl: string
}
```

### Media (extends base result)

```
{
  type: "media"
  mediaType: "image" | "video" | "file"
  thumbnailUrl?: string
  duration?: string             // for video, e.g. "12:04"
  resolution?: string           // e.g. "1080p"
  fileFormat: string            // "PNG", "MP4", "FIG", "PDF"
  specs: string[]               // e.g. ["Dashboard", "Grafana snapshot"]
}
```

### Filter state

```
{
  type: string[]                // ["documents", "text_blocks"]
  location: string[]            // ["Tech", "Design"]
  author: string[]              // ["Marcus Chen"]
  dateRange: { start: ISO date, end: ISO date } | "past_6_months" | "past_month" | null
}
```

### Graph data

```
{
  totalNodes: number
  totalConnections: number
  nodes: [{
    id: string
    type: "document" | "conversation" | "media" | "text_block"
    label?: string              // for key nodes visible in collapsed view
    x: number, y: number        // pre-computed layout position
  }]
  edges: [{
    source: nodeId
    target: nodeId
    strength: "strong" | "normal" | "weak"
  }]
}
```

### Quick-search data

```
{
  recentSearches: string[]      // last N queries, stored locally
  quickResults: BaseResult[]    // top 6 results, mixed types
  totalResults: number
}
```

---

## Interaction Summary

| Action                               | Behavior                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Type in search input                 | Opens quick-search dropdown. After debounce (150ms), fetches and shows top 6 mixed results + recent searches |
| Press Enter in search input          | Closes dropdown, navigates to full results (Frame 2 state)                                                   |
| Click filter button                  | Opens filter dropdown panel for that category                                                                |
| Click a filter option                | Adds filter, updates chips bar, re-fetches results                                                           |
| Click `×` on a filter chip           | Removes that filter, re-fetches                                                                              |
| Click "Clear all"                    | Removes all filters, resets to browse state                                                                  |
| Click content type tab               | Filters results to that type, updates counts                                                                 |
| Change sort dropdown                 | Reorders results                                                                                             |
| Click result row                     | Navigates to the item (document, conversation, media)                                                        |
| Click "Jump to source" on text block | Navigates to exact position within parent document                                                           |
| Click "Open full conversation"       | Opens the threaded conversation view                                                                         |
| Click "Ask Agent" in dropdown        | Opens agent chat panel with query pre-filled                                                                 |
| Click knowledge graph header         | Expands/collapses graph panel                                                                                |
| Press Esc                            | Dismisses quick-search dropdown                                                                              |
| Arrow keys in dropdown               | Navigates between result items                                                                               |
| Click thumbnail/media tile           | Opens the media item                                                                                         |

## States Not Covered in Mockups (but expected in implementation)

- **Loading:** Skeleton placeholders while results are fetched
- **Error:** Inline error message if search API fails, with retry option
- **Empty browse:** If the site has zero content, show onboarding/empty state
- **Filter dropdown open:** Each filter category has its own dropdown panel with checkbox/date-picker UI
- **Pagination:** Cursor-based or offset-based loading for result sets > visible items
