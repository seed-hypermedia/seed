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
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native-.*|@expo(-.*)?|expo(-.*)?|@exodus|multiformats|@noble|bip39|@react-navigation)/)',
  ],
}
