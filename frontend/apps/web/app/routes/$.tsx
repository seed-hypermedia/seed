import { useFullRender } from "@/cache-policy";
import { DocumentPage } from "@/document";
import { FeedPage } from "@/feed";
import {
  createInstrumentationContext,
  instrument,
  printInstrumentationSummary,
  setRequestInstrumentationContext,
} from "@/instrumentation.server";
import { GRPCError, loadSiteResource, SiteDocumentPayload } from "@/loaders";
import { defaultPageMeta, defaultSiteIcon } from "@/meta";
import { NoSitePage, NotRegisteredPage } from "@/not-registered";
import { getOptimizedImageUrl } from "@/providers";
import { parseRequest } from "@/request";
import { getConfig } from "@/site-config.server";
import { unwrap, type Wrapped } from "@/wrapping";
import { wrapJSON } from "@/wrapping.server";
import { Code } from "@connectrpc/connect";
import { HeadersFunction } from "@remix-run/node";
import { MetaFunction, Params, useLoaderData } from "@remix-run/react";
import {
  getDocumentTitle,
  hmId,
  hmIdPathToEntityQueryPath,
  hostnameStripProtocol,
} from "@shm/shared";
import { useTx } from "@shm/shared/translation";
import { extractIpfsUrlCid } from "@shm/ui/get-file-url";
import { SizableText } from "@shm/ui/text";

type DocumentPayload = SiteDocumentPayload | "unregistered" | "no-site";

const unregisteredMeta = defaultPageMeta("Welcome to Seed Hypermedia");

// export const links = () => [...documentLinks()]

export const documentPageMeta = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload>;
}): ReturnType<MetaFunction> => {
  const siteDocument = unwrap<SiteDocumentPayload>(data);
  // Use the document's home icon (siteHomeIcon), not the origin site's icon
  const siteHomeIcon = siteDocument?.siteHomeIcon
    ? getOptimizedImageUrl(extractIpfsUrlCid(siteDocument.siteHomeIcon), "S")
    : null;
  const meta: ReturnType<MetaFunction> = [];

  meta.push({
    tagName: "link",
    rel: "icon",
    href: siteHomeIcon || defaultSiteIcon,
    type: "image/png",
  });

  if (!siteDocument) return meta;

  if (siteDocument.id)
    meta.push({
      name: "hypermedia_id",
      content: siteDocument.id.id,
    });
  if (siteDocument.document) {
    const documentTitle = getDocumentTitle(siteDocument.document);
    const documentDescription = "";
    const imageUrl = `${siteDocument.origin}/hm/api/content-image?space=${
      siteDocument.id.uid
    }&path=${hmIdPathToEntityQueryPath(siteDocument.id.path)}&version=${
      siteDocument.id.version
    }`;
    const currentUrl = `${siteDocument.origin}${
      siteDocument.id.path?.length ? "/" + siteDocument.id.path.join("/") : ""
    }`;
    const domain = hostnameStripProtocol(siteDocument.origin);

    meta.push({ title: documentTitle });
    meta.push({
      name: "description",
      content: documentDescription,
    });

    meta.push({
      property: "og:url",
      content: currentUrl,
    });
    meta.push({
      property: "og:type",
      content: "website",
    });
    meta.push({
      property: "og:title",
      content: documentTitle,
    });
    meta.push({
      property: "og:description",
      content: documentDescription,
    });
    meta.push({
      property: "og:image",
      content: imageUrl,
    });

    // Twitter Meta Tags
    meta.push({
      name: "twitter:card",
      content: "summary_large_image",
    });
    meta.push({
      property: "twitter:domain",
      content: domain,
    });
    meta.push({
      property: "twitter:url",
      content: currentUrl,
    });
    meta.push({
      name: "twitter:title",
      content: documentTitle,
    });
    meta.push({
      name: "twitter:description",
      content: documentDescription,
    });
    meta.push({
      name: "twitter:image",
      content: imageUrl,
    });

    meta.push({
      name: "hypermedia_version",
      content: siteDocument.document.version,
    });
    meta.push({
      name: "hypermedia_title",
      content: documentTitle,
    });
  } else {
    meta.push({ title: "Not Found" });
  }
  return meta;
};

export const meta: MetaFunction<typeof loader> = (args) => {
  const payload = unwrap<DocumentPayload>(args.data);
  if (payload === "unregistered") return unregisteredMeta();
  if (payload === "no-site") return unregisteredMeta();
  return documentPageMeta({
    // @ts-ignore
    data: args.data,
  });
};

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const parsedRequest = parseRequest(request);
  const ctx = createInstrumentationContext(
    parsedRequest.url.pathname,
    request.method
  );

  // Check if this is a data request (client-side navigation) vs document request (full page)
  // Remix single fetch normalizes URLs, so check sec-fetch-mode header
  const isDataRequest = request.headers.get("Sec-Fetch-Mode") === "cors";

  // Store context for SSR phase access (will be retrieved in entry.server.tsx)
  // Only needed for document requests that will go through SSR
  if (!isDataRequest) {
    setRequestInstrumentationContext(request.url, ctx);
  }

  if (!useFullRender(parsedRequest)) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx);
    }
    return null;
  }
  const { url, hostname, pathParts } = parsedRequest;
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const feed = url.searchParams.get("feed") === "true";

  const serviceConfig = await instrument(ctx, "getConfig", () =>
    getConfig(hostname)
  );
  if (!serviceConfig) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx);
    }
    return wrapJSON("no-site", { status: 404 });
  }
  const { registeredAccountUid } = serviceConfig;
  if (!registeredAccountUid) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx);
    }
    return wrapJSON("unregistered", { status: 404 });
  }

  let documentId;

  // Determine document type based on URL pattern
  if (pathParts[0] === "hm" && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...)
    documentId = hmId(pathParts[1], {
      path: pathParts.slice(2),
      version,
      latest,
    });
  } else {
    // Site document (regular path)
    const path = params["*"] ? params["*"].split("/").filter(Boolean) : [];
    documentId = hmId(registeredAccountUid, { path, version, latest });
  }

  const result = await instrument(ctx, "loadSiteResource", () =>
    loadSiteResource(parsedRequest, documentId, {
      prefersLanguages: parsedRequest.prefersLanguages,
      feed,
      instrumentationCtx: ctx,
    })
  );

  // For data requests (client-side nav), print summary here since there's no SSR phase
  if (isDataRequest && ctx.enabled) {
    printInstrumentationSummary(ctx);
  }

  return result;
};

export default function UnifiedDocumentPage() {
  const unwrappedData = useLoaderData();
  const data = unwrap<DocumentPayload>(unwrappedData);
  if (data === "unregistered") {
    return <NotRegisteredPage />;
  }
  if (data === "no-site") {
    return <NoSitePage />;
  }

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return (
      <DaemonErrorPage
        message={data.daemonError.message}
        code={data.daemonError.code}
      />
    );
  }

  // Show feed page if feed param is present
  if (data.feed) {
    return <FeedPage {...data} />;
  }

  return <DocumentPage {...data} />;
}

export function DaemonErrorPage(props: GRPCError) {
  const tx = useTx();
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-2xl flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            {props.code === Code.Unavailable
              ? tx("Internal Server Error")
              : tx("Server Error")}
          </SizableText>

          {props.code === Code.Unavailable ? (
            <SizableText>
              {tx(
                "error_no_daemon_connection",
                `No connection to the backend daemon server. It's probably a bug in our software. Please let us know!`
              )}
            </SizableText>
          ) : null}

          <pre className="text-destructive wrap-break-word whitespace-pre-wrap">
            {props.message}
          </pre>
        </div>
      </div>
    </div>
  );
}
