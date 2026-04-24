// Find-in-page UI using vanilla JS to avoid React duplication issues
import './tailwind.css'

type FindInPageResult = {
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

const ipc = (window as any).ipc as {
  send: (cmd: string, args?: any) => void
}
const appWindowEvents = (window as any).appWindowEvents as
  | {subscribe: (handler: (event: any) => void) => () => void}
  | undefined
const darkModeStream = (window as any).darkMode as
  | {subscribe: (handler: (value: boolean) => void) => () => void}
  | undefined
const findInPageResults = (window as any).findInPageResults as
  | {subscribe: (handler: (result: FindInPageResult) => void) => () => void}
  | undefined

function createFindInPageUI() {
  const root = document.getElementById('root')
  if (!root) return

  const wrapper = document.createElement('div')
  wrapper.className = 'light'
  wrapper.style.width = '100%'
  wrapper.style.height = '100%'

  darkModeStream?.subscribe((isDark: boolean) => {
    wrapper.className = isDark ? 'dark' : 'light'
  })

  // Single-card container that fills the WebContentsView bounds exactly.
  const card = document.createElement('div')
  card.className = 'bg-panel border-border flex h-full w-full items-center overflow-hidden rounded-md border shadow-sm'

  // Input lives inside a relative wrap so the counter can sit absolutely over
  // the right side of the field — this keeps the overall layout stable when
  // the counter appears/disappears.
  const inputWrap = document.createElement('div')
  inputWrap.className = 'relative flex h-full min-w-0 flex-1 items-center'

  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Find in page…'
  input.className = 'text-foreground h-full w-full border-0 bg-transparent pl-3 pr-16 text-sm outline-none focus:ring-0'

  const counter = document.createElement('span')
  counter.className =
    'text-muted-foreground pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums select-none'
  counter.textContent = ''

  inputWrap.appendChild(input)
  inputWrap.appendChild(counter)

  const divider = document.createElement('div')
  divider.className = 'bg-border mx-1 h-5 w-px'

  const makeIconButton = (svg: string, ariaLabel: string) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', ariaLabel)
    btn.className = 'text-foreground hover:bg-muted flex size-9 shrink-0 items-center justify-center'
    btn.innerHTML = svg
    return btn
  }

  const upButton = makeIconButton(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
    'Previous match',
  )
  const downButton = makeIconButton(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    'Next match',
  )
  const closeButton = makeIconButton(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    'Close find',
  )

  let query = ''
  let matches = 0
  let activeMatchOrdinal = 0
  let hasActiveSearch = false

  function updateCounter() {
    if (query.length === 0 || matches === 0) {
      counter.textContent = ''
      divider.style.visibility = 'hidden'
    } else {
      counter.textContent = `${activeMatchOrdinal}/${matches}`
      divider.style.visibility = ''
    }
  }
  updateCounter()

  function resetResult() {
    matches = 0
    activeMatchOrdinal = 0
    hasActiveSearch = false
    updateCounter()
  }

  function clearFind() {
    query = ''
    input.value = ''
    resetResult()
    ipc.send('find_in_page_cancel')
  }

  function navigate(forward: boolean) {
    if (query.length === 0) return
    if (!hasActiveSearch) {
      // First query after a cleared/empty state: start a new search.
      ipc.send('find_in_page_query', {query, findNext: false, forward})
      hasActiveSearch = true
    } else {
      // Advance the cursor within the existing request so Chromium cycles.
      ipc.send('find_in_page_query', {query, findNext: true, forward})
    }
  }

  input.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value
    if (query.length === 0) {
      resetResult()
      ipc.send('find_in_page_cancel')
      return
    }
    // `findNext: true` forces Chromium to stop the previous session and start
    // a new one with this query — that's what makes each keystroke visibly
    // repaint the page. `false` is "continue", which the engine coalesces
    // when calls arrive faster than a scan completes (symptom: page only
    // updates after Enter).
    hasActiveSearch = true
    ipc.send('find_in_page_query', {query, findNext: true, forward: true})
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearFind()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      navigate(!e.shiftKey)
    }
  })

  upButton.addEventListener('click', () => navigate(false))
  downButton.addEventListener('click', () => navigate(true))
  closeButton.addEventListener('click', clearFind)

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearFind()
    }
  })

  findInPageResults?.subscribe((result: FindInPageResult) => {
    if (!result) return
    matches = result.matches ?? 0
    activeMatchOrdinal = result.activeMatchOrdinal ?? 0
    updateCounter()
  })

  setTimeout(() => {
    input.focus()
    input.select()
  }, 10)

  appWindowEvents?.subscribe((event: any) => {
    if (event.type === 'find_in_page') {
      setTimeout(() => {
        input.focus()
        input.select()
      }, 10)
    }
  })

  card.appendChild(inputWrap)
  card.appendChild(divider)
  card.appendChild(upButton)
  card.appendChild(downButton)
  card.appendChild(closeButton)
  wrapper.appendChild(card)
  root.appendChild(wrapper)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFindInPageUI)
} else {
  createFindInPageUI()
}
