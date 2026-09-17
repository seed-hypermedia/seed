/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SEED_WEB_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
