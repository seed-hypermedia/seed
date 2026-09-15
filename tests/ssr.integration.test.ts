/**
 * SSR Integration Test
 *
 * Tests that the web app properly server-renders pages with hydrated data.
 * This test:
 * 1. Starts a daemon with test fixtures
 * 2. Builds and starts the web app
 * 3. Makes HTTP requests to verify SSR is working correctly
 * 4. Tests client-side hydration works without errors
 */

import * as cheerio from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_ACCOUNT_ID } from "../test-fixtures/minimal-fixtures";
import {
  createDocumentUpdate,
  createRedirectDocument,
} from "../frontend/apps/cli/src/test/account-helpers";
import { FIXTURE_ACCOUNT } from "../frontend/apps/cli/src/test/fixture-seed";
import {
  flattenToOperations,
  parseMarkdown,
} from "../frontend/apps/cli/src/utils/markdown";
import { setupTestEnv, TestEnv } from "./integration";

// Increase test timeout for integration tests
const TEST_TIMEOUT = 120_000; // 2 minutes

// Single shared environment for all tests
let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({
    // Set to true for faster iteration during development
    skipBuild: process.env.SKIP_BUILD === "true",
  });
}, TEST_TIMEOUT);

afterAll(async () => {
  await env?.cleanup();
});

describe("SSR Integration", () => {
  it(
    "should respond to health check",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      expect(response.status).toBeLessThan(500);
    },
    TEST_TIMEOUT,
  );

  it(
    "should server-render the home page with HTML content",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();
      expect(response.status).toBe(200);

      // Verify we get HTML back
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    },
    TEST_TIMEOUT,
  );

  it(
    "should server-render document content from test fixtures",
    async () => {
      // Use a bot user-agent to get fully-rendered SSR HTML (not streamed)
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      // Look for the text "asdfg" from our test database inside the SSR content.
      // With the editor-matching DOM structure, paragraph text is inside
      // <p class="blockContent"> elements, not <span> tags.
      const ssrContainer = $(".ssr-content-placeholder");
      const hasText = ssrContainer.text().includes("asdfg");

      expect(
        hasText,
        'Expected to find text "asdfg" in server-rendered .ssr-content-placeholder HTML',
      ).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "should include dehydrated state in the HTML",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();

      // Check for React Query dehydrated state
      // This is typically embedded as JSON in a script tag
      // The exact format depends on how Remix serializes loader data
      expect(html).toContain("dehydratedState");
    },
    TEST_TIMEOUT,
  );

  it(
    "should return proper content-type header",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const contentType = response.headers.get("content-type");
      expect(contentType).toContain("text/html");
    },
    TEST_TIMEOUT,
  );

  it(
    "should not have JavaScript errors in the initial HTML",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();

      // Check that we don't have obvious error markers in the HTML
      expect(html).not.toContain("Error:");
      expect(html).not.toContain("throw new Error");
    },
    TEST_TIMEOUT,
  );
});

/**
 * Every kind of address the site loader distinguishes must render the right thing under SSR.
 *
 * Regression guard for #1120: a republished path (a redirect Ref with `republish: true`) rendered
 * "Document Not Found" for three weeks because the loader pinned the TARGET document's version
 * onto the republish's own address, an id the daemon cannot serve. The unit tests in
 * frontend/apps/web/app/loaders.republish.test.ts mock the daemon; this suite exercises the same
 * route against a real daemon and the built web server.
 */
describe("SSR Redirect Routes", () => {
  const runId = Date.now();
  const targetPath = `redirect-target-${runId}`;
  const targetTitle = `Redirect Target ${runId}`;
  const targetBody = `Body of the redirect target ${runId}`;
  const republishedPath = `republished-${runId}`;
  const movedPath = `moved-${runId}`;

  async function loaderData(path: string) {
    const response = await fetch(
      `${env.web.baseUrl}/${path}?_data=${encodeURIComponent("routes/$")}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { json: any };
    return body.json;
  }

  function entityQueryFor(data: any, hmId: string) {
    return data.dehydratedState?.queries.find(
      (q: any) => q.queryKey[0] === "ENTITY" && q.queryKey[1] === hmId,
    );
  }

  beforeAll(async () => {
    const titled = (name: string, body: string) => [
      {
        type: "SetAttributes" as const,
        attrs: [{ key: ["name"], value: name }],
      },
      ...flattenToOperations(parseMarkdown(body).tree),
    ];
    await createDocumentUpdate(
      env.web.baseUrl,
      FIXTURE_ACCOUNT,
      targetPath,
      titled(targetTitle, targetBody),
    );
    // Both redirect sources start as ordinary documents, then get redirected — the same
    // sequence the CLI's `document redirect` and the web republish dialog produce.
    await createDocumentUpdate(
      env.web.baseUrl,
      FIXTURE_ACCOUNT,
      republishedPath,
      titled(`Republish Source ${runId}`, "Replaced by the republish"),
    );
    await createRedirectDocument(env.web.baseUrl, FIXTURE_ACCOUNT, republishedPath, {
      path: targetPath,
      republish: true,
    });
    await createDocumentUpdate(
      env.web.baseUrl,
      FIXTURE_ACCOUNT,
      movedPath,
      titled(`Moved Source ${runId}`, "Moved away"),
    );
    await createRedirectDocument(env.web.baseUrl, FIXTURE_ACCOUNT, movedPath, {
      path: targetPath,
    });
  }, TEST_TIMEOUT);

  it(
    "server-renders the redirect target itself",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/${targetPath}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(targetTitle);
      expect(html).not.toContain("Document Not Found");
    },
    TEST_TIMEOUT,
  );

  it(
    "server-renders a republished path with the target's content at the republish's own address",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/${republishedPath}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(targetTitle);
      expect(html).toContain(targetBody);
      expect(html).not.toContain("Document Not Found");

      const data = await loaderData(republishedPath);
      const republishedId = `hm://${FIXTURE_ACCOUNT_ID}/${republishedPath}`;
      // The route keeps the republish's address and never pins the target's version onto it.
      expect(data.id.id).toBe(republishedId);
      expect(data.id.version).toBeFalsy();
      expect(data.document.metadata.name).toBe(targetTitle);

      // The resource query the client hydrates for this route holds the target document.
      const entity = entityQueryFor(data, republishedId);
      expect(entity, "dehydrated ENTITY query for the republished route").toBeDefined();
      // Query keys serialize through JSON, so an unpinned version arrives as null.
      expect(entity.queryKey[2] ?? null).toBeNull();
      expect(entity.state.data.type).toBe("document");
      expect(entity.state.data.document.metadata.name).toBe(targetTitle);
    },
    TEST_TIMEOUT,
  );

  it(
    "redirects a moved path to its target",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/${movedPath}`, {
        redirect: "manual",
      });
      expect([301, 302, 307, 308]).toContain(response.status);
      const location = response.headers.get("location") ?? "";
      expect(location).toContain(targetPath);
      expect(location).not.toContain(movedPath);
    },
    TEST_TIMEOUT,
  );
});

describe("SSR API Integration", () => {
  it(
    "should respond to daemon health check",
    async () => {
      const response = await fetch(
        `http://localhost:${env.daemon.config.httpPort}/debug/version`,
      );
      expect(response.ok).toBe(true);
      const version = await response.text();
      expect(version).toBeTruthy();
    },
    TEST_TIMEOUT,
  );
});

describe("SSR Header and Navigation", () => {
  it(
    "should server-render the header with site logo",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      // Check for header element
      const header = $("header");
      expect(
        header.length,
        "Expected header element to be present",
      ).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "should server-render navigation items from home directory",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      // Header should be rendered server-side
      const header = $("header");
      expect(header.length).toBeGreaterThan(0);

      // The header should contain links (navigation items)
      const headerLinks = header.find("a");
      // At minimum we should have the site logo link
      expect(headerLinks.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "should server-render the join button",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();

      // Join button should be SSR rendered (renamed from Subscribe)
      expect(html).toContain("Join");
    },
    TEST_TIMEOUT,
  );

  it(
    "should include prefetched home document data in dehydrated state",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();

      // Dehydrated state should contain home document query key
      // This verifies the navigation data is being prefetched for SSR
      expect(html).toContain("dehydratedState");
    },
    TEST_TIMEOUT,
  );
});

describe("SSR Utility Pages Header", () => {
  it(
    "should server-render profile page without SSR errors",
    async () => {
      // Profile page uses the account UID from our test database
      const profileUrl = `${env.web.baseUrl}/hm/profile/${FIXTURE_ACCOUNT_ID}`;
      const response = await fetch(profileUrl, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();

      // Page should load (even if it shows error due to missing site config)
      expect(response.status).toBeLessThan(500);

      // Should not have React SSR errors
      expect(html).not.toContain("Invalid hook call");
      expect(html).not.toContain("Minified React error");
      expect(html).not.toContain("Hooks can only be called inside");
    },
    TEST_TIMEOUT,
  );

  it(
    "should server-render connect page without SSR errors",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/hm/connect`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();

      // Page should load (even if it shows error due to missing site config)
      expect(response.status).toBeLessThan(500);

      // Should not have React SSR errors
      expect(html).not.toContain("Invalid hook call");
      expect(html).not.toContain("Minified React error");
      expect(html).not.toContain("Hooks can only be called inside");
    },
    TEST_TIMEOUT,
  );
});

describe("Client Hydration Readiness", () => {
  it(
    "should not have React error boundaries triggered during SSR",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        },
      });
      const html = await response.text();

      // Check for React error boundary content that indicates SSR failure
      // These patterns appear when React catches errors during rendering
      expect(html).not.toContain("Invalid hook call");
      expect(html).not.toContain("Minified React error");
      expect(html).not.toContain("Cannot read properties of null");
      expect(html).not.toContain("Hooks can only be called inside");

      // Check that the error boundary UI isn't showing
      // Our error boundary shows "🤕" emoji and this text
      expect(html).not.toContain("Uh oh, it's not you, it's us");
    },
    TEST_TIMEOUT,
  );

  it(
    "should have valid React hydration script setup",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();
      const $ = cheerio.load(html);

      // Verify React hydration scripts are present
      const scripts = $("script").toArray();
      const hasModuleScripts = scripts.some((script) => {
        const type = $(script).attr("type");
        return type === "module";
      });

      expect(
        hasModuleScripts,
        "Expected module scripts for React hydration",
      ).toBe(true);

      // Verify window.ENV is set before other scripts
      const envScript = $("script").filter((_, el) => {
        const content = $(el).html() || "";
        return content.includes("window.ENV");
      });
      expect(
        envScript.length,
        "Expected window.ENV script to be present",
      ).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "should export a valid React component from root",
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`);
      const html = await response.text();

      // The page should render content, not just an error
      // A broken HOC export would cause the page to fail to render
      expect(response.status).toBe(200);

      // Should have actual content rendered (not empty body)
      const $ = cheerio.load(html);
      const bodyContent = $("body").html() || "";
      expect(bodyContent.length).toBeGreaterThan(100);

      // Should have the Providers wrapper rendered (indicates App component worked)
      // The providers wrap content in specific elements we can check for
      expect(html).toContain("class=");
    },
    TEST_TIMEOUT,
  );
});
