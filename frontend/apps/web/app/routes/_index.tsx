import {useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {useFullRender} from "~/cache-policy";
import {DocumentPage, documentPageHeaders, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {logDebug, logDebugTiming} from "~/logger";
import {defaultPageMeta} from "~/meta";
import {NoSitePage, NotRegisteredPage} from "~/not-registered";
import {parseRequest} from "~/request";
import {getConfig} from "~/site-config";
import {unwrap, wrapJSON, Wrapped} from "~/wrapping";

// Remove this if you want the error:
Button;
// seriously, wtf

const unregisteredMeta = defaultPageMeta("Welcome to Seed Hypermedia");

type HomePagePayload = SiteDocumentPayload | "unregistered" | "no-site";

export const meta = ({data}: {data: Wrapped<HomePagePayload>}) => {
  const payload = unwrap<HomePagePayload>(data);
  if (payload === "unregistered") return unregisteredMeta();
  if (payload === "no-site") return unregisteredMeta();
  return documentPageMeta({data});
};

export const headers = documentPageHeaders;

export const loader = async ({request}: {request: Request}) => {
  const parsedRequest = parseRequest(request);
  if (!useFullRender(parsedRequest)) return null;
  const {url, hostname, origin} = parsedRequest;
  const debugTiming = logDebugTiming();
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const serviceConfig = await getConfig(hostname);
  if (!serviceConfig) return wrapJSON("no-site", {status: 404});
  const {registeredAccountUid} = serviceConfig;
  if (!registeredAccountUid) return wrapJSON("unregistered", {status: 404});
  const result = await loadSiteDocument(
    parsedRequest,
    hmId("d", registeredAccountUid, {version, path: [], latest})
  );
  debugTiming("homepage loader resolved");
  return result;
};

export default function SiteDocument() {
  logDebug("homepage render");
  const data = unwrap<HomePagePayload>(useLoaderData());
  if (data === "unregistered") {
    return <NotRegisteredPage />;
  }
  if (data === "no-site") {
    return <NoSitePage />;
  }

  return <DocumentPage {...data} />;
}
