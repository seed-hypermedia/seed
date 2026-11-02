import {parseFrontmatter, type HMSigner, type SeedClient} from '@seed-hypermedia/client'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync, statSync, unlinkSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import type {DevLoopOptions} from './dev-loop'
import {defaultLayout, exportPath, exportSpace, importSpace, listSpaceVersions, retireMissing} from './space-sync'

/** A temporary checkout or file change; the next ordinary polling pass retries it. */
export class DevSyncPaused extends Error {}

/**
 * What the loop watches on disk: every page and schema file with its text, and every file a
 * page's frontmatter names by relative path (its attribute assets, a folder's files one by one)
 * with a digest of its bytes, each asset mapped to the page it belongs to. So an edit to a tool's
 * code pushes the tool's page, and an asset edited mid-pass is noticed like a page would be.
 */
function readDirectory(dir: string): {files: Map<string, string>; pageOf: Map<string, string>} {
  if (!existsSync(dir)) throw new DevSyncPaused('The documentation directory is absent; waiting for it to return.')
  const files = new Map<string, string>()
  const pageOf = new Map<string, string>()
  const walk = (folder: string) => {
    for (const entry of readdirSync(resolve(dir, folder), {withFileTypes: true})) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const file = join(folder, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith('.md') || file.endsWith('.schema.json'))
        files.set(file, readFileSync(resolve(dir, file), 'utf8'))
    }
  }
  walk('')
  for (const [page, text] of [...files].filter(([file]) => file.endsWith('.md'))) {
    for (const asset of attributeAssetFiles(dir, page, text)) {
      if (!files.has(asset)) files.set(asset, digestOf(resolve(dir, asset)))
      pageOf.set(asset, page)
    }
  }
  return {files, pageOf}
}

/** A short digest of a file's bytes, enough to notice a change without holding the bytes. */
function digestOf(file: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`
}

/** The files a page's frontmatter names by relative path, relative to the directory; a folder is listed file by file. */
function attributeAssetFiles(dir: string, page: string, text: string): string[] {
  let metadata: Record<string, unknown>
  try {
    metadata = parseFrontmatter(text).metadata as Record<string, unknown>
  } catch {
    return []
  }
  const out: string[] = []
  const pageDir = resolve(dir, dirname(page))
  const leaves = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value as Record<string, unknown>).flatMap(leaves)
        : []
  for (const value of leaves(metadata)) {
    if (!/^\.\.?\//.test(value)) continue
    const abs = resolve(pageDir, value)
    if (!existsSync(abs)) continue
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, {withFileTypes: true})) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        if (entry.isDirectory()) walk(join(folder, entry.name))
        else if (entry.isFile()) out.push(relative(dir, join(folder, entry.name)))
      }
    }
    if (statSync(abs).isDirectory()) walk(abs)
    else out.push(relative(dir, abs))
  }
  return out
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([file, contents]) => b.get(file) === contents)
}

/** One long-lived sync session. Disk reconciliation and app exports never run concurrently. */
export class DevDirectorySync {
  private readonly gitDir?: string
  private readonly gitRoot?: string
  private revision?: string
  private baseline?: Map<string, string>
  private versions = new Map<string, string>()
  private files = new Map<string, string>()
  private reconcile = false
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly opts: DevLoopOptions,
    private readonly client: SeedClient,
    private readonly signer: HMSigner,
    private readonly account: string,
    private readonly log: (line: string) => void,
  ) {
    const git = spawnSync('git', ['-C', opts.dir, 'rev-parse', '--show-toplevel', '--absolute-git-dir'], {
      encoding: 'utf8',
    })
    if (git.status === 0) [this.gitRoot, this.gitDir] = git.stdout.trim().split('\n')
  }

  private checkout(): string {
    if (!this.gitDir) return ''
    const busy = [
      'index.lock',
      'HEAD.lock',
      'rebase-merge',
      'rebase-apply',
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
    ]
    if (busy.some((file) => existsSync(resolve(this.gitDir!, file)))) {
      throw new DevSyncPaused('Git is changing the checkout; sync will resume automatically.')
    }
    const head = readFileSync(resolve(this.gitDir, 'HEAD'), 'utf8')
    const commit = spawnSync('git', ['-C', this.gitRoot!, 'rev-parse', '--verify', 'HEAD'], {encoding: 'utf8'})
    const conflicts = spawnSync('git', ['-C', this.gitRoot!, 'ls-files', '--unmerged'], {encoding: 'utf8'})
    if (conflicts.status !== 0 || conflicts.stdout) {
      throw new DevSyncPaused('Git has unresolved conflicts; sync will resume after they are resolved.')
    }
    // An unborn branch is still a valid directory to edit. HEAD also distinguishes
    // two branch names pointing to the same commit, including linked worktrees.
    if (
      busy.some((file) => existsSync(resolve(this.gitDir!, file))) ||
      readFileSync(resolve(this.gitDir, 'HEAD'), 'utf8') !== head
    ) {
      throw new DevSyncPaused('Git changed during the sync check; retrying the new checkout.')
    }
    return head + (commit.status === 0 ? commit.stdout.trim() : '')
  }

  /** Run one pass, queued behind any earlier pass; failures do not poison subsequent attempts. */
  tick(): Promise<void> {
    const task = this.pending.then(() => this.run())
    this.pending = task.catch(() => {})
    return task
  }

  private async run() {
    const revision = this.checkout()
    const {files: snapshot, pageOf} = readDirectory(this.opts.dir)
    const initial = this.baseline === undefined
    if (
      (!initial || this.opts.push) &&
      ![...snapshot.keys()].some(
        (file) => file.endsWith('.md') && (this.opts.layout ?? defaultLayout).pathForFile(file) !== null,
      )
    ) {
      throw new DevSyncPaused('No source documents in this checkout; waiting for them to return.')
    }
    const switched = this.revision !== undefined && this.revision !== revision
    if (switched && this.opts.watchFiles === false) {
      throw new DevSyncPaused('Checkout changed; --no-watch leaves sync paused to protect the new source files.')
    }
    const full = (initial && this.opts.push) || switched || this.reconcile
    const changed =
      !initial && this.opts.watchFiles !== false
        ? [...new Set([...snapshot.keys(), ...this.baseline!.keys()])].filter(
            (file) => snapshot.get(file) !== this.baseline!.get(file),
          )
        : []
    const layout = this.opts.layout ?? defaultLayout
    const assertCurrent = () => {
      if (this.checkout() !== revision || !sameFiles(snapshot, readDirectory(this.opts.dir).files)) {
        throw new DevSyncPaused('Checkout or source files changed during sync; retrying from disk.')
      }
    }
    // A request already accepted by the daemon may finish during a checkout. Do
    // not issue its next publication, and repair the dev site on the next pass.
    const client: SeedClient = {
      ...this.client,
      publish: (input) => {
        assertCurrent()
        return this.client.publish(input)
      },
      putBlob: (blob, options) => {
        assertCurrent()
        return this.client.putBlob(blob, options)
      },
    }
    const written: string[] = []
    const exportOptions = {
      client,
      uid: this.account,
      dir: this.opts.dir,
      layout,
      preserveSource: true,
      beforeWrite: assertCurrent,
      onWrite: (file: string) => {
        // A page or schema by its text, an attribute asset by its digest, as readDirectory keeps them.
        const content =
          file.endsWith('.md') || file.endsWith('.schema.json')
            ? readFileSync(resolve(this.opts.dir, file), 'utf8')
            : digestOf(resolve(this.opts.dir, file))
        snapshot.set(file, content)
        this.baseline?.set(file, content)
        written.push(file)
        this.log(`wrote ${file}`)
      },
    }
    try {
      if (full || changed.length) {
        assertCurrent()
        if ((initial || switched) && this.opts.beforePush)
          await this.opts.beforePush({client, signer: this.signer, account: this.account})
        assertCurrent()
        if (switched) this.log('Checkout changed; reconciling the dev site with this branch.')
        const candidates = full ? [...snapshot.keys()] : changed
        // A schema file or an attribute asset pushes the page it belongs to.
        const markdown = [
          ...new Set(candidates.map((file) => pageOf.get(file) ?? file.replace(/\.schema\.json$/, '.md'))),
        ]
        const only = markdown.filter((file) => snapshot.has(file))
        const result = await importSpace({
          client,
          signer: this.signer,
          account: this.account,
          dir: this.opts.dir,
          layout,
          metadataFor: this.opts.metadataFor,
          only,
          log: (line) => {
            if (!line.startsWith('same    ')) this.log(line)
          },
        })
        assertCurrent()
        const gone = markdown
          .filter((file) => !snapshot.has(file))
          .map((file) => layout.pathForFile(file))
          .filter((path): path is string => path !== null)
        const retired = await retireMissing({
          client,
          signer: this.signer,
          account: this.account,
          dir: this.opts.dir,
          layout,
          paths: full ? undefined : gone,
          skip: new Set(result.moved.map((move) => move.split(' -> ')[0]!)),
          log: this.log,
        })
        assertCurrent()
        if (!initial && !switched && (result.created.length || result.updated.length || result.moved.length))
          this.opts.onPushed?.(only)
        // Start a new observation baseline after the old checkout's requests
        // have drained. Never export the prior branch back over the new files.
        const versions = await listSpaceVersions(client, this.account)
        assertCurrent()
        this.files = new Map(
          [...snapshot.keys()]
            .filter((file) => file.endsWith('.md'))
            .flatMap((file) => {
              const path = layout.pathForFile(file)
              return path === null ? [] : [[path, file] as const]
            }),
        )
        if (full) {
          // A document created in the app after retirement still needs exporting.
          this.versions = new Map([...versions].filter(([path]) => this.files.has(path)))
        } else {
          // A file push acknowledges only its own paths. App edits to other pages
          // during the request must still be picked up by the following pull.
          for (const file of only) {
            const path = layout.pathForFile(file)
            if (path !== null && versions.has(path)) this.versions.set(path, versions.get(path)!)
          }
          for (const path of gone) this.versions.delete(path)
        }
        this.baseline = snapshot
        this.revision = revision
        this.reconcile = false
        if (full)
          this.log(
            `${result.created.length} created, ${result.moved.length} moved, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${retired.length} retired.`,
          )
        if (switched) this.log('Checkout reconciled; watching app and file edits again.')
        return
      }

      const next = await listSpaceVersions(client, this.account)
      assertCurrent()
      if (!next.size && this.versions.size) throw new DevSyncPaused('The dev site is unavailable; keeping local files.')
      if (initial) {
        this.files = (await exportSpace(exportOptions)).files
        this.versions = next
      } else {
        for (const [path, version] of next) {
          if (this.versions.get(path) === version) continue
          const result = await exportPath(exportOptions, path)
          assertCurrent()
          if (!result.file) continue
          this.files.set(path, result.file)
          this.versions.set(path, version)
        }
        for (const path of this.versions.keys()) {
          if (next.has(path)) continue
          const file = this.files.get(path)
          if (file) {
            assertCurrent()
            if (existsSync(resolve(this.opts.dir, file))) unlinkSync(resolve(this.opts.dir, file))
            snapshot.delete(file)
            this.baseline?.delete(file)
            this.log(`removed ${file}`)
          }
          this.files.delete(path)
          this.versions.delete(path)
        }
      }
      assertCurrent()
      if (written.length) this.opts.onWritten?.(written)
      this.baseline = snapshot
      this.revision = revision
    } catch (error) {
      if (full || changed.length || error instanceof DevSyncPaused) this.reconcile = this.opts.watchFiles !== false
      throw error
    }
  }
}
