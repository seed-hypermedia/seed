import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once, EventEmitter} from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

test('dependency changes during shutdown cannot leave competing child processes', {timeout: 15000}, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-file-watcher-'))
  await fs.mkdir(path.join(dir, 'fixture'))
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({dependencies: {fixture: 'file:./fixture'}}))
  await fs.writeFile(path.join(dir, 'fixture/package.json'), JSON.stringify({name: 'fixture', version: '1.0.0'}))
  await fs.writeFile(
    path.join(dir, 'child.mjs'),
    `import * as fs from 'node:fs';
const gate = 'release-' + process.pid;
console.log('CHILD ' + process.pid);
setInterval(() => {}, 1000);
process.once('SIGTERM', () => {
  console.log('STOPPING ' + process.pid);
  if (fs.existsSync(gate)) process.exit(0);
  fs.watch('.', () => { if (fs.existsSync(gate)) process.exit(0); });
});`,
  )
  const child = spawn(
    'bun',
    [fileURLToPath(new URL('./watch-file-deps.ts', import.meta.url)), process.execPath, 'child.mjs'],
    {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const exited = once(child, 'exit')
  const output = new EventEmitter()
  const lines = []
  let pending = ''
  child.stdout.on('data', (chunk) => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\n')) >= 0) {
      lines.push(pending.slice(0, end))
      pending = pending.slice(end + 1)
      output.emit('line')
    }
  })
  child.stderr.resume()
  const matching = (prefix) => lines.filter((line) => line.startsWith(prefix))
  const waitFor = async (prefix, count) => {
    while (matching(prefix).length < count) await once(output, 'line')
    return matching(prefix)[count - 1]
  }
  t.after(async () => {
    for (const line of matching('CHILD ')) await fs.writeFile(path.join(dir, `release-${line.split(' ')[1]}`), '')
    child.kill('SIGTERM')
    await exited
    await fs.rm(dir, {recursive: true, force: true})
  })

  const first = (await waitFor('CHILD ', 1)).split(' ')[1]
  await waitFor('👀 watch-file-deps:', 1)
  // Respect the watcher's documented one-second suppression of its own install events.
  await delay(1100)
  await fs.writeFile(path.join(dir, 'fixture/source.txt'), 'first change')
  await waitFor('STOPPING ', 1)
  await fs.writeFile(path.join(dir, 'fixture/source.txt'), 'second change')
  await waitFor('↻ watch-file-deps:', 2)
  // Keep the first child's shutdown gated while the second restart has time to spawn a contender.
  await delay(500)
  assert.equal(matching('CHILD ').length, 1, 'a new child must wait for the existing child to exit')

  await fs.writeFile(path.join(dir, `release-${first}`), '')
  await waitFor('CHILD ', 2)
  assert.throws(() => process.kill(Number(first), 0), {code: 'ESRCH'})
  assert.equal(matching('CHILD ').length, 2)
})
