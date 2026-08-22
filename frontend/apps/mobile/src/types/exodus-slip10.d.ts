declare module '@exodus/slip10' {
  export interface DerivedKey {
    key: Uint8Array
    chainCode: Uint8Array
  }

  export interface MasterKey {
    derive(path: string): DerivedKey
    key: Uint8Array
    chainCode: Uint8Array
  }

  const SLIP10: {
    fromSeed(seed: Uint8Array | Buffer): MasterKey
  }

  export default SLIP10
}
