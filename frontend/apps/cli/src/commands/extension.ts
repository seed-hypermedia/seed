/**
 * Extension commands — publish, inspect, install, uninstall, list, update.
 *
 * An extension is a document whose metadata carries a `seedExtension`
 * manifest and whose body is its README; its code is one self-contained HTML
 * file stored as an IPFS file. A site installs an extension by writing an
 * install record under `extensions.<mount>` in its home document metadata.
 * See docs/extensions/design.md and docs/extensions/cli.md.
 */

import type {Command} from 'commander'
import {
  autoLinkChildToParent,
  fileToIpfsBlobs,
  followRedirects,
  packHmId,
  resolveCapability,
  resolveEditableDocument,
  type DocumentOperation,
  type SeedClient,
} from '@seed-hypermedia/client'
import {
  extensionEntryCid,
  parseExtensionInstalls,
  parseExtensionManifest,
  validateExtensionManifest,
  type ExtensionInstallRecord,
  type ExtensionManifest,
} from '@seed-hypermedia/client/extensions'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getClient, getServerUrl, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError, printInfo, printSuccess, printWarning, stripBlockIdComments} from '../output'
import {documentToMarkdown} from '../markdown'
import {markdownToInput, resolveMetadataFileLinks, mergeMetadata} from './document'
import {keyOptions, resolveSigningKey, type ResolvedKey} from '../utils/keys'
import {resolveIdWithClient} from '../utils/resolve-id'
import {createSignerFromKey} from '../utils/signer'
import {
  assertMountPath,
  bareHmId,
  buildInstallRecord,
  defaultExtensionPath,
  extensionMountUrls,
  finalizeManifest,
  formatBytes,
  installCommandHint,
  installRecordAttributes,
  parseSettingsJson,
  rawInstalls,
  rawManifest,
  readExtensionPackage,
  stripLeadingTitle,
  uninstallAttributes,
} from '../utils/extension'
import {computeBodyReplaceOps, diffAttributes, setAttributesOp, signAndPublishChange} from '../utils/publish'

// ── Shared helpers ───────────────────────────────────────────────────────────

type FetchedExtension = {
  /** Id the document was fetched at (carries the version when one was requested). */
  id: UnpackedHypermediaId
  /** `hm://uid/path` without version — what install records point at. */
  extensionId: string
  document: HMDocument
  manifest: ExtensionManifest
}

/**
 * Fetch an extension document (honouring `?v=` on the id) and validate its
 * manifest. Throws a readable error for non-documents and non-extensions.
 */
async function fetchExtension(client: SeedClient, id: UnpackedHypermediaId): Promise<FetchedExtension> {
  const followed = await followRedirects(client, id)
  const resource = followed.resource
  if (resource.type !== 'document') {
    throw new Error(`${packHmId(id)} is not a document (resource type: ${resource.type}).`)
  }
  const target = followed.targetId
  const extensionId = bareHmId(target.uid, target.path)
  const raw = rawManifest(resource.document.metadata)
  if (raw === undefined || raw === null) {
    throw new Error(`${extensionId} is not an extension: its metadata has no "seedExtension" manifest.`)
  }
  // validateExtensionManifest throws with the individual schema issues.
  const manifest = parseExtensionManifest(resource.document.metadata) ?? validateExtensionManifest(raw)
  return {id: {...target, version: resource.document.version}, extensionId, document: resource.document, manifest}
}

function fileUrl(serverUrl: string, cid: string): string {
  return `${serverUrl}/hm/api/file/${cid}`
}

/** Site home document plus the DAG state needed to publish a metadata change to it. */
async function loadSiteHome(client: SeedClient, siteUid: string) {
  const homeId = unpackHmId(`hm://${siteUid}`)
  if (!homeId) throw new Error(`Invalid site account id: ${siteUid}`)
  try {
    return await resolveEditableDocument(client, homeId)
  } catch (e) {
    throw new Error(
      `Cannot load the home document of hm://${siteUid}: ${(e as Error).message}. ` +
        'The site must exist (publish its home document first) before extensions can be installed.',
    )
  }
}

/** Publish attribute ops against a site's home document. */
async function publishHomeAttributes(opts: {
  client: SeedClient
  key: ResolvedKey
  siteUid: string
  base: Awaited<ReturnType<typeof loadSiteHome>>
  attrs: Parameters<typeof setAttributesOp>[0]
}): Promise<string> {
  const signer = createSignerFromKey(opts.key)
  const capability = await resolveCapability(opts.client, opts.siteUid, opts.key.accountId, '')
  const {version} = await signAndPublishChange({
    client: opts.client,
    signer,
    space: opts.siteUid,
    path: '',
    ops: [setAttributesOp(opts.attrs)],
    base: opts.base.state,
    capability,
  })
  return version
}

async function readmeSummary(doc: HMDocument, maxChars = 400): Promise<string> {
  const md = stripBlockIdComments(await documentToMarkdown(doc))
  const body = md.startsWith('---\n') ? md.slice(md.indexOf('\n---', 4) + 4) : md
  const text = body.trim()
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text
}

function describeInstall(record: ExtensionInstallRecord): string {
  const bits = [record.version ? `pinned ${record.version}` : 'latest']
  if (record.title) bits.push(`title "${record.title}"`)
  if (record.nav === false) bits.push('hidden from nav')
  if (record.settings) bits.push(`settings ${JSON.stringify(record.settings)}`)
  return bits.join(', ')
}

/** Structured output when --json/--yaml was passed; otherwise the text renderer. */
function emit(globalOpts: Record<string, unknown>, data: unknown, text: () => string) {
  if (globalOpts.json || globalOpts.yaml) {
    console.log(formatOutput(data, getOutputFormat(globalOpts), isPretty(globalOpts)))
  } else {
    console.log(text())
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

export function registerExtensionCommands(program: Command) {
  const ext = program
    .command('extension')
    .description('Publish and install site extensions (publish, inspect, install, uninstall, list, update)')

  // ── publish ──────────────────────────────────────────────────────────────

  ext
    .command('publish <dir>')
    .description('Publish an extension package (manifest + built entry HTML + README) as a document')
    .option(
      '-p, --path <path>',
      'Document path under the signing account (default: manifest defaultMountPath or name slug)',
    )
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('--entry <file>', 'Entry HTML file (default: <dir>/dist/index.html)')
    .option('--manifest <file>', 'Manifest JSON file (default: <dir>/seed-extension.json)')
    .option('--readme <file>', 'README markdown used as the document body (default: <dir>/README.md)')
    .option('--name <name>', 'Extension display name (default: first # heading of the README, or package.json name)')
    .option('--dry-run', 'Validate and show what would be published without publishing')
    .action(async (dir: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const quiet = !!globalOpts.quiet
      try {
        const pkg = readExtensionPackage(dir, {
          entry: options.entry,
          manifest: options.manifest,
          readme: options.readme,
          name: options.name,
        })
        for (const w of pkg.warnings) printWarning(w)

        // Chunk the entry into UnixFS blocks; the root CID is the manifest entry.
        const entry = await fileToIpfsBlobs(pkg.entryBytes)
        const manifest = finalizeManifest(pkg.manifestRaw, entry.cid)

        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const account = key.accountId
        const rawPath: string = options.path || defaultExtensionPath(manifest, pkg.name)
        const pathNoSlash = rawPath.replace(/^\/+|\/+$/g, '')
        if (!pathNoSlash) throw new Error('An extension cannot be published as the home document; pass -p <path>.')
        const path = `/${pathNoSlash}`
        const extensionId = `hm://${account}${path}`
        const id = unpackHmId(extensionId)
        if (!id) throw new Error(`Invalid document path: ${rawPath}`)

        // README → body. The leading "# Title" is the document name, so it is not repeated in the body.
        const readmeMd = pkg.readme === null ? '' : stripLeadingTitle(pkg.readme, pkg.name)
        const input = await markdownToInput(readmeMd)

        // Metadata: README frontmatter < extension fields. `seedExtension` is nested; `summary` mirrors description.
        const baseMeta = mergeMetadata(input.metadata, {})
        const {metadata: resolvedBase, blobs: metaBlobs} = await resolveMetadataFileLinks(baseMeta)
        const metadata: HMMetadata = {
          ...resolvedBase,
          name: pkg.name,
          ...(manifest.description ? {summary: manifest.description} : {}),
          seedExtension: manifest,
        } as HMMetadata

        const serverUrl = getServerUrl(globalOpts)
        const hint = installCommandHint(extensionId, manifest.defaultMountPath, !!globalOpts.dev)

        if (options.dryRun) {
          emit(
            globalOpts,
            {
              id: extensionId,
              name: pkg.name,
              entry: {cid: entry.cid, bytes: pkg.entryBytes.byteLength, file: pkg.entryPath},
              manifest,
              metadata,
              blocks: input.tree?.length ?? 0,
              warnings: pkg.warnings,
              install: hint,
            },
            () =>
              [
                `Would publish extension "${pkg.name}" (name from ${pkg.nameSource})`,
                `  id:        ${extensionId}`,
                `  entry:     ipfs://${entry.cid} (${formatBytes(pkg.entryBytes.byteLength)} from ${pkg.entryPath})`,
                `  manifest:  ${JSON.stringify(manifest)}`,
                `  body:      ${input.tree?.length ?? 0} top-level block(s) from ${pkg.readmePath ?? '(no README)'}`,
                `Install with:`,
                `  ${hint}`,
              ].join('\n'),
          )
          return
        }

        const client = getClient(globalOpts)
        const signer = createSignerFromKey(key)
        const blobs = [
          ...entry.blobs.map((b) => ({data: b.data, cid: b.cid})),
          ...input.fileBlobs.map((b) => ({data: b.data, cid: b.cid})),
          ...metaBlobs.map((b) => ({data: b.data, cid: b.cid})),
        ]

        // Update in place when the document already exists so the extension keeps its history and
        // installs that pinned an older version can be updated; otherwise create it.
        const existing = await client.request('Resource', id)
        let version: string
        let action: 'created' | 'updated'
        if (existing.type === 'document' || existing.type === 'redirect') {
          const base = await resolveEditableDocument(client, id)
          if (base.redirect && !quiet) {
            printInfo(
              `${extensionId} currently ${base.redirect.republish ? 'republishes' : 'redirects to'} ${packHmId(
                base.redirect.target,
              )}; publishing replaces the redirect with the extension document.`,
            )
          }
          const existingMeta = base.document.metadata as Record<string, unknown>
          const ops: DocumentOperation[] = []
          const attrs = diffAttributes([], metadata, {
            name: existingMeta.name,
            summary: existingMeta.summary,
            seedExtension: existingMeta.seedExtension,
          })
          if (attrs.length > 0) ops.push(setAttributesOp(attrs))
          ops.push(...computeBodyReplaceOps(base.document, input.tree ?? []))
          if (ops.length === 0) {
            printInfo(`Nothing changed: ${extensionId} already carries this manifest, entry and README.`)
            emit(
              globalOpts,
              {id: extensionId, version: base.document.version, entry: entry.cid, unchanged: true},
              () => '',
            )
            return
          }
          const capability = await resolveCapability(client, account, key.accountId, path)
          const result = await signAndPublishChange({
            client,
            signer,
            space: account,
            path,
            ops,
            base: base.state,
            capability,
            blobs,
          })
          version = result.version
          action = 'updated'
        } else {
          const ops: DocumentOperation[] = []
          const attrs = diffAttributes([], metadata, undefined)
          if (attrs.length > 0) ops.push(setAttributesOp(attrs))
          ops.push(...input.ops)
          const result = await signAndPublishChange({client, signer, space: account, path, ops, blobs})
          version = result.version
          action = 'created'
          try {
            const linked = await autoLinkChildToParent({client, account, path, childHmUrl: extensionId, signer})
            if (linked && !quiet) printInfo('Parent document updated with link')
          } catch (e) {
            if (!quiet) printWarning(`Failed to update parent document: ${(e as Error).message}`)
          }
        }

        const result = {
          id: extensionId,
          version,
          name: pkg.name,
          entry: entry.cid,
          entryUrl: fileUrl(serverUrl, entry.cid),
          web: `${serverUrl}/hm/${account}${path}`,
          action,
          install: hint,
        }
        if (globalOpts.json || globalOpts.yaml) {
          emit(globalOpts, result, () => '')
          return
        }
        if (quiet) {
          console.log(`${extensionId}\t${version}`)
          return
        }
        printSuccess(`Extension ${action}: ${result.web}`)
        console.log(
          [
            `  id:       ${extensionId}`,
            `  version:  ${version}`,
            `  entry:    ipfs://${entry.cid}`,
            `            ${result.entryUrl}`,
            `Install on a site (run with that site's key):`,
            `  ${hint}`,
          ].join('\n'),
        )
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── inspect ──────────────────────────────────────────────────────────────

  ext
    .command('inspect <id>')
    .description('Show an extension document: manifest, permissions, entry CID (honours ?v= in the URL)')
    .action(async (rawId: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const {id, client, serverUrl} = await resolveIdWithClient(rawId, globalOpts)
        const found = await fetchExtension(client, id)
        const {manifest, document} = found
        const entryCid = extensionEntryCid(manifest)
        const summary = await readmeSummary(document)
        const data = {
          id: found.extensionId,
          name: document.metadata?.name ?? '',
          version: document.version,
          requestedVersion: id.version ?? null,
          manifest,
          permissions: manifest.permissions,
          entry: {cid: entryCid, url: fileUrl(serverUrl, entryCid)},
          authors: document.authors,
          readme: summary,
          install: installCommandHint(found.extensionId, manifest.defaultMountPath, !!globalOpts.dev),
        }
        emit(globalOpts, data, () =>
          [
            `Name:           ${data.name}`,
            `Id:             ${data.id}`,
            `Version:        ${data.version}${id.version ? '' : ' (latest)'}`,
            `Kind:           ${manifest.kind}`,
            `Code version:   ${manifest.version}`,
            `Description:    ${manifest.description ?? ''}`,
            `Permissions:    ${manifest.permissions.length ? manifest.permissions.join(', ') : '(none)'}`,
            `Default mount:  ${manifest.defaultMountPath ?? ''}`,
            `Homepage:       ${manifest.homepage ?? ''}`,
            `Min protocol:   ${manifest.minProtocol ?? ''}`,
            `Entry:          ipfs://${entryCid}`,
            `                ${data.entry.url}`,
            `Authors:        ${document.authors.join(', ')}`,
            ``,
            `Install with:`,
            `  ${data.install}`,
            ...(summary ? [``, `README:`, summary] : []),
          ].join('\n'),
        )
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── install ──────────────────────────────────────────────────────────────

  ext
    .command('install <id>')
    .description("Install an extension on the signing key's site by writing an install record to its home document")
    .option('--path <mount>', 'Mount path under the site (default: manifest defaultMountPath)')
    .option('-k, --key <name>', "Site signing key name or account ID (the site is this key's own account)")
    .option('--latest', 'Follow the latest extension version instead of pinning the current one')
    .option('--title <title>', 'Navigation title (default: the mount path is shown)')
    .option('--no-nav', 'Hide the mount from site navigation')
    .option('--settings <json>', 'JSON object passed to the extension as settings')
    .option('--force', 'Replace an existing install record at the mount path')
    .option('--dry-run', 'Show the record that would be written without publishing')
    .action(async (rawId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const quiet = !!globalOpts.quiet
      try {
        const id = unpackHmId(rawId)
        if (!id) throw new Error(`Invalid extension id: ${rawId} (expected hm://<account>/<path>)`)
        const client = getClient(globalOpts)
        const serverUrl = getServerUrl(globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const siteUid = key.accountId

        const found = await fetchExtension(client, id)
        const mountArg: string | undefined = options.path || found.manifest.defaultMountPath
        if (!mountArg) {
          throw new Error('The manifest has no defaultMountPath; pass --path <mount> to choose where to mount it.')
        }
        const mount = assertMountPath(mountArg)
        const settings = parseSettingsJson(options.settings)
        const record = buildInstallRecord({
          ext: found.extensionId,
          version: options.latest ? undefined : found.document.version,
          title: options.title,
          nav: options.nav === false ? false : undefined,
          settings,
        })

        const home = await loadSiteHome(client, siteUid)
        const installs = rawInstalls(home.document.metadata)
        const previous = installs[mount]
        if (previous && typeof previous === 'object' && !options.force) {
          throw new Error(
            `An extension is already installed at "${mount}" on hm://${siteUid} (${
              (previous as ExtensionInstallRecord).ext
            }). Use --force to replace it, or "extension uninstall --path ${mount}".`,
          )
        }
        for (const other of parseExtensionInstalls(home.document.metadata)) {
          if (other.mountPath === mount) continue
          if (mount.startsWith(`${other.mountPath}/`) || other.mountPath.startsWith(`${mount}/`)) {
            printWarning(
              `Mount "${mount}" overlaps with "${other.mountPath}" (${other.record.ext}); the longest matching mount wins per path.`,
            )
          }
        }

        // A document at the mount path keeps existing and stays addressable, but the page UI shows the extension.
        const shadowedId = unpackHmId(`hm://${siteUid}/${mount}`)
        if (shadowedId) {
          try {
            const shadowed = await client.request('Resource', shadowedId)
            if (shadowed.type === 'document' || shadowed.type === 'redirect') {
              printWarning(
                `hm://${siteUid}/${mount} already holds a ${shadowed.type}; the extension page will shadow it in the site UI (the document remains readable through the API).`,
              )
            }
          } catch {
            // not found or unreachable — nothing to warn about
          }
        }

        const attrs = installRecordAttributes(mount, record, previous)
        const urls = extensionMountUrls(serverUrl, siteUid, mount)
        const output = {
          site: `hm://${siteUid}`,
          mount,
          record,
          extension: {
            id: found.extensionId,
            name: found.document.metadata?.name ?? '',
            version: found.document.version,
          },
          permissions: found.manifest.permissions,
          urls,
          replaced: previous && typeof previous === 'object' ? previous : undefined,
        }

        if (options.dryRun) {
          emit(globalOpts, {...output, dryRun: true, attrs}, () =>
            [
              `Would install "${output.extension.name}" (${found.extensionId}) on hm://${siteUid} at "${mount}"`,
              `  record:      ${JSON.stringify(record)}`,
              `  permissions: ${found.manifest.permissions.join(', ') || '(none)'}`,
              `  served at:   ${urls.web}`,
            ].join('\n'),
          )
          return
        }

        if (attrs.length === 0) {
          if (!quiet) printInfo(`Already installed with this exact record at "${mount}"; nothing to publish.`)
          emit(globalOpts, {...output, unchanged: true}, () => '')
          return
        }

        const version = await publishHomeAttributes({client, key, siteUid, base: home, attrs})
        if (globalOpts.json || globalOpts.yaml) {
          emit(globalOpts, {...output, homeVersion: version}, () => '')
          return
        }
        if (quiet) {
          console.log(urls.hm)
          return
        }
        printSuccess(`Installed "${output.extension.name}" at ${urls.hm} (${describeInstall(record)})`)
        console.log(
          [
            `  record:      ${JSON.stringify(record)}`,
            `  permissions: ${found.manifest.permissions.join(', ') || '(none)'}`,
            `  served at:   ${urls.web}`,
            `  home doc:    ${version}`,
          ].join('\n'),
        )
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── uninstall ────────────────────────────────────────────────────────────

  ext
    .command('uninstall')
    .description("Remove an extension install record from the signing key's site")
    .requiredOption('--path <mount>', 'Mount path to remove')
    .option('-k, --key <name>', 'Site signing key name or account ID')
    .option('--dry-run', 'Show what would be removed without publishing')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const quiet = !!globalOpts.quiet
      try {
        const client = getClient(globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const siteUid = key.accountId
        const mount = assertMountPath(options.path)

        const home = await loadSiteHome(client, siteUid)
        const installs = rawInstalls(home.document.metadata)
        const previous = installs[mount]
        const attrs = uninstallAttributes(mount, previous)
        if (attrs.length === 0) {
          throw new Error(
            `No extension is installed at "${mount}" on hm://${siteUid}. Use "extension list" to see installed mounts.`,
          )
        }
        const output = {site: `hm://${siteUid}`, mount, removed: previous}
        if (options.dryRun) {
          emit(
            globalOpts,
            {...output, dryRun: true, attrs},
            () => `Would remove the extension at "${mount}" on hm://${siteUid}: ${JSON.stringify(previous)}`,
          )
          return
        }
        const version = await publishHomeAttributes({client, key, siteUid, base: home, attrs})
        if (globalOpts.json || globalOpts.yaml) {
          emit(globalOpts, {...output, homeVersion: version}, () => '')
          return
        }
        if (!quiet) printSuccess(`Uninstalled the extension at hm://${siteUid}/${mount} (home doc ${version})`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  ext
    .command('list [site]')
    .description("List extensions installed on a site (default: the signing key's own site)")
    .option('-k, --key <name>', 'Signing key whose site to list when no site is given')
    .action(async (site: string | undefined, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        let client: SeedClient
        let siteUid: string
        if (site) {
          const resolved = await resolveIdWithClient(site, globalOpts)
          client = resolved.client
          siteUid = resolved.id.uid
        } else {
          client = getClient(globalOpts)
          const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
          siteUid = key.accountId
        }
        const homeId = unpackHmId(`hm://${siteUid}`)
        if (!homeId) throw new Error(`Invalid site id: ${site}`)
        const followed = await followRedirects(client, homeId)
        if (followed.resource.type !== 'document') {
          throw new Error(`hm://${siteUid} has no home document (resource type: ${followed.resource.type}).`)
        }
        const mounts = parseExtensionInstalls(followed.resource.document.metadata)

        const rows = await Promise.all(
          mounts.map(async ({mountPath, record}) => {
            const row = {
              mount: mountPath,
              ext: record.ext,
              version: record.version ?? null,
              pinned: !!record.version,
              title: record.title ?? null,
              nav: record.nav !== false,
              settings: record.settings ?? null,
              name: null as string | null,
              permissions: null as string[] | null,
              latestVersion: null as string | null,
              error: null as string | null,
            }
            try {
              const extId = unpackHmId(record.version ? `${record.ext}?v=${record.version}` : record.ext)
              if (!extId) throw new Error('invalid ext id')
              const found = await fetchExtension(client, extId)
              row.name = found.document.metadata?.name ?? null
              row.permissions = found.manifest.permissions
              if (record.version) {
                const latest = await fetchExtension(client, {...extId, version: null, latest: true})
                row.latestVersion = latest.document.version
              }
            } catch (e) {
              row.error = (e as Error).message
            }
            return row
          }),
        )

        emit(globalOpts, {site: `hm://${siteUid}`, extensions: rows}, () => {
          if (rows.length === 0) return `No extensions installed on hm://${siteUid}.`
          const lines = [`Extensions installed on hm://${siteUid}:`]
          for (const r of rows) {
            const status = r.error
              ? `unavailable (${r.error})`
              : r.pinned
                ? r.latestVersion && r.latestVersion !== r.version
                  ? `pinned ${r.version} (update available: ${r.latestVersion})`
                  : `pinned ${r.version}`
                : 'latest'
            lines.push(`  /${r.mount}  ${r.name ?? '(unknown)'}${r.title ? ` — "${r.title}"` : ''}`)
            lines.push(`      ${r.ext}`)
            lines.push(
              `      ${status}; permissions: ${r.permissions?.join(', ') || '(none)'}${
                r.nav ? '' : '; hidden from nav'
              }`,
            )
          }
          return lines.join('\n')
        })
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── update ───────────────────────────────────────────────────────────────

  ext
    .command('update')
    .description("Re-pin an installed extension to the extension document's current version")
    .requiredOption('--path <mount>', 'Mount path of the install to update')
    .option('-k, --key <name>', 'Site signing key name or account ID')
    .option('--dry-run', 'Show the version change without publishing')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const quiet = !!globalOpts.quiet
      try {
        const client = getClient(globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const siteUid = key.accountId
        const mount = assertMountPath(options.path)

        const home = await loadSiteHome(client, siteUid)
        const current = parseExtensionInstalls(home.document.metadata).find((m) => m.mountPath === mount)
        if (!current) throw new Error(`No extension is installed at "${mount}" on hm://${siteUid}.`)
        const record = current.record
        if (!record.version) {
          if (!quiet) printInfo(`"${mount}" follows the latest version of ${record.ext}; nothing to update.`)
          emit(globalOpts, {site: `hm://${siteUid}`, mount, record, unchanged: true}, () => '')
          return
        }
        const extId = unpackHmId(record.ext)
        if (!extId) throw new Error(`Install record at "${mount}" has an invalid ext id: ${record.ext}`)
        const latest = await fetchExtension(client, {...extId, version: null, latest: true})
        const latestVersion = latest.document.version
        if (latestVersion === record.version) {
          if (!quiet)
            printInfo(`"${mount}" is already pinned to the current version of ${record.ext} (${latestVersion}).`)
          emit(globalOpts, {site: `hm://${siteUid}`, mount, record, unchanged: true}, () => '')
          return
        }
        const output = {
          site: `hm://${siteUid}`,
          mount,
          ext: record.ext,
          from: record.version,
          to: latestVersion,
          permissions: latest.manifest.permissions,
        }
        if (options.dryRun) {
          emit(
            globalOpts,
            {...output, dryRun: true},
            () => `Would re-pin "${mount}" (${record.ext}) from ${record.version} to ${latestVersion}`,
          )
          return
        }
        const attrs = [{key: ['extensions', mount, 'version'], value: latestVersion}]
        const version = await publishHomeAttributes({client, key, siteUid, base: home, attrs})
        if (globalOpts.json || globalOpts.yaml) {
          emit(globalOpts, {...output, homeVersion: version}, () => '')
          return
        }
        if (!quiet) {
          printSuccess(`Updated "${mount}" (${record.ext}) to version ${latestVersion} (home doc ${version})`)
          console.log(`  permissions: ${latest.manifest.permissions.join(', ') || '(none)'}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
