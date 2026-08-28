# Site Header Home Navigation Design

## Goal

Add a fixed Home destination as the first site-header navigation item in every layout, and move Horizontal navigation
beside the site branding while preserving responsive overflow behavior.

## Header composition

`SiteHeader` will derive a presentation-only Home navigation item from `siteHomeId`. Its label is always `Home`, its
destination is the root home document, and its stable key cannot collide with persisted navigation entries. The derived
item is prepended to configured items before desktop or mobile navigation renders. It is never written to the document's
detached navigation block.

The Home item appears in every navigation layout:

- Horizontal places branding at the far left and navigation immediately beside it. Flexible remaining space separates
  navigation from search and right-side actions.
- Center preserves its centered, stacked branding and navigation layout.
- Mobile presents Home first in the same list as configured destinations.

The Activity Feed control remains separate and follows document navigation.

## Responsive overflow

Home and configured destinations enter `useResponsiveItems` as one ordered collection. Hidden measurement elements
measure the rendered width of every label; the width estimator is only a fallback when an element cannot be measured.

The calculation reserves space for controls that are actually present, including the overflow trigger, Activity Feed,
editing controls, gaps, and padding. It uses the navigation container's real width after the Horizontal layout places
branding beside it. Items that fit stay visible in original order, and all remaining items appear in the dropdown in
original order.

Home has no permanent visibility preference and may move into the dropdown like any configured item. Existing
active-item priority remains: the active destination stays visible when possible. Home is active only when the current
document is the root home document. On nested documents, Home is inactive and the most specific matching configured
destination is active.

Resize observation recalculates visibility when the viewport or navigation container changes. Changes to branding,
actions, editing controls, or labels must also result in an accurate recalculation. The dropdown remains mouse- and
keyboard-accessible and exposes every overflowed destination.

## Navigation settings

The settings preview prepends Home in Horizontal and Center layouts. The editable list should also show Home first as a
locked row when this can be added without complicating persistence or drag-and-drop behavior. The locked row has no
drag, edit, or remove controls and is explicitly presented as fixed.

All mutations continue to operate only on configured items. Home is excluded from dirty-state comparisons, duplicate
checks, reorder operations, and the saved navigation block.

## Testing

Automated coverage will verify:

1. Home is prepended without mutating configured navigation data.
2. Home links to the site root and is active only on the root home document.
3. Home appears first in Horizontal, Center, and mobile navigation.
4. Horizontal navigation sits beside branding while Center remains stacked and centered.
5. Responsive visibility preserves item order.
6. Home may overflow under the same rules as configured items.
7. Active-item visibility priority continues to work.
8. Every non-visible item is available in the overflow dropdown.
9. Container and reserved-width changes recalculate visibility.
10. Settings preview and the locked row include Home without changing saved navigation data.
11. Existing desktop and web navigation-loading behavior remains stable.

Manual verification will cover wide, medium, and narrow widths in both layouts, including overflow menu interaction,
mobile navigation, active states, settings preview, custom-item editing, and persistence.

## Out of scope

- Persisting or migrating a Home navigation record.
- Changing the Center layout's positioning.
- Moving the Activity Feed into the document navigation model.
- Changing the site's branding link or label.
