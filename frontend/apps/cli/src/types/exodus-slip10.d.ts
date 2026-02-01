declare module '@exodus/slip10' {
  interface DerivedKey {
    key: Uint8Array
    chainCode: Uint8Array
    derive(path: string): DerivedKey
  }

  interface SLIP10 {
    fromSeed(seed: Uint8Array | Buffer): DerivedKey
  }

  const slip10: SLIP10
  export default slip10
}
