// The schema engine lives in the client package so the CLI and the agents service run the same
// validator and resolver as the app. This module keeps the UI's import paths working.
export * from '@seed-hypermedia/client/schema-engine'
