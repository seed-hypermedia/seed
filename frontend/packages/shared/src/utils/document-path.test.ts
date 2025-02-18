import {describe, expect, test} from 'vitest'
import {validatePath} from './document-path'

describe('validatePath', () => {
  // Test paths that don't start with '/'
  test('should return error for paths not starting with /', () => {
    expect(validatePath('test')).toEqual({
      error: `wrong path format (should start with '/')`,
    })
  })

  // Test reserved paths
  test.each(['/assets', '/favicon.ico', '/robots.txt', '/hm'])(
    'should return error for reserved path: %s',
    (path) => {
      expect(validatePath(path)).toEqual({
        error: `This path name is reserved and can't be used: ${path.slice(1)}`,
      })
    },
  )

  // Test paths with special character prefixes
  test.each(['/-test', '/.test', '/_test'])(
    'should return error for path starting with special character: %s',
    (path) => {
      expect(validatePath(path)).toEqual({
        error: `Path can't start with special characters "-", "." or "_": ${path.slice(
          1,
        )}`,
      })
    },
  )

  // Test valid paths
  test.each([
    '/valid',
    '/valid/path',
    '/valid-path',
    '/valid_path',
    '/valid.path',
  ])('should return null for valid path: %s', (path) => {
    expect(validatePath(path)).toBeNull()
  })
})
