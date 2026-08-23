// Platform polyfills (crypto, TextDecoder, CompressionStream) must be the
// first side effect so every later import sees the filled-in globals.
import './src/vault/platform'

// Polyfill Buffer for libraries that depend on Node.js Buffer (like bip39)
import {Buffer} from 'buffer'
globalThis.Buffer = Buffer

import {registerRootComponent} from 'expo'
import App from './App'

registerRootComponent(App)
