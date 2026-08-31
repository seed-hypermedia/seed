import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
import {viteSingleFile} from 'vite-plugin-singlefile'

export default defineConfig({
  // Inline every script, style and asset into dist/index.html: the host loads
  // the extension through `srcdoc`, where relative URLs cannot resolve.
  plugins: [react(), viteSingleFile()],
  server: {
    // Fixed port so `?extdev=http://localhost:5183` keeps working across restarts.
    port: 5183,
    strictPort: true,
    // The host embeds this dev server in a sandboxed iframe from another
    // (opaque) origin; module scripts are CORS requests, so allow all origins.
    cors: true,
  },
  build: {
    target: 'es2022',
  },
})
