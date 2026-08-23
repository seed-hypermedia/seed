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
    // ESM-only deps of the client package: their exports maps carry only the
    // "import" condition, which jest's CJS resolver never matches. Point jest
    // at the ESM sources directly; babel transforms them to CJS
    // (transformIgnorePatterns below lets them through).
    '^@ipld/dag-cbor$': '<rootDir>/../../../node_modules/@ipld/dag-cbor/src/index.js',
    '^cborg$': '<rootDir>/../../../node_modules/cborg/cborg.js',
    '^multiformats$': '<rootDir>/node_modules/multiformats/dist/src/index.js',
    '^multiformats/(.*)$': '<rootDir>/node_modules/multiformats/dist/src/$1.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native-.*|@expo(-.*)?|expo(-.*)?|@exodus|multiformats|@noble|bip39|@react-navigation|@ipld|cborg|pako)/)',
  ],
}
