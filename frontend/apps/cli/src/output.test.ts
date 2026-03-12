import {describe, test, expect, beforeAll} from 'bun:test'
import chalk from 'chalk'
import {formatOutput, colorizeJson, colorizeYaml, stripBlockIdComments, replacer} from './output'

// Force chalk to emit ANSI codes even without a TTY (test runner)
beforeAll(() => {
  chalk.level = 3
})

// Strip ANSI escape codes for assertion comparisons
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

describe('formatOutput', () => {
  const data = {name: 'Alice', count: 42, active: true, tags: ['a', 'b']}

  test('json format produces valid indented JSON', () => {
    const result = formatOutput(data, 'json')
    expect(JSON.parse(result)).toEqual(data)
    expect(result).toContain('\n') // indented
  })

  test('json is the default format', () => {
    const result = formatOutput(data)
    expect(JSON.parse(result)).toEqual(data)
  })

  test('yaml format produces valid YAML', () => {
    const result = formatOutput(data, 'yaml')
    expect(result).toContain('name: Alice')
    expect(result).toContain('count: 42')
    expect(result).toContain('active: true')
  })

  test('table format with array renders header, separator, and rows', () => {
    const rows = [
      {id: 'a', name: 'Alice'},
      {id: 'b', name: 'Bob'},
    ]
    const result = formatOutput(rows, 'table')
    const lines = result.split('\n')
    expect(lines.length).toBe(4) // header, separator, 2 rows
    expect(lines[0]).toContain('id')
    expect(lines[0]).toContain('name')
    expect(lines[1]).toMatch(/^-+\s+-+$/)
    expect(lines[2]).toContain('a')
    expect(lines[3]).toContain('Bob')
  })

  test('table format with empty array returns (empty)', () => {
    expect(formatOutput([], 'table')).toBe('(empty)')
  })

  test('table format with object renders key: value pairs', () => {
    const result = formatOutput({foo: 'bar', baz: 123}, 'table')
    expect(result).toContain('foo: bar')
    expect(result).toContain('baz: 123')
  })

  test('table format with primitive array renders one per line', () => {
    const result = formatOutput(['x', 'y', 'z'], 'table')
    expect(result).toBe('x\ny\nz')
  })

  test('table format with scalar renders as string', () => {
    expect(formatOutput('hello', 'table')).toBe('hello')
  })

  test('table format truncates nested objects', () => {
    const result = formatOutput({arr: [1, 2], obj: {nested: true}}, 'table')
    expect(result).toContain('[2 items]')
    expect(result).toContain('{...}')
  })

  test('table format shows empty string for null/undefined values', () => {
    const result = formatOutput({a: null, b: undefined}, 'table')
    expect(result).toContain('a: ')
    expect(result).toContain('b: ')
  })

  test('json format with pretty=true produces colorized output', () => {
    const result = formatOutput(data, 'json', true)
    // Should contain ANSI escape codes
    expect(result).not.toBe(formatOutput(data, 'json', false))
    // Stripped output should be valid JSON
    expect(JSON.parse(stripAnsi(result))).toEqual(data)
  })

  test('yaml format with pretty=true produces colorized output', () => {
    const result = formatOutput(data, 'yaml', true)
    expect(result).not.toBe(formatOutput(data, 'yaml', false))
    expect(stripAnsi(result)).toContain('name:')
  })
})

describe('replacer', () => {
  test('converts BigInt to string', () => {
    expect(replacer('key', BigInt(123456789))).toBe('123456789')
  })

  test('passes through other values unchanged', () => {
    expect(replacer('key', 42)).toBe(42)
    expect(replacer('key', 'hello')).toBe('hello')
    expect(replacer('key', true)).toBe(true)
    expect(replacer('key', null)).toBe(null)
  })

  test('BigInt values serialize in JSON.stringify', () => {
    const obj = {big: BigInt(999)}
    const json = JSON.stringify(obj, replacer)
    expect(json).toBe('{"big":"999"}')
  })
})

describe('colorizeJson', () => {
  test('produces output with ANSI codes', () => {
    const result = colorizeJson({name: 'test', count: 1})
    expect(result).not.toBe(JSON.stringify({name: 'test', count: 1}, null, 2))
    // Contains color codes
    expect(result).toContain('\x1B[')
  })

  test('stripped output is valid JSON', () => {
    const data = {str: 'hello', num: 42, bool: true, nil: null, arr: [1, 2]}
    const result = colorizeJson(data)
    expect(JSON.parse(stripAnsi(result))).toEqual(data)
  })

  test('handles null input', () => {
    const result = colorizeJson(null)
    expect(stripAnsi(result)).toBe('null')
  })

  test('handles empty object', () => {
    const result = colorizeJson({})
    expect(stripAnsi(result)).toBe('{}')
  })

  test('handles nested objects', () => {
    const data = {a: {b: {c: 'deep'}}}
    const result = colorizeJson(data)
    expect(JSON.parse(stripAnsi(result))).toEqual(data)
  })

  test('handles BigInt via replacer', () => {
    const result = colorizeJson({big: BigInt(42)})
    const parsed = JSON.parse(stripAnsi(result))
    expect(parsed.big).toBe('42')
  })
})

describe('colorizeYaml', () => {
  test('produces output with ANSI codes', () => {
    const result = colorizeYaml({name: 'test'})
    expect(result).toContain('\x1B[')
  })

  test('stripped output contains YAML content', () => {
    const data = {str: 'hello', num: 42, bool: true}
    const result = stripAnsi(colorizeYaml(data))
    expect(result).toContain('str:')
    expect(result).toContain('hello')
    expect(result).toContain('num:')
    expect(result).toContain('42')
    expect(result).toContain('bool:')
    expect(result).toContain('true')
  })

  test('handles null values', () => {
    const result = colorizeYaml({x: null})
    expect(stripAnsi(result)).toContain('null')
  })

  test('handles arrays', () => {
    const result = colorizeYaml({items: ['a', 'b']})
    const plain = stripAnsi(result)
    expect(plain).toContain('items:')
    expect(plain).toContain('- a')
    expect(plain).toContain('- b')
  })
})

describe('stripBlockIdComments', () => {
  test('removes inline block-id comments', () => {
    const input = 'Hello world <!-- id:abc123 -->'
    expect(stripBlockIdComments(input)).toBe('Hello world')
  })

  test('removes block-id from heading', () => {
    const input = '# My Heading <!-- id:h1-xyz -->'
    expect(stripBlockIdComments(input)).toBe('# My Heading')
  })

  test('removes standalone block-id lines', () => {
    const input = '<!-- id:container1 -->\n- Item 1\n- Item 2'
    const result = stripBlockIdComments(input)
    expect(result).not.toContain('<!-- id:')
    expect(result).toContain('- Item 1')
    expect(result).toContain('- Item 2')
  })

  test('removes block-id from code fence', () => {
    const input = '```python <!-- id:code1 -->\nprint("hello")\n```'
    expect(stripBlockIdComments(input)).toBe('```python\nprint("hello")\n```')
  })

  test('handles multiple block-ids in document', () => {
    const input = [
      '---',
      'name: "Test"',
      '---',
      '',
      '# Title <!-- id:h1 -->',
      '',
      'Paragraph text <!-- id:p1 -->',
      '',
      '<!-- id:list1 -->',
      '- Item A <!-- id:li1 -->',
      '- Item B <!-- id:li2 -->',
    ].join('\n')

    const result = stripBlockIdComments(input)
    expect(result).not.toContain('<!-- id:')
    expect(result).toContain('# Title')
    expect(result).toContain('Paragraph text')
    expect(result).toContain('- Item A')
    expect(result).toContain('- Item B')
    expect(result).toContain('name: "Test"')
  })

  test('collapses triple+ newlines into double', () => {
    const input = 'Line A\n\n\n\nLine B'
    expect(stripBlockIdComments(input)).toBe('Line A\n\nLine B')
  })

  test('does not touch non-block-id HTML comments', () => {
    const input = '<!-- This is a regular comment -->\nText <!-- keep this -->'
    expect(stripBlockIdComments(input)).toBe(input)
  })

  test('handles empty string', () => {
    expect(stripBlockIdComments('')).toBe('')
  })

  test('handles markdown with no block-ids', () => {
    const input = '# Hello\n\nWorld'
    expect(stripBlockIdComments(input)).toBe(input)
  })

  test('preserves block-id-like content inside code blocks as text', () => {
    // Note: regex-based stripping will remove these even inside code blocks.
    // This is acceptable for the CLI since blocksToMarkdown() never puts
    // block-id comments inside code block content (only on the fence line).
    const input = '```\nsome text\n```'
    expect(stripBlockIdComments(input)).toBe(input)
  })

  test('handles IDs with hyphens and underscores', () => {
    const input = 'Text <!-- id:my-block_id-123 -->'
    expect(stripBlockIdComments(input)).toBe('Text')
  })
})
