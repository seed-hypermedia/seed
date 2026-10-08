import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const temporary = await mkdtemp(path.join(tmpdir(), 'seed-ui-package-'))
try {
  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', path.join(root, 'dist'), '--json', '--ignore-scripts', '--pack-destination', temporary],
      {
        encoding: 'utf8',
        env: {...process.env, npm_config_cache: path.join(temporary, '.npm')},
      },
    ),
  )[0]
  const install = path.join(temporary, 'node_modules/@shm/ui')
  await mkdir(install, {recursive: true})
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '--strip-components=1', '-C', install])
  const manifest = JSON.parse(await readFile(path.join(install, 'package.json'), 'utf8'))
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.type, 'module')
  assert(!JSON.stringify(manifest).includes('workspace:'))
  assert(packed.files.every(({path: file}) => !file.startsWith('src/') && !file.startsWith('scripts/')))

  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({private: true, type: 'module'}))
  const cleanInstall = process.argv.includes('--install')
  if (cleanInstall) {
    // CI verifies registry dependency resolution with a real external install.
    // Match React and its types to the versions pinned by the workspace lockfile.
    const peers = ['react', 'react-dom', '@types/react', '@types/react-dom'].map(
      (name) => `${name}@${require(`${name}/package.json`).version}`,
    )
    execFileSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, packed.filename), ...peers],
      {
        cwd: temporary,
        stdio: 'inherit',
        env: {...process.env, npm_config_cache: path.join(temporary, '.npm')},
      },
    )
  } else {
    // Offline mode reuses installed third-party dependencies. The UI package
    // itself is always unpacked, never linked to its workspace sources.
    for (const dependency of [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.peerDependencies),
      '@types/react',
      '@types/react-dom',
    ]) {
      let target
      for (const searchPath of require.resolve.paths(dependency)) {
        const candidate = path.join(searchPath, dependency)
        try {
          if (JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8')).name === dependency) {
            target = candidate
            break
          }
        } catch {}
      }
      assert(target, `Missing installed test dependency: ${dependency}`)
      const destination = path.join(temporary, 'node_modules', dependency)
      await mkdir(path.dirname(destination), {recursive: true})
      await symlink(target, destination, 'dir')
    }
  }
  const specifiers = Object.keys(manifest.exports).filter((key) => !key.endsWith('.css') && key !== './package.json')
  await writeFile(
    path.join(temporary, 'smoke.mjs'),
    `
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Button} from '@shm/ui/button'
import {CodeInput} from '@shm/ui/components/code-input'
for (const entry of ${JSON.stringify(specifiers)}) await import(entry === '.' ? '@shm/ui' : '@shm/ui/' + entry.slice(2))
const button = renderToStaticMarkup(createElement(Button, {loading: true, disabled: false}, 'Continue'))
assert.match(button, /disabled=""/)
const code = renderToStaticMarkup(createElement(CodeInput, {value: '', onChange() {}, length: 6}))
assert.equal((code.match(/<input /g) || []).length, 6)
assert.match(code, /min-w-0/)
`,
  )
  execFileSync(process.execPath, [path.join(temporary, 'smoke.mjs')], {stdio: 'inherit'})
  await writeFile(
    path.join(temporary, 'consumer.tsx'),
    `
import {Button, type ButtonProps} from '@shm/ui/button'
import {Input} from '@shm/ui/input'
import {Dialog, DialogContent, DialogTitle} from '@shm/ui/dialog'
import {Label} from '@shm/ui/label'
import {CodeInput} from '@shm/ui/components/code-input'
import {SeedLogo} from '@shm/ui'
const props: ButtonProps = {variant: 'brand'}
export const example = <Dialog><DialogContent><DialogTitle>Login</DialogTitle><SeedLogo/><Label>Email</Label><Input type="email"/><CodeInput value="" onChange={() => {}} length={6}/><Button {...props}>Continue</Button></DialogContent></Dialog>
`,
  )
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--jsx',
      'react-jsx',
      '--types',
      'react,react-dom',
      'consumer.tsx',
    ],
    {cwd: temporary, stdio: 'inherit'},
  )
  const stylesheet = await readFile(path.join(install, 'styles.css'), 'utf8')
  assert(!/@(?:tailwind|theme|apply|custom-variant|import)\b/.test(stylesheet), 'Published CSS must be compiled')
  assert(stylesheet.includes('--brand-5:'), 'Shared theme is included')
  assert(stylesheet.includes('.min-w-0'), 'Component utilities are included')
  assert(stylesheet.includes('.bg-primary'), 'Variant utilities are included')
  assert(stylesheet.includes('prefers-reduced-motion'), 'Dialogs respect reduced motion')
  if (process.env.UI_PACKAGE_ARTIFACT_DIR) {
    const artifactDirectory = path.resolve(process.env.UI_PACKAGE_ARTIFACT_DIR)
    await mkdir(artifactDirectory, {recursive: true})
    await cp(path.join(temporary, packed.filename), path.join(artifactDirectory, packed.filename))
  }
  console.log(
    `Verified packed ${manifest.name}@${manifest.version}: ${specifiers.length} JS exports, ${
      cleanInstall ? 'clean npm install' : 'offline dependency reuse'
    }, standalone Node ESM rendering, NodeNext declarations, and compiled CSS`,
  )
} finally {
  await rm(temporary, {recursive: true, force: true})
}
