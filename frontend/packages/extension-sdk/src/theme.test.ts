import {describe, expect, it} from 'vitest'
import {applyTheme, injectBaseStyles, seedBaseStyles} from './theme'

describe('theme helpers', () => {
  it('applyTheme mirrors the host theme onto the document', () => {
    applyTheme({theme: 'dark'})
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyTheme({theme: 'light'})
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('injectBaseStyles adds the stylesheet once', () => {
    injectBaseStyles()
    injectBaseStyles()
    const styles = document.querySelectorAll('#seed-extension-base-styles')
    expect(styles.length).toBe(1)
    expect(styles[0]?.textContent).toBe(seedBaseStyles)
    expect(seedBaseStyles).toContain('[data-theme="dark"]')
  })
})
