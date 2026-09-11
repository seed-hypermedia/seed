// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {TooltipProvider} from '../../tooltip'
import {DateValueField as RawDateValueField, formatInstant, formatIsoDate, parseIsoDate} from '../date-field'

const DateValueField = (props: Parameters<typeof RawDateValueField>[0]) => (
  <TooltipProvider>
    <RawDateValueField {...props} />
  </TooltipProvider>
)

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('date helpers', () => {
  it('round-trips a calendar date without timezone drift', () => {
    const d = parseIsoDate('2026-08-26')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(26)
    expect(formatIsoDate(d)).toBe('2026-08-26')
    expect(parseIsoDate('nope')).toBeUndefined()
    expect(parseIsoDate('2026-8-26')).toBeUndefined()
  })
  it('formats an instant as RFC 3339 UTC with seconds precision', () => {
    expect(formatInstant(new Date(Date.UTC(2026, 7, 26, 14, 30, 5, 250)))).toBe('2026-08-26T14:30:05Z')
  })
})

describe('DateValueField', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows a placeholder when empty and the readable date when set', () => {
    act(() => root.render(<DateValueField value="" mode="date" onValue={() => {}} />))
    const button = container.querySelector('[data-testid="date-field"]')!
    expect(button.textContent).toContain('Pick a date')
    act(() => root.render(<DateValueField value="2026-08-26" mode="date" onValue={() => {}} onClear={() => {}} />))
    const set = container.querySelector('[data-testid="date-field"]')!
    expect(set.getAttribute('data-value')).toBe('2026-08-26')
    expect(set.textContent).toMatch(/2026/)
    expect(container.querySelector('[aria-label="Clear date"]')).toBeTruthy()
  })

  it('shows a non-parsable value verbatim so nothing is lost', () => {
    act(() => root.render(<DateValueField value="sometime in spring" mode="date" onValue={() => {}} />))
    expect(container.querySelector('[data-testid="date-field"]')!.textContent).toContain('sometime in spring')
  })

  it('clear writes an empty string', () => {
    let last: string | null = null
    act(() =>
      root.render(
        <DateValueField value="2026-08-26" mode="date" onValue={(v) => (last = v)} onClear={() => (last = '')} />,
      ),
    )
    act(() => (container.querySelector('[aria-label="Clear date"]') as HTMLButtonElement).click())
    expect(last).toBe('')
  })
})
