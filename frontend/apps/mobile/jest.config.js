module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Fall back to the app's node_modules for imports coming from the aliased
  // in-repo client package (which lives outside this npm install).
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^react-native$': 'react-native-web',
    '^@/(.*)$': '<rootDir>/$1',
    '^@seed-hypermedia/client$': '<rootDir>/../../packages/client/src/index.ts',
    '^@seed-hypermedia/client/(.*)$': '<rootDir>/../../packages/client/src/$1',
    '^@shm/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    // The DOM-free half of the shared agents UI, and the dependency-free agents protocol.
    // Mirrors the scoped alias in metro.config.js (`.ts` only — no .tsx web components).
    '^@shm/ui/agents/(.*)$': '<rootDir>/../../packages/ui/src/agents/$1.ts',
    '^@seed-hypermedia/agents-protocol$': '<rootDir>/../../../agents/protocol/src/index.ts',
    '^@tanstack/react-query$': '<rootDir>/node_modules/@tanstack/react-query',
    // ESM-only deps of the client package: their exports maps carry only the
    // "import" condition, which jest's CJS resolver never matches. Point jest
    // at the ESM sources directly; babel transforms them to CJS
    // (transformIgnorePatterns below lets them through).
    '^@ipld/dag-cbor$': '<rootDir>/../../../node_modules/@ipld/dag-cbor/src/index.js',
    '^cborg$': '<rootDir>/../../../node_modules/cborg/cborg.js',
    '^multiformats$': '<rootDir>/node_modules/multiformats/dist/src/index.js',
    '^multiformats/(.*)$': '<rootDir>/node_modules/multiformats/dist/src/$1.js',
  },
  // Babel only auto-applies a config to files under its own root, so in-repo packages outside
  // this app (@shm/shared, @shm/ui/agents, @seed-hypermedia/client) would otherwise transform
  // with no config at all — and @shm/shared/constants uses Vite's `import.meta`, which is a
  // syntax error under CJS. Pointing babel-jest at this app's config applies
  // babel-plugin-transform-import-meta everywhere, matching what Metro already does for the
  // bundle via its watchFolders.
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', {configFile: require.resolve('./babel.config.js')}],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native-.*|@expo(-.*)?|expo(-.*)?|@exodus|multiformats|@noble|bip39|@react-navigation|@ipld|cborg|pako)/)',
  ],
}
