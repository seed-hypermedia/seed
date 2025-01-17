import {useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {defaultPageMeta} from "~/meta";
import {NotRegisteredPage} from "~/not-registered";
import {unwrap, wrapJSON, Wrapped} from "~/wrapping";

// Remove this if you want the error:
Button;
// seriously, wtf

const unregisteredMeta = defaultPageMeta("Welcome to Seed Hypermedia");

export const meta = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload | "unregistered">;
}) => {
  const payload = unwrap<SiteDocumentPayload | "unregistered">(data);
  if (payload === "unregistered") return unregisteredMeta();
  return documentPageMeta({data});
};

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url);

  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const waitForSync = url.searchParams.get("waitForSync") !== null;
  const hostname = request.headers.get("x-forwarded-host") || url.hostname;
  const serviceConfig = await getConfig(hostname);
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`);
  const {registeredAccountUid} = serviceConfig;
  if (!registeredAccountUid) return wrapJSON("unregistered");
  return await loadSiteDocument(
    url.hostname,
    hmId("d", registeredAccountUid, {version, path: [], latest}),
    waitForSync
  );
};

export default function SiteDocument() {
  const data = unwrap<SiteDocumentPayload | "unregistered">(useLoaderData());
  if (data === "unregistered") {
    return <NotRegisteredPage />;
  }
  return <DocumentPage {...data} />;
}
