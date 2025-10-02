# Web Performance Testing Tool

A tool for measuring and monitoring web performance metrics for our web
applications.

## Overview

This tool uses Lighthouse to measure performance metrics for both our web
application and landing page. It focuses on Core Web Vitals and other key
performance indicators, running tests against both mobile and desktop
configurations.

## Features

- Automated performance testing for web applications
- Mobile and desktop device emulation
- Core Web Vitals measurement:
  - Largest Contentful Paint (LCP)
  - Interaction to Next Paint (INP)
  - Cumulative Layout Shift (CLS)
- Additional metrics:
  - Time to First Byte (TTFB)
  - Page Load Time
  - Page Size
  - Request Count
- Performance budgets enforcement
- JSON report generation
- CI/CD integration

## Prerequisites

- Node.js 18 or higher
- Yarn package manager
- Chrome/Chromium browser (for Lighthouse)

## Installation

```bash
# Install dependencies
yarn
```

## Usage

### Running Tests

Test a specific application:

```bash
# Test web app
yarn test web

# Test landing page
yarn test landing
```

Test both applications:

```bash
# Test both web app and landing page
yarn test all
```

### Configuration

Performance budgets and other settings can be configured in `src/config.ts`:

```typescript
export const performanceBudgets = {
  mobile: {
    lcp: 2500, // ms
    inp: 100, // ms
    cls: 0.1, // score
    ttfb: 800, // ms
    requests: 50, // count
    size: 500000, // bytes
  },
  desktop: {
    lcp: 2000, // ms
    inp: 80, // ms
    cls: 0.1, // score
    ttfb: 400, // ms
    requests: 50, // count
    size: 1000000, // bytes
  },
}
```

### Test Results

Results are stored in the `results` directory:

```
results/
├── web/
│   ├── index.json                           # Index of all web app test runs
│   └── 2025-05-22T14-26-03-919Z.json       # Individual test results
└── landing/
    ├── index.json                           # Index of all landing page test runs
    └── 2025-05-22T14-41-00-803Z.json       # Individual test results
```

### Viewing Results

Results can be viewed in the performance dashboard:

1. Copy results to the dashboard:

   ```bash
   cd ../performance-dashboard
   yarn copy-results
   ```

2. Start the dashboard:

   ```bash
   yarn dev
   ```

3. Navigate to the Web or Landing sections to view the results

## CI/CD Integration

The tool is integrated into our CI/CD pipelines:

- Web app: Tests run before Docker image build
- Landing page: Tests run before SCP deployment

### GitHub Actions Configuration

```yaml
- name: Run Performance Tests
  run: |
    yarn test web      # For web app workflow
    yarn test landing  # For landing page workflow
```

## Troubleshooting

### Common Issues

1. **Chrome not found**: Ensure Chrome/Chromium is installed and accessible

   ```bash
   which chrome || which chromium
   ```

2. **Port conflicts**: Default test ports:

   - Web app: 3000
   - Landing: 4173

   Ensure these ports are available or configure different ports in the
   settings.

3. **Test failures**: Check that the application is running and accessible:

   ```bash
   # Web app
   curl http://localhost:3000

   # Landing page
   curl http://localhost:4173
   ```

### Debug Mode

Run tests with debug output:

```bash
DEBUG=* yarn test web
```

## Contributing

When adding new features or metrics:

1. Update types in `src/types.ts`
2. Add new metrics to performance budgets
3. Update the dashboard to display new metrics
4. Update this documentation
