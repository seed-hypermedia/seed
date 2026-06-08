declare module 'bun:test' {
  export const describe: typeof import('vitest').describe
  export const expect: typeof import('vitest').expect
  export const test: typeof import('vitest').test
}
