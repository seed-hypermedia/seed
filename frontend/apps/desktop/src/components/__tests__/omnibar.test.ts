import {describe, expect, it} from 'vitest'

// Test the omnibar state machine logic
// We'll create isolated versions of the state logic for testing

type OmnibarMode = 'idle' | 'focused' | 'search'

interface OmnibarState {
  mode: OmnibarMode
  inputValue: string
}

// Simulate the state machine logic from useOmnibarState
function createOmnibarStateMachine(currentUrl: string | null) {
  let state: OmnibarState = {
    mode: 'idle',
    inputValue: '',
  }

  return {
    getState: () => state,

    focus: (selectAll: boolean = true) => {
      if (currentUrl) {
        state = {mode: 'focused', inputValue: currentUrl}
      } else {
        state = {mode: 'search', inputValue: ''}
      }
    },

    focusSearch: () => {
      state = {mode: 'search', inputValue: ''}
    },

    blur: () => {
      state = {mode: 'idle', inputValue: ''}
    },

    handleInputChange: (value: string) => {
      state = {...state, inputValue: value}

      // If in focused mode and value doesn't look like URL, switch to search
      if (state.mode === 'focused' && value !== currentUrl) {
        const looksLikeUrl =
          value.startsWith('http://') ||
          value.startsWith('https://') ||
          value.startsWith('hm://') ||
          (value.includes('.') && !value.includes(' '))

        if (!looksLikeUrl && value.length > 0) {
          state = {...state, mode: 'search'}
        }
      }
    },
  }
}

describe('Omnibar State Machine', () => {
  describe('initial state', () => {
    it('should start in idle mode', () => {
      const machine = createOmnibarStateMachine('https://example.com')
      expect(machine.getState().mode).toBe('idle')
      expect(machine.getState().inputValue).toBe('')
    })
  })

  describe('focus transitions', () => {
    it('should transition to focused mode when URL exists', () => {
      const url = 'https://example.com/doc'
      const machine = createOmnibarStateMachine(url)

      machine.focus()

      expect(machine.getState().mode).toBe('focused')
      expect(machine.getState().inputValue).toBe(url)
    })

    it('should transition to search mode when no URL exists', () => {
      const machine = createOmnibarStateMachine(null)

      machine.focus()

      expect(machine.getState().mode).toBe('search')
      expect(machine.getState().inputValue).toBe('')
    })

    it('should transition to search mode via focusSearch', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focusSearch()

      expect(machine.getState().mode).toBe('search')
      expect(machine.getState().inputValue).toBe('')
    })
  })

  describe('blur transitions', () => {
    it('should transition back to idle mode on blur', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      expect(machine.getState().mode).toBe('focused')

      machine.blur()
      expect(machine.getState().mode).toBe('idle')
      expect(machine.getState().inputValue).toBe('')
    })

    it('should transition from search to idle on blur', () => {
      const machine = createOmnibarStateMachine(null)

      machine.focusSearch()
      expect(machine.getState().mode).toBe('search')

      machine.blur()
      expect(machine.getState().mode).toBe('idle')
    })
  })

  describe('input change handling', () => {
    it('should update input value in focused mode', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      machine.handleInputChange('https://new-url.com')

      expect(machine.getState().inputValue).toBe('https://new-url.com')
      expect(machine.getState().mode).toBe('focused')
    })

    it('should switch from focused to search when typing non-URL text', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      machine.handleInputChange('search query')

      expect(machine.getState().mode).toBe('search')
      expect(machine.getState().inputValue).toBe('search query')
    })

    it('should stay in focused mode when typing URL-like text', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      machine.handleInputChange('https://another.com')

      expect(machine.getState().mode).toBe('focused')
    })

    it('should stay in focused mode when typing domain-like text', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      machine.handleInputChange('example.com')

      expect(machine.getState().mode).toBe('focused')
    })

    it('should stay in focused mode when typing hm:// URL', () => {
      const machine = createOmnibarStateMachine('https://example.com')

      machine.focus()
      machine.handleInputChange('hm://abc123')

      expect(machine.getState().mode).toBe('focused')
    })
  })
})

describe('URL Detection', () => {
  function looksLikeUrl(value: string): boolean {
    return (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('hm://') ||
      (value.includes('.') && !value.includes(' '))
    )
  }

  it('should detect http:// URLs', () => {
    expect(looksLikeUrl('http://example.com')).toBe(true)
  })

  it('should detect https:// URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true)
  })

  it('should detect hm:// URLs', () => {
    expect(looksLikeUrl('hm://abc123')).toBe(true)
  })

  it('should detect domain-like text', () => {
    expect(looksLikeUrl('example.com')).toBe(true)
    expect(looksLikeUrl('sub.domain.com')).toBe(true)
  })

  it('should not detect plain search queries', () => {
    expect(looksLikeUrl('search query')).toBe(false)
    expect(looksLikeUrl('hello world')).toBe(false)
  })

  it('should not detect text with dots and spaces', () => {
    expect(looksLikeUrl('hello. world')).toBe(false)
    expect(looksLikeUrl('test.file name')).toBe(false)
  })
})

describe('Route ID extraction', () => {
  // Simulate getRouteId logic
  function getRouteId(route: {
    key: string
    id?: {uid: string}
  }): {uid: string} | null {
    if (
      route.key === 'document' ||
      route.key === 'feed' ||
      route.key === 'activity' ||
      route.key === 'directory' ||
      route.key === 'collaborators' ||
      route.key === 'discussions'
    ) {
      return route.id || null
    }
    return null
  }

  it('should return id for document route', () => {
    const route = {key: 'document', id: {uid: 'abc123'}}
    expect(getRouteId(route)).toEqual({uid: 'abc123'})
  })

  it('should return id for feed route', () => {
    const route = {key: 'feed', id: {uid: 'abc123'}}
    expect(getRouteId(route)).toEqual({uid: 'abc123'})
  })

  it('should return id for activity route', () => {
    const route = {key: 'activity', id: {uid: 'abc123'}}
    expect(getRouteId(route)).toEqual({uid: 'abc123'})
  })

  it('should return null for contacts route', () => {
    const route = {key: 'contacts'}
    expect(getRouteId(route)).toBeNull()
  })

  it('should return null for bookmarks route', () => {
    const route = {key: 'bookmarks'}
    expect(getRouteId(route)).toBeNull()
  })

  it('should return null for library route', () => {
    const route = {key: 'library'}
    expect(getRouteId(route)).toBeNull()
  })

  it('should return null for drafts route', () => {
    const route = {key: 'drafts'}
    expect(getRouteId(route)).toBeNull()
  })
})

describe('Draft route detection', () => {
  function isDraftRoute(route: {key: string}): boolean {
    return route.key === 'draft'
  }

  it('should return true for draft route', () => {
    expect(isDraftRoute({key: 'draft'})).toBe(true)
  })

  it('should return false for document route', () => {
    expect(isDraftRoute({key: 'document'})).toBe(false)
  })

  it('should return false for feed route', () => {
    expect(isDraftRoute({key: 'feed'})).toBe(false)
  })
})

describe('URL displayable route detection', () => {
  function isUrlDisplayableRoute(route: {key: string}): boolean {
    return (
      route.key === 'document' ||
      route.key === 'feed' ||
      route.key === 'activity' ||
      route.key === 'directory' ||
      route.key === 'collaborators' ||
      route.key === 'discussions'
    )
  }

  it('should return true for document route', () => {
    expect(isUrlDisplayableRoute({key: 'document'})).toBe(true)
  })

  it('should return true for feed route', () => {
    expect(isUrlDisplayableRoute({key: 'feed'})).toBe(true)
  })

  it('should return true for activity route', () => {
    expect(isUrlDisplayableRoute({key: 'activity'})).toBe(true)
  })

  it('should return true for directory route', () => {
    expect(isUrlDisplayableRoute({key: 'directory'})).toBe(true)
  })

  it('should return true for collaborators route', () => {
    expect(isUrlDisplayableRoute({key: 'collaborators'})).toBe(true)
  })

  it('should return true for discussions route', () => {
    expect(isUrlDisplayableRoute({key: 'discussions'})).toBe(true)
  })

  it('should return false for draft route', () => {
    expect(isUrlDisplayableRoute({key: 'draft'})).toBe(false)
  })

  it('should return false for contacts route', () => {
    expect(isUrlDisplayableRoute({key: 'contacts'})).toBe(false)
  })

  it('should return false for bookmarks route', () => {
    expect(isUrlDisplayableRoute({key: 'bookmarks'})).toBe(false)
  })
})

describe('View term for route', () => {
  // Simulate getViewTermForRoute logic
  function getViewTermForRoute(route: {
    key: string
    panel?: {key: string}
  }): string | null {
    // First-class view routes
    if (route.key === 'activity') return '/:activity'
    if (route.key === 'discussions') return '/:discussions'
    if (route.key === 'collaborators') return '/:collaborators'
    if (route.key === 'directory') return '/:directory'

    // Document routes with panel
    if (route.key === 'document' && route.panel) {
      const panelKey = route.panel.key
      if (panelKey === 'activity') return '/:activity'
      if (panelKey === 'discussions') return '/:discussions'
      if (panelKey === 'collaborators') return '/:collaborators'
      if (panelKey === 'directory') return '/:directory'
    }

    return null
  }

  describe('first-class view routes', () => {
    it('should return /:activity for activity route', () => {
      expect(getViewTermForRoute({key: 'activity'})).toBe('/:activity')
    })

    it('should return /:discussions for discussions route', () => {
      expect(getViewTermForRoute({key: 'discussions'})).toBe('/:discussions')
    })

    it('should return /:collaborators for collaborators route', () => {
      expect(getViewTermForRoute({key: 'collaborators'})).toBe(
        '/:collaborators',
      )
    })

    it('should return /:directory for directory route', () => {
      expect(getViewTermForRoute({key: 'directory'})).toBe('/:directory')
    })
  })

  describe('document routes with panel', () => {
    it('should return /:activity for document with activity panel', () => {
      expect(
        getViewTermForRoute({key: 'document', panel: {key: 'activity'}}),
      ).toBe('/:activity')
    })

    it('should return /:discussions for document with discussions panel', () => {
      expect(
        getViewTermForRoute({key: 'document', panel: {key: 'discussions'}}),
      ).toBe('/:discussions')
    })

    it('should return /:collaborators for document with collaborators panel', () => {
      expect(
        getViewTermForRoute({key: 'document', panel: {key: 'collaborators'}}),
      ).toBe('/:collaborators')
    })

    it('should return /:directory for document with directory panel', () => {
      expect(
        getViewTermForRoute({key: 'document', panel: {key: 'directory'}}),
      ).toBe('/:directory')
    })
  })

  describe('routes without view term', () => {
    it('should return null for document route without panel', () => {
      expect(getViewTermForRoute({key: 'document'})).toBeNull()
    })

    it('should return null for feed route', () => {
      expect(getViewTermForRoute({key: 'feed'})).toBeNull()
    })

    it('should return null for contacts route', () => {
      expect(getViewTermForRoute({key: 'contacts'})).toBeNull()
    })

    it('should return null for draft route', () => {
      expect(getViewTermForRoute({key: 'draft'})).toBeNull()
    })
  })
})

describe('Keyboard event handling', () => {
  it('should blur on Escape in any mode', () => {
    const machine = createOmnibarStateMachine('https://example.com')

    machine.focus()
    expect(machine.getState().mode).toBe('focused')

    // Simulate Escape key
    machine.blur()
    expect(machine.getState().mode).toBe('idle')
  })

  it('should handle mode transitions correctly through full workflow', () => {
    const machine = createOmnibarStateMachine('https://example.com/doc')

    // Start in idle
    expect(machine.getState().mode).toBe('idle')

    // Focus (Cmd+L) - should show URL
    machine.focus()
    expect(machine.getState().mode).toBe('focused')
    expect(machine.getState().inputValue).toBe('https://example.com/doc')

    // Type search text - should switch to search mode
    machine.handleInputChange('my search')
    expect(machine.getState().mode).toBe('search')
    expect(machine.getState().inputValue).toBe('my search')

    // Escape - should go back to idle
    machine.blur()
    expect(machine.getState().mode).toBe('idle')
    expect(machine.getState().inputValue).toBe('')

    // Focus search (Cmd+K) - should start in search mode
    machine.focusSearch()
    expect(machine.getState().mode).toBe('search')
    expect(machine.getState().inputValue).toBe('')
  })
})
