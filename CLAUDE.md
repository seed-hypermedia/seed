# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Type Checking
```bash
# Build shared package types first (required for type checking)
yarn workspace @shm/shared build:types

# Run type checking across all workspaces
yarn typecheck

# Format code
yarn format:check
yarn format:write

# Security audit
yarn security:check       # Check production dependencies for vulnerabilities
yarn security:check:dev   # Check development dependencies for vulnerabilities
```

### Running Applications

**Desktop App:**
```bash
# Run desktop app in development mode (testnet by default)
./dev run-desktop

# Run desktop app on production network
SEED_P2P_TESTNET_NAME="" ./dev run-desktop

# Alternative using yarn
yarn desktop
```

**Web App:**
```bash
# Run web app in development mode
yarn web

# Build web app for production
yarn web:prod

# Run web app with standalone backend
yarn web:dev:standalone
```

### Testing
```bash
# Run all tests
yarn test

# Run web app tests
yarn web:test
yarn web:test run <testFileName>  # Run specific test file

# Run shared package tests  
yarn workspace @shm/shared test run

# Run desktop app tests
yarn desktop:test       # Build the Electron app and Full E2E test suite
yarn desktop:test:only  # E2E tests only
```

### Single Test Execution
```bash
# For web tests
yarn web:test run <testFileName>

# For shared package tests
yarn workspace @shm/shared test run <testFileName>
```

## Architecture Overview

### Project Structure
The codebase follows a monorepo structure using Yarn workspaces:

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
- Nix and Direnv for environment management
- Yarn 3 for package management
- Vite for frontend bundling

## Important Notes

- Always run `yarn workspace @shm/shared build:types` before type checking to ensure types are built
- Tests should be run automatically when modifying code with existing test files
- The desktop app uses Electron Forge for building and packaging
- Web app uses Remix with server-side rendering
- P2P networking defaults to testnet; use `SEED_P2P_TESTNET_NAME=""` for production network