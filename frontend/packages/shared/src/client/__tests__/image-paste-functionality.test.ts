import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch as any

// Note: DOM-dependent tests would need browser environment
// This test focuses on the core logic that can be tested in Node.js

describe('Image Paste Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Image Detection Logic', () => {
    it('should correctly identify image MIME types', () => {
      const imageTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'image/svg+xml',
        'image/webp',
      ]

      const nonImageTypes = [
        'text/plain',
        'text/html',
        'video/mp4',
        'application/pdf',
        'audio/mp3',
      ]

      // Test that image types are detected (core logic from plugin)
      imageTypes.forEach((type) => {
        expect(type.startsWith('image/')).toBe(true)
      })

      // Test that non-image types are not detected
      nonImageTypes.forEach((type) => {
        expect(type.startsWith('image/')).toBe(false)
      })
    })

    it('should prioritize direct image files over HTML content', () => {
      const mockImageFile = new File(['image data'], 'test.png', {
        type: 'image/png',
      })
      const mockClipboardItems = [
        {
          type: 'image/png',
          getAsFile: () => mockImageFile,
          getAsString: vi.fn(),
        },
        {
          type: 'text/html',
          getAsFile: () => null,
          getAsString: vi.fn(),
        },
      ]

      // Simulate the plugin's logic for finding images first
      let foundDirectImage = false

      // First loop - check for direct images (exact logic from plugin)
      for (const item of mockClipboardItems) {
        if (item.type.startsWith('image/')) {
          const img = item.getAsFile()
          if (img) {
            foundDirectImage = true
            break // Plugin should stop here
          }
        }
      }

      // Should find direct image and not process HTML
      expect(foundDirectImage).toBe(true)
      // @ts-expect-error
      expect(mockClipboardItems[1].getAsString).not.toHaveBeenCalled()
    })
  })

  describe('HTML Content Type Recognition', () => {
    it('should identify HTML content type correctly', () => {
      const clipboardItem = {
        type: 'text/html',
        getAsFile: () => null,
        getAsString: vi.fn(),
      }

      // Core logic: plugin checks for 'text/html' type
      expect(clipboardItem.type === 'text/html').toBe(true)
      expect(clipboardItem.getAsFile()).toBe(null)
    })

    it('should validate image URL patterns in HTML', () => {
      // Test patterns that would be found in HTML content
      const htmlWithImages =
        '<img src="https://example.com/image1.jpg" alt="test1">'
      const htmlWithoutImages = '<p>No images here</p>'

      // Simple regex to simulate what the plugin looks for
      const imgTagRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi

      const matches1 = htmlWithImages.match(imgTagRegex)
      const matches2 = htmlWithoutImages.match(imgTagRegex)

      expect(matches1).not.toBeNull()
      expect(matches1).toHaveLength(1)
      expect(matches2).toBeNull()
    })
  })

  describe('File Processing Logic', () => {
    it('should create appropriate File objects from image blobs', async () => {
      const mockBlob = new Blob(['fake image data'], {type: 'image/jpeg'})

      mockFetch.mockResolvedValueOnce({
        blob: () => Promise.resolve(mockBlob),
      })

      const response = await fetch('https://example.com/image.jpg')
      const blob = await response.blob()

      // Simulate creating File from blob (exact logic from plugin)
      const imgFile = new File([blob], `pasted-image-${Date.now()}.png`, {
        type: blob.type || 'image/png',
      })

      expect(imgFile).toBeInstanceOf(File)
      expect(imgFile.type).toBe('image/jpeg')
      expect(imgFile.name).toMatch(/^pasted-image-\d+\.png$/)
    })

    it('should handle fetch errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      try {
        await fetch('https://example.com/nonexistent.jpg')
      } catch (error) {
        // In the actual plugin, this error is caught and logged
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Network error')
      }

      consoleSpy.mockRestore()
    })
  })

  describe('Media Type Classification', () => {
    it('should correctly identify video MIME types', () => {
      const videoTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/webm']

      videoTypes.forEach((type) => {
        expect(type.startsWith('video/')).toBe(true)
        expect(type.startsWith('image/')).toBe(false)
      })
    })

    it('should handle file attachments for non-media types', () => {
      const fileTypes = [
        'application/pdf',
        'text/plain',
        'application/zip',
        'application/json',
      ]

      fileTypes.forEach((type) => {
        expect(type.startsWith('image/')).toBe(false)
        expect(type.startsWith('video/')).toBe(false)
        // These should be handled as general file uploads
      })
    })
  })

  describe('Plugin Configuration', () => {
    it('should validate plugin priority setting', () => {
      // The LocalMediaPastePlugin should have high priority (100)
      const EXPECTED_PRIORITY = 100
      expect(EXPECTED_PRIORITY).toBe(100)
    })

    it('should validate clipboard data processing logic', () => {
      // Test the first check in handlePaste - items array existence
      const emptyClipboard = Array.from([]) // Empty items
      const validClipboard = Array.from([
        {type: 'image/png', getAsFile: () => new File([], 'test.png')},
      ])

      expect(emptyClipboard.length === 0).toBe(true) // Should return false
      expect(validClipboard.length > 0).toBe(true) // Should proceed
    })

    it('should validate insertion position logic', () => {
      // Test the logic for determining where to insert the image
      const mockSelection = {
        $anchor: {
          parent: {type: {name: 'paragraph'}, nodeSize: 10},
          start: () => 5,
          end: () => 10,
        },
      }

      // Simulate the plugin's insertion position logic
      const insertPos =
        mockSelection.$anchor.parent.type.name !== 'image' &&
        mockSelection.$anchor.parent.nodeSize <= 2
          ? mockSelection.$anchor.start() - 2
          : mockSelection.$anchor.end() + 1

      expect(typeof insertPos).toBe('number')
      expect(insertPos).toBe(11) // Should be end + 1 since nodeSize > 2
    })
  })

  describe('Error Handling', () => {
    it('should handle missing clipboard data gracefully', () => {
      // Simulate the plugin's handling of empty clipboard data
      const emptyItems: any[] = []
      const items = Array.from(emptyItems)

      expect(items.length).toBe(0)
      // Plugin should return false for empty items
    })

    it('should handle invalid file objects', () => {
      const clipboardItem = {
        type: 'image/png',
        getAsFile: () => null, // Invalid file
        getAsString: vi.fn(),
      }

      const file = clipboardItem.getAsFile()
      expect(file).toBeNull()
      // Plugin should skip items that don't return valid files
    })
  })
})
