# Seed Mobile App

Expo-based React Native app for iOS, Android, and Web.

## Monorepo Setup Notes

This app follows [Expo's official monorepo guide](https://docs.expo.dev/guides/monorepos/) with adaptations for the existing Yarn workspaces configuration.

### Key Configuration Files

**metro.config.js** - Configures Metro bundler to resolve packages from both the workspace and monorepo root:
- Sets `watchFolders` to include the monorepo root
- Configures `nodeModulesPaths` to check workspace node_modules first, then root

**babel.config.js** - Dual-mode babel configuration:
- Uses standard babel presets (`@babel/preset-env`, `@babel/preset-typescript`, `@babel/preset-react`) for Jest tests (when `NODE_ENV=test`)
- Uses `babel-preset-expo` for Expo/Metro bundling

**jest.config.js** - Jest configuration for testing:
- Uses `jsdom` test environment
- Maps `react-native` to `react-native-web` for web-compatible testing
- Custom `transformIgnorePatterns` to handle Expo packages

### React Version Compatibility

The root monorepo uses React 18.2.0 via resolutions. Expo 52 prefers React 18.3.1. This is a known tradeoff in monorepos - we keep 18.2.0 for compatibility with other workspace apps.

### Commands

```bash
# Start Expo dev server (shows QR for mobile, opens web)
yarn mobile

# Start web only
yarn mobile:web

# Run tests
yarn mobile:test
```

### Development Notes

1. **First Run**: Run `yarn` from monorepo root to install dependencies
2. **Clearing Cache**: Use `npx expo start --clear` if you encounter bundling issues
3. **TypeScript**: The app uses Expo's tsconfig base (`expo/tsconfig.base`)

### Known Issues

- Metro validation warnings about `watcher.unstable_*` options can be ignored
- Version mismatch warnings for React/React Native are expected due to monorepo constraints

### Sources

- [Expo Monorepo Guide](https://docs.expo.dev/guides/monorepos/)
- [Yarn Workspaces with React Native (2025)](https://dev.to/pgomezec/setting-up-react-native-monorepo-with-yarn-workspaces-2025-a29)
