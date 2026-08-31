import type {ExtensionContext} from '@seed-hypermedia/client/extensions'

/**
 * Mirror the host theme onto the document so CSS keyed on `[data-theme=dark]`
 * (see {@link seedBaseStyles}) and native form controls follow the host.
 */
export function applyTheme(context: Pick<ExtensionContext, 'theme'>, doc: Document = document): void {
  const root = doc.documentElement
  root.dataset.theme = context.theme
  root.style.colorScheme = context.theme
}

/**
 * A handful of CSS custom properties that match the host's look in both
 * themes. Inject once (see {@link injectBaseStyles}) and use the variables in
 * your own stylesheet: `background: var(--seed-bg); color: var(--seed-fg)`.
 */
export const seedBaseStyles = `
:root {
  --seed-bg: #ffffff;
  --seed-fg: #1a1a1a;
  --seed-muted: #6b7280;
  --seed-accent: #2563eb;
  --seed-border: #e5e7eb;
  --seed-surface: #f9fafb;
  --seed-danger: #dc2626;
  --seed-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --seed-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
[data-theme="dark"] {
  --seed-bg: #111111;
  --seed-fg: #f3f4f6;
  --seed-muted: #9ca3af;
  --seed-accent: #60a5fa;
  --seed-border: #2a2a2a;
  --seed-surface: #1b1b1b;
  --seed-danger: #f87171;
}
html, body {
  margin: 0;
  background: var(--seed-bg);
  color: var(--seed-fg);
  font-family: var(--seed-font);
}
`

const STYLE_ID = 'seed-extension-base-styles'

/** Append {@link seedBaseStyles} to `<head>` once. Safe to call repeatedly. */
export function injectBaseStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = seedBaseStyles
  doc.head.appendChild(style)
}
