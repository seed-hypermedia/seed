declare module '@sentry/electron/preload' {
  export {}
}

declare module '@sentry/electron/renderer' {
  export const init: (options: any) => void
  export const Replay: any
  export const BrowserTracing: any
  export const captureException: (error: Error | string) => void
}
