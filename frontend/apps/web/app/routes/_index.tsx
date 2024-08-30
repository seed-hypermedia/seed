import {useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {unwrap} from "~/wrapping";

// Remove this if you want the error:
Button;
// seriously, wtf

export const meta = documentPageMeta;

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) throw new Error("No registered account uid");
  return await loadSiteDocument(
    hmId("d", registeredAccountUid, {version, path: []})
  );
};

export default function SiteDocument() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
