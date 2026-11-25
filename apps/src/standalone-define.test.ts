import {expect, test} from 'bun:test'
import {readFile} from 'node:fs/promises'
import * as path from 'node:path'

/**
 * The compiled binary starts through a build-time define, because `import.meta.main` is false in
 * compiled executables on Windows. A define only replaces the exact expression it names, so the
 * entry point has to spell that expression out; this keeps the two files in step.
 */
test('the entry point reads the standalone flag as the literal the binary build defines', async () => {
  const root = path.resolve(import.meta.dir, '..')
  const build = await readFile(path.join(root, 'scripts', 'build-binary.ts'), 'utf8')
  const main = await readFile(path.join(root, 'src', 'main.ts'), 'utf8')

  const defined = /'(process\.env\.[A-Z_]*STANDALONE)':/.exec(build)?.[1]
  expect(defined).toBeDefined()
  expect(main).toContain(`import.meta.main || ${defined} === '1'`)
})
