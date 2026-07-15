/**
 * Block content types that are selected as whole nodes (atoms) rather than
 * placing a text cursor: clicking them makes a NodeSelection and arrow keys
 * step over them as units.
 *
 * Standalone module so selection plugins can import it without pulling in the
 * full editor/schema graph.
 */
export const selectableNodeTypes = ['image', 'file', 'embed', 'video', 'web-embed', 'math', 'button', 'query']
