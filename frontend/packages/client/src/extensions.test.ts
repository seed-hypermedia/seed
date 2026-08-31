import {describe, expect, test} from 'vitest'
import * as Ext from './extensions'

const ENTRY = 'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

const validManifest: Ext.ExtensionManifestInput = {
  manifestVersion: 1,
  kind: 'page',
  version: '1.0.0',
  entry: ENTRY,
}

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe('ExtensionManifestSchema', () => {
  test('accepts a minimal manifest and defaults permissions to []', () => {
    const parsed = Ext.ExtensionManifestSchema.parse(validManifest)
    expect(parsed.permissions).toEqual([])
    expect(parsed.kind).toBe('page')
    expect(parsed.entry).toBe(ENTRY)
  })

  test('accepts every optional field', () => {
    const parsed = Ext.ExtensionManifestSchema.parse({
      ...validManifest,
      description: 'A kanban board',
      permissions: ['sign', 'storage'],
      defaultMountPath: 'board/v2-beta',
      homepage: 'https://example.com',
      minProtocol: 1,
    })
    expect(parsed.permissions).toEqual(['sign', 'storage'])
    expect(parsed.defaultMountPath).toBe('board/v2-beta')
  })

  test('rejects a bad entry', () => {
    for (const entry of ['https://example.com/entry.html', 'ipfs://', 'ipfs://bafy/index.html', 'bafyabc', '']) {
      const result = Ext.ExtensionManifestSchema.safeParse({...validManifest, entry})
      expect(result.success, `entry ${JSON.stringify(entry)} should be rejected`).toBe(false)
    }
  })

  test('rejects unknown keys (strict)', () => {
    const result = Ext.ExtensionManifestSchema.safeParse({...validManifest, icon: 'x'})
    expect(result.success).toBe(false)
  })

  test('rejects wrong manifestVersion, kind, permission and minProtocol', () => {
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, manifestVersion: 2}).success).toBe(false)
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, kind: 'widget'}).success).toBe(false)
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, permissions: ['write']}).success).toBe(false)
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, minProtocol: 0}).success).toBe(false)
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, minProtocol: 1.5}).success).toBe(false)
    expect(Ext.ExtensionManifestSchema.safeParse({...validManifest, version: ''}).success).toBe(false)
  })

  test('defaultMountPath must match the mount path regex', () => {
    for (const ok of ['board', 'a/b', 'my-ext/v2', 'x1/2y']) {
      expect(
        Ext.ExtensionManifestSchema.safeParse({...validManifest, defaultMountPath: ok}).success,
        `${ok} should be accepted`,
      ).toBe(true)
    }
    for (const bad of ['/board', 'board/', 'Board', 'a//b', '-a', 'a b', 'a.b', '']) {
      expect(
        Ext.ExtensionManifestSchema.safeParse({...validManifest, defaultMountPath: bad}).success,
        `${JSON.stringify(bad)} should be rejected`,
      ).toBe(false)
    }
  })
})

describe('ExtensionInstallRecordSchema', () => {
  test('accepts hm:// document URLs without a version', () => {
    for (const ext of ['hm://z6MkAbc', 'hm://z6MkAbc/kanban', 'hm://z6MkAbc/a/b-c']) {
      expect(Ext.ExtensionInstallRecordSchema.safeParse({ext}).success, `${ext} should be accepted`).toBe(true)
    }
  })

  test('rejects ext URLs carrying ?v= or that are not hm://', () => {
    for (const ext of [
      'hm://z6MkAbc/kanban?v=bafy',
      'hm://z6MkAbc?v=bafy',
      'hm://z6MkAbc/kanban#frag',
      'https://example.com/kanban',
      'hm://',
      '',
    ]) {
      expect(Ext.ExtensionInstallRecordSchema.safeParse({ext}).success, `${ext} should be rejected`).toBe(false)
    }
  })

  test('accepts optional fields and rejects unknown keys', () => {
    const parsed = Ext.ExtensionInstallRecordSchema.parse({
      ext: 'hm://z6MkAbc/kanban',
      version: 'bafyversion',
      title: 'Board',
      nav: false,
      settings: {columns: 3},
    })
    expect(parsed.settings).toEqual({columns: 3})
    expect(Ext.ExtensionInstallRecordSchema.safeParse({ext: 'hm://z6MkAbc', foo: 1}).success).toBe(false)
    expect(Ext.ExtensionInstallRecordSchema.safeParse({ext: 'hm://z6MkAbc', nav: 'yes'}).success).toBe(false)
  })
})

describe('parseExtensionInstalls', () => {
  test('returns [] for non-object metadata or a missing extensions key', () => {
    expect(Ext.parseExtensionInstalls(null)).toEqual([])
    expect(Ext.parseExtensionInstalls(undefined)).toEqual([])
    expect(Ext.parseExtensionInstalls('str')).toEqual([])
    expect(Ext.parseExtensionInstalls({})).toEqual([])
    expect(Ext.parseExtensionInstalls({extensions: null})).toEqual([])
    expect(Ext.parseExtensionInstalls({extensions: 'nope'})).toEqual([])
  })

  test('drops null entries, invalid records and invalid mount paths; sorts by mount path', () => {
    const mounts = Ext.parseExtensionInstalls({
      extensions: {
        zeta: {ext: 'hm://z6MkAbc/zeta'},
        removed: null,
        broken: {ext: 'https://not-hm'},
        '/leading': {ext: 'hm://z6MkAbc/x'},
        Upper: {ext: 'hm://z6MkAbc/x'},
        'alpha/nested': {ext: 'hm://z6MkAbc/nested', title: 'Nested'},
        alpha: {ext: 'hm://z6MkAbc/alpha'},
      },
    })
    expect(mounts.map((m) => m.mountPath)).toEqual(['alpha', 'alpha/nested', 'zeta'])
    expect(mounts[1]).toEqual({
      mountPath: 'alpha/nested',
      mountSegments: ['alpha', 'nested'],
      record: {ext: 'hm://z6MkAbc/nested', title: 'Nested'},
    })
  })
})

describe('resolveExtensionMount', () => {
  const metadata = {
    extensions: {
      'a/b': {ext: 'hm://z6MkAbc/ab'},
      a: {ext: 'hm://z6MkAbc/a'},
      board: {ext: 'hm://z6MkAbc/board'},
    },
  }

  test('exact match with empty subPath', () => {
    const mount = Ext.resolveExtensionMount(metadata, ['board'])
    expect(mount?.mountPath).toBe('board')
    expect(mount?.record.ext).toBe('hm://z6MkAbc/board')
    expect(mount?.subPath).toEqual([])
  })

  test('longest mount wins for nested mounts and subPath is the remainder', () => {
    const nested = Ext.resolveExtensionMount(metadata, ['a', 'b', 'c', 'd'])
    expect(nested?.mountPath).toBe('a/b')
    expect(nested?.subPath).toEqual(['c', 'd'])

    const parent = Ext.resolveExtensionMount(metadata, ['a', 'x'])
    expect(parent?.mountPath).toBe('a')
    expect(parent?.subPath).toEqual(['x'])

    const exactParent = Ext.resolveExtensionMount(metadata, ['a'])
    expect(exactParent?.mountPath).toBe('a')
    expect(exactParent?.subPath).toEqual([])
  })

  test('does not match a mount deeper than the path', () => {
    expect(Ext.resolveExtensionMount({extensions: {'a/b': {ext: 'hm://z6MkAbc/ab'}}}, ['a'])).toBeNull()
  })

  test('returns null for an empty path or no matching mount', () => {
    expect(Ext.resolveExtensionMount(metadata, [])).toBeNull()
    expect(Ext.resolveExtensionMount(metadata, null)).toBeNull()
    expect(Ext.resolveExtensionMount(metadata, undefined)).toBeNull()
    expect(Ext.resolveExtensionMount(metadata, [''])).toBeNull()
    expect(Ext.resolveExtensionMount(metadata, ['nothing'])).toBeNull()
    expect(Ext.resolveExtensionMount({}, ['board'])).toBeNull()
  })

  test('ignores empty segments', () => {
    const mount = Ext.resolveExtensionMount(metadata, ['', 'a', '', 'b', '', 'c'])
    expect(mount?.mountPath).toBe('a/b')
    expect(mount?.subPath).toEqual(['c'])
  })
})

describe('parseExtensionManifest / validateExtensionManifest', () => {
  test('parseExtensionManifest returns null for non-extension or invalid metadata', () => {
    expect(Ext.parseExtensionManifest(null)).toBeNull()
    expect(Ext.parseExtensionManifest({name: 'Plain doc'})).toBeNull()
    expect(Ext.parseExtensionManifest({seedExtension: {...validManifest, entry: 'nope'}})).toBeNull()
  })

  test('parseExtensionManifest returns the manifest with defaults', () => {
    const manifest = Ext.parseExtensionManifest({name: 'Kanban', seedExtension: validManifest})
    expect(manifest).toEqual({...validManifest, permissions: []})
  })

  test('validateExtensionManifest returns the manifest or throws a readable message', () => {
    expect(Ext.validateExtensionManifest(validManifest)).toEqual({...validManifest, permissions: []})
    expect(() => Ext.validateExtensionManifest({...validManifest, entry: 'nope'})).toThrow(
      'Invalid extension manifest: entry: entry must be an ipfs:// CID',
    )
    expect(() => Ext.validateExtensionManifest({...validManifest, bogus: 1})).toThrow(
      /^Invalid extension manifest: \(root\): .*bogus/,
    )
    expect(() => Ext.validateExtensionManifest({...validManifest, entry: 'nope', version: ''})).toThrow(
      /version: String must contain at least 1 character\(s\); entry: entry must be an ipfs:\/\/ CID$/,
    )
  })

  test('extensionEntryCid strips the ipfs:// prefix', () => {
    expect(Ext.extensionEntryCid(Ext.validateExtensionManifest(validManifest))).toBe(ENTRY.slice('ipfs://'.length))
  })
})

describe('buildSignDataPayload', () => {
  test('is prefix + extension id + newline + bytes', () => {
    const data = new Uint8Array([1, 2, 3, 255])
    const payload = Ext.buildSignDataPayload('hm://z6MkAbc/ext', data)
    const head = new TextEncoder().encode('seed-extension-signature:v1\nhm://z6MkAbc/ext\n')
    expect(Array.from(payload)).toEqual([...head, 1, 2, 3, 255])
    expect(Ext.EXTENSION_SIGN_DATA_PREFIX).toBe('seed-extension-signature:v1\n')
  })

  test('handles empty data', () => {
    const payload = Ext.buildSignDataPayload('hm://z6MkAbc', new Uint8Array())
    expect(new TextDecoder().decode(payload)).toBe('seed-extension-signature:v1\nhm://z6MkAbc\n')
  })
})

describe('isExtensionMessage', () => {
  test('accepts request, response and event messages tagged with the current protocol', () => {
    const tag = Ext.EXTENSION_MESSAGE_TAG
    expect(Ext.isExtensionMessage({[tag]: 1, type: 'request', id: 1, method: 'hello', params: {}})).toBe(true)
    expect(Ext.isExtensionMessage({[tag]: 1, type: 'response', id: 1, result: null})).toBe(true)
    expect(Ext.isExtensionMessage({[tag]: 1, type: 'event', event: 'context', data: {}})).toBe(true)
  })

  test('rejects everything else', () => {
    expect(Ext.isExtensionMessage(null)).toBe(false)
    expect(Ext.isExtensionMessage('seed-extension')).toBe(false)
    expect(Ext.isExtensionMessage({type: 'request'})).toBe(false)
    expect(Ext.isExtensionMessage({'seed-extension': 2, type: 'request'})).toBe(false)
    expect(Ext.isExtensionMessage({'seed-extension': '1', type: 'request'})).toBe(false)
    expect(Ext.isExtensionMessage({'seed-extension': 1, type: 'ping'})).toBe(false)
  })
})

describe('ExtensionError', () => {
  test('toPayload carries code, message and data', () => {
    const err = new Ext.ExtensionError('permission_denied', 'sign not granted', {method: 'sign.data'})
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExtensionError')
    expect(err.toPayload()).toEqual({
      code: 'permission_denied',
      message: 'sign not granted',
      data: {method: 'sign.data'},
    })
    expect(new Ext.ExtensionError('internal', 'boom').toPayload()).toEqual({
      code: 'internal',
      message: 'boom',
      data: undefined,
    })
  })
})

describe('EXTENSION_METHOD_PERMISSIONS', () => {
  test('maps every gated method to the right permission', () => {
    expect(Ext.EXTENSION_METHOD_PERMISSIONS).toEqual({
      'sign.comment': 'sign',
      'sign.document': 'sign',
      'sign.data': 'sign',
      navigate: 'navigate',
      openExternal: 'navigate',
      'storage.get': 'storage',
      'storage.set': 'storage',
      'storage.remove': 'storage',
      'storage.keys': 'storage',
    })
    for (const [method, permission] of Object.entries(Ext.EXTENSION_METHOD_PERMISSIONS)) {
      if (method.startsWith('sign.')) expect(permission).toBe('sign')
      else if (method.startsWith('storage.')) expect(permission).toBe('storage')
      else expect(permission).toBe('navigate')
      expect(Ext.ExtensionPermissionSchema.safeParse(permission).success).toBe(true)
    }
  })

  test('ungated methods are absent', () => {
    for (const method of [
      'hello',
      'getContext',
      'api.query',
      'file.url',
      'file.read',
      'route.set',
      'ui.toast',
    ] as const) {
      expect(Ext.EXTENSION_METHOD_PERMISSIONS[method]).toBeUndefined()
    }
  })
})

describe('extension dev overrides', () => {
  const KEY = Ext.EXTENSION_DEV_OVERRIDES_STORAGE_KEY

  test('reads {} for missing storage, missing key, invalid JSON or non-object JSON', () => {
    expect(Ext.readExtensionDevOverrides(null)).toEqual({})
    expect(Ext.readExtensionDevOverrides(undefined)).toEqual({})
    expect(Ext.readExtensionDevOverrides(makeStorage())).toEqual({})
    expect(Ext.readExtensionDevOverrides(makeStorage({[KEY]: '{not json'}))).toEqual({})
    expect(Ext.readExtensionDevOverrides(makeStorage({[KEY]: '"str"'}))).toEqual({})
    expect(Ext.readExtensionDevOverrides(makeStorage({[KEY]: 'null'}))).toEqual({})
    expect(Ext.readExtensionDevOverrides(makeStorage({[KEY]: '42'}))).toEqual({})
    expect(
      Ext.readExtensionDevOverrides({
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toEqual({})
  })

  test('keeps only http(s) string values', () => {
    const storage = makeStorage({
      [KEY]: JSON.stringify({
        'hm://a': 'http://localhost:5174',
        'hm://b': 'https://dev.example.com',
        'hm://c': 'ftp://nope',
        'hm://d': 'javascript:alert(1)',
        'hm://e': 42,
        'hm://f': null,
        'hm://g': 'localhost:5174',
      }),
    })
    expect(Ext.readExtensionDevOverrides(storage)).toEqual({
      'hm://a': 'http://localhost:5174',
      'hm://b': 'https://dev.example.com',
    })
  })

  test('write adds, replaces and removes overrides; removal of the last one empties the key', () => {
    const storage = makeStorage()
    expect(Ext.writeExtensionDevOverride(storage, 'hm://a', 'http://localhost:5174')).toEqual({
      'hm://a': 'http://localhost:5174',
    })
    expect(Ext.writeExtensionDevOverride(storage, 'hm://b', 'http://localhost:5175')).toEqual({
      'hm://a': 'http://localhost:5174',
      'hm://b': 'http://localhost:5175',
    })
    expect(Ext.writeExtensionDevOverride(storage, 'hm://a', 'http://localhost:6000')['hm://a']).toBe(
      'http://localhost:6000',
    )
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({
      'hm://a': 'http://localhost:6000',
      'hm://b': 'http://localhost:5175',
    })

    expect(Ext.writeExtensionDevOverride(storage, 'hm://a', null)).toEqual({'hm://b': 'http://localhost:5175'})
    expect(storage.map.has(KEY)).toBe(true)
    expect(Ext.writeExtensionDevOverride(storage, 'hm://b', null)).toEqual({})
    expect(storage.map.has(KEY)).toBe(false)
  })

  test('write survives missing or throwing storage', () => {
    expect(Ext.writeExtensionDevOverride(null, 'hm://a', 'http://localhost:5174')).toEqual({
      'hm://a': 'http://localhost:5174',
    })
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(Ext.writeExtensionDevOverride(throwing, 'hm://a', 'http://localhost:5174')).toEqual({
      'hm://a': 'http://localhost:5174',
    })
    expect(Ext.writeExtensionDevOverride(throwing, 'hm://a', null)).toEqual({})
  })
})
