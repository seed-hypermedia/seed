// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  DocumentMetadataAffordanceButtons,
  EditableDocumentMetadataFields,
  HomeDocumentMetadataAffordanceBar,
} from '../document-metadata-affordances'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

if (!('PointerEvent' in window)) {
  ;(window as any).PointerEvent = MouseEvent
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {}
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {}
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

function renderButtons(props: Partial<React.ComponentProps<typeof DocumentMetadataAffordanceButtons>> = {}) {
  const onMetadata = props.onMetadata ?? vi.fn()
  act(() => {
    root.render(
      <DocumentMetadataAffordanceButtons
        metadata={{}}
        visible
        onMetadata={onMetadata}
        onRequestSummary={vi.fn()}
        {...props}
      />,
    )
  })
  return {onMetadata}
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) ?? null
}

function openMobileMenu() {
  act(() => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Add document metadata"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
  })
}

function activateMenuItem(item: HTMLElement) {
  act(() => {
    item.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
    item.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
    item.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    document.body
      .querySelector<HTMLElement>('[data-radix-menu-content]')
      ?.dispatchEvent(new Event('animationend', {bubbles: true}))
  })
}

function ControlledEditableDocumentMetadataFields(
  props: Omit<
    React.ComponentProps<typeof EditableDocumentMetadataFields>,
    'summaryRequested' | 'onSummaryRequestedChange'
  >,
) {
  const [summaryRequested, setSummaryRequested] = React.useState(false)
  return (
    <EditableDocumentMetadataFields
      {...props}
      summaryRequested={summaryRequested}
      onSummaryRequestedChange={setSummaryRequested}
    />
  )
}

describe('DocumentMetadataAffordanceButtons', () => {
  it('shows only buttons for missing metadata fields', () => {
    renderButtons({metadata: {icon: 'ipfs://icon-cid', summary: 'A summary'}, fileUpload: vi.fn()})

    expect(buttonWithText('Add icon')).toBeNull()
    expect(buttonWithText('Add Summary')).toBeNull()
    expect(buttonWithText('Add cover image')).not.toBeNull()
  })

  it('requests the summary editor when Add Summary is clicked', () => {
    const onRequestSummary = vi.fn()
    renderButtons({onRequestSummary})

    act(() => {
      buttonWithText('Add Summary')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(onRequestSummary).toHaveBeenCalledOnce()
  })

  it('uploads an icon image selected through the hidden file input', async () => {
    const fileUpload = vi.fn(async () => 'bafyicon')
    const onMetadata = vi.fn()
    renderButtons({fileUpload, onMetadata})
    const file = new File(['icon'], 'icon.png', {type: 'image/png'})
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose document icon"]')!

    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })

    expect(fileUpload).toHaveBeenCalledWith(file)
    expect(onMetadata).toHaveBeenCalledWith({icon: 'ipfs://bafyicon'})
  })

  it('uploads a cover image selected through the hidden file input', async () => {
    const fileUpload = vi.fn(async () => 'ipfs://bafycover')
    const onMetadata = vi.fn()
    renderButtons({fileUpload, onMetadata})
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose document cover image"]')!

    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })

    expect(fileUpload).toHaveBeenCalledWith(file)
    expect(onMetadata).toHaveBeenCalledWith({cover: 'ipfs://bafycover'})
  })

  it('keeps invisible affordances out of the tab order', () => {
    renderButtons({visible: false, fileUpload: vi.fn()})

    expect(buttonWithText('Add icon')?.tabIndex).toBe(-1)
    expect(buttonWithText('Add Summary')?.tabIndex).toBe(-1)
    expect(buttonWithText('Add cover image')?.tabIndex).toBe(-1)
  })

  it('hides image upload buttons when uploads are unavailable', () => {
    renderButtons()

    expect(buttonWithText('Add icon')).toBeNull()
    expect(buttonWithText('Add cover image')).toBeNull()
    expect(buttonWithText('Add Summary')).not.toBeNull()
  })

  it('can keep editor affordances visible on mobile while hiding them until hover on desktop', () => {
    renderButtons({visible: false, fileUpload: vi.fn(), alwaysVisibleOnMobile: true})
    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!

    expect(affordanceRow.className).toContain('opacity-100')
    expect(affordanceRow.className).toContain('md:opacity-0')
  })

  it('shows only the gated actions in the mobile Add menu', () => {
    renderButtons({mobileOnly: true, fileUpload: vi.fn(), metadata: {icon: 'ipfs://icon-cid'}})

    expect(container.querySelectorAll('button')).toHaveLength(1)
    openMobileMenu()

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
      (item) => item.textContent?.trim(),
    )
    expect(items).toEqual(['Add Summary', 'Add cover image'])
  })

  it('renders no mobile Add trigger when every action is gated off', () => {
    renderButtons({
      mobileOnly: true,
      fileUpload: vi.fn(),
      metadata: {icon: 'ipfs://icon-cid', cover: 'ipfs://cover-cid', summary: 'A summary'},
    })

    expect(container.querySelector('button[aria-label="Add document metadata"]')).toBeNull()
  })

  it('uploads an icon selected from the mobile Add menu', async () => {
    const fileUpload = vi.fn(async () => 'bafyicon')
    const onMetadata = vi.fn()
    renderButtons({mobileOnly: true, fileUpload, onMetadata})
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose document icon"]')!
    const clickSpy = vi.spyOn(input, 'click')
    openMobileMenu()

    act(() => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Add icon'))
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(clickSpy).toHaveBeenCalledOnce()
    const file = new File(['icon'], 'icon.png', {type: 'image/png'})
    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })

    expect(fileUpload).toHaveBeenCalledWith(file)
    expect(onMetadata).toHaveBeenCalledWith({icon: 'ipfs://bafyicon'})
  })

  it('uploads a cover selected from the mobile Add menu', async () => {
    const fileUpload = vi.fn(async () => 'ipfs://bafycover')
    const onMetadata = vi.fn()
    renderButtons({mobileOnly: true, fileUpload, onMetadata, metadata: {icon: 'ipfs://icon-cid'}})
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose document cover image"]')!
    const clickSpy = vi.spyOn(input, 'click')
    openMobileMenu()

    act(() => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Add cover image'))
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(clickSpy).toHaveBeenCalledOnce()
    const file = new File(['cover'], 'cover.png', {type: 'image/png'})
    await act(async () => {
      Object.defineProperty(input, 'files', {value: [file], configurable: true})
      input.dispatchEvent(new Event('change', {bubbles: true}))
    })

    expect(fileUpload).toHaveBeenCalledWith(file)
    expect(onMetadata).toHaveBeenCalledWith({cover: 'ipfs://bafycover'})
  })
})

describe('EditableDocumentMetadataFields', () => {
  async function renderFields(
    props: Partial<
      React.ComponentProps<typeof import('../document-metadata-affordances').EditableDocumentMetadataFields>
    > = {},
  ) {
    const onMetadata = props.onMetadata ?? vi.fn()
    act(() => {
      root.render(
        <ControlledEditableDocumentMetadataFields
          name="New page"
          summary=""
          metadata={{}}
          onMetadata={onMetadata}
          onBeginEdit={vi.fn()}
          {...props}
        />,
      )
    })
    return {onMetadata}
  }

  it('positions desktop affordances above the title without reserving layout height', async () => {
    await renderFields({fileUpload: vi.fn()})

    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!
    expect(affordanceRow.parentElement?.className).toContain('relative')
    expect(affordanceRow.className).toContain('absolute')
    expect(affordanceRow.className).toContain('bottom-full')
    expect(affordanceRow.className).toContain('pb-1')
    expect(affordanceRow.className).not.toContain('mb-1')
  })

  it('keeps affordances inside the header surface when a cover is present', async () => {
    await renderFields({metadata: {cover: 'ipfs://cover'}, fileUpload: vi.fn()})

    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!
    expect(affordanceRow.parentElement?.className).toContain('pt-8')
    expect(affordanceRow.className).toContain('top-0')
    expect(affordanceRow.className).not.toContain('bottom-full')
  })

  it('keeps editor affordances mobile-visible and desktop-hidden until hover', async () => {
    await renderFields()
    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!

    act(() => {
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document title"]')?.focus()
    })

    expect(affordanceRow.className).toContain('opacity-100')
    expect(affordanceRow.className).toContain('md:opacity-0')
  })

  it('focuses the title when requested by the document machine', async () => {
    await renderFields({focusTitleOnMount: true})

    expect(document.activeElement).toBe(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document title"]'),
    )
  })

  it('reflows the title when its container width changes', async () => {
    let notifyResize: (() => void) | undefined
    const OriginalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    try {
      await renderFields({name: 'A title that wraps when the container gets narrower'})
      const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document title"]')!
      let measuredHeight = 48
      Object.defineProperty(title, 'scrollHeight', {get: () => measuredHeight})

      measuredHeight = 144
      act(() => notifyResize?.())

      expect(title.style.height).toBe('144px')
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })

  it('reserves affordance space and only fades visibility', async () => {
    await renderFields({fileUpload: vi.fn()})
    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!

    expect(affordanceRow.className).toContain('opacity-0')
    expect(affordanceRow.className).not.toContain('max-h-0')
    expect(affordanceRow.className).not.toContain('translate-y')
    expect(affordanceRow.className).not.toContain('blur')
  })

  it('offsets header affordances left to visually align with the title edge', async () => {
    await renderFields({fileUpload: vi.fn()})
    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!

    expect(affordanceRow.className).toContain('-ml-2')
  })

  it('renders metadata buttons above the title', async () => {
    await renderFields({fileUpload: vi.fn()})
    const affordanceRow = container.querySelector('[data-document-metadata-affordances]')!
    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document title"]')!

    expect(affordanceRow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('focuses an empty summary editor from Add Summary and hides it after empty blur', async () => {
    await renderFields()

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add document summary"]')
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')
    expect(summary).not.toBeNull()
    expect(document.activeElement).toBe(summary)

    act(() => {
      summary?.blur()
    })

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')).toBeNull()
    expect(buttonWithText('Add Summary')).not.toBeNull()
  })

  it('keeps an empty summary editor mounted when focus moves into a menu', async () => {
    await renderFields()

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add document summary"]')
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')
    expect(summary).not.toBeNull()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)

    act(() => {
      summary?.dispatchEvent(new FocusEvent('blur', {bubbles: true, relatedTarget: menu}))
    })

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')).toBe(summary)
    menu.remove()
  })

  it('saves summary text as metadata and keeps the editor visible after blur', async () => {
    const onMetadata = vi.fn()
    await renderFields({onMetadata})

    act(() => {
      buttonWithText('Add Summary')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')!

    act(() => {
      summary.value = 'A concise summary'
      summary.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(onMetadata).toHaveBeenCalledWith({summary: 'A concise summary'})
  })

  it('keeps the Add Summary button until the summary textarea blurs', async () => {
    const onMetadata = vi.fn()

    act(() => {
      root.render(
        <ControlledEditableDocumentMetadataFields
          name="New page"
          summary=""
          metadata={{}}
          onMetadata={onMetadata}
          onBeginEdit={vi.fn()}
        />,
      )
    })

    act(() => {
      buttonWithText('Add Summary')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    act(() => {
      root.render(
        <ControlledEditableDocumentMetadataFields
          name="New page"
          summary="A concise summary"
          metadata={{summary: 'A concise summary'}}
          onMetadata={onMetadata}
          onBeginEdit={vi.fn()}
        />,
      )
    })

    expect(buttonWithText('Add Summary')).not.toBeNull()

    act(() => {
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')?.blur()
    })

    expect(buttonWithText('Add Summary')).toBeNull()
  })

  it('keeps an emptied existing summary textarea visible until blur', async () => {
    const onMetadata = vi.fn()

    act(() => {
      root.render(
        <ControlledEditableDocumentMetadataFields
          name="New page"
          summary="A concise summary"
          metadata={{summary: 'A concise summary'}}
          onMetadata={onMetadata}
          onBeginEdit={vi.fn()}
        />,
      )
    })

    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')!
    act(() => {
      summary.focus()
      summary.value = ''
      summary.dispatchEvent(new Event('input', {bubbles: true}))
    })

    act(() => {
      root.render(
        <ControlledEditableDocumentMetadataFields
          name="New page"
          summary=""
          metadata={{}}
          onMetadata={onMetadata}
          onBeginEdit={vi.fn()}
        />,
      )
    })

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')).not.toBeNull()
    expect(buttonWithText('Add Summary')).toBeNull()

    act(() => {
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')?.blur()
    })

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')).toBeNull()
    expect(buttonWithText('Add Summary')).not.toBeNull()
  })

  it('keeps the summary textarea focused after Add Summary closes the mobile menu', async () => {
    function MobileSummaryHarness() {
      const [summaryRequested, setSummaryRequested] = React.useState(false)
      return (
        <>
          <DocumentMetadataAffordanceButtons
            metadata={{}}
            visible
            mobileOnly
            fileUpload={vi.fn()}
            onMetadata={vi.fn()}
            onRequestSummary={() => setSummaryRequested(true)}
          />
          <EditableDocumentMetadataFields
            name="New page"
            summary=""
            metadata={{}}
            onMetadata={vi.fn()}
            onBeginEdit={vi.fn()}
            summaryRequested={summaryRequested}
            onSummaryRequestedChange={setSummaryRequested}
          />
        </>
      )
    }

    act(() => {
      root.render(<MobileSummaryHarness />)
    })
    openMobileMenu()
    activateMenuItem(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (item) => item.textContent?.includes('Add Summary'),
      )!,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')
    expect(summary).not.toBeNull()
    expect(document.activeElement).toBe(summary)
  })

  it('keeps the summary textarea focused after keyboard Add Summary activation', async () => {
    function MobileSummaryHarness() {
      const [summaryRequested, setSummaryRequested] = React.useState(false)
      return (
        <>
          <DocumentMetadataAffordanceButtons
            metadata={{}}
            visible
            mobileOnly
            fileUpload={vi.fn()}
            onMetadata={vi.fn()}
            onRequestSummary={() => setSummaryRequested(true)}
          />
          <EditableDocumentMetadataFields
            name="New page"
            summary=""
            metadata={{}}
            onMetadata={vi.fn()}
            onBeginEdit={vi.fn()}
            summaryRequested={summaryRequested}
            onSummaryRequestedChange={setSummaryRequested}
          />
        </>
      )
    }

    act(() => {
      root.render(<MobileSummaryHarness />)
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Add document metadata"]')!
    act(() => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}))
    })
    const summaryItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('Add Summary'),
    )!
    act(() => {
      summaryItem.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const summary = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')
    expect(summary).not.toBeNull()
    expect(document.activeElement).toBe(summary)
  })
})

describe('HomeDocumentMetadataAffordanceBar', () => {
  async function renderHomeBar(
    props: Partial<
      React.ComponentProps<typeof import('../document-metadata-affordances').HomeDocumentMetadataAffordanceBar>
    > = {},
  ) {
    const onMetadata = props.onMetadata ?? vi.fn()
    act(() => {
      root.render(
        <HomeDocumentMetadataAffordanceBar metadata={{}} onMetadata={onMetadata} onBeginEdit={vi.fn()} {...props} />,
      )
    })
    return {onMetadata}
  }

  it('renders a focusable top affordance area for home documents', async () => {
    await renderHomeBar({fileUpload: vi.fn()})
    const bar = container.querySelector<HTMLElement>('[data-home-document-metadata-affordances]')
    expect(bar).not.toBeNull()
    expect(bar?.tabIndex).toBe(-1)
    expect(buttonWithText('Add icon')).not.toBeNull()
    expect(container.querySelector('[data-document-metadata-affordances]')?.className).toContain('opacity-100')
  })

  it('does not render summary controls for home documents', async () => {
    await renderHomeBar({metadata: {summary: 'Home summary'}, fileUpload: vi.fn()})

    expect(buttonWithText('Add Summary')).toBeNull()
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Document summary"]')).toBeNull()
  })
})
