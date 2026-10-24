import {expect, it} from 'vitest'
import {createWebIdentitySigner, preparePublicKey} from './auth-utils'

it('binds signatures to the captured identity and permits only its own or delegated account', async () => {
  const first = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const second = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const identity = {...first, id: 'device', delegatedAccountUid: 'account'}
  const signer = createWebIdentitySigner(identity, 'account')
  expect(await signer.getPublicKey()).toEqual(await preparePublicKey(first.publicKey))
  expect(() => createWebIdentitySigner(identity, 'someone-else')).toThrow('not available')
  const deviceSigner = createWebIdentitySigner(identity, 'device')
  // An account switch must not retarget a signer already held by an in-flight operation.
  Object.assign(identity, second, {id: 'another-device'})
  const data = new Uint8Array([1, 2, 3])
  for (const bound of [signer, deviceSigner]) {
    const signature = await bound.sign(data)
    expect(await crypto.subtle.verify('Ed25519', first.publicKey, signature, data)).toBe(true)
    expect(await crypto.subtle.verify('Ed25519', second.publicKey, signature, data)).toBe(false)
  }
})
