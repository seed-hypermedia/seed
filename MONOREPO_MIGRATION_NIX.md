# Monorepo Migration - Nix/Bazel/Please Integration

## ⚠️ IMPORTANT: Build Tooling Integration

Your project uses sophisticated build tooling that **significantly impacts** the migration strategy:

- **Nix**: Manages development environment and tool versions
- **Please (plz)**: Build orchestration tool
- **Bazel**: Build system integration
- **direnv**: Automatic environment management

## Critical Discovery

The migration plan in `MONOREPO_MIGRATION.md` needs adjustments because:

1. **Yarn is installed via Nix** (`shell.nix` line 11)
2. **Please expects yarn** (`BUILD.plz` uses `yarn_install`)
3. **Bazel validates yarn version** (`WORKSPACE.bazel` checks for yarn 3.5.1)
4. **direnv sets all environment variables** (`.envrc` already manages env vars)

## Updated Migration Strategy

### Option A: Keep Yarn + Improve Setup (Recommended)

Since Yarn is deeply integrated with your build system, **keep Yarn** but improve the monorepo setup:

✅ **What we CAN improve:**

- Remove build steps for packages (consume source directly)
- Consolidate TypeScript configs
- Remove barrel files
- Better npm scripts organization
- Clearer workspace structure

❌ **What we should NOT change:**

- Package manager (keep Yarn 3)
- Nix configuration
- Please build rules
- Bazel workspace setup

**Benefits:**

- No breaking changes to build system
- Still get 80% of desired improvements
- Compatible with CI/CD
- Team familiar with tooling

### Option B: Switch to PNPM (Complex, Not Recommended)

Would require updating:

1. `shell.nix` - Replace yarn with pnpm
2. `BUILD.plz` - Create pnpm_install rule (if possible)
3. `WORKSPACE.bazel` - Update version checks
4. All CI/CD pipelines
5. Please build rules (may not support pnpm)
6. Bazel tooling

**Risks:**

- Please may not support pnpm
- Bazel rules may break
- Significant testing required
- Team retraining needed

## Recommended Approach: "Yarn + Optimization"

### Phase 1: Workspace Improvements (Keep Yarn)

#### 1.1 Update shell.nix - No Changes Needed

Keep existing setup:

```nix
# shell.nix - NO CHANGES
yarn  # Keep this
```

#### 1.2 Update BUILD.plz - No Changes Needed

```python
# BUILD.plz - NO CHANGES
yarn_install(
    name = "yarn",
    visibility = [
        "//build/tools/...",
        "//frontend/...",
    ],
)
```

#### 1.3 Verify .envrc Configuration

Your `.envrc` already handles environment variables perfectly! This is better than our proposed .env solution because:

- ✅ Automatically loaded by direnv
- ✅ Integrated with Nix
- ✅ No need for dotenv-cli
- ✅ Already has all the vars we need

**No changes needed** to `.envrc` for now.

### Phase 2: Monorepo Improvements (Without Package Manager Change)

These improvements work with Yarn:

#### 2.1 Consolidated TypeScript Configs

Create `tsconfig.base.json` at root (from main migration doc)

#### 2.2 Remove Build Steps for Packages

Update package.json exports to consume source directly:

```json
{
  "name": "@shm/shared",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  }
}
```

#### 2.3 Barrel File Removal

Follow Phase 5 from main migration doc - this works with Yarn.

#### 2.4 Better npm Scripts

Organize root `package.json` with all the dev/prod scenarios.

### Phase 3: Enhanced direnv Configuration

Since you're using direnv, create mode-specific configurations:

**File: `/.envrc.development.gateway`** (NEW)

```bash
# Source main envrc
source_env .envrc

# Override for gateway mode
export SEED_IDENTITY_ENABLED=true
export SEED_IDENTITY_DEFAULT_ORIGIN=http://localhost:3000
```

**File: `/.envrc.production`** (NEW)

```bash
# Source main envrc
source_env .envrc

# Override ports for production mode
export SEED_P2P_PORT="53000"
export SEED_HTTP_PORT="53001"
export SEED_GRPC_PORT="53002"
export VITE_DESKTOP_P2P_PORT="$SEED_P2P_PORT"
export VITE_DESKTOP_HTTP_PORT="$SEED_HTTP_PORT"
export VITE_DESKTOP_GRPC_PORT="$SEED_GRPC_PORT"
```

**Usage:**

```bash
# Load different environment
direnv allow .envrc.production
```

### Phase 4: Improved Scripts with Yarn

Update root `package.json`:

```json
{
  "packageManager": "yarn@3.6.1",
  "scripts": {
    "// === Desktop App ===": "",
    "dev:desktop": "yarn workspace @shm/desktop dev",
    "dev:desktop:prod": "VITE_DESKTOP_HTTP_PORT=53001 VITE_DESKTOP_GRPC_PORT=53002 VITE_DESKTOP_P2P_PORT=53000 yarn workspace @shm/desktop dev",

    "// === Web App - Development ===": "",
    "dev:web": "yarn workspace @shm/web dev",
    "dev:web:gateway": "SEED_IDENTITY_ENABLED=true yarn workspace @shm/web dev",

    "// === Type Checking (No Build Step!) ===": "",
    "typecheck": "yarn workspaces foreach -pt run typecheck",

    "// === Testing ===": "",
    "test": "yarn workspaces foreach -pt run test",
    "test:web": "yarn workspace @shm/web test run",
    "test:shared": "yarn workspace @shm/shared test run"
  }
}
```

## What We Gain (Even Without PNPM)

### ✅ Major Improvements

1. **No build steps** - packages consumed from source
2. **Faster HMR** - direct source watching
3. **Consolidated configs** - tsconfig.base.json, shared prettier
4. **Barrel removal** - 30-50% faster dev experience
5. **Better scripts** - organized and discoverable
6. **Type safety** - better because consuming source

### ✅ Keep What Works

1. **Nix environment** - proven and stable
2. **Please builds** - no disruption
3. **Bazel integration** - unchanged
4. **direnv** - better than .env files anyway!
5. **CI/CD** - no changes needed

## Migration Timeline (Yarn-Optimized)

| Phase                         | Duration  | Risk   |
| ----------------------------- | --------- | ------ |
| 1. TypeScript consolidation   | 2-3 hours | Low    |
| 2. Remove package build steps | 1-2 hours | Low    |
| 3. Update npm scripts         | 1 hour    | Low    |
| 4. Barrel file removal        | 2-3 hours | Medium |
| 5. Testing & validation       | 2 hours   | Low    |

**Total: 8-11 hours** (vs 11-18 with PNPM switch)

**Risk Level: LOW** (no build tooling changes)

## Recommendation

**Proceed with "Yarn + Optimization" approach** because:

1. ✅ Gets 80% of benefits with 20% of risk
2. ✅ No Nix/Bazel/Please changes
3. ✅ No CI/CD updates needed
4. ✅ Team keeps familiar tooling
5. ✅ Can still consider PNPM later if needed

## Future: PNPM Migration (If Desired)

If you want PNPM in the future, tackle it as a separate project after:

- Testing that Please supports pnpm_install
- Verifying Bazel compatibility
- Planning Nix package update
- Ensuring CI/CD compatibility

**Estimate for future PNPM switch: 15-20 hours** (build system integration)

## Next Steps

1. **Decision Point**: Confirm "Yarn + Optimization" approach
2. **Start with**: TypeScript consolidation (safe, high value)
3. **Then**: Remove build steps (immediate DX win)
4. **Finally**: Barrel removal (performance boost)

Each step is independently valuable and low-risk!

---

## Questions to Answer

Before proceeding, clarify:

1. **Is Please flexible enough** to handle consuming packages from source without build steps?
2. **Does Bazel care** about how packages are consumed internally?
3. **Are there other build rules** we should be aware of that depend on Yarn?
4. **Do you want to keep Nix/Please/Bazel** integration (recommended: yes)?

Let me know your preference and we'll proceed with the appropriate migration path!
