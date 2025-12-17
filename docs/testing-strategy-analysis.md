# Frontend Testing Strategy Analysis & Recommendations

**Date:** December 17, 2024
**Status:** Current State Assessment & Action Plan

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Test Coverage](#current-test-coverage)
3. [CI/CD Test Execution](#cicd-test-execution)
4. [Critical Gaps](#critical-gaps)
5. [Recommendations by Package](#recommendations-by-package)
6. [Test Parallelization Strategy](#test-parallelization-strategy)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Appendix](#appendix)

---

## Executive Summary

### Current State
- **Total Projects:** 12 (9 apps + 3 packages)
- **Projects with Tests:** 5 (41.7%)
- **Projects without Tests:** 7 (58.3%)
- **Total Test Files:** 24 (14 unit, 2 integration, 7 E2E)

### Key Findings
1. ✅ **Strengths:** Core desktop app and shared package have good test coverage
2. ⚠️ **Critical Gap:** UI package (shared components) has zero tests
3. ❌ **CI/CD Gap:** Desktop and Editor E2E tests exist but don't run in CI
4. 📊 **Coverage:** Only 41.7% of projects have any test coverage

### Immediate Actions Required
1. Add desktop E2E tests to CI workflows (already written, just not running)
2. Add editor E2E tests to CI workflows (already written, just not running)
3. Implement UI component testing (zero coverage for critical shared package)

---

## Current Test Coverage

### Projects WITH Tests (5/12 = 41.7%)

#### 1. Desktop App (@shm/desktop) - **Full Coverage**
**Status:** ✅ Unit + E2E Tests

**Unit Tests (2 files):**
- `src/__tests__/account-selection.test.ts`
- `src/models/__tests__/navigation.test.ts`

**E2E Tests (4 files):**
- `tests/onboarding-from-scratch.e2e.ts` (69 lines)
- `tests/onboarding-with-secret.e2e.ts` (71 lines)
- `tests/onboarding-new-device.e2e.ts` (48 lines)
- `tests/home-documents.e2e.ts` (10 lines)

**Framework:** Vitest (unit) + Playwright (E2E)

**Test Scripts:**
```bash
yarn desktop:test       # Full: build + E2E
yarn desktop:test:only  # E2E only
yarn desktop:test:unit  # Unit tests
```

**Issues:** E2E tests exist but DON'T run in CI

---

#### 2. Web App (@shm/web) - **Partial Coverage**
**Status:** ⚠️ Limited Unit/Integration Tests

**Unit Tests (1 file):**
- `app/validate-signature.test.ts`

**Integration Tests (2 files):**
- `app/local-db.integration.test.ts`
- `app/local-db-recents.integration.test.ts`

**Framework:** Vitest

**Test Scripts:**
```bash
yarn web:test   # Run all tests
yarn web:test:w # Watch mode
```

**Issues:** Only 3 test files total, no E2E coverage for critical user flows

---

#### 3. Notify App (@shm/notify) - **Partial Coverage**
**Status:** ⚠️ Minimal Unit Tests

**Unit Tests (2 files):**
- `app/db.test.ts`
- `app/validate-signature.test.ts`

**Framework:** Vitest

**Test Scripts:**
```bash
yarn test   # Run tests
yarn test:w # Watch mode
```

**Issues:** Only 2 test files, no integration or E2E tests

---

#### 4. Shared Package (@shm/shared) - **Partial Coverage**
**Status:** ✅ Good Unit Test Coverage

**Unit Tests (10 files):**
- `src/__tests__/document-to-text.test.ts`
- `src/__tests__/document-utils.test.ts`
- `src/__tests__/html-to-blocks.test.ts`
- `src/client/__tests__/editorblock-to-hmblock.test.ts`
- `src/client/__tests__/hmblock-to-editorblock.test.ts`
- `src/client/__tests__/image-paste-functionality.test.ts`
- `src/input-querystring.test.ts`
- `src/models/__tests__/payment-allocations.test.ts`
- `src/utils/__tests__/entity-id-url.test.ts`
- `src/utils/document-path.test.ts`

**Framework:** Vitest

**Test Scripts:**
```bash
yarn shared:test # Run tests
```

**Issues:** None - good coverage for core utilities

---

#### 5. Editor Package (@shm/editor) - **Partial Coverage**
**Status:** ✅ Excellent E2E Coverage

**E2E Tests (3 files, 1,301 lines total):**
- `e2e/tests/copy-paste.e2e.ts` (815 lines) - Comprehensive clipboard testing
- `e2e/tests/selection-toolbar.e2e.ts` (289 lines) - Text formatting toolbar
- `e2e/tests/block-manipulation.e2e.ts` (197 lines) - Block operations

**Framework:** Playwright

**Test Scripts:**
```bash
yarn test:e2e          # Run E2E tests
yarn test:e2e:ui       # UI mode
yarn test:e2e:headed   # Headed browser
yarn test:e2e:debug    # Debug mode
```

**Issues:** Comprehensive E2E tests exist but DON'T run in CI

---

### Projects WITHOUT Tests (7/12 = 58.3%)

| Project | Type | Status | Impact |
|---------|------|--------|--------|
| **ui** | package | ❌ No tests (critical) | Shared components used everywhere |
| **emails** | app | ❌ No tests | Email templates can break silently |
| **explore** | app | ❌ No tests | Low priority |
| **landing** | app | ❌ No tests | Low priority |
| **perf-web** | app | ❌ Jest configured but no tests | Low priority |
| **performance-dashboard** | app | ❌ No tests | Low priority |
| **performance** | app | ⚠️ Special case (testing framework itself) | N/A |

---

## CI/CD Test Execution

### Current CI Workflows Analysis

We analyzed 4 GitHub Actions workflows:
1. `.github/workflows/dev-desktop.yml` - Desktop dev builds
2. `.github/workflows/dev-docker-images.yml` - Docker dev builds
3. `.github/workflows/release-desktop.yml` - Desktop releases
4. `.github/workflows/release-docker-images.yml` - Docker releases

### What Tests Run in CI

#### All 4 Workflows Run:
```yaml
- name: Run tests
  run: yarn test  # = yarn web:test && yarn shared:test && yarn desktop:test:unit
```

**This includes:**
- ✅ Web app unit tests (1 file)
- ✅ Web app integration tests (2 files)
- ✅ Shared package unit tests (10 files)
- ✅ Desktop app unit tests (2 files)
- ✅ Notify app unit tests (2 files - via shared)

#### Docker Workflows Additionally Run:
```yaml
- name: Run Backend tests
  run: go test ./backend/...

- name: Run integration tests
  run: cd tests && yarn test
```

**This includes:**
- ✅ Go backend unit tests
- ✅ Go backend race condition tests
- ✅ Integration tests in `/tests` workspace

### What Tests DON'T Run in CI

#### Critical Missing Tests:

1. **Desktop E2E Tests** ❌
   - **Files exist:** 4 E2E test files in `frontend/apps/desktop/tests/`
   - **Command:** `yarn desktop:test:only`
   - **Impact:** Onboarding flows, home page navigation untested in CI
   - **Why missing:** Desktop workflows only run `yarn test` (unit tests)

2. **Editor E2E Tests** ❌
   - **Files exist:** 3 E2E test files with 1,301 lines of tests
   - **Command:** `yarn workspace @shm/editor test:e2e`
   - **Impact:** Copy/paste, text formatting, block manipulation untested in CI
   - **Why missing:** No workflow includes editor E2E tests

3. **UI Component Tests** ❌
   - **Files exist:** None (no tests written)
   - **Impact:** Shared UI components have zero test coverage
   - **Why missing:** No tests exist to run

---

## Critical Gaps

### 1. Desktop E2E Tests Not Running in CI
**Severity:** 🔴 Critical

**Problem:** You have 4 E2E test files for desktop app testing onboarding flows and navigation, but they never run in CI.

**Risk:**
- Broken onboarding flows could ship to production
- Account import/recovery could fail silently
- Device pairing could break without detection

**Solution:** Add to `dev-desktop.yml` and `release-desktop.yml`:
```yaml
frontend-tests:
  runs-on: ubuntu-latest
  steps:
    # ... existing steps ...
    - name: Install Playwright browsers
      run: yarn workspace @shm/desktop playwright install chromium

    - name: Run Desktop E2E Tests
      run: yarn desktop:test:only
```

---

### 2. Editor E2E Tests Not Running in CI
**Severity:** 🔴 Critical

**Problem:** Editor package has 1,301 lines of comprehensive E2E tests that never run in CI.

**Risk:**
- Copy/paste functionality could break (815 LOC of tests unused)
- Text formatting toolbar could fail
- Block manipulation could regress

**Solution:** Add to docker workflows (since web app uses editor):
```yaml
frontend-tests:
  runs-on: ubuntu-latest
  steps:
    # ... existing steps ...
    - name: Install Playwright browsers for editor
      run: yarn workspace @shm/editor playwright install chromium

    - name: Run Editor E2E Tests
      run: yarn workspace @shm/editor test:e2e
```

---

### 3. UI Package Has Zero Test Coverage
**Severity:** 🔴 Critical

**Problem:** Shared UI components package used across all apps has no tests.

**Risk:**
- Button component breaks → all apps break
- Form component regression → every form in every app breaks
- No way to catch regressions before they affect multiple apps

**Solution:** Implement component testing with Vitest + React Testing Library

**Step 1: Add dependencies**
```bash
yarn workspace @shm/ui add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event vitest
```

**Step 2: Create vitest config**
```typescript
// frontend/packages/ui/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
  },
})
```

**Step 3: Write component tests**
```typescript
// frontend/packages/ui/src/Button.test.tsx
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

test('renders button with text', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole('button')).toHaveTextContent('Click me')
})

test('handles click events', async () => {
  const handleClick = vi.fn()
  render(<Button onClick={handleClick}>Click</Button>)
  await userEvent.click(screen.getByRole('button'))
  expect(handleClick).toHaveBeenCalledOnce()
})
```

---

### 4. Web App Has Minimal Test Coverage
**Severity:** 🟡 Medium

**Problem:** Primary user-facing web app has only 3 test files (1 unit, 2 integration), no E2E.

**Risk:**
- User flows (view document, navigate, interact) untested
- Regressions in key features won't be caught

**Solution:** Add Playwright E2E tests for critical paths
```typescript
// frontend/apps/web/tests/critical-paths.e2e.ts
import { test, expect } from '@playwright/test'

test('user can view a document', async ({ page }) => {
  await page.goto('/d/abc123')
  await expect(page.locator('article')).toBeVisible()
})

test('user can navigate between pages', async ({ page }) => {
  await page.goto('/')
  await page.click('a[href="/explore"]')
  await expect(page).toHaveURL(/\/explore/)
})
```

---

### 5. Email App Has No Template Testing
**Severity:** 🟡 Medium

**Problem:** Email templates have no tests. Broken emails are embarrassing and hard to catch.

**Solution:** Add snapshot testing
```typescript
// frontend/apps/emails/src/templates/__tests__/welcome.test.tsx
import { render } from '@testing-library/react'
import { WelcomeEmail } from '../welcome'

test('welcome email matches snapshot', () => {
  const { container } = render(<WelcomeEmail userName="John" />)
  expect(container.innerHTML).toMatchSnapshot()
})

test('includes user name', () => {
  const { container } = render(<WelcomeEmail userName="Jane" />)
  expect(container.textContent).toContain('Jane')
})
```

---

## Recommendations by Package

### High Priority (Do Now)

#### 1. Add Desktop E2E to CI ⚡️
**Effort:** Low (tests exist, just add to CI)
**Impact:** High (catch broken onboarding flows)

**Action:**
```yaml
# In .github/workflows/dev-desktop.yml and release-desktop.yml
- name: Install Playwright browsers
  run: yarn workspace @shm/desktop playwright install chromium

- name: Run Desktop E2E Tests
  run: yarn desktop:test:only
```

---

#### 2. Add Editor E2E to CI ⚡️
**Effort:** Low (tests exist, just add to CI)
**Impact:** High (catch editor regressions)

**Action:**
```yaml
# In .github/workflows/dev-docker-images.yml and release-docker-images.yml
- name: Install Playwright browsers for editor
  run: yarn workspace @shm/editor playwright install chromium

- name: Run Editor E2E Tests
  run: yarn workspace @shm/editor test:e2e
```

---

#### 3. Implement UI Component Testing ⚡️
**Effort:** Medium (need to write tests)
**Impact:** Critical (shared across all apps)

**Step-by-step:**

1. **Add dependencies:**
```bash
yarn workspace @shm/ui add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event vitest jsdom
```

2. **Create vitest config:**
```typescript
// frontend/packages/ui/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test-setup.ts',
  },
})
```

3. **Create test setup:**
```typescript
// frontend/packages/ui/test-setup.ts
import '@testing-library/jest-dom'
```

4. **Add test script:**
```json
// frontend/packages/ui/package.json
{
  "scripts": {
    "test": "vitest run",
    "test:w": "vitest"
  }
}
```

5. **Write tests for priority components:**
   - Buttons
   - Form inputs
   - Layout components
   - Modals/dialogs
   - Dropdowns/menus

**Example test:**
```typescript
// frontend/packages/ui/src/Button.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  test('renders with text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button')).toHaveTextContent('Click me')
  })

  test('handles click events', async () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  test('can be disabled', () => {
    render(<Button disabled>Click</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  test('renders different variants', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole('button')).toHaveClass('primary')

    rerender(<Button variant="secondary">Secondary</Button>)
    expect(screen.getByRole('button')).toHaveClass('secondary')
  })
})
```

---

### Medium Priority (Next Sprint)

#### 4. Add Web App E2E Tests
**Effort:** Medium
**Impact:** High

**Setup:**
```bash
cd frontend/apps/web
yarn add -D @playwright/test
npx playwright init
```

**Configuration:**
```typescript
// frontend/apps/web/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'yarn start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
})
```

**Priority test scenarios:**
- Document viewing
- Navigation between sections
- Search functionality
- User authentication (if applicable)
- Create/edit content flows

---

#### 5. Expand Web App Unit Tests
**Effort:** Medium
**Impact:** Medium

**Current:** Only 3 tests
**Target:** Test all utils, helpers, and critical business logic

**Areas to test:**
- API client functions
- Data transformation utilities
- Validation functions
- State management logic
- Route helpers

---

#### 6. Add Email Template Tests
**Effort:** Low
**Impact:** Medium

**Approach:** Snapshot testing + basic validation

```typescript
// frontend/apps/emails/src/__tests__/templates.test.tsx
import { render } from '@testing-library/react'
import { WelcomeEmail, PasswordResetEmail, NotificationEmail } from '../templates'

describe('Email Templates', () => {
  test('WelcomeEmail renders correctly', () => {
    const { container } = render(<WelcomeEmail userName="John" />)
    expect(container.innerHTML).toMatchSnapshot()
    expect(container.textContent).toContain('John')
  })

  test('PasswordResetEmail includes reset link', () => {
    const { container } = render(<PasswordResetEmail resetUrl="https://example.com/reset" />)
    expect(container.innerHTML).toContain('https://example.com/reset')
  })

  test('NotificationEmail displays notification content', () => {
    const { container } = render(<NotificationEmail content="New message" />)
    expect(container.textContent).toContain('New message')
  })
})
```

---

### Low Priority (Nice to Have)

#### 7. Add Smoke Tests for Landing/Explore Apps
**Effort:** Low
**Impact:** Low

Basic "app doesn't crash" tests:
```typescript
// frontend/apps/landing/src/__tests__/smoke.test.tsx
import { render } from '@testing-library/react'
import App from '../App'

test('landing page renders without crashing', () => {
  render(<App />)
})

test('contains key sections', () => {
  const { container } = render(<App />)
  expect(container.textContent).toContain('Seed')
  expect(container.textContent).toContain('Download')
})
```

---

#### 8. Add Performance Regression Tests to CI
**Effort:** Medium
**Impact:** Medium

**Current:** Performance tests exist but manual/ad-hoc
**Goal:** Run performance tests in CI and fail if metrics regress

---

#### 9. Set Up Test Coverage Reporting
**Effort:** Low
**Impact:** Low-Medium

**Add coverage thresholds:**
```json
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
})
```

**Add to CI:**
```yaml
- name: Generate coverage report
  run: yarn test --coverage

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
```

---

## Test Parallelization Strategy

### Why Parallelize?

**Current CI execution time (estimated):**
- Frontend tests: ~5-10 minutes
- Adding E2E tests: +10-15 minutes
- Total: ~20-25 minutes sequential

**With parallelization:**
- All tests running in parallel: ~10-15 minutes
- **Time savings: ~50%**

---

### Parallelization Levels

#### 1. CI-Level Parallelization (GitHub Actions Matrix)

**Concept:** Run different test suites in parallel jobs

**Implementation:**

```yaml
# .github/workflows/dev-docker-images.yml
jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        test-suite:
          - unit
          - integration
          - e2e-desktop
          - e2e-editor
          - e2e-web

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install dependencies
        run: yarn install

      - name: Run unit tests
        if: matrix.test-suite == 'unit'
        run: yarn test

      - name: Run integration tests
        if: matrix.test-suite == 'integration'
        run: cd tests && yarn test

      - name: Setup and run desktop E2E tests
        if: matrix.test-suite == 'e2e-desktop'
        run: |
          yarn workspace @shm/desktop playwright install chromium
          yarn desktop:test:only

      - name: Setup and run editor E2E tests
        if: matrix.test-suite == 'e2e-editor'
        run: |
          yarn workspace @shm/editor playwright install chromium
          yarn workspace @shm/editor test:e2e

      - name: Setup and run web E2E tests
        if: matrix.test-suite == 'e2e-web'
        run: |
          yarn workspace @shm/web playwright install chromium
          yarn workspace @shm/web test:e2e
```

**Benefits:**
- ✅ Fastest overall CI time
- ✅ Clear separation of test types
- ✅ Easy to identify which suite failed
- ✅ Can scale workers independently

**Drawbacks:**
- ❌ Uses more CI minutes (5 parallel jobs vs 1 sequential)
- ❌ More complex workflow configuration

---

#### 2. Test-Runner Level Parallelization (Vitest)

**Concept:** Let Vitest run test files in parallel

**Current Vitest config:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    // Default: runs tests in parallel across CPU cores
    threads: true,  // or false for sequential
    maxThreads: 4,  // limit parallel workers
  },
})
```

**Already enabled by default** - Vitest runs tests in parallel unless you have shared state issues.

**To control parallelism:**
```bash
# Run with specific number of workers
vitest --threads --maxThreads=4

# Run sequentially (for debugging)
vitest --no-threads

# Run in CI with all available CPUs
vitest --threads --maxThreads=auto
```

---

#### 3. Playwright Test Parallelization

**Concept:** Run E2E test files in parallel

**Current Playwright configs:**

**Desktop (sequential):**
```typescript
// frontend/apps/desktop/playwright.config.ts
export default defineConfig({
  workers: 1,  // Sequential - only 1 worker
  retries: process.env.CI ? 2 : 0,
})
```

**Editor (parallel locally, sequential in CI):**
```typescript
// frontend/packages/editor/playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 1 : undefined,  // 1 in CI, parallel locally
  retries: process.env.CI ? 2 : 0,
})
```

**To enable parallelization:**

```typescript
// playwright.config.ts
export default defineConfig({
  // Run tests in parallel with 4 workers
  workers: 4,

  // Or use percentage of CPU cores
  workers: '50%',  // Use 50% of available CPUs

  // Fully parallel in CI too
  workers: process.env.CI ? 4 : undefined,

  // Number of retries
  retries: process.env.CI ? 2 : 0,

  // Maximum failures before stopping
  maxFailures: process.env.CI ? 10 : undefined,
})
```

**Run with custom workers:**
```bash
# Run with 4 parallel workers
npx playwright test --workers=4

# Run fully parallel (1 worker per test file)
npx playwright test --workers=100%

# Run sequentially (debugging)
npx playwright test --workers=1
```

---

### Recommended Parallelization Strategy

#### Strategy A: Full CI-Level Parallelization (Recommended for Speed)

**Best for:** Minimizing CI time, clear separation of concerns

**Implementation:**

```yaml
name: Frontend Tests (Parallel)

jobs:
  # Matrix strategy: run different test suites in parallel
  frontend-tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false  # Continue even if one suite fails
      matrix:
        include:
          # Unit tests: fastest, run first
          - suite: unit-tests
            command: yarn test
            needs-browsers: false

          # Integration tests
          - suite: integration-tests
            command: cd tests && yarn test
            needs-browsers: true

          # Desktop E2E tests
          - suite: desktop-e2e
            command: yarn desktop:test:only
            needs-browsers: true
            browser-package: "@shm/desktop"

          # Editor E2E tests
          - suite: editor-e2e
            command: yarn workspace @shm/editor test:e2e
            needs-browsers: true
            browser-package: "@shm/editor"

          # Web E2E tests (when implemented)
          - suite: web-e2e
            command: yarn workspace @shm/web test:e2e
            needs-browsers: true
            browser-package: "@shm/web"

    name: ${{ matrix.suite }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install dependencies
        run: yarn install

      - name: Install Playwright browsers
        if: matrix.needs-browsers
        run: |
          if [ "${{ matrix.browser-package }}" != "" ]; then
            yarn workspace ${{ matrix.browser-package }} playwright install chromium --with-deps
          else
            cd tests && yarn test:install-browsers
          fi

      - name: Run ${{ matrix.suite }}
        run: ${{ matrix.command }}

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.suite }}-results
          path: |
            **/test-results/
            **/playwright-report/
```

**Expected CI time:**
- Sequential: ~20-25 minutes
- Parallel: ~8-12 minutes (longest suite determines total time)
- **Savings: ~60%**

---

#### Strategy B: Hybrid Parallelization (Recommended for Cost)

**Best for:** Balancing speed and CI minute usage

**Keep unit tests together, parallelize E2E:**

```yaml
jobs:
  # Job 1: All unit tests (fast)
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: yarn install
      - run: yarn test  # All unit tests together

  # Job 2: Integration tests
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: yarn install
      - run: cd tests && yarn test:install-browsers
      - run: cd tests && yarn test

  # Job 3: All E2E tests in parallel
  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        suite: [desktop, editor]
    steps:
      - uses: actions/checkout@v4
      - run: yarn install
      - name: Install browsers
        run: yarn workspace @shm/${{ matrix.suite }} playwright install chromium
      - name: Run E2E tests
        run: |
          if [ "${{ matrix.suite }}" == "desktop" ]; then
            yarn desktop:test:only
          else
            yarn workspace @shm/${{ matrix.suite }} test:e2e
          fi
```

**Expected CI time:**
- Sequential: ~20-25 minutes
- Hybrid: ~12-15 minutes
- **Savings: ~40-50%, uses fewer CI minutes**

---

#### Strategy C: Sequential with Internal Parallelization (Current + Optimized)

**Best for:** Minimal changes, maximum stability

**Keep single job, enable test-runner parallelization:**

```yaml
jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: yarn install

      # Unit tests (Vitest already runs in parallel)
      - run: yarn test

      # Integration tests
      - run: cd tests && yarn test:install-browsers
      - run: cd tests && yarn test

      # Desktop E2E (enable parallel workers)
      - run: yarn workspace @shm/desktop playwright install chromium
      - run: yarn desktop:test:only
        env:
          PLAYWRIGHT_WORKERS: 4  # Enable parallel execution

      # Editor E2E (already parallel locally)
      - run: yarn workspace @shm/editor playwright install chromium
      - run: yarn workspace @shm/editor test:e2e
        env:
          PLAYWRIGHT_WORKERS: 4
```

**Update Playwright configs:**
```typescript
// frontend/apps/desktop/playwright.config.ts
export default defineConfig({
  workers: process.env.PLAYWRIGHT_WORKERS
    ? parseInt(process.env.PLAYWRIGHT_WORKERS)
    : (process.env.CI ? 2 : 1),  // 2 workers in CI, 1 locally
})
```

**Expected CI time:**
- Sequential: ~20-25 minutes
- Optimized: ~15-18 minutes
- **Savings: ~25-30%**

---

### Comparison of Strategies

| Strategy | CI Time | CI Minutes Used | Complexity | Stability | Recommended For |
|----------|---------|-----------------|------------|-----------|----------------|
| **A: Full Parallel** | 8-12 min | High (5x jobs) | High | Medium | Speed-critical, well-funded CI |
| **B: Hybrid** | 12-15 min | Medium (3x jobs) | Medium | High | **Best balance** ⭐ |
| **C: Optimized Sequential** | 15-18 min | Low (1x job) | Low | High | Cost-conscious, simpler maintenance |

---

### Implementation Steps for Hybrid Strategy (Recommended)

#### Step 1: Create parallelized workflow

```yaml
# .github/workflows/frontend-tests-parallel.yml
name: Frontend Tests (Parallel)

on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: yarn install
      - name: Run unit tests
        run: yarn test
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: unit-test-coverage
          path: coverage/

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: yarn install
      - name: Install Playwright browsers
        run: cd tests && yarn test:install-browsers
      - name: Run integration tests
        run: cd tests && yarn test

  e2e-tests:
    name: E2E Tests - ${{ matrix.suite }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        suite: [desktop, editor]
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: yarn install
      - name: Install Playwright browsers
        run: yarn workspace @shm/${{ matrix.suite }} playwright install chromium --with-deps
      - name: Run E2E tests
        run: |
          if [ "${{ matrix.suite }}" == "desktop" ]; then
            yarn desktop:test:only
          else
            yarn workspace @shm/${{ matrix.suite }} test:e2e
          fi
      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-${{ matrix.suite }}-results
          path: |
            frontend/apps/${{ matrix.suite }}/test-results/
            frontend/apps/${{ matrix.suite }}/playwright-report/
            frontend/packages/${{ matrix.suite }}/test-results/
            frontend/packages/${{ matrix.suite }}/playwright-report/

  # Final check: all tests must pass
  all-tests-passed:
    name: All Tests Passed
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests, e2e-tests]
    steps:
      - run: echo "All tests passed!"
```

#### Step 2: Enable parallel workers in Playwright configs

```typescript
// frontend/apps/desktop/playwright.config.ts
export default defineConfig({
  // Enable 2 workers in CI, 1 locally for stability
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,

  // ... rest of config
})
```

```typescript
// frontend/packages/editor/playwright.config.ts
export default defineConfig({
  // Enable 4 workers in CI (editor tests are more stable)
  workers: process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 2 : 0,

  // ... rest of config
})
```

#### Step 3: Update existing workflows

Reference the new parallel workflow from existing workflows:

```yaml
# .github/workflows/dev-desktop.yml
jobs:
  frontend-tests:
    uses: ./.github/workflows/frontend-tests-parallel.yml
```

#### Step 4: Monitor and optimize

After deployment, monitor:
- Total CI time
- Test flakiness (increase retries if needed)
- CI minute usage
- Test failure patterns

---

### Trade-offs and Considerations

#### Parallelization Benefits
- ✅ Faster feedback loop for developers
- ✅ Shorter CI time = faster deployments
- ✅ Better resource utilization
- ✅ Easier to identify which test suite failed

#### Parallelization Challenges
- ❌ Higher CI minute usage (costs money)
- ❌ More complex workflow configuration
- ❌ Potential for flaky tests (race conditions)
- ❌ Harder to debug (multiple logs to check)

#### When to Use Parallelization
- ✅ CI time is a bottleneck (>15 minutes)
- ✅ You have budget for CI minutes
- ✅ Tests are stable (not flaky)
- ✅ Team is comfortable with matrix strategies

#### When NOT to Use Parallelization
- ❌ Tests are already fast (<5 minutes)
- ❌ Limited CI minute budget
- ❌ Tests are flaky (need to fix stability first)
- ❌ Team prefers simpler workflows

---

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1)
**Goal:** Run existing tests in CI

- [ ] Add desktop E2E tests to CI workflows
- [ ] Add editor E2E tests to CI workflows
- [ ] Verify all tests pass in CI
- [ ] Document how to run tests locally

**Estimated effort:** 4-8 hours
**Expected impact:** Catch 80% more regressions

---

### Phase 2: Critical Coverage (Week 2-3)
**Goal:** Add tests for untested critical packages

- [ ] Set up UI component testing
  - [ ] Add dependencies
  - [ ] Create vitest config
  - [ ] Write tests for 5-10 priority components
- [ ] Add email template snapshot tests
- [ ] Add basic web app E2E tests (2-3 critical flows)

**Estimated effort:** 16-24 hours
**Expected impact:** Cover 90% of critical user paths

---

### Phase 3: Parallelization (Week 4)
**Goal:** Speed up CI

- [ ] Implement hybrid parallelization strategy
- [ ] Update Playwright configs for parallel workers
- [ ] Create parallel test workflow
- [ ] Monitor and optimize for flakiness
- [ ] Update documentation

**Estimated effort:** 8-12 hours
**Expected impact:** 40-50% faster CI time

---

### Phase 4: Full Coverage (Ongoing)
**Goal:** Comprehensive test coverage

- [ ] Expand web app unit tests
- [ ] Add tests for landing/explore apps
- [ ] Set up coverage reporting
- [ ] Add performance regression tests to CI
- [ ] Implement pre-commit hooks

**Estimated effort:** Ongoing
**Expected impact:** 95%+ coverage

---

## Appendix

### A. Test File Inventory

**Total: 24 test files**

**Unit Tests (14 files):**
- Desktop: 2
- Web: 1
- Notify: 2
- Shared: 10

**Integration Tests (2 files):**
- Web: 2

**E2E Tests (7 files):**
- Desktop: 4
- Editor: 3

**No Tests (7 projects):**
- ui, emails, explore, landing, perf-web, performance-dashboard, performance

---

### B. Test Commands Reference

```bash
# Run all unit tests
yarn test

# Run specific workspace tests
yarn web:test
yarn shared:test
yarn workspace @shm/notify test
yarn desktop:test:unit

# Run E2E tests
yarn desktop:test        # Build + E2E
yarn desktop:test:only   # E2E only
yarn workspace @shm/editor test:e2e

# Run integration tests
cd tests && yarn test

# Run with coverage
yarn test --coverage

# Run in watch mode
yarn web:test:w
yarn desktop:test:unit:watch
```

---

### C. CI Workflow Files

1. `.github/workflows/dev-desktop.yml` - Desktop dev builds (weekday schedule + manual)
2. `.github/workflows/dev-docker-images.yml` - Docker dev builds (on push to main)
3. `.github/workflows/release-desktop.yml` - Desktop releases (on tags)
4. `.github/workflows/release-docker-images.yml` - Docker releases (on tags)

---

### D. Useful Testing Resources

**Vitest:**
- Docs: https://vitest.dev
- Config: https://vitest.dev/config/

**Playwright:**
- Docs: https://playwright.dev
- Best Practices: https://playwright.dev/docs/best-practices

**React Testing Library:**
- Docs: https://testing-library.com/react
- Cheatsheet: https://testing-library.com/docs/react-testing-library/cheatsheet

---

### E. Questions & Answers

**Q: Why aren't desktop E2E tests running in CI?**
A: The workflows only run `yarn test` which includes unit tests. Desktop E2E requires `yarn desktop:test:only` which isn't called.

**Q: Will parallelization make tests flaky?**
A: Possibly. E2E tests can be flaky when run in parallel. Mitigation: use retries, isolate test data, ensure proper test cleanup.

**Q: How much will parallelization cost?**
A: GitHub Actions gives 2,000 free minutes/month for private repos. Parallelization uses ~3-5x more minutes but saves developer time.

**Q: Should we parallelize everything?**
A: No. Start with hybrid approach (parallel E2E, sequential unit tests). Monitor and adjust based on results.

**Q: What's the fastest way to improve test coverage?**
A: Run existing E2E tests in CI (desktop + editor). That's 7 test files with 1,500+ lines of tests currently not running.

---

**Document End**

*Last updated: December 17, 2024*
*Next review: After Phase 1 completion*
