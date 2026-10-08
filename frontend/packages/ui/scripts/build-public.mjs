import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Scanner} from '@tailwindcss/oxide'
import {compile, optimize} from '@tailwindcss/node'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src')
const output = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const entrypoints = [
  'button',
  'seed-logo',
  'utils',
  'components/input',
  'components/dialog',
  'components/label',
  'components/code-input',
  'components/badge',
  'components/textarea',
  'components/skeleton',
]

await rm(output, {recursive: true, force: true})
await mkdir(output, {recursive: true})
const files = entrypoints.map((entry) => path.join(source, `${entry}.${entry === 'utils' ? 'ts' : 'tsx'}`))
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  declaration: true,
  rootDir: source,
  outDir: output,
  types: ['react', 'react-dom'],
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  )
  process.exit(1)
}
program.emit()

// Native ESM and NodeNext declarations both need explicit relative extensions.
for (const file of await readdir(output, {recursive: true})) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
  const filename = path.join(output, file)
  const content = await readFile(filename, 'utf8')
  await writeFile(
    filename,
    content.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (match, start, specifier, end) => {
      return path.extname(specifier) ? match : `${start}${specifier}.js${end}`
    }),
  )
}
await writeFile(path.join(output, 'index.js'), entrypoints.map((entry) => `export * from './${entry}.js'\n`).join(''))
await writeFile(path.join(output, 'index.d.ts'), entrypoints.map((entry) => `export * from './${entry}.js'\n`).join(''))

// Compile only this public surface. No preflight: consumers retain their reset.
const css = `
@import 'tailwindcss/theme.css';
@import '../src/theme.css';
@import 'tw-animate-css';
@custom-variant dark (&:is(.dark *));
@tailwind utilities;
@media (prefers-reduced-motion: reduce) {
  [data-slot^='dialog-'] { animation: none !important; transition: none !important; }
}
`
const compiler = await compile(css, {base: path.join(root, 'scripts'), onDependency: () => {}})
const candidates = new Scanner({}).scanFiles(
  await Promise.all(
    files.map(async (file) => ({content: await readFile(file, 'utf8'), extension: path.extname(file).slice(1)})),
  ),
)
await writeFile(path.join(output, 'styles.css'), optimize(compiler.build(candidates), {minify: true}).code)
const tokens = await compile("@import '../src/theme.css';", {base: path.join(root, 'scripts'), onDependency: () => {}})
await writeFile(path.join(output, 'tokens.css'), optimize(tokens.build([]), {minify: true}).code)
for (const file of ['theme.css', 'base.css']) await cp(path.join(source, file), path.join(output, file))
await cp(path.join(root, '../../../LICENSE'), path.join(output, 'LICENSE'))
await cp(path.join(root, 'README.md'), path.join(output, 'README.md'))

const exports = {'.': {types: './index.d.ts', import: './index.js'}}
for (const entry of entrypoints) exports[`./${entry}`] = {types: `./${entry}.d.ts`, import: `./${entry}.js`}
for (const alias of ['input', 'dialog', 'label']) exports[`./${alias}`] = exports[`./components/${alias}`]
for (const stylesheet of ['styles', 'tokens', 'theme', 'base']) exports[`./${stylesheet}.css`] = `./${stylesheet}.css`
exports['./package.json'] = './package.json'

// Derive runtime dependencies from the emitted public modules. Fail closed if a
// component starts pulling in a private workspace package or undeclared module.
const dependencies = {}
for (const file of await readdir(output, {recursive: true})) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
  const content = await readFile(path.join(output, file), 'utf8')
  for (const match of content.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.')) continue
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (manifest.peerDependencies[name]) continue
    const version = manifest.dependencies[name]
    if (!version || version.startsWith('workspace:')) throw new Error(`Unpublishable public dependency: ${name}`)
    dependencies[name] = version
  }
}
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      description: 'Shared Seed Hypermedia React components and design tokens',
      license: 'Apache-2.0',
      repository: {type: 'git', url: 'https://github.com/seed-hypermedia/seed.git', directory: 'frontend/packages/ui'},
      type: 'module',
      main: './index.js',
      types: './index.d.ts',
      sideEffects: ['**/*.css'],
      exports,
      dependencies,
      peerDependencies: manifest.peerDependencies,
      publishConfig: {access: 'public'},
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `Built ${manifest.name}@${manifest.version}: ${entrypoints.length} public modules, declarations, and compiled CSS`,
)
