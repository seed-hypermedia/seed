// @vitest-environment jsdom
import {TooltipProvider} from '@shm/ui/tooltip'
import {METADATA_VALUE_RULES, ObjectEditor, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

function renderString(
  value: string,
  opts: {
    onValue?: (v: unknown) => void
    fileUpload?: (file: File) => Promise<string>
    openFile?: (cid: string) => void
  } = {},
) {
  act(() => {
    root.render(
      <TooltipProvider>
        <ValueEditorProvider fileUpload={opts.fileUpload} openFile={opts.openFile}>
          <ValueEditor value={value} onValue={opts.onValue ?? (() => {})} rules={METADATA_VALUE_RULES} />
        </ValueEditorProvider>
      </TooltipProvider>,
    )
  })
}

describe('string field IPFS file references', () => {
  it('renders a plain string as a text input, not a tag', () => {
    renderString('hello')
    expect(container.querySelector('input')).toBeTruthy()
    // No file-reference remove button for a plain string.
    expect(container.querySelector('button[aria-label="Remove file reference"]')).toBeNull()
  })

  it('renders an ipfs:// value as a clickable file tag that opens the viewer', () => {
    const openFile = vi.fn()
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    renderString(`ipfs://${cid}`, {openFile})

    // The editable input is replaced by the tag.
    expect(container.querySelector('input')).toBeNull()
    const remove = container.querySelector('button[aria-label="Remove file reference"]')
    expect(remove).toBeTruthy()

    // The tag button (the one that isn't the remove button) opens the file.
    const tag = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') !== 'Remove file reference',
    ) as HTMLButtonElement
    expect(tag).toBeTruthy()
    act(() => tag.click())
    expect(openFile).toHaveBeenCalledWith(cid)
  })

  it('removing a file reference clears the value back to an empty string', () => {
    const onValue = vi.fn()
    renderString('ipfs://bafyabc', {onValue})
    const remove = container.querySelector('button[aria-label="Remove file reference"]') as HTMLButtonElement
    act(() => remove.click())
    expect(onValue).toHaveBeenCalledWith('')
  })

  it('dropping a file uploads it and stores an ipfs:// reference', async () => {
    const onValue = vi.fn()
    const fileUpload = vi.fn(async () => 'bafyuploadedcid')
    renderString('', {onValue, fileUpload})

    const dropTarget = container.querySelector('input')!.parentElement as HTMLElement
    const file = new File(['data'], 'photo.png', {type: 'image/png'})
    const dropEvent = new Event('drop', {bubbles: true}) as Event & {dataTransfer: unknown}
    dropEvent.dataTransfer = {files: [file]}

    act(() => {
      dropTarget.dispatchEvent(dropEvent)
    })
    await flush()

    expect(fileUpload).toHaveBeenCalledWith(file)
    expect(onValue).toHaveBeenCalledWith('ipfs://bafyuploadedcid')
  })

  it('converts a pasted gateway /ipfs/ URL into an ipfs:// reference', () => {
    const onValue = vi.fn()
    renderString('', {onValue})
    const input = container.querySelector('input') as HTMLInputElement
    const cid = 'bafyreia6fzsx6pkwdolb6qqa6b4tb7kxt2xcjuhuoxyvvt4p6lucacfg2y'
    const pasteEvent = new Event('paste', {bubbles: true}) as Event & {clipboardData: unknown}
    pasteEvent.clipboardData = {getData: () => `https://hyper.media/ipfs/${cid}`}
    act(() => {
      input.dispatchEvent(pasteEvent)
    })
    expect(onValue).toHaveBeenCalledWith(`ipfs://${cid}`)
  })

  it('converts a gateway URL pasted onto a selected row (input not focused)', () => {
    const onValue = vi.fn()
    act(() => {
      root.render(
        <TooltipProvider>
          <ValueEditorProvider>
            <ObjectEditor value={{title: 'x'}} onValue={onValue} rules={METADATA_VALUE_RULES} path={[]} />
          </ValueEditorProvider>
        </TooltipProvider>,
      )
    })
    const row = container.querySelector('[role="treeitem"]') as HTMLElement
    act(() => row.focus())
    const cid = 'bafyreia6fzsx6pkwdolb6qqa6b4tb7kxt2xcjuhuoxyvvt4p6lucacfg2y'
    const pasteEvent = new Event('paste', {bubbles: true}) as Event & {clipboardData: unknown}
    pasteEvent.clipboardData = {getData: () => `https://hyper.media/ipfs/${cid}`}
    act(() => {
      row.dispatchEvent(pasteEvent)
    })
    expect(onValue).toHaveBeenCalledWith({title: `ipfs://${cid}`})
  })

  it('does not double-prefix an ipfs:// CID returned by the uploader', async () => {
    const onValue = vi.fn()
    const fileUpload = vi.fn(async () => 'ipfs://bafyalready')
    renderString('', {onValue, fileUpload})

    const dropTarget = container.querySelector('input')!.parentElement as HTMLElement
    const dropEvent = new Event('drop', {bubbles: true}) as Event & {dataTransfer: unknown}
    dropEvent.dataTransfer = {files: [new File(['x'], 'x.bin')]}
    act(() => {
      dropTarget.dispatchEvent(dropEvent)
    })
    await flush()

    expect(onValue).toHaveBeenCalledWith('ipfs://bafyalready')
  })
})
