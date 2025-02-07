import {defineConfig} from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [],
    },
  },
  plugins: [
    tsConfigPaths({
      root: '../../',
    }),
  ],
})
