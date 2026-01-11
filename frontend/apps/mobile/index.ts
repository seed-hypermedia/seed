// Polyfill Buffer for libraries that depend on Node.js Buffer (like bip39)
import {Buffer} from 'buffer'
globalThis.Buffer = Buffer

// Note: import.meta.env is handled by babel-plugin-transform-import-meta
// The shared code has fallbacks to process.env which works in React Native

import {registerRootComponent} from 'expo'
import App from './App'

registerRootComponent(App)
