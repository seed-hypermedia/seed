import {useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {NotRegisteredPage} from "~/not-registered";
import {unwrap, wrapJSON} from "~/wrapping";

// Remove this if you want the error:
Button;
// seriously, wtf

export const meta = documentPageMeta;

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const waitForSync = url.searchParams.get("waitForSync") !== null;
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) return wrapJSON("unregistered");
  return await loadSiteDocument(
    hmId("d", registeredAccountUid, {version, path: []}),
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
