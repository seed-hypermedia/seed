import * as cbor from '@ipld/dag-cbor'
import {readFileSync} from 'fs'
import {CID} from 'multiformats/cid'
import * as rawCodec from 'multiformats/codecs/raw'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, test} from 'vitest'
import {validatePluginManifest} from '../plugin-manifest'

/**
 * The committed example-plugin fixtures must stay publishable and honest:
 * every blob's data must hash to its claimed CID, and the manifest blob must
 * validate. If a dialect/manifest change breaks these, regenerate the
 * fixtures (see docs/plugins/authoring.md).
 */

const FIXTURES = [
  '../../../../../docs/plugins/example-plugin.json',
  '../../../../../docs/plugins/example-find-replace.json',
]

function loadFixture(relative: string) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
    manifestCid: string
    blobs: {cid: string; data: string}[]
  }
}

describe.each(FIXTURES)('example plugin fixture %s', (path) => {
  const fixture = loadFixture(path)

  test('every blob hashes to its claimed CID', async () => {
    for (const blob of fixture.blobs) {
      const data = Buffer.from(blob.data, 'base64')
      const claimed = CID.parse(blob.cid)
      const digest = await sha256.digest(data)
      const recomputed = CID.createV1(claimed.code, digest).toString()
      expect(recomputed).toBe(blob.cid)
      expect([0x71, rawCodec.code]).toContain(claimed.code)
    }
  })

  test('the manifest blob decodes and validates', () => {
    const manifestBlob = fixture.blobs.find((blob) => blob.cid === fixture.manifestCid)
    expect(manifestBlob).toBeTruthy()
    const decoded = cbor.decode(Buffer.from(manifestBlob!.data, 'base64'))
    // decode yields CID instances for links; re-encode to DAG-JSON-ish form
    const dagJson = JSON.parse(
      JSON.stringify(decoded, (_key, value) => {
        const asCid = CID.asCID(value)
        return asCid ? {'/': asCid.toString()} : value
      }),
    )
    const validated = validatePluginManifest(dagJson)
    expect('manifest' in validated, JSON.stringify(validated)).toBe(true)
  })
})
