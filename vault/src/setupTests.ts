import {beforeEach} from 'bun:test'
import {GlobalRegistrator} from '@happy-dom/global-registrator'

GlobalRegistrator.register()

// Each test starts in a fresh tab; reload tests retain storage within the test.
beforeEach(() => window.sessionStorage.clear())
