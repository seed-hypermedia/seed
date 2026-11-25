// Builds the standalone @seed-hypermedia/agents-ui package into dist/:
//
// - index.js (+ lazy chunks): native ESM bundling the agents UI with every Seed workspace package
//   it uses. Only react and react-dom stay external (peer dependencies).
// - *.d.ts: declarations for the public API, plus the agents protocol's wire types under protocol/.
//   The build fails if a declaration reaches into a private workspace package.
// - styles.css: Tailwind utilities generated from exactly the modules in the bundle, Seed's palette,
//   and the CSS those modules import.
import {createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {compile, optimize} from '@tailwindcss/node'
import {Scanner} from '@tailwindcss/oxide'
import react from '@vitejs/plugin-react'
import ts from 'typescript'
import {build} from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packages = path.resolve(root, '..')
const protocolRoot = path.resolve(root, '../../../agents/protocol')
const output = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

await rm(output, {recursive: true, force: true})
await mkdir(output, {recursive: true})

// 1. JavaScript bundle. Remember every source module rollup kept, to scan for Tailwind classes.
const bundledModules = new Set()
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [
    react(),
    {
      name: 'collect-bundled-modules',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk') for (const id of chunk.moduleIds) bundledModules.add(id.split('?')[0])
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@seed-hypermedia/agents-protocol': path.join(protocolRoot, 'src/index.ts'),
      '@seed-hypermedia/client': path.join(packages, 'client/src'),
      '@shm/shared': path.join(packages, 'shared/src'),
      '@shm/ui': path.join(packages, 'ui/src'),
      '@shm/editor': path.join(packages, 'editor/src'),
      // The editor's own alias for its stylesheets (no other bundled package uses `@/`).
      '@/': `${path.join(packages, 'editor/src')}/`,
    },
  },
  define: {'process.env.NODE_ENV': JSON.stringify('production')},
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {entry: path.join(root, 'src/index.ts'), formats: ['es'], fileName: 'index', cssFileName: 'bundled'},
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/],
      output: {chunkFileNames: 'chunks/[name]-[hash].js'},
    },
  },
})

// 2. Declarations. Public sources are emitted one by one; their imports of the agents protocol are
// pointed at a copy of its declarations, and any other non-relative import fails the build.
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  allowImportingTsExtensions: true,
  types: ['react', 'react-dom'],
}
const tsconfig = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config
const kitSources = (await readdir(path.join(root, 'src')))
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
  .map((file) => path.join(root, 'src', file))
const kitProgram = ts.createProgram(kitSources, {
  ...compilerOptions,
  baseUrl: root,
  paths: tsconfig.compilerOptions.paths,
})
reportDiagnostics(kitSources.flatMap((file) => ts.getPreEmitDiagnostics(kitProgram, kitProgram.getSourceFile(file))))
for (const file of kitSources) {
  kitProgram.emit(
    kitProgram.getSourceFile(file),
    (name, text) => {
      if (!name.endsWith('.d.ts')) return
      writeFileSync(path.join(output, path.basename(name)), text)
    },
    undefined,
    true,
  )
}
const protocolProgram = ts.createProgram([path.join(protocolRoot, 'src/index.ts')], {
  ...compilerOptions,
  rootDir: path.join(protocolRoot, 'src'),
  outDir: path.join(output, 'protocol'),
})
reportDiagnostics(ts.getPreEmitDiagnostics(protocolProgram))
protocolProgram.emit(undefined, undefined, undefined, true)

const allowedTypeImports = new Set(['react', 'react/jsx-runtime'])
for (const file of await readdir(output, {recursive: true})) {
  if (!file.endsWith('.d.ts')) continue
  const filename = path.join(output, file)
  const rewrite = (match, start, specifier, end) => {
    if (specifier === '@seed-hypermedia/agents-protocol') return `${start}./protocol/index.js${end}`
    if (specifier.startsWith('.')) return path.extname(specifier) ? match : `${start}${specifier}.js${end}`
    if (allowedTypeImports.has(specifier)) return match
    throw new Error(`${file} declares a type from ${specifier}, which consumers cannot resolve`)
  }
  // Statements (`import … from '…'`, `export … from '…'`) and inline type queries (`import('…')`).
  const content = (await readFile(filename, 'utf8'))
    .replace(/^((?:import|export)\b[^'";]*?\bfrom\s*['"])([^'"]+)(['"])/gm, rewrite)
    .replace(/(\bimport\(\s*['"])([^'"]+)(['"])/g, rewrite)
  await writeFile(filename, content)
}

// 3. Stylesheet: utilities for the bundled modules + Seed theme + CSS the modules imported.
const scanned = [...bundledModules].filter(
  (id) => path.isAbsolute(id) && /\.(tsx?|jsx?)$/.test(id) && !id.includes('/node_modules/'),
)
const compiler = await compile(await readFile(path.join(root, 'src/styles.css'), 'utf8'), {
  base: path.join(root, 'src'),
  onDependency: () => {},
})
const candidates = new Scanner({}).scanFiles(
  await Promise.all(
    scanned.map(async (file) => ({content: await readFile(file, 'utf8'), extension: path.extname(file).slice(1)})),
  ),
)
const tailwind = optimize(compiler.build(candidates), {minify: true}).code
const bundledCss = await readFile(path.join(output, 'bundled.css'), 'utf8').catch(() => '')
// Library mode inlines every asset; fonts (KaTeX ships several formats of each) go back to files so
// a browser downloads only the face and format it uses, when it uses it.
await mkdir(path.join(output, 'assets'), {recursive: true})
const css = await extractDataFonts(`${bundledCss}\n${tailwind}`)
await writeFile(path.join(output, 'styles.css'), css)
await rm(path.join(output, 'bundled.css'), {force: true})

await cp(path.join(root, '../../../LICENSE'), path.join(output, 'LICENSE'))
await cp(path.join(root, 'README.md'), path.join(output, 'README.md'))
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      description: 'The Seed Hypermedia agents UI as a React package for any app',
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'https://github.com/seed-hypermedia/seed.git',
        directory: 'frontend/packages/agents-ui',
      },
      type: 'module',
      main: './index.js',
      types: './index.d.ts',
      sideEffects: ['**/*.css'],
      exports: {
        '.': {types: './index.d.ts', import: './index.js'},
        './styles.css': './styles.css',
        './package.json': './package.json',
      },
      peerDependencies: manifest.peerDependencies,
      publishConfig: {access: 'public'},
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `Built ${manifest.name}@${manifest.version}: ${bundledModules.size} bundled modules, ${scanned.length} scanned for styles`,
)

async function extractDataFonts(stylesheet) {
  const written = new Set()
  return stylesheet.replace(
    /url\((['"]?)data:(font\/[a-z0-9-]+|application\/font-[a-z0-9-]+);base64,([A-Za-z0-9+/=]+)\1\)/g,
    (_m, _q, mime, data) => {
      const ext = mime.split(/[/-]/).pop()
      const name = `assets/${createHash('sha256').update(data).digest('hex').slice(0, 16)}.${ext}`
      if (!written.has(name)) {
        written.add(name)
        writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
      }
      return `url(./${name})`
    },
  )
}

function reportDiagnostics(diagnostics) {
  if (!diagnostics.length) return
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  )
  process.exit(1)
}
