Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## General Coding Guidelines

- Don't use relative imports outside the current directory. Don't import from `../../../something` — use workspace imports.
- When asked to fix bugs, always try to write a test that fails to reproduce the bug before fixing it. Unless asked otherwise.
- When finished coding run `bun run biome check --write` and `bun run check` to ensure the code doesn't raise any issues.
- Never suppress biome warnings with `biome-ignore` just to avoid fixing them. Only suppress when the warning is genuinely a false positive and add a meaningful justification.
- We use `tsgo` for typechecking, and `biome` for formatting and linting.
- Prefer whole module imports (aka namespace imports, e.g. `import * as X from "x"`) over very granular imports for individual symbols with destructuring.
  - It's OK to use import destructuring for common third-party libraries like React, e.g. when importing hooks, but for our own code, prefer namespace imports.
  - It's OK to use import destructuring for React components, even our own.
  - When naming symbols in modules that are expected to be imported as whole namespaces, avoid using module name in the name of the symbols, unless necessary.
- Always write doc comments for all exported symbols.
- Avoid barrel files. Prefer to import from individual modules.
- If you want to add a shadcn component use `bunx --bun shadcn@latest add <component-name>`.
- Do not use banner style comments (e.g. lines of `====` or `----`).
- Avoid global state. Prefer dependency injection. Can only use global state at the very top layer of the application.
- Make sure to remove rambling "stream of consciousness" (a.k.a. thinking out loud) comments in the final code.
- Prefer broader integration-style tests. Avoid excessive mocking.
- Test actual implementation, do not duplicate logic into tests.
- When extracting code to a new module, update all call sites directly. Don't leave re-exports in the old module as "backward compatibility" — this creates unnecessary indirection and confusion.
- Consult files in `docs/` to see if there's anything relevant for your current job.
- Flags are the primary way to configure this application, and they are the source of truth, with the benefit of being self-documenting. Environment variables are layered on top of flags. See @src/config.ts for how configuration is managed.
- Avoid unnecessary destructuring. Use dot notation to preserve context.
- Avoid else statements. Prefer early returns.
- Use the modern built-in API for base64 operations (always use url-safe variant):
  - Encode: `bytes.toBase64({ alphabet: "base64url" })`.
  - Decode: `Uint8Array.fromBase64(str, { alphabet: "base64url" })`.
  - On the client-side, a polyfill already exists in `@/frontend/base64.ts` that checks for native support first and falls back to a manual implementation. Import as `import * as base64 from "@/frontend/base64"` and use `base64.encode`/`base64.decode` — never reimplement base64 logic.
  - On the server (Bun), the native API is available directly.
  - Never use `btoa`/`atob`, `Buffer`, or third-party base64 libraries directly.
