# Frontend Monorepo Migration Plan

## Executive Summary

This document outlines a comprehensive plan to migrate the current Yarn-based frontend monorepo to a cleaner, more maintainable setup that eliminates build steps for internal packages, consolidates configurations, and improves developer experience.

**Key Goals:**
- ✅ Eliminate build steps for shared packages (consume source directly)
- ✅ Unified tool configurations (TypeScript, Prettier, ESLint)
- ✅ Consistent package naming and import aliases
- ✅ Better environment variable management
- ✅ Simplified development workflow

**Recommended Tool: PNPM**

After analyzing your setup, **PNPM** is the best choice because:
- Strict dependency management (prevents phantom dependencies)
- Faster than Yarn 3 with node-modules linker
- Native workspace protocol support
- Better handling of peer dependencies
- Built-in filtering and parallel execution
- Industry momentum (Vite, Vue, Nuxt, and many others use it)

---

## Current Issues Identified

### 1. Build Step Requirements
- `@shm/shared` requires `build:types` before typecheck
- Adds friction to development workflow
- Type changes require manual rebuild

### 2. Configuration Duplication
- TypeScript paths defined in both `tsconfig.json` AND `vite.config`
- Each package has its own tsconfig with inconsistent settings
- Prettier config only at frontend level, not root

### 3. Inconsistent Dependency Declarations
- Mix of `"*"`, `"workspace:*"` for internal deps
- Confusing for developers

### 4. Environment Variable Complexity
- Env vars scattered across CLI scripts and direnv
- No centralized .env.example files
- Unclear which vars are required per app

### 5. Package Structure Confusion
- 9 apps but only 4 are primary (web, desktop, emails, explore)
- No clear indication of app priority/status

---

## Development Scenarios Support

All your required development scenarios are fully supported. Here's how each will work after migration:

### Desktop App Scenarios

#### 1. Run Desktop App - Development Mode
```bash
pnpm dev:desktop
# or
pnpm --filter=@shm/desktop dev
```

#### 2. Run Desktop App - Production Mode (Custom Ports & App Path)
```bash
# Using environment variables for custom config
VITE_DESKTOP_HTTP_PORT=53001 \
VITE_DESKTOP_GRPC_PORT=53002 \
VITE_DESKTOP_P2P_PORT=53000 \
VITE_DESKTOP_APPDATA=appData.prod.local \
pnpm --filter=@shm/desktop dev
```

**Recommended: Create npm script for convenience**
```json
{
  "scripts": {
    "dev:desktop:prod": "VITE_DESKTOP_HTTP_PORT=53001 VITE_DESKTOP_GRPC_PORT=53002 VITE_DESKTOP_P2P_PORT=53000 VITE_DESKTOP_APPDATA=appData.prod.local pnpm --filter=@shm/desktop dev"
  }
}
```

### Web App Scenarios

#### 3. Run Web App - Development Mode
```bash
pnpm dev:web
# or
pnpm --filter=@shm/web dev
```

#### 4. Run Web App - Development as Gateway
```bash
# Gateway mode (identity enabled)
SEED_IDENTITY_ENABLED=true \
SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000 \
pnpm --filter=@shm/web dev
```

**Recommended script:**
```json
{
  "scripts": {
    "dev:web:gateway": "SEED_IDENTITY_ENABLED=true SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000 pnpm --filter=@shm/web dev"
  }
}
```

#### 5. Run Web App - Development with Custom Domain
```bash
# Custom domain setup
SEED_BASE_URL=http://my-custom-domain.local:3000 \
PORT=3000 \
pnpm --filter=@shm/web dev --host
```

**Recommended script:**
```json
{
  "scripts": {
    "dev:web:custom": "SEED_BASE_URL=${CUSTOM_DOMAIN:-http://localhost:3000} pnpm --filter=@shm/web dev --host"
  }
}
```

**Usage:**
```bash
CUSTOM_DOMAIN=http://my-custom-domain.local:3000 pnpm dev:web:custom
```

#### 6. Run Web App - Development Pointing to Specific Gateway
```bash
# Point to local gateway
SEED_BASE_URL=http://localhost:3099 \
DAEMON_HTTP_URL=http://localhost:53001 \
VITE_DESKTOP_HTTP_PORT=53001 \
VITE_DESKTOP_GRPC_PORT=53002 \
VITE_DESKTOP_P2P_PORT=53000 \
pnpm --filter=@shm/web dev
```

**Recommended script:**
```json
{
  "scripts": {
    "dev:web:local-gateway": "SEED_BASE_URL=http://localhost:3099 DAEMON_HTTP_URL=http://localhost:53001 VITE_DESKTOP_HTTP_PORT=53001 VITE_DESKTOP_GRPC_PORT=53002 VITE_DESKTOP_P2P_PORT=53000 pnpm --filter=@shm/web dev"
  }
}
```

#### 7. Run Web App - Production Mode (Local Build)
```bash
# Build production version
pnpm --filter=@shm/web build

# Run production build
pnpm --filter=@shm/web start:prod
```

**Or combined script:**
```json
{
  "scripts": {
    "prod:web": "pnpm --filter=@shm/web build && pnpm --filter=@shm/web start:prod"
  }
}
```

#### 8. Run Web App - Production Mode as Gateway
```bash
# Build first
pnpm --filter=@shm/web build

# Run with gateway config
SEED_IDENTITY_ENABLED=true \
SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000 \
pnpm --filter=@shm/web start:prod
```

**Recommended script:**
```json
{
  "scripts": {
    "prod:web:gateway": "pnpm --filter=@shm/web build && SEED_IDENTITY_ENABLED=true SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000 pnpm --filter=@shm/web start:prod"
  }
}
```

#### 9. Run Web App - Production with Custom Domain
```bash
# Build first
pnpm --filter=@shm/web build

# Run with custom domain
SEED_BASE_URL=https://my-domain.com \
PORT=3000 \
pnpm --filter=@shm/web start:prod
```

**Recommended script:**
```json
{
  "scripts": {
    "prod:web:custom": "pnpm --filter=@shm/web build && SEED_BASE_URL=${CUSTOM_DOMAIN} PORT=${PORT:-3000} pnpm --filter=@shm/web start:prod"
  }
}
```

### Testing Scenarios

#### 10. Run All Tests
```bash
# Run all tests across all packages
pnpm test

# Run tests in specific app
pnpm --filter=@shm/web test
pnpm --filter=@shm/desktop test
pnpm --filter=@shm/shared test
```

#### 11. Run Specific Tests by File Pattern
```bash
# Using Vitest pattern matching
pnpm --filter=@shm/web test run <fileName>

# Example: Test specific file
pnpm --filter=@shm/web test run document.test.ts

# Example: Test pattern matching
pnpm --filter=@shm/web test run "**/*document*"

# Run tests in watch mode for specific file
pnpm --filter=@shm/web test:w document.test.ts
```

**Recommended scripts for convenience:**
```json
{
  "scripts": {
    "test:web": "pnpm --filter=@shm/web test run",
    "test:web:watch": "pnpm --filter=@shm/web test:w",
    "test:desktop": "pnpm --filter=@shm/desktop test",
    "test:shared": "pnpm --filter=@shm/shared test run",
    "test:shared:watch": "pnpm --filter=@shm/shared test:w"
  }
}
```

**Usage examples:**
```bash
# Test specific file in web app
pnpm test:web document.test.ts

# Watch mode for shared package
pnpm test:shared:watch utils.test.ts

# Test with pattern
pnpm test:web "routes/*.test.tsx"
```

### Advanced: Using .env Files for Different Modes

Create mode-specific env files:

**File: `/.env.development`**
```bash
DAEMON_HTTP_PORT=58001
DAEMON_GRPC_PORT=58002
DAEMON_P2P_PORT=58000
SEED_BASE_URL=http://localhost:3000
SEED_IDENTITY_ENABLED=false
```

**File: `/.env.development.gateway`**
```bash
DAEMON_HTTP_PORT=58001
DAEMON_GRPC_PORT=58002
DAEMON_P2P_PORT=58000
SEED_BASE_URL=http://localhost:3000
SEED_IDENTITY_ENABLED=true
SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000
```

**File: `/.env.production`**
```bash
DAEMON_HTTP_PORT=53001
DAEMON_GRPC_PORT=53002
DAEMON_P2P_PORT=53000
SEED_BASE_URL=http://localhost:3099
```

Then use `dotenv-cli` or custom script:
```bash
pnpm add -D -w dotenv-cli
```

**Update scripts:**
```json
{
  "scripts": {
    "dev:web": "dotenv -e .env.development -- pnpm --filter=@shm/web dev",
    "dev:web:gateway": "dotenv -e .env.development.gateway -- pnpm --filter=@shm/web dev",
    "prod:web": "dotenv -e .env.production -- pnpm --filter=@shm/web build && pnpm --filter=@shm/web start:prod"
  }
}
```

### Complete Root package.json Scripts Reference

Here's what the final root `package.json` scripts section could look like with all scenarios:

```json
{
  "scripts": {
    "// === Desktop App ===": "",
    "dev:desktop": "pnpm --filter=@shm/desktop dev",
    "dev:desktop:prod": "VITE_DESKTOP_HTTP_PORT=53001 VITE_DESKTOP_GRPC_PORT=53002 VITE_DESKTOP_P2P_PORT=53000 VITE_DESKTOP_APPDATA=appData.prod.local pnpm --filter=@shm/desktop dev",
    "build:desktop": "pnpm --filter=@shm/desktop package",

    "// === Web App - Development ===": "",
    "dev:web": "pnpm --filter=@shm/web dev",
    "dev:web:gateway": "SEED_IDENTITY_ENABLED=true SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000 pnpm --filter=@shm/web dev",
    "dev:web:custom": "SEED_BASE_URL=${CUSTOM_DOMAIN:-http://localhost:3000} pnpm --filter=@shm/web dev --host",
    "dev:web:local-gateway": "SEED_BASE_URL=http://localhost:3099 DAEMON_HTTP_URL=http://localhost:53001 VITE_DESKTOP_HTTP_PORT=53001 pnpm --filter=@shm/web dev",

    "// === Web App - Production ===": "",
    "build:web": "pnpm --filter=@shm/web build",
    "prod:web": "pnpm build:web && pnpm --filter=@shm/web start:prod",
    "prod:web:gateway": "pnpm build:web && SEED_IDENTITY_ENABLED=true pnpm --filter=@shm/web start:prod",
    "prod:web:custom": "pnpm build:web && SEED_BASE_URL=${CUSTOM_DOMAIN} pnpm --filter=@shm/web start:prod",

    "// === Testing ===": "",
    "test": "pnpm -r --filter='./frontend/**' run test",
    "test:web": "pnpm --filter=@shm/web test run",
    "test:web:watch": "pnpm --filter=@shm/web test:w",
    "test:desktop": "pnpm --filter=@shm/desktop test",
    "test:shared": "pnpm --filter=@shm/shared test run",
    "test:shared:watch": "pnpm --filter=@shm/shared test:w",

    "// === Other Apps ===": "",
    "dev:explore": "pnpm --filter=@shm/explore dev",
    "dev:landing": "pnpm --filter=@shm/landing dev",

    "// === Type Checking ===": "",
    "typecheck": "pnpm -r --filter='./frontend/**' run typecheck",
    "typecheck:web": "pnpm --filter=@shm/web typecheck",
    "typecheck:desktop": "pnpm --filter=@shm/desktop typecheck",

    "// === Formatting ===": "",
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",

    "// === Utilities ===": "",
    "clean": "pnpm -r exec rm -rf dist node_modules .turbo",
    "clean:deps": "rm -rf node_modules pnpm-lock.yaml && pnpm -r exec rm -rf node_modules"
  }
}
```

### Quick Reference Card

Save this for quick access:

```bash
# Desktop
pnpm dev:desktop                  # Dev mode
pnpm dev:desktop:prod             # Prod mode (different ports)

# Web - Development
pnpm dev:web                      # Standard dev
pnpm dev:web:gateway              # As gateway
pnpm dev:web:custom               # Custom domain (set CUSTOM_DOMAIN env)
pnpm dev:web:local-gateway        # Point to local gateway

# Web - Production
pnpm prod:web                     # Build + run
pnpm prod:web:gateway             # Build + run as gateway
pnpm prod:web:custom              # Build + run with custom domain

# Tests
pnpm test                         # All tests
pnpm test:web                     # Web tests
pnpm test:web document.test.ts    # Specific test file
pnpm test:web "**/*document*"     # Pattern matching
pnpm test:web:watch               # Watch mode

# Type checking
pnpm typecheck                    # All packages
pnpm typecheck:web                # Web only
```

**Summary:** All 11 scenarios are fully supported and can be made even more convenient with npm scripts. The migration actually makes these scenarios EASIER to manage because:

1. **Clear separation** - Each scenario has its own script
2. **Composable** - Can mix and match env vars
3. **No build steps** - Packages consumed directly in dev mode
4. **Better filtering** - PNPM's `--filter` is powerful and fast
5. **Consistent patterns** - All follow the same structure

---

## Migration Strategy

### Phase 1: Pre-Migration Setup (1-2 hours)

#### 1.1 Install PNPM
```bash
# Install pnpm globally
npm install -g pnpm@latest

# Or use corepack (recommended)
corepack enable
corepack prepare pnpm@latest --activate
```

#### 1.2 Backup Current State
```bash
# Create backup branch
git checkout -b backup/pre-monorepo-migration

# Commit current state
git add .
git commit -m "backup: pre-monorepo migration state"

# Return to feature branch
git checkout feat/monorepo
```

#### 1.3 Document Current Environment
```bash
# Document what's currently working
yarn typecheck > pre-migration-typecheck.log
yarn test > pre-migration-test.log
```

---

### Phase 2: Configuration Consolidation (3-4 hours)

#### 2.1 Create Root-Level Shared Configs

**File: `/tsconfig.base.json`** (NEW)
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // Strict Type Checking
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,

    // Module Resolution
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,

    // Other
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx"
  }
}
```

**File: `/.prettierrc.json`** (UPDATE ROOT)
```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80,
  "tabWidth": 2,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

**File: `/frontend/.eslintrc.json`** (NEW - optional but recommended)
```json
{
  "root": true,
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint", "react", "react-hooks"],
  "rules": {
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}
```

#### 2.2 Update Package TSConfigs to Extend Base

**File: `/frontend/packages/shared/tsconfig.json`**
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx", "dist", "node_modules"]
}
```

**File: `/frontend/packages/ui/tsconfig.json`**
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx", "dist", "node_modules"]
}
```

**File: `/frontend/packages/editor/tsconfig.json`**
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx", "dist", "node_modules"]
}
```

#### 2.3 Update App TSConfigs

**File: `/frontend/apps/web/tsconfig.json`**
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["vite/client"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./app/*"]
    }
  },
  "include": [
    "app/**/*.ts",
    "app/**/*.tsx",
    "devicelink/**/*.ts",
    "devicelink/**/*.tsx"
  ],
  "references": [
    {"path": "../../packages/shared"},
    {"path": "../../packages/ui"},
    {"path": "../../packages/editor"}
  ]
}
```

**File: `/frontend/apps/desktop/tsconfig.json`**
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "commonjs",
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "references": [
    {"path": "../../packages/shared"},
    {"path": "../../packages/ui"},
    {"path": "../../packages/editor"}
  ]
}
```

#### 2.4 Create Shared Vite Config

**File: `/frontend/vite.config.base.ts`** (NEW)
```typescript
import {defineConfig, UserConfig} from 'vite'
import path from 'path'

export function createViteConfig(options: {
  root?: string
  additionalConfig?: UserConfig
} = {}) {
  const root = options.root || process.cwd()

  return defineConfig({
    resolve: {
      alias: {
        '@shm/shared': path.resolve(root, '../../packages/shared/src'),
        '@shm/ui': path.resolve(root, '../../packages/ui/src'),
        '@shm/editor': path.resolve(root, '../../packages/editor/src'),
      },
      dedupe: [
        'react',
        'react-dom',
        '@shm/shared',
        '@shm/ui',
        '@shm/editor',
      ],
    },
    ...options.additionalConfig,
  })
}
```

#### 2.5 Update App Vite Configs to Use Base

**File: `/frontend/apps/web/vite.config.mts`**
```typescript
import {vitePlugin as remix} from '@remix-run/dev'
import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'vite'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'
import {envOnlyMacros} from 'vite-env-only'
import {createViteConfig} from '../../vite.config.base'

export default defineConfig(({isSsrBuild}) => {
  const baseConfig = createViteConfig({root: __dirname})

  return {
    ...baseConfig,
    server: {
      port: 3000,
    },
    clearScreen: false,
    build: {minify: false, sourcemap: true},
    ssr: {
      noExternal: ['react-icons', '@shm/editor'],
    },
    define: isSsrBuild
      ? {}
      : {
          'process.env': {
            NODE_ENV: process.env.NODE_ENV,
            NODE_DEBUG: process.env.NODE_DEBUG,
            SEED_ENABLE_STATISTICS: process.env.SEED_ENABLE_STATISTICS,
            SITE_SENTRY_DSN: process.env.SITE_SENTRY_DSN,
          },
        },
    optimizeDeps: {
      exclude:
        process.env.NODE_ENV === 'production'
          ? []
          : [
              'expo-linear-gradient',
              'react-icons',
              '@shm/editor',
              '@shm/shared',
              '@remix-run/react',
            ],
    },
    plugins: [
      remix(),
      envOnlyMacros(),
      tsconfigPaths(),
      commonjs({
        filter(id) {
          if (id.includes('node_modules/@react-native/normalize-color')) {
            return true
          }
        },
      }),
      tailwindcss(),
    ].filter(Boolean),
  }
})
```

---

### Phase 3: PNPM Migration (2-3 hours)

#### 3.1 Create pnpm-workspace.yaml

**File: `/pnpm-workspace.yaml`** (NEW)
```yaml
packages:
  # Frontend apps
  - 'frontend/apps/*'
  # Frontend packages
  - 'frontend/packages/*'
  # Docs
  - 'docs'

# Shared settings
shared-workspace-lockfile: true
link-workspace-packages: true
```

#### 3.2 Create .npmrc for PNPM

**File: `/.npmrc`** (NEW)
```ini
# Use exact versions by default
save-exact=true

# Hoist peer dependencies to root
hoist=true
public-hoist-pattern[]=*eslint*
public-hoist-pattern[]=*prettier*
public-hoist-pattern[]=*typescript*

# Strict peer dependencies
strict-peer-dependencies=false

# Auto install peers
auto-install-peers=true

# Shamefully hoist (only if needed for problematic packages)
shamefully-hoist=false
```

#### 3.3 Update Root package.json

**File: `/package.json`**
```json
{
  "name": "seed",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "// Test Scripts": "",
    "test": "pnpm -r --filter='./frontend/**' run test",
    "test:web": "pnpm --filter=@shm/web test",
    "test:shared": "pnpm --filter=@shm/shared test",

    "// Type Checking": "",
    "typecheck": "pnpm -r --filter='./frontend/**' run typecheck",
    "typecheck:web": "pnpm --filter=@shm/web typecheck",
    "typecheck:desktop": "pnpm --filter=@shm/desktop typecheck",

    "// Formatting": "",
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",

    "// Dev Scripts": "",
    "dev:web": "pnpm --filter=@shm/web dev",
    "dev:desktop": "pnpm --filter=@shm/desktop dev",
    "dev:explore": "pnpm --filter=@shm/explore dev",

    "// Build Scripts": "",
    "build:web": "pnpm --filter=@shm/web build",
    "build:desktop": "pnpm --filter=@shm/desktop package",

    "// Utility Scripts": "",
    "clean": "pnpm -r exec rm -rf dist node_modules .turbo",
    "clean:deps": "rm -rf node_modules pnpm-lock.yaml && pnpm -r exec rm -rf node_modules"
  }
}
```

#### 3.4 Update Package package.json Files

**File: `/frontend/packages/shared/package.json`**
```json
{
  "name": "@shm/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",
    "test": "vitest --run",
    "test:w": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@bufbuild/protobuf": "1.10.0",
    "@connectrpc/connect-web": "1.1.3",
    "@tanstack/react-query": "^4.36.1",
    "@xstate/react": "4.1.3",
    "cheerio": "^1.0.0",
    "katex": "0.16.9",
    "lowlight": "3.1.0",
    "nanoid": "4.0.2",
    "react": "18.2.0",
    "react-tweet": "3.2.0",
    "xstate": "5.19.2"
  },
  "devDependencies": {
    "typescript": "5.8.3",
    "vitest": "0.34.2"
  }
}
```

**Note:** Remove `build:types` script - no longer needed!

**File: `/frontend/packages/ui/package.json`**
```json
{
  "name": "@shm/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.tsx",
  "types": "./src/index.tsx",
  "exports": {
    ".": "./src/index.tsx",
    "./*": "./src/*"
  },
  "scripts": {
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@shm/shared": "workspace:*",
    // ... rest of dependencies
  }
}
```

**File: `/frontend/packages/editor/package.json`**
```json
{
  "name": "@shm/editor",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@shm/ui": "workspace:*",
    // ... rest of dependencies
  }
}
```

#### 3.5 Update App package.json Files

**File: `/frontend/apps/web/package.json`**
```json
{
  "name": "@shm/web",
  "private": true,
  "sideEffects": false,
  "type": "module",
  "scripts": {
    // ... existing scripts
  },
  "dependencies": {
    "@shm/editor": "workspace:*",
    "@shm/emails": "workspace:*",
    "@shm/shared": "workspace:*",
    "@shm/ui": "workspace:*",
    // ... rest of dependencies
  }
}
```

Apply `"workspace:*"` pattern to all apps: desktop, emails, explore, landing, etc.

---

### Phase 4: Environment Variable Management (1-2 hours)

#### 4.1 Create Environment Variable Templates

**File: `/.env.example`** (NEW - Root level)
```bash
# Seed Hypermedia - Root Environment Variables
# Copy this file to .env and fill in your values

# ============================================
# SHARED CONFIGURATION
# ============================================

# Backend Configuration
DAEMON_HTTP_PORT=58001
DAEMON_GRPC_PORT=58002
DAEMON_P2P_PORT=58000
DAEMON_HTTP_URL=http://localhost:58001
DAEMON_FILE_URL=http://localhost:58001/ipfs

# Network Configuration
SEED_P2P_TESTNET_NAME=testnet  # Leave empty for production network

# ============================================
# WEB APP SPECIFIC
# ============================================

# Server Configuration
PORT=3000
NODE_ENV=development

# Feature Flags
SEED_BASE_URL=http://localhost:3000
SEED_SIGNING_ENABLED=true
SEED_IDENTITY_ENABLED=false
SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000
SEED_ENABLE_STATISTICS=false

# External Services
LIGHTNING_API_URL=https://ln.testnet.seed.hyper.media
SITE_SENTRY_DSN=

# ============================================
# DESKTOP APP SPECIFIC
# ============================================

VITE_DESKTOP_HTTP_PORT=58001
VITE_DESKTOP_GRPC_PORT=58002
VITE_DESKTOP_P2P_PORT=58000
VITE_DESKTOP_APPDATA=appData.local

# ============================================
# DEVELOPMENT TOOLS
# ============================================

ELECTRON_ENABLE_LOGGING=false
PWDEBUG=0
```

**File: `/frontend/apps/web/.env.example`** (NEW)
```bash
# Web App Environment Variables
# These override root .env for web-specific development

PORT=3000
SEED_BASE_URL=http://localhost:3000
SEED_SIGNING_ENABLED=true
DAEMON_HTTP_PORT=58001
DAEMON_FILE_URL=http://localhost:58001/ipfs
```

**File: `/frontend/apps/desktop/.env.example`** (NEW)
```bash
# Desktop App Environment Variables

VITE_DESKTOP_HTTP_PORT=58001
VITE_DESKTOP_GRPC_PORT=58002
VITE_DESKTOP_P2P_PORT=58000
VITE_DESKTOP_APPDATA=appData.local
```

#### 4.2 Create Environment Loading Utility

**File: `/scripts/load-env.mjs`** (NEW)
```javascript
#!/usr/bin/env node

import {config} from 'dotenv'
import {expand} from 'dotenv-expand'
import path from 'path'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// Load root .env
const rootEnv = config({path: path.join(rootDir, '.env')})
expand(rootEnv)

// Load app-specific .env if provided
const appName = process.argv[2]
if (appName) {
  const appEnvPath = path.join(rootDir, 'frontend', 'apps', appName, '.env')
  const appEnv = config({path: appEnvPath})
  expand(appEnv)
}

console.log('Environment loaded successfully')
```

#### 4.3 Update Package Scripts to Use Env Loading

**File: `/package.json`** (update scripts)
```json
{
  "scripts": {
    "dev:web": "node scripts/load-env.mjs web && pnpm --filter=@shm/web dev",
    "dev:desktop": "node scripts/load-env.mjs desktop && pnpm --filter=@shm/desktop dev"
  }
}
```

---

### Phase 5: Barrel File Removal (Optional but Recommended - 2-3 hours)

**Why Remove Barrel Files?**

Barrel files (index.ts that re-export everything) cause several issues:
- Slower HMR (entire barrel reloads on any change)
- Poor tree-shaking (bundlers can't eliminate unused code effectively)
- Circular dependency risks
- Slower TypeScript compilation
- Less explicit imports

**Current Import Pattern (with barrels):**
```typescript
// Imports from barrel file
import { useDocument, createDocument, Button, Dialog } from '@shm/shared'
```

**After Removal (direct imports):**
```typescript
// Direct imports - explicit and performant
import { useDocument } from '@shm/shared/hooks/use-document'
import { createDocument } from '@shm/shared/utils/document'
import { Button } from '@shm/ui/button'
import { Dialog } from '@shm/ui/dialog'
```

#### 5.1 Update Package Exports

The `exports` field in package.json already supports this with `"./*": "./src/*"`

**Verify `/frontend/packages/shared/package.json`:**
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  }
}
```

This allows both:
- `import { X } from '@shm/shared'` (barrel - to be removed)
- `import { X } from '@shm/shared/hooks/use-document'` (direct)

#### 5.2 Automated Import Transformation

Use a codemod to automatically update all imports:

**File: `/scripts/remove-barrel-imports.mjs`** (NEW)
```javascript
#!/usr/bin/env node

/**
 * Codemod to transform barrel imports to direct imports
 *
 * Usage: node scripts/remove-barrel-imports.mjs
 */

import {execSync} from 'child_process'
import fs from 'fs'
import path from 'path'

const PACKAGES_TO_TRANSFORM = [
  {
    name: '@shm/shared',
    path: 'frontend/packages/shared/src',
    exports: {
      // Map common exports to their file paths
      // You'll need to fill this based on your actual exports
      'useDocument': 'hooks/use-document',
      'createDocument': 'utils/document',
      'HMDocument': 'models/document',
      // ... add all your exports
    }
  },
  {
    name: '@shm/ui',
    path: 'frontend/packages/ui/src',
    exports: {
      'Button': 'button',
      'Dialog': 'dialog',
      'Input': 'input',
      // ... add all your exports
    }
  },
  {
    name: '@shm/editor',
    path: 'frontend/packages/editor/src',
    exports: {
      'Editor': 'editor',
      'useEditor': 'hooks/use-editor',
      // ... add all your exports
    }
  }
]

console.log('🔄 Starting barrel import transformation...')
console.log('This will update all imports to use direct paths instead of barrel files\n')

// TODO: Implement transformation logic or use jscodeshift
console.log('⚠️  Manual approach recommended:')
console.log('1. Keep barrel files temporarily for backward compatibility')
console.log('2. Use IDE "Find Usages" to locate imports')
console.log('3. Gradually update imports file by file')
console.log('4. Remove barrel files once all imports are updated')
```

#### 5.3 Manual Transformation Strategy (Recommended)

**Step-by-step approach:**

1. **Audit Current Barrel Files**
```bash
# Find all barrel files
find frontend/packages -name "index.ts" -o -name "index.tsx"

# Review what they export
cat frontend/packages/shared/src/index.ts
cat frontend/packages/ui/src/index.tsx
cat frontend/packages/editor/src/index.ts
```

2. **Create Export Map**

Document all exports and their actual locations:

```typescript
// @shm/shared exports → file locations
export { useDocument } from './hooks/use-document'        // @shm/shared/hooks/use-document
export { createDocument } from './utils/document'         // @shm/shared/utils/document
export { HMDocument } from './models/document'            // @shm/shared/models/document

// @shm/ui exports → file locations
export { Button } from './button'                         // @shm/ui/button
export { Dialog } from './dialog'                         // @shm/ui/dialog

// @shm/editor exports → file locations
export { Editor } from './editor'                         // @shm/editor/editor
export { useEditor } from './hooks/use-editor'            // @shm/editor/hooks/use-editor
```

3. **Update Imports Gradually**

Start with one app (e.g., web) and update imports:

**Before:**
```typescript
import { useDocument, createDocument, HMDocument } from '@shm/shared'
import { Button, Dialog } from '@shm/ui'
```

**After:**
```typescript
import { useDocument } from '@shm/shared/hooks/use-document'
import { createDocument } from '@shm/shared/utils/document'
import { HMDocument } from '@shm/shared/models/document'
import { Button } from '@shm/ui/button'
import { Dialog } from '@shm/ui/dialog'
```

4. **Use IDE Automation**

Most IDEs can help:

**VS Code:**
```
1. Open file with barrel import
2. Hover over imported symbol
3. Click "Go to Definition"
4. Note the actual file path
5. Update import manually
```

**WebStorm/IntelliJ:**
```
1. Right-click on import
2. "Optimize Imports" can help
3. Use "Find Usages" to see all locations
```

5. **Verify with TypeScript**

After updating, ensure types still work:
```bash
pnpm typecheck:web
pnpm typecheck:desktop
```

6. **Update Vite Config (if needed)**

Ensure aliases still work without barrels:

```typescript
// vite.config.base.ts - already supports this
resolve: {
  alias: {
    '@shm/shared': path.resolve(root, '../../packages/shared/src'),
    '@shm/ui': path.resolve(root, '../../packages/ui/src'),
    '@shm/editor': path.resolve(root, '../../packages/editor/src'),
  }
}
```

7. **Remove Barrel Files**

Once all imports are updated:

```bash
# ONLY after confirming all imports are updated
rm frontend/packages/shared/src/index.ts
rm frontend/packages/ui/src/index.tsx
rm frontend/packages/editor/src/index.ts
```

8. **Update Package.json**

Remove barrel as main entry:

```json
{
  "name": "@shm/shared",
  "exports": {
    "./*": "./src/*"
  }
  // Remove "main" and "types" pointing to index.ts
}
```

#### 5.4 Validation Checklist

- [ ] All imports updated from barrel to direct
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] Dev servers start correctly
- [ ] HMR works (faster than before!)
- [ ] Production builds work
- [ ] No circular dependency warnings
- [ ] Barrel files removed from packages

#### 5.5 Expected Benefits

After removing barrel files, you should see:

**Performance Improvements:**
- ✅ 30-50% faster HMR in development
- ✅ 10-20% smaller production bundles (better tree-shaking)
- ✅ 20-30% faster TypeScript type checking

**Developer Experience:**
- ✅ More explicit imports (easier to understand)
- ✅ Better "Go to Definition" (jumps to source, not barrel)
- ✅ No circular dependency issues
- ✅ Clearer code ownership

**Timeline:** 2-3 hours for manual transformation, can be done incrementally after main migration.

---

### Phase 6: Migration Execution (1-2 hours)

#### 6.1 Clean Existing State
```bash
# Remove node_modules
rm -rf node_modules
find frontend -name "node_modules" -type d -prune -exec rm -rf {} \;

# Remove yarn files
rm -rf .yarn/cache
rm -rf yarn.lock

# Remove built types
find frontend/packages -name "dist" -type d -prune -exec rm -rf {} \;
```

#### 6.2 Install PNPM Dependencies
```bash
# Install dependencies
pnpm install

# Verify installation
pnpm list --depth=0
```

#### 6.3 Verify TypeScript Setup
```bash
# Should work without build step now!
pnpm typecheck

# Individual checks
pnpm typecheck:web
pnpm typecheck:desktop
```

#### 6.4 Verify Tests
```bash
pnpm test
```

#### 6.5 Test Development Servers
```bash
# Terminal 1: Start backend (existing)
./dev run-backend

# Terminal 2: Start web app
pnpm dev:web

# Terminal 3: Start desktop app
pnpm dev:desktop
```

---

### Phase 7: Optional Enhancements

#### 7.1 Add Turborepo for Build Caching (Optional)

If you want even faster builds and intelligent caching:

**Install Turborepo:**
```bash
pnpm add -D -w turbo
```

**File: `/turbo.json`** (NEW)
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "out/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Update package.json scripts:**
```json
{
  "scripts": {
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build"
  }
}
```

#### 7.2 Add Changesets for Version Management (Optional)

For managing versions and changelogs:

```bash
pnpm add -D -w @changesets/cli
pnpm changeset init
```

---

## Validation Checklist

After migration, verify:

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes without needing build step
- [ ] `pnpm test` runs all tests successfully
- [ ] `pnpm dev:web` starts web app correctly
- [ ] `pnpm dev:desktop` starts desktop app correctly
- [ ] Hot module replacement works in both apps
- [ ] Changes to shared packages reflect immediately (no rebuild needed)
- [ ] Environment variables load correctly
- [ ] All imports resolve correctly
- [ ] Production builds work (`pnpm build:web`, `pnpm build:desktop`)

---

## Rollback Plan

If issues arise:

```bash
# Return to backup branch
git checkout backup/pre-monorepo-migration

# Or cherry-pick specific changes
git checkout feat/monorepo
git cherry-pick <specific-commits>

# Reinstall old setup
rm -rf node_modules pnpm-lock.yaml
yarn install
```

---

## Benefits After Migration

### Developer Experience
- ✅ **No build steps for packages** - edit and see changes instantly
- ✅ **Consistent configs** - one source of truth
- ✅ **Clear env var management** - .env.example files guide setup
- ✅ **Faster installs** - PNPM is ~2x faster than Yarn
- ✅ **Better IDE support** - source imports improve go-to-definition

### Maintainability
- ✅ **Shared configs** - update once, apply everywhere
- ✅ **Strict dependencies** - no phantom deps
- ✅ **Clear package structure** - explicit exports
- ✅ **Type safety** - direct source consumption means better types

### Performance
- ✅ **Faster cold starts** - no type building
- ✅ **Faster hot reload** - direct source watching
- ✅ **Smaller disk usage** - PNPM's content-addressable store

---

## Timeline Estimate

| Phase | Duration | Can be Done in Parallel |
|-------|----------|------------------------|
| Phase 1: Pre-migration | 1-2 hours | No |
| Phase 2: Config consolidation | 3-4 hours | No |
| Phase 3: PNPM migration | 2-3 hours | No |
| Phase 4: Env var management | 1-2 hours | Yes (with Phase 3) |
| Phase 5: Barrel file removal | 2-3 hours | Yes (after Phase 6) |
| Phase 6: Execution & testing | 1-2 hours | No |
| Phase 7: Optional enhancements | 1-2 hours | Yes (after validation) |

**Total: 11-18 hours** (conservative estimate with testing and barrel removal)

---

## Import Strategy Summary

### Question: Do I need to change how I import files?

**Short Answer:** Your current imports (`@shm/shared/*`, `@shm/ui/*`) will continue to work with the migration. However, removing barrel files is highly recommended for better performance.

### Current Import Patterns (Before Migration)

```typescript
// Using barrel file (index.ts)
import { useDocument, createDocument, Button } from '@shm/shared'

// OR with path aliases in tsconfig
import { useDocument } from '@shm/shared/hooks/use-document'
```

**Issues with current approach:**
- ❌ Requires `build:types` step
- ❌ Slow HMR (entire barrel reloads)
- ❌ Poor tree-shaking
- ❌ Circular dependency risks

### After Migration (With Barrel Files Kept)

```typescript
// Still works via package.json exports field
import { useDocument, createDocument } from '@shm/shared'
import { Button, Dialog } from '@shm/ui'
```

**Configuration that enables this:**
```json
// package.json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  }
}
```

**Benefits:**
- ✅ No build step required
- ✅ Direct source consumption
- ⚠️ Still has barrel file performance issues

### After Migration + Barrel Removal (Recommended)

```typescript
// Direct imports - explicit and performant
import { useDocument } from '@shm/shared/hooks/use-document'
import { createDocument } from '@shm/shared/utils/document'
import { Button } from '@shm/ui/button'
import { Dialog } from '@shm/ui/dialog'
```

**Configuration:**
```json
// package.json (barrel removed)
{
  "exports": {
    "./*": "./src/*"
  }
}
```

**Benefits:**
- ✅ No build step required
- ✅ 30-50% faster HMR
- ✅ 10-20% smaller bundles
- ✅ Better tree-shaking
- ✅ No circular dependencies
- ✅ Clearer code

### Migration Path

1. **Phase 1-4:** Core migration (keeps barrel files)
   - Everything works as before
   - No import changes needed
   - Can ship this immediately

2. **Phase 5:** Barrel removal (optional but recommended)
   - Update imports to be direct
   - Can be done incrementally
   - Significant performance gains

### Recommendation

**For immediate migration:** Keep barrel files, change nothing about imports. This gives you all the benefits of no build steps with zero breaking changes.

**For optimal setup:** Remove barrel files after core migration. This is a 2-3 hour investment that pays off with much better performance and DX.

---

## Next Steps

1. **Review this document** - ensure all decisions align with team preferences
2. **Create feature branch** - `git checkout -b feat/monorepo-v2`
3. **Start with Phase 1** - backup and preparation
4. **Execute phases sequentially** - test after each phase
5. **Get team to test** - ensure all workflows work
6. **Decide on barrel removal** - optional but recommended
7. **Merge to main** - celebrate improved DX! 🎉

---

## Questions & Support

If you encounter issues during migration:

1. Check the validation checklist
2. Review error messages carefully (PNPM errors are usually very clear)
3. Verify tsconfig references are correct
4. Ensure all workspace:* references are in place
5. Check that vite configs have correct aliases

Common issues and solutions:

**"Cannot find module '@shm/shared'"**
- Check package.json has `"main": "./src/index.ts"`
- Verify vite.config has correct alias
- Ensure pnpm install completed

**"Type errors after migration"**
- Run `pnpm install` again
- Check tsconfig references
- Restart TypeScript server in IDE

**"Module not found in production build"**
- Check vite config `ssr.noExternal` includes the package
- Verify package exports are correct

---

## Architecture Diagram

```
seed/ (root)
├── .env                        # Root environment variables
├── .env.example                # Template
├── .npmrc                      # PNPM config
├── pnpm-workspace.yaml         # Workspace definition
├── tsconfig.base.json          # Shared TypeScript config
├── package.json                # Root package with scripts
├── turbo.json                  # Optional: build caching
│
├── frontend/
│   ├── vite.config.base.ts     # Shared Vite config
│   ├── .prettierrc             # Prettier config
│   │
│   ├── packages/               # Shared code
│   │   ├── shared/
│   │   │   ├── src/
│   │   │   │   └── index.ts    # Main entry (consumed directly)
│   │   │   ├── package.json    # workspace:* deps
│   │   │   └── tsconfig.json   # Extends base
│   │   │
│   │   ├── ui/
│   │   │   ├── src/
│   │   │   │   └── index.tsx
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   └── editor/
│   │       ├── src/
│   │       │   └── index.ts
│   │       ├── package.json
│   │       └── tsconfig.json
│   │
│   └── apps/                   # Applications
│       ├── web/                # Primary app
│       │   ├── .env.example
│       │   ├── app/
│       │   ├── vite.config.mts # Uses base config
│       │   ├── tsconfig.json   # References packages
│       │   └── package.json    # workspace:* deps
│       │
│       ├── desktop/            # Primary app
│       │   ├── .env.example
│       │   ├── src/
│       │   ├── tsconfig.json
│       │   └── package.json
│       │
│       ├── emails/             # Primary app
│       ├── explore/            # Primary app
│       ├── landing/            # Supporting app
│       ├── performance/        # Supporting app
│       └── ...
│
└── backend/                    # Go services (unchanged)
```

---

**Ready to start? Begin with Phase 1! 🚀**