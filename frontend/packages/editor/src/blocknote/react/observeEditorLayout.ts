/**
 * Calls `onChange` when the editor's content changes size, which moves the
 * blocks below it without firing a scroll, window resize or transaction (an
 * embed, KaTeX or media block finishing its render, for example). Watches the
 * editor's children too, because the editor itself may have a fixed or minimum
 * height that hides content growth. Returns a cleanup function.
 */
export function observeEditorLayout(editorDom: Element | null | undefined, onChange: () => void): () => void {
  if (!editorDom || typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(() => onChange())
  observer.observe(editorDom)
  Array.from(editorDom.children).forEach((child) => observer.observe(child))
  return () => observer.disconnect()
}
