import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = fileURLToPath(new URL('./dist/storybook', import.meta.url))
execFileSync('pnpm', ['--filter', '@shm/design-playground', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, VITE_STORYBOOK_URL: './storybook/'},
})
execFileSync('pnpm', ['--filter', '@shm/ui', 'exec', 'storybook', 'build', '--output-dir', output], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, STORYBOOK_PLAYGROUND_URL: '../'},
})
console.log('Combined site ready: frontend/apps/design-playground/dist (Storybook at /storybook/).')
