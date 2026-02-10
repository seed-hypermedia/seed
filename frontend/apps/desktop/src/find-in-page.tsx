// Find-in-page UI using vanilla JS to avoid React duplication issues
import './tailwind.css'

// Use window.ipc from preload (type-cast to avoid conflicts with main app types)
const ipc = (window as any).ipc as {send: (cmd: string, args?: any) => void}
const appWindowEvents = (window as any).appWindowEvents as
  | {subscribe: (handler: (event: any) => void) => () => void}
  | undefined
const darkModeStream = (window as any).darkMode as
  | {subscribe: (handler: (value: boolean) => void) => () => void}
  | undefined

// Create the UI
function createFindInPageUI() {
  const root = document.getElementById('root')
  if (!root) return

  // Create wrapper with dark/light mode
  const wrapper = document.createElement('div')
  wrapper.className = 'light'
  wrapper.style.width = '100%'
  wrapper.style.height = '100%'

  // Subscribe to dark mode changes
  darkModeStream?.subscribe((isDark: boolean) => {
    wrapper.className = isDark ? 'dark' : 'light'
  })

  // Create container
  const container = document.createElement('div')
  container.className =
    'fixed inset-0 flex items-center justify-center gap-2 p-4'

  // Create input wrapper
  const inputWrapper = document.createElement('div')
  inputWrapper.className = 'flex flex-1 items-center'

  // Create input
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Find in page...'
  input.className =
    'bg-panel border-border text-foreground h-8 flex-1 rounded-sm border px-2 text-sm outline-none focus:ring-1 focus:ring-ring'

  // Create button container
  const buttonContainer = document.createElement('div')
  buttonContainer.className =
    'border-border bg-panel flex items-center overflow-hidden rounded-sm border'

  // Create up button
  const upButton = document.createElement('button')
  upButton.type = 'button'
  upButton.className =
    'flex size-8 items-center justify-center text-foreground hover:bg-muted'
  upButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`

  // Create down button
  const downButton = document.createElement('button')
  downButton.type = 'button'
  downButton.className =
    'flex size-8 items-center justify-center text-foreground hover:bg-muted'
  downButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`

  // Create close button
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className =
    'flex size-8 items-center justify-center text-foreground hover:bg-muted'
  closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

  // State
  let query = ''

  function clearFind() {
    query = ''
    input.value = ''
    ipc.send('find_in_page_cancel')
  }

  function search(forward: boolean = true) {
    if (query.length > 0) {
      ipc.send('find_in_page_query', {
        query,
        findNext: false,
        forward,
      })
    }
  }

  // Event handlers
  input.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value
    if (query.length === 0) {
      ipc.send('find_in_page_cancel')
    } else {
      ipc.send('find_in_page_query', {query, findNext: true})
    }
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearFind()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      search(true)
    }
  })

  upButton.addEventListener('click', () => search(false))
  downButton.addEventListener('click', () => search(true))
  closeButton.addEventListener('click', clearFind)

  // Global escape handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clearFind()
    }
  })

  // Focus input on load and when find_in_page event is received
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

  // Assemble the UI
  inputWrapper.appendChild(input)
  buttonContainer.appendChild(upButton)
  buttonContainer.appendChild(downButton)
  buttonContainer.appendChild(closeButton)
  container.appendChild(inputWrapper)
  container.appendChild(buttonContainer)
  wrapper.appendChild(container)
  root.appendChild(wrapper)
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFindInPageUI)
} else {
  createFindInPageUI()
}
