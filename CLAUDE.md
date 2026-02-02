# CLAUDE.md

- In all interactions and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Type Checking
```bash
# Build shared package types first (required for type checking)
pnpm -F @shm/shared build:types

# Run type checking across all workspaces
pnpm typecheck

# Format code
pnpm format:check
pnpm format:write

# Security audit
pnpm security:check       # Check production dependencies for vulnerabilities
pnpm security:check:dev   # Check development dependencies for vulnerabilities
```

### Running Applications

**Desktop App:**
```bash
# Run desktop app in development mode (testnet by default)
./dev run-desktop

# Run desktop app on production network
SEED_P2P_TESTNET_NAME="" ./dev run-desktop

# Alternative using pnpm
pnpm desktop
```

**Web App:**
```bash
# Run web app in development mode
pnpm web

# Build web app for production
pnpm web:prod

# Run web app with standalone backend
pnpm web:dev:standalone
```

### Testing
```bash
# Run all tests
pnpm test

# Run web app tests
pnpm web:test
pnpm web:test run <testFileName>  # Run specific test file

# Run shared package tests
pnpm -F @shm/shared test run

# Run desktop app tests
pnpm desktop:test       # Build the Electron app and Full E2E test suite
pnpm desktop:test:only  # E2E tests only
```

### Single Test Execution
```bash
# For web tests
pnpm web:test run <testFileName>

# For shared package tests
pnpm -F @shm/shared test run <testFileName>
```

## Architecture Overview

### Project Structure
The codebase follows a monorepo structure using pnpm workspaces:

- **`frontend/apps/`**: Application codebases
  - `desktop/`: Electron-based desktop application
  - `web/`: Remix-based web application
  - `explore/`, `landing/`, `performance/`: Supporting applications

- **`frontend/packages/`**: Shared packages
  - `shared/`: Core shared utilities and models
  - `ui/`: Shared UI components
  - `editor/`: Document editor components

- **`backend/`**: Go backend services
  - `cmd/seed-daemon/`: Main P2P daemon
  - `cmd/seed-site/`: Site hosting service

### Key Technologies

**Frontend Stack:**
- React 18 with TypeScript
- Electron (desktop app)
- Remix (web app)
- TailwindCSS for styling
- TipTap for rich text editing
- tRPC for type-safe API communication
- Tanstack Query for data fetching

**Backend Stack:**
- Go for backend services
- P2P networking with libp2p
- Protocol Buffers for data serialization
- Connect-RPC for service communication

### Development Tools
- **`./dev`**: Main development CLI tool for running common tasks
- Mise and Direnv for environment management
- pnpm for package management
- Vite for frontend bundling

## Important Notes

- Always run `pnpm -F @shm/shared build:types` before type checking to ensure types are built
- Tests should be run automatically when modifying code with existing test files
- The desktop app uses Electron Forge for building and packaging
- Web app uses Remix with server-side rendering
- P2P networking defaults to testnet; use `SEED_P2P_TESTNET_NAME=""` for production network

## Before Pushing Code

If there's code changed inside `frontend/*`, always ensure the following before pushing:

1. **Type checking passes:**
   ```bash
   pnpm typecheck
   ```

2. **Code is formatted:**
   ```bash
   pnpm format:write
   ```
