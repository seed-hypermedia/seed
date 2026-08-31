import {parseExtensionInstalls} from '@seed-hypermedia/client/extensions'
import {getDocAttributeChanges} from '@shm/shared/utils/document-changes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {
  buildInstallRecord,
  getRawExtensionInstalls,
  installExtension,
  normalizeMountPath,
  removeExtension,
  setExtensionNav,
  shortVersion,
  updateExtensionVersion,
  validateMountPath,
} from '../utils/extension-installs'

const AUTHOR = 'z6MkAuthorAuthorAuthorAuthorAuthorAuthorAuthor'
const extId = hmId(AUTHOR, {path: ['kanban']})

/** Flatten emitted attribute ops into `{ 'a.b.c': 'string:value' | 'null' | ... }` for readable assertions. */
function opsByKey(changes: ReturnType<typeof getDocAttributeChanges>) {
  const out: Record<string, string> = {}
  for (const change of changes) {
    if (change.op.case !== 'setAttribute') continue
    const attr = change.op.value
    const v = attr.value
    out[attr.key.join('.')] = v.case === 'nullValue' ? 'null' : `${v.case}:${String(v.value)}`
  }
  return out
}

describe('extension install helpers', () => {
  it('builds a pinned record with a versionless ext url', () => {
    const record = buildInstallRecord({extensionId: extId, pinnedVersion: 'bafyVersion1', title: ' Board '})
    expect(record).toEqual({ext: `hm://${AUTHOR}/kanban`, version: 'bafyVersion1', title: 'Board'})
  })

  it('omits version when following latest and stores nav only when false', () => {
    expect(buildInstallRecord({extensionId: extId, pinnedVersion: null, nav: true})).toEqual({
      ext: `hm://${AUTHOR}/kanban`,
    })
    expect(buildInstallRecord({extensionId: extId, nav: false})).toEqual({ext: `hm://${AUTHOR}/kanban`, nav: false})
  })

  it('normalizes and validates mount paths, refusing taken keys', () => {
    expect(normalizeMountPath(' /Board/ ')).toBe('board')
    const existing = {board: {ext: `hm://${AUTHOR}/kanban`}, removed: null}
    expect(validateMountPath('', existing)).toMatch(/required/)
    expect(validateMountPath('Bad Path', existing)).toMatch(/lowercase/)
    expect(validateMountPath('board', existing)).toMatch(/already used/)
    // A key nulled by the metadata editor may be reused.
    expect(validateMountPath('removed', existing)).toBeNull()
    expect(validateMountPath('tools/kanban', existing)).toBeNull()
  })

  it('install adds a key and keeps existing entries (including nulls) untouched', () => {
    const current = getRawExtensionInstalls({extensions: {other: {ext: `hm://${AUTHOR}/other`}, gone: null}})
    const record = buildInstallRecord({extensionId: extId, pinnedVersion: 'bafyV1'})
    const next = installExtension(current, 'board', record)
    expect(next).toEqual({other: {ext: `hm://${AUTHOR}/other`}, gone: null, board: record})
    expect(() => installExtension(next, 'board', record)).toThrow(/already used/)
    expect(parseExtensionInstalls({extensions: next}).map((m) => m.mountPath)).toEqual(['board', 'other'])
  })

  it('remove drops the key and the diff emits a null op per published leaf', () => {
    const published = {
      name: 'Site',
      extensions: {board: {ext: `hm://${AUTHOR}/kanban`, version: 'bafyV1', settings: {columns: 4}}},
    }
    const next = removeExtension(getRawExtensionInstalls(published), 'board')
    expect(next).toEqual({})
    const changes = getDocAttributeChanges({...published, extensions: next} as any, published as any)
    expect(opsByKey(changes)).toEqual({
      'extensions.board.ext': 'null',
      'extensions.board.version': 'null',
      'extensions.board.settings.columns': 'null',
    })
  })

  it('update re-pins only the version and the diff emits a single string op', () => {
    const published = {extensions: {board: {ext: `hm://${AUTHOR}/kanban`, version: 'bafyV1', title: 'Board'}}}
    const next = updateExtensionVersion(getRawExtensionInstalls(published), 'board', 'bafyV2')
    expect(next.board).toEqual({ext: `hm://${AUTHOR}/kanban`, version: 'bafyV2', title: 'Board'})
    expect(opsByKey(getDocAttributeChanges({extensions: next} as any, published as any))).toEqual({
      'extensions.board.version': 'stringValue:bafyV2',
    })
    // Switching to "follow latest" removes the version field.
    const latest = updateExtensionVersion(getRawExtensionInstalls(published), 'board', null)
    expect(latest.board).toEqual({ext: `hm://${AUTHOR}/kanban`, title: 'Board'})
    expect(opsByKey(getDocAttributeChanges({extensions: latest} as any, published as any))).toEqual({
      'extensions.board.version': 'null',
    })
    expect(() => updateExtensionVersion({}, 'board', 'x')).toThrow(/No extension/)
  })

  it('nav toggle stores false explicitly and true as absent', () => {
    const published = {extensions: {board: {ext: `hm://${AUTHOR}/kanban`}}}
    const hidden = setExtensionNav(getRawExtensionInstalls(published), 'board', false)
    expect(hidden.board).toEqual({ext: `hm://${AUTHOR}/kanban`, nav: false})
    expect(opsByKey(getDocAttributeChanges({extensions: hidden} as any, published as any))).toEqual({
      'extensions.board.nav': 'boolValue:false',
    })
    const shown = setExtensionNav(hidden, 'board', true)
    expect(shown.board).toEqual({ext: `hm://${AUTHOR}/kanban`})
  })

  it('shortVersion abbreviates CIDs', () => {
    expect(shortVersion(undefined)).toBe('latest')
    expect(shortVersion('bafyreiabcdefghijklmnopqrstuvwxyz')).toBe('bafyre…uvwxyz')
  })
})
