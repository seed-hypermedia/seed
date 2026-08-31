import {describe, expect, it} from 'vitest'
import {base64Decode, base64Encode, toBytes} from './base64'

describe('base64', () => {
  it('round-trips empty and small buffers', () => {
    expect(base64Encode(new Uint8Array())).toBe('')
    expect(base64Decode('')).toEqual(new Uint8Array())
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes)
  })

  it('round-trips buffers larger than the chunk size', () => {
    const bytes = new Uint8Array(0x8000 * 3 + 17)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes)
  })

  it('matches the standard alphabet', () => {
    expect(base64Encode(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
    expect(new TextDecoder().decode(base64Decode('aGVsbG8='))).toBe('hello')
  })

  it('toBytes encodes strings as UTF-8 and passes bytes through', () => {
    // Compared as plain arrays: under jsdom, TextEncoder yields a Uint8Array from another realm.
    expect(Array.from(toBytes('é'))).toEqual([0xc3, 0xa9])
    const bytes = new Uint8Array([1, 2])
    expect(toBytes(bytes)).toBe(bytes)
  })
})
