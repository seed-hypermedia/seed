import {useLoaderData} from "@remix-run/react";
import {Button} from "@tamagui/button";
import {getConfig} from "~/config";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadHMDocument} from "~/loaders";

// Remove this if you want the error:
Button;
// seriously, wtf

export const meta = documentPageMeta;

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) throw new Error("No registered account uid");
  // todo, use version "v"
  return await loadHMDocument(registeredAccountUid, []);
};

export default function SiteDocument() {
  const data = useLoaderData<typeof loader>();
  return <DocumentPage {...data} />;
}
