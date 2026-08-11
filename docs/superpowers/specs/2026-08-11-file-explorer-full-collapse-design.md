# File Explorer Full Collapse Design

## Goal

When the desktop file explorer is collapsed, remove the explorer panel and its residual rail completely. Preserve the
existing expand control, tooltip, icon, and behavior, but place the control over the top-left corner of the main content
area.

## Desktop Behavior

- The open state remains unchanged: the resizable file explorer is visible with its existing collapse control.
- Collapsing removes the file explorer panel, resize handle, border, and all reserved horizontal space.
- While collapsed, the main content occupies the full available layout width.
- The expand control is rendered only while the explorer is collapsed.
- The expand control is absolutely positioned at the top-left of the main content container.
- Its top inset and control height visually align with the Publish and three-dot actions at the top-right.
- Clicking the control restores the file explorer using the current behavior.
- The existing “Show file explorer” tooltip, accessible label, `FolderTree` icon, and interaction behavior are
  preserved.
- The open explorer's collapse control uses the same plain `PanelLeft` icon as the main desktop app sidebar control.

## Mobile and Server Rendering

- Mobile drawer behavior is unchanged.
- Server rendering continues to show the existing static file explorer placeholder before client sizing is known.

## Implementation

`SiteFileBrowserLayout` continues to own the collapsed state. The collapsed-state rail is removed. The main content
wrapper becomes the positioning container and conditionally renders the existing expand tooltip/button in a top-left
absolute overlay. No new component API or portal is introduced.

## Tests

Update the existing `SiteFileBrowserLayout` tests to verify:

- the collapsed explorer and resize handle reserve no layout rail;
- the expand control appears only in the collapsed state;
- the control is positioned as a top-left absolute overlay within the main content container;
- clicking the expand control restores the explorer and hides the expand control;
- existing mobile and server-rendering behavior remains unchanged.

## Out of Scope

- Changing the open explorer’s appearance, default width, or resize constraints.
- Changing the mobile file-browser drawer.
- Changing Publish or three-dot action positioning.
- Introducing new animation or persistence behavior for collapse state.
