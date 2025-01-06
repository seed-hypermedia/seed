import {PassThrough} from "node:stream";

import type {AppLoadContext, EntryContext} from "@remix-run/node";
import {createReadableStreamFromReadable} from "@remix-run/node";
import {RemixServer} from "@remix-run/react";
import fs from "fs";
import {mkdir, readFile, stat, writeFile} from "fs/promises";
import * as isbotModule from "isbot";
import {dirname, join, resolve} from "path";
import {renderToPipeableStream} from "react-dom/server";

const ABORT_DELAY = 5_000;

const CACHE_PATH = resolve(
  join(process.env.DATA_DIR || process.cwd(), "cache")
);

function recursiveRm(targetPath: string) {
  if (!fs.existsSync(targetPath)) return;
  if (fs.lstatSync(targetPath).isDirectory()) {
    fs.readdirSync(targetPath).forEach((file) => {
      recursiveRm(join(targetPath, file));
    });
    fs.rmdirSync(targetPath);
  } else {
    fs.unlinkSync(targetPath);
  }
}

let nextWarm: Promise<void> | undefined = undefined;

async function initializeServer() {
  recursiveRm(CACHE_PATH);
  await mkdir(CACHE_PATH, {recursive: true});
  await warmFullCache();
  // warm full cache 45 seconds, but only if the next warm is not already in progress
  setInterval(() => {
    if (nextWarm === undefined) {
      nextWarm = warmFullCache().finally(() => {
        nextWarm = undefined;
      });
    }
  }, 45_000);
}

initializeServer()
  .then(() => {
    console.log("Server initialized and cache warmed");
  })
  .catch((e) => {
    console.error("Error initializing server", e);
  });

async function warmCachePath(path: string) {
  const resp = await fetch(
    `http://localhost:${process.env.PORT || "3000"}${path}`,
    {
      headers: {
        "x-full-render": "true",
      },
    }
  );
  const respHtml = await resp.text();
  const links = new Set<string>();
  const matches = respHtml.match(/href="\/[^"]*"/g) || [];
  for (const match of matches) {
    const url = match.slice(6, -1); // Remove href=" and ending "
    if (url.startsWith("/")) {
      links.add(url);
    }
  }
  // save html to CACHE_PATH with every path is index.html and the path is a directory
  const cachePath = join(CACHE_PATH, path, "index.html");
  if (!respHtml) {
    console.error("respHtml is empty for path", path);
    throw new Error("respHtml is empty for path " + path);
  }
  // create the directory if it doesn't exist
  await mkdir(dirname(cachePath), {recursive: true});
  await writeFile(cachePath, respHtml);
  const contentLinks = new Set(
    Array.from(links).filter((link) => !link.startsWith("/assets"))
  );
  return {
    html: respHtml,
    status: resp.status,
    contentLinks,
  };
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    return false;
  }
}

async function warmFullCache() {
  const pathsToWarm = new Set<string>(["/"]);
  const warmedPaths = new Set<string>();
  // warm paths until we've warmed all paths
  while (pathsToWarm.size > 0) {
    const path = pathsToWarm.values().next().value;
    const {html, status, contentLinks} = await warmCachePath(path);
    pathsToWarm.delete(path);
    warmedPaths.add(path);
    for (const link of contentLinks) {
      if (!warmedPaths.has(link)) {
        pathsToWarm.add(link);
      }
    }
  }
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext
) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/ipfs")) {
    return new Response("Not Found", {
      status: 404,
    });
  }
  if (
    request.headers.get("x-full-render") === "true" ||
    url.pathname.startsWith("/hm") ||
    url.pathname.startsWith("/assets")
  ) {
    return handleFullRequest(
      request,
      responseStatusCode,
      responseHeaders,
      remixContext,
      loadContext
    );
  }

  const cachePath = join(CACHE_PATH, `${url.pathname}/index.html`);
  if (await fileExists(cachePath)) {
    const html = await readFile(cachePath, "utf8");
    responseHeaders.set("Content-Type", "text/html");
    return new Response(html, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  }
  // return warm cache path html
  const {html} = await warmCachePath(url.pathname);
  responseHeaders.set("Content-Type", "text/html");
  return new Response(html, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

export function handleFullRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext
) {
  let prohibitOutOfOrderStreaming =
    isBotRequest(request.headers.get("user-agent")) || remixContext.isSpaMode;

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      );
}

// We have some Remix apps in the wild already running with isbot@3 so we need
// to maintain backwards compatibility even though we want new apps to use
// isbot@4.  That way, we can ship this as a minor Semver update to @remix-run/dev.
function isBotRequest(userAgent: string | null) {
  if (!userAgent) {
    return false;
  }

  // isbot >= 3.8.0, >4
  if ("isbot" in isbotModule && typeof isbotModule.isbot === "function") {
    return isbotModule.isbot(userAgent);
  }

  // isbot < 3.8.0
  if ("default" in isbotModule && typeof isbotModule.default === "function") {
    return isbotModule.default(userAgent);
  }

  return false;
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const {pipe, abort} = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
