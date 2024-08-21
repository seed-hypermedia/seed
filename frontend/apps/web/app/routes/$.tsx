import {Params, useLoaderData} from "@remix-run/react";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadHMDocument} from "~/loaders";

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) throw new Error("No registered account uid");
  // todo, use version "v"
  const path = (params["*"] || "").split("/");
  return await loadHMDocument(registeredAccountUid, path);
};

export default function SiteDocument() {
  // const {"*": path} = useParams();
  const data = useLoaderData<typeof loader>();
  return <DocumentPage {...data} />;
}
