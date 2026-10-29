import {afterEach, describe, expect, test} from 'bun:test'
import {decode as decodeCbor} from '@ipld/dag-cbor'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown, type SeedClient} from '@seed-hypermedia/client'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {execFileSync, spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CID} from 'multiformats/cid'
import {create as createDigest} from 'multiformats/hashes/digest'
import {DevDirectorySync, DevSyncPaused} from './dev-sync'
import {keyPairFromPrivateKey} from './key-derivation'
import {createSignerFromKey} from './signer'
import type {DevLoopOptions} from './dev-loop'
import {loadPublicationBlobs, loadSchemaBlobs, publicationMetadataFor} from '../sync-hypermedia'
import {encodeSchemaBlob} from './space-sync'

const dirs: string[] = []
const key = keyPairFromPrivateKey(new Uint8Array(32).fill(7))
const signer = createSignerFromKey(key)
let sequence = 0
const version = () =>
  CID.createV1(0x71, createDigest(0x12, createHash('sha256').update(String(++sequence)).digest())).toString()
const genesis = version()
const gitEnv = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
const gitArgs = [
  '-c',
  'user.name=Sync Test',
  '-c',
  'user.email=sync@example.test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
]

function git(root: string, ...args: string[]) {
  return execFileSync('git', [...gitArgs, '-C', root, ...args], {
    encoding: 'utf8',
    env: gitEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'dev-sync-checkout-'))
  dirs.push(root)
  const dir = join(root, 'docs')
  mkdirSync(dir)
  writeFileSync(join(root, 'keep'), 'keep the repository when docs disappear\n')
  writeFileSync(join(dir, 'index.md'), '---\nname: First\n---\nFirst branch. <!-- id:home -->\n')
  writeFileSync(join(dir, 'old.md'), 'Move me. <!-- id:move -->\n')
  git(root, 'init', '-b', 'first')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'first')
  git(root, 'checkout', '-b', 'second')
  writeFileSync(join(dir, 'index.md'), '---\nname: Second\n---\nSecond branch. <!-- id:home -->\n')
  git(root, 'mv', 'docs/old.md', 'docs/new.md')
  writeFileSync(join(dir, 'extra.md'), 'Only on second.\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'second')
  git(root, 'checkout', 'first')
  return {root, dir}
}

// Only the transport is a fixture: real Git checkouts, files, Markdown parsing,
// imports, signed publications and exports run through the production code. The
// daemon echoes accepted publications; hooks suspend individual requests without sleeps.
function session(dir: string, overrides: Partial<DevLoopOptions> = {}) {
  const docs = new Map<string, HMDocument>()
  const published: string[] = []
  const logs: string[] = []
  const hooks: {request?: (key: string, path: string) => Promise<void>; publish?: () => Promise<void>} = {}
  const appEdit = (path: string, source: string) => {
    const parsed = parseMarkdown(source)
    docs.set(path, {
      account: key.accountId,
      path,
      metadata: parsed.metadata,
      content: markdownBlockNodesToHMBlockNodes(parsed.tree),
      version: version(),
      genesis,
    } as HMDocument)
  }
  const client = {
    request: async (name: string, input: any) => {
      const path = input?.path?.length ? '/' + input.path.join('/') : ''
      await hooks.request?.(name, path)
      if (name === 'Resource')
        return docs.has(path) ? {type: 'document', document: docs.get(path)} : {type: 'not-found'}
      if (name === 'Query')
        return {
          results: [...docs]
            .filter(([p]) => p !== '')
            .map(([p, doc]) => ({type: 'document', path: p.slice(1).split('/'), version: doc.version})),
        }
      if (name === 'ListChanges') {
        const path = input.targetId.path?.length ? '/' + input.targetId.path.join('/') : ''
        return {
          changes: [
            {id: genesis, deps: []},
            {id: docs.get(path)!.version, deps: [genesis]},
          ],
        }
      }
      if (name === 'GetCID') return {value: {type: 'String'}}
      throw new Error(`Unexpected request ${name}`)
    },
    publish: async (input: any) => {
      await hooks.publish?.()
      for (const blob of input.blobs) {
        const value = decodeCbor(blob.data) as any
        if (value.type !== 'Ref') continue
        const path = value.path ?? ''
        published.push(path)
        if (!value.heads?.length || value.redirect) docs.delete(path)
        else {
          const file = path ? path.slice(1) + '.md' : 'index.md'
          appEdit(path, readFileSync(join(dir, file), 'utf8'))
          docs.get(path)!.version = value.heads.map((cid: CID) => cid.toString()).join('.')
        }
      }
      return {}
    },
  } as unknown as SeedClient
  const sync = new DevDirectorySync(
    {dir, apiUrl: '', daemonUrl: '', intervalMs: 2000, push: true, ...overrides},
    client,
    signer,
    key.accountId,
    (line) => logs.push(line),
  )
  return {sync, docs, published, logs, hooks, appEdit}
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('a running dev sync follows Git checkouts', () => {
  test('can initially export the app into an empty directory without --push', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-sync-empty-'))
    dirs.push(dir)
    const {sync, appEdit, published} = session(dir, {push: false})
    appEdit('', 'An existing app document. <!-- id:home -->\n')
    await sync.tick()
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toContain('An existing app document.')
    await sync.tick()
    expect(published).toEqual([])
  }, 30_000)

  test('reconciles modifications, moves and deletions in both directions without dirtying either branch', async () => {
    const {root, dir} = repository()
    const {sync, docs, logs} = session(dir)
    await sync.tick()
    git(root, 'checkout', 'second')
    await sync.tick()
    await sync.tick()
    expect(docs.get('')!.metadata.name).toBe('Second')
    expect([...docs.keys()].sort()).toEqual(['', '/extra', '/new'])
    expect(git(root, 'status', '--porcelain')).toBe('')
    git(root, 'checkout', 'first')
    await sync.tick()
    await sync.tick()
    expect(docs.get('')!.metadata.name).toBe('First')
    expect([...docs.keys()].sort()).toEqual(['', '/old'])
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(logs.filter((line) => line.includes('Checkout reconciled'))).toHaveLength(2)
  }, 30_000)

  test('abandons a pull that started on the previous branch and resumes on the next pass', async () => {
    const {root, dir} = repository()
    const {sync, hooks, appEdit} = session(dir)
    await sync.tick()
    appEdit('', 'Old branch app edit.\n')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    hooks.request = async (name) => {
      if (name === 'Query') {
        entered.resolve()
        await release.promise
      }
    }
    const pulling = sync.tick()
    await entered.promise
    git(root, 'checkout', 'second')
    hooks.request = undefined
    release.resolve()
    await expect(pulling).rejects.toBeInstanceOf(DevSyncPaused)
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toContain('Second branch.')
    await sync.tick()
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('does not publish a batch prepared before a checkout, and retries without restarting', async () => {
    const {root, dir} = repository()
    const {sync, hooks, published, docs} = session(dir)
    await sync.tick()
    writeFileSync(join(dir, 'index.md'), 'Local edit before checkout.\n')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    hooks.request = async (name, path) => {
      if (name === 'Resource' && path === '') {
        entered.resolve()
        await release.promise
      }
    }
    const count = published.length
    const pushing = sync.tick()
    await entered.promise
    git(root, 'checkout', '-f', 'second')
    hooks.request = undefined
    release.resolve()
    await expect(pushing).rejects.toBeInstanceOf(DevSyncPaused)
    expect(published).toHaveLength(count)
    await sync.tick()
    expect(docs.get('')!.metadata.name).toBe('Second')
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('waits for a real Git index lock, then resumes automatically', async () => {
    const {root, dir} = repository()
    const {sync, published} = session(dir)
    await sync.tick()
    const count = published.length
    const gitDir = git(root, 'rev-parse', '--absolute-git-dir')
    const locked = Promise.withResolvers<void>()
    const watcher = watch(gitDir, () => {
      if (existsSync(join(gitDir, 'index.lock'))) locked.resolve()
    })
    const child = spawn('git', [...gitArgs, '-C', root, 'update-index', '--index-info'], {
      env: gitEnv,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    const finished = new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git exited ${code}`))))
    })
    try {
      await locked.promise
      await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
      expect(published).toHaveLength(count)
    } finally {
      watcher.close()
      child.stdin.end()
      await finished
    }
    git(root, 'checkout', 'second')
    await sync.tick()
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('survives a branch with no docs and a replaced directory', async () => {
    const {root, dir} = repository()
    const {sync, published} = session(dir)
    await sync.tick()
    git(root, 'checkout', '-b', 'without-docs')
    git(root, 'rm', '-r', 'docs')
    git(root, 'commit', '-m', 'remove docs')
    const count = published.length
    await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
    // Ignored .dev state normally keeps the directory itself alive during checkout.
    mkdirSync(join(dir, '.dev'), {recursive: true})
    await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
    expect(published).toHaveLength(count)
    git(root, 'checkout', 'second')
    await sync.tick()
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('pauses for checkout conflicts without a merge marker, then resumes after resolution', async () => {
    const {root, dir} = repository()
    const {sync, published} = session(dir)
    await sync.tick()
    writeFileSync(join(dir, 'index.md'), 'Conflicting local edit.\n')
    git(root, 'checkout', '--merge', 'second')
    expect(git(root, 'ls-files', '--unmerged')).not.toBe('')
    expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false)
    const count = published.length
    await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
    expect(published).toHaveLength(count)
    git(root, 'restore', '--source=HEAD', '--staged', '--worktree', 'docs/index.md')
    await sync.tick()
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('uses the linked worktree HEAD and detects two branch names at the same commit', async () => {
    const {root} = repository()
    const linked = join(root, 'linked')
    git(root, 'worktree', 'add', '-b', 'linked-branch', linked, 'first')
    const {sync, logs} = session(join(linked, 'docs'))
    await sync.tick()
    git(root, 'checkout', 'second')
    await sync.tick()
    expect(logs.some((line) => line.includes('Checkout changed'))).toBe(false)
    git(linked, 'checkout', '-b', 'same-commit')
    await sync.tick()
    expect(logs.some((line) => line.includes('Checkout reconciled'))).toBe(true)
    expect(git(linked, 'status', '--porcelain')).toBe('')
  }, 30_000)

  test('retries failed pushes and catches an immediate hand edit after an app write', async () => {
    const {root, dir} = repository()
    const {sync, hooks, appEdit, docs} = session(dir)
    await sync.tick()
    appEdit('', 'App edit.\n')
    await sync.tick()
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toContain('App edit.')
    writeFileSync(join(dir, 'index.md'), 'Immediate hand edit.\n')
    hooks.publish = async () => {
      throw new Error('offline')
    }
    await expect(sync.tick()).rejects.toThrow('offline')
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toBe('Immediate hand edit.\n')
    hooks.publish = undefined
    await sync.tick()
    expect(docs.get('')!.content![0]!.block).toMatchObject({text: 'Immediate hand edit.'})
    expect(git(root, 'diff', '--name-only')).toBe('docs/index.md')
  }, 30_000)

  test('checks the checkout again after fetching a schema, before writing its file', async () => {
    const {root, dir} = repository()
    const {sync, hooks, appEdit, docs} = session(dir)
    await sync.tick()
    appEdit('', 'App schema edit.\n')
    docs.get('')!.metadata.schemaDefinition = 'ipfs://' + genesis
    hooks.request = async (name) => {
      if (name === 'GetCID') git(root, 'checkout', '-f', 'second')
    }
    await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
    expect(existsSync(join(dir, 'index.schema.json'))).toBe(false)
    expect(git(root, 'status', '--porcelain')).toBe('')
    hooks.request = undefined
    await sync.tick()
    expect(docs.get('')!.metadata.name).toBe('Second')
  }, 30_000)

  test('keeps --no-watch from exporting the previous branch into a new checkout', async () => {
    const {root, dir} = repository()
    const {sync, published} = session(dir, {watchFiles: false})
    await sync.tick()
    const count = published.length
    git(root, 'checkout', 'second')
    await expect(sync.tick()).rejects.toBeInstanceOf(DevSyncPaused)
    expect(published).toHaveLength(count)
    expect(git(root, 'status', '--porcelain')).toBe('')
    git(root, 'checkout', 'first')
    await sync.tick()
  }, 30_000)

  test('keeps app edits to other pages visible while a file is being pushed', async () => {
    const {dir} = repository()
    const {sync, hooks, appEdit} = session(dir)
    await sync.tick()
    writeFileSync(join(dir, 'index.md'), 'Local home edit.\n')
    hooks.publish = async () => {
      appEdit('/old', 'Concurrent app edit.\n')
    }
    await sync.tick()
    hooks.publish = undefined
    await sync.tick()
    expect(readFileSync(join(dir, 'old.md'), 'utf8')).toContain('Concurrent app edit.')
    expect(readFileSync(join(dir, 'index.md'), 'utf8')).toBe('Local home edit.\n')
  }, 30_000)

  test('schema validation errors are recoverable instead of exiting the launcher', async () => {
    const {dir} = repository()
    const schema = {type: 'String'}
    const {cid} = await encodeSchemaBlob(schema)
    writeFileSync(join(dir, 'example.schema.json'), JSON.stringify(schema))
    writeFileSync(join(dir, 'schemas.lock.json'), JSON.stringify({schemas: {}}))
    await expect(loadSchemaBlobs(dir)).rejects.toThrow('no lockfile entry')
    writeFileSync(join(dir, 'schemas.lock.json'), JSON.stringify({schemas: {'hm://hyper.media/example': cid}}))
    expect((await loadSchemaBlobs(dir)).map((blob) => blob.cid)).toEqual([cid])
  }, 30_000)

  test('labels only the staging home at publication without changing the source or production metadata', () => {
    const metadata = {name: 'Hypermedia', icon: 'ipfs://icon', summary: 'Protocol documentation.'}
    const staging = publicationMetadataFor('https://staging.hyper.media/')!
    expect(staging('index.md', metadata)).toEqual({...metadata, name: 'Hypermedia [STAGING]'})
    expect(staging('protocol.md', metadata)).toBe(metadata)
    expect(metadata.name).toBe('Hypermedia')
    expect(staging('index.md', metadata).name).toBe('Hypermedia [STAGING]')
    expect(publicationMetadataFor('https://hyper.media')).toBeUndefined()
    expect(publicationMetadataFor('http://localhost:58004')).toBeUndefined()
  })

  test('bundles the home icon for publication and rejects stale icon metadata', async () => {
    const {dir} = repository()
    const data = new Uint8Array([137, 80, 78, 71])
    const cid = CID.createV1(0x55, createDigest(0x12, createHash('sha256').update(data).digest())).toString()
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets/HyperMedia_IconInverse.png'), data)
    writeFileSync(join(dir, 'schemas.lock.json'), JSON.stringify({schemas: {}}))
    writeFileSync(join(dir, 'index.md'), `---\nname: Hypermedia\nicon: ipfs://${cid}\n---\n`)
    expect(await loadPublicationBlobs(dir)).toEqual([{cid, data}])
    writeFileSync(join(dir, 'assets/HyperMedia_IconInverse.png'), new Uint8Array([1, 2, 3]))
    await expect(loadPublicationBlobs(dir)).rejects.toThrow('Home icon CID mismatch')
  })

  test('drains all workers from a failed push before reconciling a queued checkout', async () => {
    const {root, dir} = repository()
    const {sync, hooks, docs} = session(dir)
    await sync.tick()
    writeFileSync(join(dir, 'index.md'), 'Edit home.\n')
    writeFileSync(join(dir, 'old.md'), 'Edit old.\n')
    const homeEntered = Promise.withResolvers<void>()
    const oldEntered = Promise.withResolvers<void>()
    const failHome = Promise.withResolvers<void>()
    const finishOld = Promise.withResolvers<void>()
    hooks.request = async (name, path) => {
      if (name !== 'Resource') return
      if (path === '') {
        homeEntered.resolve()
        await failHome.promise
        throw new Error('failed home request')
      }
      if (path === '/old') {
        oldEntered.resolve()
        await finishOld.promise
      }
    }
    let settled = false
    const pushing = sync.tick()
    void pushing.catch(() => {
      settled = true
    })
    await Promise.all([homeEntered.promise, oldEntered.promise])
    failHome.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    git(root, 'checkout', '-f', 'second')
    const following = sync.tick()
    hooks.request = undefined
    finishOld.resolve()
    await expect(pushing).rejects.toBeInstanceOf(Error)
    await following
    expect(docs.get('')!.metadata.name).toBe('Second')
    expect(git(root, 'status', '--porcelain')).toBe('')
  }, 30_000)
})
