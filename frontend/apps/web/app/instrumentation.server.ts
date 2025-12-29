/**
 * Server-side request instrumentation for performance profiling.
 *
 * Enable with SEED_INSTRUMENTATION=dev environment variable.
 * When enabled, tracks timing of all server operations and prints
 * a hierarchical summary when the request completes.
 */

import { AsyncLocalStorage } from "async_hooks";

// Read env var at runtime, not from bundled constants
// (constants.ts is bundled at build time and won't see runtime env changes)
function isInstrumentationEnabled(): boolean {
  return process.env.SEED_INSTRUMENTATION === "dev";
}

// AsyncLocalStorage to pass context across async boundaries (loader -> SSR)
const instrumentationStorage = new AsyncLocalStorage<InstrumentationContext>();

export type InstrumentationSpan = {
  name: string;
  start: number;
  end?: number;
  children: InstrumentationSpan[];
  parent?: InstrumentationSpan;
};

export type InstrumentationContext = {
  enabled: boolean;
  requestPath: string;
  requestMethod: string;
  root: InstrumentationSpan;
  current: InstrumentationSpan;
};

/**
 * Create a new instrumentation context for a request.
 * Returns a no-op context if instrumentation is disabled.
 */
export function createInstrumentationContext(
  requestPath: string,
  requestMethod: string = "GET"
): InstrumentationContext {
  const root: InstrumentationSpan = {
    name: "request",
    start: performance.now(),
    children: [],
  };
  return {
    enabled: isInstrumentationEnabled(),
    requestPath,
    requestMethod,
    root,
    current: root,
  };
}

/**
 * Start a new span as a child of the current span.
 * Updates ctx.current to the new span.
 */
export function startSpan(ctx: InstrumentationContext, name: string): void {
  if (!ctx.enabled) return;

  const span: InstrumentationSpan = {
    name,
    start: performance.now(),
    children: [],
    parent: ctx.current,
  };
  ctx.current.children.push(span);
  ctx.current = span;
}

/**
 * End the current span and move back to parent.
 */
export function endSpan(ctx: InstrumentationContext): void {
  if (!ctx.enabled) return;

  ctx.current.end = performance.now();
  if (ctx.current.parent) {
    ctx.current = ctx.current.parent;
  }
}

/**
 * Wrap an async function with instrumentation.
 * Automatically starts a span before and ends it after.
 *
 * IMPORTANT: This function captures the parent span at call time to correctly
 * handle parallel operations (Promise.all). Each parallel span becomes a sibling
 * rather than nesting incorrectly.
 */
export async function instrument<T>(
  ctx: InstrumentationContext,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!ctx.enabled) {
    return fn();
  }

  // Capture parent at call time to handle parallel operations correctly
  const parent = ctx.current;
  const span: InstrumentationSpan = {
    name,
    start: performance.now(),
    children: [],
    parent,
  };
  parent.children.push(span);

  // Defer setting current until after synchronous phase completes
  // This allows Promise.all map callbacks to all capture the same parent
  await Promise.resolve();

  // Set as current for any nested instrumentation within fn()
  ctx.current = span;
  try {
    return await fn();
  } finally {
    span.end = performance.now();
    // Restore to parent (not prevCurrent, since parallel siblings may have changed it)
    ctx.current = parent;
  }
}

/**
 * Wrap a sync function with instrumentation.
 */
export function instrumentSync<T>(
  ctx: InstrumentationContext,
  name: string,
  fn: () => T
): T {
  if (!ctx.enabled) {
    return fn();
  }

  startSpan(ctx, name);
  try {
    return fn();
  } finally {
    endSpan(ctx);
  }
}

/**
 * Print the instrumentation summary to console.
 */
export function printInstrumentationSummary(ctx: InstrumentationContext): void {
  if (!ctx.enabled) return;

  // End root span if not already ended
  if (!ctx.root.end) {
    ctx.root.end = performance.now();
  }

  const totalMs = ctx.root.end - ctx.root.start;

  console.log("");
  console.log(`[INSTRUMENTATION] ${ctx.requestMethod} ${ctx.requestPath}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Total: ${totalMs.toFixed(1)}ms`);
  console.log("");

  // Print span tree
  printSpanTree(ctx.root.children, totalMs, "");

  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
}

function printSpanTree(
  spans: InstrumentationSpan[],
  totalMs: number,
  indent: string
): void {
  spans.forEach((span, index) => {
    const isLast = index === spans.length - 1;
    const duration = (span.end || performance.now()) - span.start;
    const percent = ((duration / totalMs) * 100).toFixed(1);

    // Tree characters
    const prefix = indent + (isLast ? "└─ " : "├─ ");
    const childIndent = indent + (isLast ? "   " : "│  ");

    // Format: name + padding + duration + percent
    const namePart = `${prefix}${span.name}`;
    const statsPart = `${duration.toFixed(1)}ms (${percent}%)`;
    const padding = Math.max(1, 50 - namePart.length - statsPart.length);

    console.log(`${namePart}${" ".repeat(padding)}${statsPart}`);

    // Recursively print children
    if (span.children.length > 0) {
      printSpanTree(span.children, totalMs, childIndent);
    }
  });
}

/**
 * Helper to instrument multiple parallel operations.
 * Returns results in same order as input functions.
 */
export async function instrumentParallel<T>(
  ctx: InstrumentationContext,
  name: string,
  fns: Array<{ name: string; fn: () => Promise<T> }>
): Promise<T[]> {
  if (!ctx.enabled) {
    return Promise.all(fns.map((f) => f.fn()));
  }

  startSpan(ctx, name);
  try {
    // Create child spans for each parallel operation
    const promises = fns.map(async ({ name: opName, fn }) => {
      const span: InstrumentationSpan = {
        name: opName,
        start: performance.now(),
        children: [],
        parent: ctx.current,
      };
      ctx.current.children.push(span);
      try {
        const result = await fn();
        span.end = performance.now();
        return result;
      } catch (e) {
        span.end = performance.now();
        throw e;
      }
    });
    return await Promise.all(promises);
  } finally {
    endSpan(ctx);
  }
}

/**
 * Run a function with instrumentation context available via AsyncLocalStorage.
 * Use this to wrap the entire request handler.
 */
export function runWithInstrumentation<T>(
  ctx: InstrumentationContext,
  fn: () => T
): T {
  return instrumentationStorage.run(ctx, fn);
}

/**
 * Get the current instrumentation context from AsyncLocalStorage.
 * Returns undefined if not in an instrumented context.
 */
export function getInstrumentationContext():
  | InstrumentationContext
  | undefined {
  return instrumentationStorage.getStore();
}

/**
 * Store the context for SSR phase access.
 * This is called from the loader to make context available to entry.server.
 */
export function setRequestInstrumentationContext(
  requestUrl: string,
  ctx: InstrumentationContext
): void {
  if (!isInstrumentationEnabled()) return;
  requestContextMap.set(requestUrl, ctx);
}

/**
 * Get context for SSR phase.
 */
export function getRequestInstrumentationContext(
  requestUrl: string
): InstrumentationContext | undefined {
  return requestContextMap.get(requestUrl);
}

/**
 * Clean up context after request completes.
 */
export function clearRequestInstrumentationContext(requestUrl: string): void {
  requestContextMap.delete(requestUrl);
}

// Map to store contexts by request URL (simple approach for SSR phase)
const requestContextMap = new Map<string, InstrumentationContext>();

// Export the runtime check function
export { isInstrumentationEnabled as ENABLE_WEB_INSTRUMENTATION };
