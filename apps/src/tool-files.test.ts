import {describe, expect, test} from 'bun:test'
import {isToolFile, MAX_RECORDED_VALUE_BYTES, recordedJson, replaceToolFiles, safeFilePath} from '@/tool-files'

const file = {name: 'a.png', mimeType: 'image/png', data: Buffer.from('PNG bytes').toString('base64')}

describe('files inside a tool’s JSON', () => {
  test('a file is an object with exactly a name, a type and data', () => {
    expect(isToolFile(file)).toBe(true)
    expect(isToolFile({name: 'a.png', data: file.data})).toBe(false)
    expect(isToolFile({...file, extra: 1})).toBe(false)
    expect(isToolFile({...file, data: 7})).toBe(false)
    expect(isToolFile([file])).toBe(false)
    expect(isToolFile(null)).toBe(false)
  })

  test('files are found at any depth and everything else is left as it was', () => {
    const seen: string[] = []
    const value = {title: 'T', nested: {list: [file, 3, {deep: file}]}, none: null}
    const replaced = replaceToolFiles(value, (found) => {
      seen.push(found.name)
      return found.name
    })
    expect(replaced).toEqual({title: 'T', nested: {list: ['a.png', 3, {deep: 'a.png'}]}, none: null})
    expect(seen).toEqual(['a.png', 'a.png'])
  })

  test('a record keeps a file’s name, type and size, and never its bytes', () => {
    const recorded = recordedJson({pages: 2, figure: file})
    expect(JSON.parse(recorded)).toEqual({pages: 2, figure: {name: 'a.png', mimeType: 'image/png', size: 9}})
    expect(recordedJson(undefined)).toBe('null')
  })

  test('a value too long to record loses its long strings, then everything but its size', () => {
    const long = 'x'.repeat(MAX_RECORDED_VALUE_BYTES)
    expect(JSON.parse(recordedJson({title: 'short', text: long}))).toEqual({
      title: 'short',
      text: `[${MAX_RECORDED_VALUE_BYTES} bytes not recorded]`,
    })
    // Under the limit, nothing is left out.
    expect(JSON.parse(recordedJson({text: 'x'.repeat(2000)}))).toEqual({text: 'x'.repeat(2000)})
    // Many short values are long together: only the size is kept.
    const many = Array.from({length: 20_000}, (_, i) => `value ${i}`)
    expect(JSON.parse(recordedJson(many))).toMatch(/^\[\d+ bytes not recorded\]$/)
  })

  test('a file name is a path that stays inside its folder', () => {
    expect(safeFilePath('assets/one.png')).toBe('assets/one.png')
    expect(safeFilePath('assets\\one.png')).toBe('assets/one.png')
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '', '.']) expect(safeFilePath(bad)).toBeNull()
  })
})
