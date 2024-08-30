import {Params, useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {unwrap} from "~/wrapping";

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) throw new Error("No registered account uid");
  const path = (params["*"] || "").split("/");
  return await loadSiteDocument(
    hmId("d", registeredAccountUid, {path, version})
  );
};

export default function SiteDocument() {
  // const {"*": path} = useParams();
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
