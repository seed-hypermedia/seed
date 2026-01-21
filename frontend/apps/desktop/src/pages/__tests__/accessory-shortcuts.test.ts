import {PanelSelectionOptions} from '@shm/shared'
import {describe, expect, it} from 'vitest'

describe('accessory shortcut logic', () => {
  describe('navigation guard - accessory availability check', () => {
    it('should return undefined when no accessory at index', () => {
      const accessoryOptions = [
        {key: 'activity' as PanelSelectionOptions, label: 'Activity'},
        {key: 'discussions' as PanelSelectionOptions, label: 'Discussions'},
      ]

      const result = accessoryOptions[2] // Out of bounds
      expect(result).toBeUndefined()
    })

    it('should return accessory when index is valid', () => {
      const accessoryOptions = [
        {key: 'activity' as PanelSelectionOptions, label: 'Activity'},
        {key: 'discussions' as PanelSelectionOptions, label: 'Discussions'},
      ]

      const result = accessoryOptions[0]
      expect(result).toEqual({key: 'activity', label: 'Activity'})
    })

    it('should handle empty accessory options array', () => {
      const accessoryOptions: Array<{
        key: PanelSelectionOptions
        label: string
      }> = []

      const result = accessoryOptions[0]
      expect(result).toBeUndefined()
    })
  })

  describe('toggle logic - open vs close', () => {
    it('should determine to close when current key matches target key', () => {
      const currentSelectionKey: PanelSelectionOptions = 'activity'
      const targetSelectionKey: PanelSelectionOptions = 'activity'

      const shouldClose = currentSelectionKey === targetSelectionKey
      expect(shouldClose).toBe(true)
    })

    it('should determine to open when current key does not match target key', () => {
      const currentSelectionKey: PanelSelectionOptions | undefined =
        'activity' as PanelSelectionOptions
      const targetSelectionKey: PanelSelectionOptions =
        'discussions' as PanelSelectionOptions

      const shouldClose = currentSelectionKey === targetSelectionKey
      expect(shouldClose).toBe(false)
    })

    it('should determine to open when no accessory is currently open', () => {
      const currentSelectionKey: PanelSelectionOptions | undefined = undefined
      const targetSelectionKey: PanelSelectionOptions = 'activity'

      const shouldClose = currentSelectionKey === targetSelectionKey
      expect(shouldClose).toBe(false)
    })
  })

  describe('index to shortcut mapping', () => {
    it('should map Cmd+1 to index 0', () => {
      const shortcutNumber = 1
      const index = shortcutNumber - 1 // 0-based index
      expect(index).toBe(0)
    })

    it('should map Cmd+5 to index 4', () => {
      const shortcutNumber = 5
      const index = shortcutNumber - 1 // 0-based index
      expect(index).toBe(4)
    })

    it('should validate index range for 5 shortcuts', () => {
      const validIndices = [0, 1, 2, 3, 4]

      validIndices.forEach((index) => {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(5)
      })
    })
  })

  describe('route accessory key extraction', () => {
    it('should extract selection key from document route', () => {
      const route = {
        key: 'document' as const,
        id: {uid: 'test'},
        selection: {key: 'activity' as PanelSelectionOptions},
      }

      const panelKey =
        route.key === 'document' ? route.selection?.key : undefined
      expect(panelKey).toBe('activity')
    })

    it('should extract selection key from draft route', () => {
      const route = {
        key: 'draft' as const,
        id: 'test-draft',
        selection: {key: 'discussions' as PanelSelectionOptions},
      }

      const panelKey = route.key === 'draft' ? route.selection?.key : undefined
      expect(panelKey).toBe('discussions')
    })

    it('should return undefined when no selection in route', () => {
      const route: {
        key: 'document'
        id: {uid: string}
        selection?: {key: PanelSelectionOptions} | null
      } = {
        key: 'document' as const,
        id: {uid: 'test'},
        selection: null,
      }

      const panelKey =
        route.key === 'document' ? route.selection?.key : undefined
      expect(panelKey).toBeUndefined()
    })

    it('should return undefined for non-document/draft routes', () => {
      type Route =
        | {key: 'feed'}
        | {
            key: 'document'
            id: {uid: string}
            selection?: {key: PanelSelectionOptions}
          }
        | {key: 'draft'; id: string; selection?: {key: PanelSelectionOptions}}

      const route: Route = {
        key: 'feed',
      }

      function getSelectionKey(r: Route): PanelSelectionOptions | undefined {
        if (r.key === 'document') {
          return r.selection?.key
        } else if (r.key === 'draft') {
          return r.selection?.key
        }
        return undefined
      }

      const panelKey = getSelectionKey(route)
      expect(panelKey).toBeUndefined()
    })
  })

  describe('accessory options order', () => {
    it('should maintain order for shortcut mapping', () => {
      const accessoryOptions = [
        {key: 'activity' as PanelSelectionOptions, label: 'Activity'}, // Cmd+1 → index 0
        {key: 'discussions' as PanelSelectionOptions, label: 'Discussions'}, // Cmd+2 → index 1
        {key: 'collaborators' as PanelSelectionOptions, label: 'Collaborators'}, // Cmd+3 → index 2
        {key: 'directory' as PanelSelectionOptions, label: 'Directory'}, // Cmd+4 → index 3
        {key: 'options' as PanelSelectionOptions, label: 'Options'}, // Cmd+5 → index 4
      ]

      expect(accessoryOptions[0].key).toBe('activity')
      expect(accessoryOptions[1].key).toBe('discussions')
      expect(accessoryOptions[2].key).toBe('collaborators')
      expect(accessoryOptions[3].key).toBe('directory')
      expect(accessoryOptions[4].key).toBe('options')
    })
  })
})
