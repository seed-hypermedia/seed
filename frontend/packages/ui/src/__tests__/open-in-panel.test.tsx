// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../tooltip'
import {OpenInPanelButton} from '../open-in-panel'

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderButton() {
  const id = hmId('alice', {path: ['doc']})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <TooltipProvider>
        <OpenInPanelButton id={id} panelRoute={{key: 'comments', id}} />
      </TooltipProvider>,
    )
  })

  return container
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('OpenInPanelButton', () => {
  it('is hidden below the desktop breakpoint', () => {
    const view = renderButton()

    const button = view.querySelector('button')

    expect(button?.className).toContain('hidden')
    expect(button?.className).toContain('md:inline-flex')
  })
})
