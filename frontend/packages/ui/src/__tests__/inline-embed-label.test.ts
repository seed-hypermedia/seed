import type {HMContactRecord, HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {resolveInlineEmbedLabel} from '../blocks-content'

function metadata(name?: string): HMDocument['metadata'] | undefined {
  return name ? ({name} as HMDocument['metadata']) : undefined
}

function contact(subject: string, name: string): HMContactRecord {
  return {
    id: `${subject}-contact`,
    subject,
    name,
    account: 'z6Mkviewer',
    signer: 'z6Mkviewer',
  }
}

describe('resolveInlineEmbedLabel', () => {
  it('prefers the home document name for bare account embeds', () => {
    const entityId = unpackHmId('hm://z6Mkhome')!

    const label = resolveInlineEmbedLabel({
      entityId,
      homeMetadata: metadata('Home Name'),
      accountMetadata: metadata('Profile Name'),
    })

    expect(label).toBe('Home Name')
  })

  it('falls back to the account name for bare account embeds', () => {
    const entityId = unpackHmId('hm://z6Mkhome')!

    const label = resolveInlineEmbedLabel({
      entityId,
      accountMetadata: metadata('Profile Name'),
    })

    expect(label).toBe('Profile Name')
  })

  it('prefers the profile name for profile embeds', () => {
    const entityId = unpackHmId('hm://z6Mkhome/:profile')!

    const label = resolveInlineEmbedLabel({
      entityId,
      homeMetadata: metadata('Home Name'),
      accountMetadata: metadata('Profile Name'),
    })

    expect(label).toBe('Profile Name')
  })

  it('falls back to the home name for profile embeds', () => {
    const entityId = unpackHmId('hm://z6Mkhome/:profile')!

    const label = resolveInlineEmbedLabel({
      entityId,
      homeMetadata: metadata('Home Name'),
    })

    expect(label).toBe('Home Name')
  })

  it('keeps contact aliases as the top-priority label', () => {
    const entityId = unpackHmId('hm://z6Mkhome')!

    const label = resolveInlineEmbedLabel({
      entityId,
      homeMetadata: metadata('Home Name'),
      accountMetadata: metadata('Profile Name'),
      contacts: [contact('z6Mkhome', 'Alias Name')],
    })

    expect(label).toBe('Alias Name')
  })
})
