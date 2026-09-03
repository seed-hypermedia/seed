# Document Options Cleanup Design

## Goal

Make document navigation easier to scan by removing redundant destinations from the three-dot menu and keeping Attributes visible in document tools.

## Design

- Remove `Sub documents`, `All Documents`, and `Attributes` from document three-dot menus on web and desktop.
- Always render the `Attributes` document-tools tab, including when its custom-attribute count is zero.
- Order remaining menu actions by intent: creation, document management, sharing/publication, organization, output, utilities, and finally destructive actions.
- Reuse the existing separator before destructive actions rather than expanding the shared menu API with new group markers.

## Testing

- Verify menu cleanup and semantic ordering through a pure shared menu-ordering helper.
- Render document tools with zero attributes and verify that the Attributes tab and zero count are present.

## Scope

This change only affects the document three-dot menu and document-tools tab visibility. The removed Sub documents and All Documents destinations remain available elsewhere in the application.
