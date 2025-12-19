/// <reference types="vite/client" />

declare const __SENTRY_DSN__: string
declare const __FORCE_LOADING_WINDOW__: string

// Electron Forge environment variables for main process
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string
declare const FIND_IN_PAGE_VITE_DEV_SERVER_URL: string
declare const FIND_IN_PAGE_VITE_NAME: string
declare const LOADING_WINDOW_VITE_DEV_SERVER_URL: string
declare const LOADING_WINDOW_VITE_NAME: string

interface ImportMetaEnv {
  readonly VITE_DESKTOP_HTTP_PORT: string
  readonly VITE_DESKTOP_P2P_PORT: string
  readonly VITE_DESKTOP_GRPC_PORT: string
  readonly VITE_DESKTOP_APPDATA: string
  readonly VITE_DESKTOP_HOSTNAME: string
  readonly VITE_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
