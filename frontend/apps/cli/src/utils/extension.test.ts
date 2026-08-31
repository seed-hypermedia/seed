import {describe, expect, test, beforeEach, afterEach} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {
  assertMountPath,
  bareHmId,
  buildInstallRecord,
  checkEntryHtml,
  defaultExtensionPath,
  deriveExtensionName,
  finalizeManifest,
  installCommandHint,
  installRecordAttributes,
  parseSettingsJson,
  rawInstalls,
  readExtensionPackage,
  readmeTitle,
  stripLeadingTitle,
  uninstallAttributes,
  MAX_ENTRY_BYTES,
} from './extension'
import {diffAttributes, flattenAttributes, metadataToSetAttributes} from './publish'

const MANIFEST = {
  manifestVersion: 1,
  kind: 'page',
  version: '0.1.0',
  description: 'Kanban board',
  permissions: ['sign', 'navigate'],
  defaultMountPath: 'board',
}

describe('readExtensionPackage', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seed-ext-'))
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'seed-extension.json'), JSON.stringify({$schema: 'x', ...MANIFEST}))
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><script>1</script>')
    writeFileSync(join(dir, 'README.md'), '# Kanban\n\nA board.\n')
  })
  afterEach(() => rmSync(dir, {recursive: true, force: true}))

  test('reads manifest, entry and README with defaults', () => {
    const pkg = readExtensionPackage(dir)
    expect(pkg.manifestRaw).toEqual(MANIFEST)
    expect(pkg.manifestRaw.$schema).toBeUndefined()
    expect(pkg.entryHtml).toContain('<script>')
    expect(pkg.readme).toContain('A board.')
    expect(pkg.name).toBe('Kanban')
    expect(pkg.nameSource).toBe('readme')
    expect(pkg.warnings).toEqual([])
  })

  test('falls back to package.json name, then directory name', () => {
    rmSync(join(dir, 'README.md'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: '@acme/my-ext'}))
    expect(readExtensionPackage(dir).name).toBe('my-ext')
    rmSync(join(dir, 'package.json'))
    const fromDir = readExtensionPackage(dir)
    expect(fromDir.name).toBe(dir.split('/').pop()!)
    expect(fromDir.nameSource).toBe('directory')
    expect(fromDir.readme).toBeNull()
  })

  test('--name wins over everything', () => {
    expect(readExtensionPackage(dir, {name: 'Custom'}).nameSource).toBe('flag')
  })

  test('honours explicit entry/manifest/readme paths', () => {
    writeFileSync(join(dir, 'other.html'), '<script>2</script>')
    writeFileSync(join(dir, 'm.json'), JSON.stringify({...MANIFEST, version: '9.9.9'}))
    writeFileSync(join(dir, 'r.md'), '# Other\n')
    const pkg = readExtensionPackage(dir, {
      entry: join(dir, 'other.html'),
      manifest: join(dir, 'm.json'),
      readme: join(dir, 'r.md'),
    })
    expect(pkg.entryHtml).toBe('<script>2</script>')
    expect(pkg.manifestRaw.version).toBe('9.9.9')
    expect(pkg.name).toBe('Other')
  })

  test('errors on missing manifest, missing entry, invalid JSON, oversize entry', () => {
    expect(() => readExtensionPackage(join(dir, 'nope'))).toThrow(/not found/)
    rmSync(join(dir, 'seed-extension.json'))
    expect(() => readExtensionPackage(dir)).toThrow(/Manifest not found/)
    writeFileSync(join(dir, 'seed-extension.json'), '{oops')
    expect(() => readExtensionPackage(dir)).toThrow(/not valid JSON/)
    writeFileSync(join(dir, 'seed-extension.json'), JSON.stringify(MANIFEST))
    rmSync(join(dir, 'dist', 'index.html'))
    expect(() => readExtensionPackage(dir)).toThrow(/Entry HTML not found/)
    writeFileSync(join(dir, 'dist', 'index.html'), Buffer.alloc(MAX_ENTRY_BYTES + 1, 0x20))
    expect(() => readExtensionPackage(dir)).toThrow(/limit is 4.00 MiB/)
  })

  test('warns about relative src/href and missing scripts', () => {
    writeFileSync(join(dir, 'dist', 'index.html'), '<link href="./a.css"><img src="/b.png">')
    const pkg = readExtensionPackage(dir)
    expect(pkg.warnings.length).toBe(2)
    expect(pkg.warnings[0]).toMatch(/2 relative URLs/)
    expect(pkg.warnings[1]).toMatch(/no <script>/)
  })
})

describe('checkEntryHtml', () => {
  test('ignores absolute and data URLs', () => {
    expect(
      checkEntryHtml('<script src="https://cdn.example/x.js"></script><img src="data:image/png;base64,AA">'),
    ).toEqual([])
  })
  test('flags ../ paths too', () => {
    expect(checkEntryHtml("<script src='../x.js'></script>")[0]).toMatch(/1 relative URL /)
  })
})

describe('readme title handling', () => {
  test('readmeTitle takes the first H1, skipping frontmatter and code fences', () => {
    expect(readmeTitle('---\nname: x\n---\n\n# Hello World  \n')).toBe('Hello World')
    expect(readmeTitle('```\n# not a title\n```\n## Sub\n# Real\n')).toBe('Real')
    expect(readmeTitle('no headings')).toBeNull()
  })

  test('stripLeadingTitle removes the title only when it leads the body', () => {
    expect(stripLeadingTitle('# Kanban\n\nBody\n', 'Kanban')).toBe('Body\n')
    expect(stripLeadingTitle('---\na: 1\n---\n# Kanban\nBody', 'Kanban')).toBe('---\na: 1\n---\nBody')
    expect(stripLeadingTitle('Intro\n# Kanban\n', 'Kanban')).toBe('Intro\n# Kanban\n')
    expect(stripLeadingTitle('# Other\n', 'Kanban')).toBe('# Other\n')
  })

  test('deriveExtensionName precedence', () => {
    expect(deriveExtensionName({flag: 'F', readme: '# R', dir: '/tmp/d'})).toEqual({name: 'F', nameSource: 'flag'})
    expect(deriveExtensionName({readme: '# R', dir: '/tmp/d'})).toEqual({name: 'R', nameSource: 'readme'})
  })
})

describe('manifest and paths', () => {
  test('finalizeManifest adds the entry and validates', () => {
    const m = finalizeManifest(MANIFEST, 'bafkabc')
    expect(m.entry).toBe('ipfs://bafkabc')
    expect(m.permissions).toEqual(['sign', 'navigate'])
    expect(() => finalizeManifest({...MANIFEST, kind: 'nope'}, 'bafk')).toThrow(/Invalid extension manifest: kind/)
    expect(() => finalizeManifest({...MANIFEST, extra: 1}, 'bafk')).toThrow(/Invalid extension manifest/)
  })

  test('defaultExtensionPath prefers defaultMountPath, then a name slug', () => {
    expect(defaultExtensionPath(MANIFEST, 'My Ext')).toBe('board')
    expect(defaultExtensionPath({}, 'My Ext!')).toBe('my-ext')
    expect(defaultExtensionPath({}, '')).toBe('extension')
  })

  test('assertMountPath trims slashes and rejects bad paths', () => {
    expect(assertMountPath('/board/')).toBe('board')
    expect(assertMountPath('tools/board')).toBe('tools/board')
    expect(() => assertMountPath('Board')).toThrow(/Invalid mount path/)
    expect(() => assertMountPath('a b')).toThrow(/Invalid mount path/)
    expect(() => assertMountPath('-x')).toThrow(/Invalid mount path/)
    expect(() => assertMountPath('')).toThrow(/Invalid mount path/)
  })

  test('bareHmId and installCommandHint', () => {
    expect(bareHmId('z6Mk', ['a', 'b'])).toBe('hm://z6Mk/a/b')
    expect(bareHmId('z6Mk', null)).toBe('hm://z6Mk')
    expect(installCommandHint('hm://z6Mk/x', 'board', false)).toBe(
      'seed-cli extension install hm://z6Mk/x --path board -k <sitekey>',
    )
    expect(installCommandHint('hm://z6Mk/x', undefined, true)).toBe(
      'seed-cli extension install hm://z6Mk/x -k <sitekey> --dev',
    )
  })
})

describe('install records', () => {
  test('buildInstallRecord only includes set fields', () => {
    expect(buildInstallRecord({ext: 'hm://z6Mk/x'})).toEqual({ext: 'hm://z6Mk/x'})
    expect(
      buildInstallRecord({ext: 'hm://z6Mk/x', version: 'bafy1', title: 'T', nav: false, settings: {columns: 4}}),
    ).toEqual({ext: 'hm://z6Mk/x', version: 'bafy1', title: 'T', nav: false, settings: {columns: 4}})
    expect(buildInstallRecord({ext: 'hm://z6Mk/x', nav: true, settings: {}})).toEqual({ext: 'hm://z6Mk/x'})
    expect(() => buildInstallRecord({ext: 'hm://z6Mk/x?v=bafy'})).toThrow(/Invalid install record: ext/)
  })

  test('parseSettingsJson', () => {
    expect(parseSettingsJson(undefined)).toBeUndefined()
    expect(parseSettingsJson('{"a":1}')).toEqual({a: 1})
    expect(() => parseSettingsJson('[1]')).toThrow(/JSON object/)
    expect(() => parseSettingsJson('{')).toThrow(/JSON object/)
  })

  test('rawInstalls tolerates junk', () => {
    expect(rawInstalls(undefined)).toEqual({})
    expect(rawInstalls({extensions: 'x'})).toEqual({})
    expect(rawInstalls({extensions: {board: null}})).toEqual({board: null})
  })

  test('installRecordAttributes writes one leaf per field', () => {
    const record = buildInstallRecord({ext: 'hm://z6Mk/x', version: 'v1', settings: {columns: 4}})
    expect(installRecordAttributes('board', record, undefined)).toEqual([
      {key: ['extensions', 'board', 'ext'], value: 'hm://z6Mk/x'},
      {key: ['extensions', 'board', 'version'], value: 'v1'},
      {key: ['extensions', 'board', 'settings', 'columns'], value: 4},
    ])
  })

  test('installRecordAttributes nulls leaves dropped by a replacement and skips unchanged ones', () => {
    const previous = {ext: 'hm://z6Mk/x', version: 'v1', title: 'Old', settings: {columns: 4}}
    const record = buildInstallRecord({ext: 'hm://z6Mk/x', nav: false})
    expect(installRecordAttributes('board', record, previous)).toEqual([
      {key: ['extensions', 'board', 'version'], value: null},
      {key: ['extensions', 'board', 'title'], value: null},
      {key: ['extensions', 'board', 'settings', 'columns'], value: null},
      {key: ['extensions', 'board', 'nav'], value: false},
    ])
    expect(installRecordAttributes('board', buildInstallRecord(previous), previous)).toEqual([])
  })

  test('uninstallAttributes nulls every leaf of the previous record', () => {
    expect(uninstallAttributes('board', {ext: 'hm://z6Mk/x', version: 'v1', settings: {a: {b: 1}}})).toEqual([
      {key: ['extensions', 'board', 'ext'], value: null},
      {key: ['extensions', 'board', 'version'], value: null},
      {key: ['extensions', 'board', 'settings', 'a', 'b'], value: null},
    ])
    expect(uninstallAttributes('board', undefined)).toEqual([])
    expect(uninstallAttributes('board', null)).toEqual([])
  })
})

describe('publish attribute helpers', () => {
  test('flattenAttributes keeps arrays whole and nests objects', () => {
    expect(flattenAttributes({a: {b: 1, c: ['x', 'y']}, d: null, e: undefined, f: true}, [])).toEqual([
      {key: ['a', 'b'], value: 1},
      {key: ['a', 'c'], value: ['x', 'y']},
      {key: ['d'], value: null},
      {key: ['f'], value: true},
    ])
  })

  test('metadataToSetAttributes builds one op or null', () => {
    expect(metadataToSetAttributes({})).toBeNull()
    expect(metadataToSetAttributes({name: 'N', theme: {color: 'red'}} as any)).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'N'},
        {key: ['theme', 'color'], value: 'red'},
      ],
    })
  })

  test('diffAttributes replaces arrays whole and nulls removed leaves', () => {
    expect(
      diffAttributes(
        ['seedExtension'],
        {permissions: ['sign'], version: '2'},
        {permissions: ['sign', 'nav'], version: '2', homepage: 'h'},
      ),
    ).toEqual([
      {key: ['seedExtension', 'permissions'], value: ['sign']},
      {key: ['seedExtension', 'homepage'], value: null},
    ])
    expect(diffAttributes(['x'], 'a', null)).toEqual([{key: ['x'], value: 'a'}])
    expect(diffAttributes(['x'], undefined, null)).toEqual([])
  })
})
