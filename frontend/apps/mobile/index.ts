// Polyfill Buffer for libraries that depend on Node.js Buffer (like bip39)
import {Buffer} from 'buffer'
globalThis.Buffer = Buffer

import {registerRootComponent} from 'expo'
import App from './App'

registerRootComponent(App)
