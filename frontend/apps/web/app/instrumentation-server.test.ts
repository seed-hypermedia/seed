import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('server instrumentation', () => {
  it('loads when Sentry is enabled', () => {
    const instrumentationPath = resolve(__dirname, '../instrumentation.server.mjs')
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import(${JSON.stringify(
          instrumentationPath,
        )}).catch((error) => { console.error(error.stack); process.exit(1) })`,
      ],
      {
        env: {
          ...process.env,
          SITE_SENTRY_DSN: 'https://public@example.com/1',
        },
        encoding: 'utf8',
      },
    )

    expect(result.stderr).not.toContain('getEnv')
    expect(result.status).toBe(0)
  })

  it('converts server-generated SVG images with Sharp', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          "const sharp = (await import('sharp')).default",
          'const svg = \'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red" /></svg>\'',
          'await sharp(Buffer.from(svg)).png().toBuffer()',
        ].join(';'),
      ],
      {
        env: process.env,
        encoding: 'utf8',
      },
    )

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
