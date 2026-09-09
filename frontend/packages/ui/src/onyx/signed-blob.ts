// The signed-blob rule (envelope, sign with sig zeroed, publish) lives in the client package,
// shared with the CLI. This module keeps the UI's import path working.
export * from '@seed-hypermedia/client/onyx-signed-blob'
