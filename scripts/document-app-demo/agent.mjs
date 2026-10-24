import {spawn} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

/** Contract given to the real app-authoring agent; also displayed in the demo documentation. */
export const APP_CONTRACT = `Create one self-contained HTML app, with inline CSS and classic JavaScript.
No external scripts, styles, images, fonts, fetches, modules, workers, forms submitting to URLs, or CDN dependencies.
Do not use HTML form elements or submit events: this sandbox disables forms, including submission event handling.
Use button type="button" with click handlers, and keydown handlers for Enter where useful.
Do not use localStorage, IndexedDB, cookies, parent, top, postMessage, or browser credentials.
window.seed is available before your scripts execute. All methods return Promises:
  seed.context() -> {app, viewer, revision}; viewer is a demo account name.
  seed.storage.get(key) -> JSON value or null
  seed.storage.set(key, value) -> null
  seed.resource('project-brief') -> {title, text}, only after the host grants permission.
Handle permission errors visibly; do not repeatedly request or retry denied reads.
Storage is already scoped to the app and viewer. Use keys at most 128 characters, values under 16 KiB.
Use textContent for user content. No browser alert/confirm/prompt. Provide accessible labels and responsive CSS.
Use the same app in a 600px-wide panel and on mobile. Keep the implementation compact.
Return JSON with title, description, and html. No Markdown fences. No tools, file reads, shell commands, or network calls are needed.
This is code generation only: do not execute the app. The host will run it in an opaque browser sandbox.`

/** Validate and identify an app artifact without trusting its HTML. */
export function artifactFromOutput(output, {id = randomUUID(), prompt = '', provenance = 'Local Codex agent'} = {}) {
  if (
    !output ||
    typeof output.title !== 'string' ||
    output.title.length > 100 ||
    typeof output.description !== 'string' ||
    output.description.length > 500 ||
    typeof output.html !== 'string' ||
    Buffer.byteLength(output.html) > 512 * 1024 ||
    !/<html[\s>]/i.test(output.html) ||
    !/<script[\s>]/i.test(output.html)
  ) {
    throw new Error('Agent must return a complete HTML app, a short title, and a description (maximum 512 KiB).')
  }
  return {
    id,
    title: output.title,
    description: output.description,
    html: output.html,
    revision: createHash('sha256').update(output.html).digest('hex'),
    prompt,
    provenance,
    createdAt: new Date().toISOString(),
  }
}

/** Generate an app with the user's signed-in Codex CLI, in an ephemeral read-only working directory. */
export async function generateApp(prompt, {signal} = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'seed-app-author-'))
  const outputPath = join(scratch, 'result.json')
  const schemaPath = join(scratch, 'schema.json')
  try {
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'html'],
        properties: Object.fromEntries(['title', 'description', 'html'].map((key) => [key, {type: 'string'}])),
      }),
    )
    const child = spawn(
      'codex',
      [
        'exec',
        '--ignore-user-config',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '-c',
        'approval_policy="never"',
        '-c',
        'web_search="disabled"',
        '-c',
        'features.shell_tool=false',
        '--cd',
        scratch,
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--color',
        'never',
        '-',
      ],
      {cwd: scratch, stdio: ['pipe', 'ignore', 'pipe'], signal},
    )
    // Do not forward CLI diagnostics (which may contain local configuration) to the browser.
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.stdin.end(`${APP_CONTRACT}\n\nApp request:\n${prompt}`)
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Codex exited with ${code}. Check codex login status in your terminal, then retry.`)),
      )
    })
    return artifactFromOutput(JSON.parse(await readFile(outputPath, 'utf8')), {prompt})
  } finally {
    await rm(scratch, {recursive: true, force: true})
  }
}
