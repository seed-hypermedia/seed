// @vitest-environment jsdom
import {ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/ui/button', () => ({
  Button: ({children, ...props}: {children?: ReactNode; [key: string]: unknown}) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@shm/ui/components/popover', () => ({
  Popover: ({children}: {children?: ReactNode}) => <>{children}</>,
  PopoverTrigger: ({children}: {children?: ReactNode}) => <>{children}</>,
  PopoverContent: ({children}: {children?: ReactNode}) => <div>{children}</div>,
}))

vi.mock('@shm/ui/icons', () => {
  const Icon = () => <span />
  return {
    Code: Icon,
    Emphasis: Icon,
    HeadingIcon: Icon,
    OrderedList: Icon,
    Strikethrough: Icon,
    Strong: Icon,
    Type: Icon,
    Underline: Icon,
    UnorderedList: Icon,
  }
})

vi.mock('@shm/ui/tooltip', () => ({
  Tooltip: ({children, content}: {children?: ReactNode; content: string}) => (
    <span data-tooltip={content}>{children}</span>
  ),
}))

vi.mock('@shm/ui/use-popover-state', () => ({
  usePopoverState: () => ({open: false, onOpenChange: vi.fn()}),
}))

vi.mock('@shm/ui/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}))

vi.mock('lucide-react', () => {
  const Icon = () => <span />
  return {ChevronDown: Icon, FileText: Icon, Link: Icon, ListChecks: Icon, MessageSquare: Icon}
})

vi.mock('./blocknote/core', () => ({
  getBlockInfoFromSelection: vi.fn(),
  updateGroupCommand: vi.fn(),
}))

vi.mock('./blocknote/react', () => ({
  useEditorContentChange: vi.fn(),
  useEditorSelectionChange: vi.fn(),
}))

const {getNearestBlockPosMock} = vi.hoisted(() => ({getNearestBlockPosMock: vi.fn()}))
vi.mock('./blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos', () => ({
  getNearestBlockPos: getNearestBlockPosMock,
  getNearestBlockOrCellPos: getNearestBlockPosMock,
}))

vi.mock('./blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos', () => ({
  getGroupInfoFromPos: vi.fn(),
}))

vi.mock('./blocknote/core/extensions/RangeSelection/RangeSelectionPlugin', () => ({
  prosemirrorPosToBlockTextOffset: vi.fn(() => 0),
}))

vi.mock('./draft-actions-context', () => ({
  useDraftActions: () => null,
}))

vi.mock('./hm-toolbar-link-button', () => ({
  HMLinkToolbarButton: () => <button data-testid="link-button" />,
}))

vi.mock('./mobile-link-toolbar-button', () => ({
  MobileLinkToolbarButton: () => <button data-testid="mobile-link-button" />,
}))

vi.mock('./mobile-text-marker-dialog', () => ({
  MobileTextMarkerDialog: () => null,
}))

vi.mock('./mobile-text-type-dialog', () => ({
  MobileTextTypeDialog: () => null,
}))

vi.mock('./style-options-panel', () => ({
  StyleOptionsPanel: () => null,
}))

vi.mock('./turn-into-doc', () => ({
  deriveDraftNameFromBlocks: vi.fn(),
  getSelectedFullBlocks: vi.fn(),
  replaceBlocksWithDraftEmbed: vi.fn(),
}))

vi.mock('./use-mobile', () => ({
  useMobile: () => false,
}))

import {FragmentActionsContext} from './fragment-actions-context'
import {HMFormattingToolbar} from './hm-formatting-toolbar'

function makeEditor() {
  return {
    _tiptapEditor: {
      view: {
        state: {
          selection: {
            empty: false,
            $from: {pos: 1},
            $to: {pos: 2},
          },
          doc: {},
        },
      },
    },
    formattingToolbar: {onUpdate: vi.fn(() => vi.fn())},
    getActiveStyles: vi.fn(() => ({})),
    focus: vi.fn(),
    toggleStyles: vi.fn(),
  }
}

function makeBlock(revision?: string) {
  return {
    type: {name: 'blockNode'},
    attrs: {id: 'block-1'},
    forEach: (callback: (child: any, offset: number) => void) => {
      callback({type: {spec: {group: 'block'}}, attrs: {revision: revision || ''}}, 0)
    },
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  getNearestBlockPosMock.mockReset()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('HMFormattingToolbar fragment actions', () => {
  it('hides comment and copy-link actions when the text selection spans multiple blocks', () => {
    const firstBlock = {attrs: {id: 'block-1'}, forEach: vi.fn()}
    const secondBlock = {attrs: {id: 'block-2'}, forEach: vi.fn()}
    getNearestBlockPosMock
      .mockReturnValueOnce({node: firstBlock, posBeforeNode: 10})
      .mockReturnValueOnce({node: secondBlock, posBeforeNode: 20})

    act(() => {
      root.render(
        <FragmentActionsContext.Provider value={{onComment: vi.fn(), onCopyFragmentLink: vi.fn()}}>
          <HMFormattingToolbar editor={makeEditor() as any} />
        </FragmentActionsContext.Provider>,
      )
    })

    expect(container.querySelector('[data-tooltip="Comment"]')).toBeNull()
    expect(container.querySelector('[data-tooltip="Copy Link"]')).toBeNull()
  })

  it('hides comment and copy-link actions when the selected block has no revision', () => {
    const block = makeBlock()
    getNearestBlockPosMock
      .mockReturnValueOnce({node: block, posBeforeNode: 10})
      .mockReturnValueOnce({node: block, posBeforeNode: 10})

    act(() => {
      root.render(
        <FragmentActionsContext.Provider value={{onComment: vi.fn(), onCopyFragmentLink: vi.fn()}}>
          <HMFormattingToolbar editor={makeEditor() as any} />
        </FragmentActionsContext.Provider>,
      )
    })

    expect(container.querySelector('[data-tooltip="Comment"]')).toBeNull()
    expect(container.querySelector('[data-tooltip="Copy Link"]')).toBeNull()
  })

  it('shows comment and copy-link actions when the selected block has a revision', () => {
    const block = makeBlock('rev-1')
    getNearestBlockPosMock
      .mockReturnValueOnce({node: block, posBeforeNode: 10})
      .mockReturnValueOnce({node: block, posBeforeNode: 10})

    act(() => {
      root.render(
        <FragmentActionsContext.Provider value={{onComment: vi.fn(), onCopyFragmentLink: vi.fn()}}>
          <HMFormattingToolbar editor={makeEditor() as any} />
        </FragmentActionsContext.Provider>,
      )
    })

    expect(container.querySelector('[data-tooltip="Comment"]')).not.toBeNull()
    expect(container.querySelector('[data-tooltip="Copy Link"]')).not.toBeNull()
  })
})
