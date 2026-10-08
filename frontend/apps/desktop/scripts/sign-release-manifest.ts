import {createHash, createPrivateKey, createPublicKey, sign} from 'node:crypto'
import {readFile, writeFile, rename} from 'node:fs/promises'
// Node 22's type stripping runs this script without installing the desktop dependencies.
import {canonicalManifest, DEV_UPDATE_PUBLIC_KEY, PROD_UPDATE_PUBLIC_KEY} from '../src/update-signing.ts'

async function main() {
  const [file, channel] = process.argv.slice(2)
  if (!file || !['dev', 'prod'].includes(channel)) {
    throw new Error('Usage: sign-release-manifest.ts <latest.json> <dev|prod>')
  }
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  delete manifest.signature
  if (process.env.MINIMUM_CHROMIUM && !/^\d+(?:\.\d+){0,3}$/.test(process.env.MINIMUM_CHROMIUM)) {
    throw new Error('MINIMUM_CHROMIUM must be a numeric version string')
  }
  if (
    process.env.CHROMIUM_RELEASED_AT &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(process.env.CHROMIUM_RELEASED_AT) ||
      !Number.isFinite(Date.parse(process.env.CHROMIUM_RELEASED_AT)))
  ) {
    throw new Error('CHROMIUM_RELEASED_AT must be an ISO 8601 timestamp')
  }
  const privatePem = process.env.UPDATE_SIGNING_PRIVATE_KEY
  const expectedPublicKey = channel === 'dev' ? DEV_UPDATE_PUBLIC_KEY : PROD_UPDATE_PUBLIC_KEY
  const privateKey = privatePem ? createPrivateKey(privatePem) : undefined
  if (privateKey) {
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Signing key must be Ed25519')
    if (!expectedPublicKey || !createPublicKey(privateKey).equals(createPublicKey(expectedPublicKey))) {
      throw new Error('Signing key does not match the public key shipped in this channel')
    }
  } else {
    console.warn('::warning::UPDATE_SIGNING_PRIVATE_KEY is unset; publishing hashes without a signature during rollout')
  }

  // Hash immutable, versioned artifact URLs before the manifest is published.
  for (const platform of Object.values(manifest.assets) as Array<Record<string, Record<string, string>>>) {
    for (const [name, asset] of Object.entries(platform)) {
      // The production generator includes empty objects for formats not built by this release.
      if (!asset.download_url) {
        delete platform[name]
        continue
      }
      for (const [urlField, hashField] of [
        ['download_url', 'sha256'],
        ['zip_url', 'zip_sha256'],
      ]) {
        if (!asset[urlField]) continue
        const url = new URL(asset[urlField])
        if (url.protocol !== 'https:') throw new Error('Release assets must use HTTPS')
        const response = await fetch(url, {signal: AbortSignal.timeout(600_000)})
        if (!response.ok || !response.body) throw new Error(`Cannot hash ${url}: HTTP ${response.status}`)
        const hash = createHash('sha256')
        for await (const chunk of response.body) hash.update(chunk)
        asset[hashField] = hash.digest('hex')
      }
    }
  }
  if (process.env.MINIMUM_CHROMIUM) manifest.minimumChromium = process.env.MINIMUM_CHROMIUM
  if (process.env.CHROMIUM_RELEASED_AT) manifest.chromiumReleasedAt = process.env.CHROMIUM_RELEASED_AT
  if (privateKey)
    manifest.signature = sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64')
  const temporary = `${file}.signed.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(temporary, file)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
