import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {audit, scanText} from './design-audit.mjs'

test('scanText counts the specified design drift patterns', () => {
  const cases = [
    ['bg-blue-700', 'rawPalette'],
    ['hover:text-red-500/50', 'rawPalette'],
    ['bg-black/5', 'blackWhite'],
    ['text-white', 'blackWhite'],
    ['<div color="#fff" />', 'colorLiteral'],
    ['w-[13px]', 'arbitraryLength'],
    ['text-[11px]', 'arbitraryTextSize'],
    ['grid-cols-[1fr_2fr]', 'arbitraryOther'],
    ['z-50', 'zIndex'],
    ['z-[9999]', 'zIndex'],
    ['transition-all', 'transitionAll'],
    ['ease-in-out', 'genericEasing'],
    ['<div style={{color: "red"}} />', 'inlineStyle'],
    ['ml-2', 'physicalDirection'],
    ['pr-4', 'physicalDirection'],
    ['left-0', 'physicalDirection'],
    ['text-left', 'physicalDirection'],
  ]

  for (const [text, category] of cases) {
    assert.equal(scanText(text)[category], 1, `${text} should count as ${category}`)
  }

  assert.equal(scanText('font-family: Georgia', {css: true}).fontFamily, 1)
  assert.equal(scanText("import Dialog from '@radix-ui/react-dialog'", {pkg: 'desktop'}).primitiveImport, 1)
})

test('scanText ignores semantic tokens, logical direction, arbitrary variants, and excluded CSS', () => {
  for (const text of [
    'bg-primary',
    'text-muted-foreground',
    'border-border',
    'data-[state=open]:opacity-100',
    'ms-2',
    'pe-4',
    'start-0',
    'text-start',
  ]) {
    assert.deepEqual(scanText(text), {}, `${text} should not count`)
  }

  assert.deepEqual(scanText('@font-face{font-family:Inter}', {css: true}), {})
  assert.deepEqual(scanText('/* bg-blue-700 */', {css: true}), {})
  assert.deepEqual(scanText("import Dialog from '@radix-ui/react-dialog'", {pkg: 'ui'}), {})
})

test('scanText reports motion without reduced-motion handling', () => {
  assert.equal(scanText('transition-colors').motionWithoutReduce, 1)
  assert.equal(scanText('transition-colors motion-reduce:transition-none').motionWithoutReduce, undefined)
})

test('audit excludes stories, tests, and the token stylesheet while including button.tsx', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'design-audit-'))
  const files = [
    ['frontend/packages/ui/src/button.tsx', 'bg-blue-700'],
    ['frontend/packages/ui/src/foo.stories.tsx', 'bg-blue-700'],
    ['frontend/packages/ui/src/__tests__/x.ts', 'bg-blue-700'],
    ['frontend/packages/ui/src/theme.css', 'font-family: Georgia;'],
  ]

  try {
    execFileSync('git', ['init', '-q'], {cwd: root})
    for (const [file, contents] of files) {
      const fullPath = path.join(root, file)
      mkdirSync(path.dirname(fullPath), {recursive: true})
      writeFileSync(fullPath, contents)
    }
    execFileSync('git', ['add', '-A'], {cwd: root})

    const result = audit(root)

    assert.deepEqual(result.files.rawPalette, [['frontend/packages/ui/src/button.tsx', 1]])
    assert.deepEqual(result.files.fontFamily, undefined)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
