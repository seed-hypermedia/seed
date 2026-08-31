/** Subpath entry so `@shm/ui/extensions` resolves through the package `./*` exports map (→ src/*.tsx) as well as the app tsconfig/vite aliases (→ src/extensions/index.ts). */
export * from './extensions/index'
