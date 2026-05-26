// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {StyleOptionsPanel} from './style-options-panel'

function makeEditor() {
  return {
    addStyles: vi.fn(),
    removeStyles: vi.fn(),
    focus: vi.fn(),
  } as any
}

type Props = Parameters<typeof StyleOptionsPanel>[0]

function defaultProps(overrides: Partial<Props> = {}): Props {
  return {
    editor: makeEditor(),
    currentBlockType: 'paragraph',
    currentGroupType: 'Group',
    currentColumnCount: '3',
    currentTextColor: 'default',
    currentBackgroundColor: 'default',
    onBlockTypeChange: vi.fn(),
    onGroupTypeChange: vi.fn(),
    onColumnCountChange: vi.fn(),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(props: Props) {
  act(() => {
    root.render(<StyleOptionsPanel {...props} />)
  })
}

function click(testId: string) {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`Element with testid="${testId}" not found`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

describe('StyleOptionsPanel', () => {
  it('renders TEXT, LIST, and GRID sections', () => {
    render(defaultProps())
    const panel = container.querySelector('[data-testid="style-options-panel"]')
    expect(panel).not.toBeNull()
    expect(container.textContent).toContain('Text')
    expect(container.textContent).toContain('List')
    expect(container.textContent).toContain('Grid')
    expect(container.querySelector('[data-testid="block-type-heading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="block-type-paragraph"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="group-type-blockquote"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="group-type-unordered"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="group-type-ordered"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="grid-cols-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="grid-cols-2"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="grid-cols-3"]')).not.toBeNull()
  })

  it('Heading button toggles between heading and paragraph', () => {
    const onBlockTypeChange = vi.fn()
    render(defaultProps({currentBlockType: 'paragraph', onBlockTypeChange}))
    click('block-type-heading')
    expect(onBlockTypeChange).toHaveBeenCalledWith('heading')
  })

  it('Heading button switches to paragraph when already heading', () => {
    const onBlockTypeChange = vi.fn()
    render(defaultProps({currentBlockType: 'heading', onBlockTypeChange}))
    click('block-type-heading')
    expect(onBlockTypeChange).toHaveBeenCalledWith('paragraph')
  })

  it('Quote toggles Blockquote group type', () => {
    const onGroupTypeChange = vi.fn()
    render(defaultProps({currentGroupType: 'Group', onGroupTypeChange}))
    click('group-type-blockquote')
    expect(onGroupTypeChange).toHaveBeenCalledWith('Blockquote')
  })

  it('Quote removes Blockquote when active', () => {
    const onGroupTypeChange = vi.fn()
    render(defaultProps({currentGroupType: 'Blockquote', onGroupTypeChange}))
    click('group-type-blockquote')
    expect(onGroupTypeChange).toHaveBeenCalledWith('Group')
  })

  it('Bullet points toggles Unordered group type', () => {
    const onGroupTypeChange = vi.fn()
    render(defaultProps({onGroupTypeChange}))
    click('group-type-unordered')
    expect(onGroupTypeChange).toHaveBeenCalledWith('Unordered')
  })

  it('Numbered list toggles Ordered group type', () => {
    const onGroupTypeChange = vi.fn()
    render(defaultProps({onGroupTypeChange}))
    click('group-type-ordered')
    expect(onGroupTypeChange).toHaveBeenCalledWith('Ordered')
  })

  it('Grid column click converts to Grid and sets column count', () => {
    const onGroupTypeChange = vi.fn()
    const onColumnCountChange = vi.fn()
    render(defaultProps({currentGroupType: 'Group', onGroupTypeChange, onColumnCountChange}))
    click('grid-cols-2')
    expect(onGroupTypeChange).toHaveBeenCalledWith('Grid')
    expect(onColumnCountChange).toHaveBeenCalledWith('2')
  })

  it('Grid column click only updates count when already in Grid', () => {
    const onGroupTypeChange = vi.fn()
    const onColumnCountChange = vi.fn()
    render(
      defaultProps({
        currentGroupType: 'Grid',
        currentColumnCount: '3',
        onGroupTypeChange,
        onColumnCountChange,
      }),
    )
    click('grid-cols-1')
    expect(onGroupTypeChange).not.toHaveBeenCalled()
    expect(onColumnCountChange).toHaveBeenCalledWith('1')
  })
})
