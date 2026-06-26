import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

/**
 * Guards against theme-token drift between the web vault and the desktop app.
 *
 * Shared @shm/ui components (the account-settings sidebar, etc.) are styled with
 * Tailwind utilities like `bg-sidebar-accent` that resolve to `--color-*` theme
 * tokens. If the vault doesn't define a token the desktop app does, those
 * utilities silently render with no color. This test fails when the vault is
 * missing any `--color-*` token the desktop app defines, so the gap is caught at
 * build time instead of as an invisible UI bug.
 */
function colorTokens(cssPath: string): Set<string> {
  const css = readFileSync(cssPath, 'utf8')
  const names = new Set<string>()
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
    names.add(match[1]!)
  }
  return names
}

describe('theme token contract', () => {
  const dir = import.meta.dir // vault/src/frontend
  const vault = colorTokens(resolve(dir, 'styles.css'))
  const desktop = colorTokens(resolve(dir, '../../../frontend/apps/desktop/src/tailwind.css'))

  test('the vault defines every --color-* token the desktop app defines', () => {
    const missing = [...desktop].filter((token) => !vault.has(token)).sort()
    expect(missing).toEqual([])
  })
})
