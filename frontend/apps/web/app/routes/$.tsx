import {Params, useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {parseRequest} from "~/request";
import {getConfig} from "~/site-config";
import {unwrap} from "~/wrapping";

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const {url, hostname} = parseRequest(request);
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const waitForSync = url.searchParams.get("waitForSync") !== null;
  const serviceConfig = await getConfig(hostname);
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`);
  const {registeredAccountUid} = serviceConfig;
  if (!registeredAccountUid) throw new Error("No registered account uid");
  const path = (params["*"] || "").split("/");
  return await loadSiteDocument(
    hostname,
    hmId("d", registeredAccountUid, {path, version, latest}),
    waitForSync
  );
};

export default function SiteDocument() {
  // const {"*": path} = useParams();
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
