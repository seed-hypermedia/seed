import type {MetaFunction} from "@remix-run/node";
import {LoaderFunction} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {HMDocument} from "@shm/shared";
import {UIAvatar} from "@shm/ui/src/avatar";
import {Button} from "@tamagui/button";
import {Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {deserialize} from "superjson";
import {getConfig} from "~/config";
import {DocumentPage} from "~/document";
import {loadHMDocument} from "~/loaders";
import {queryClient} from "../client";

// Remove these if you want the error:
queryClient;
UIAvatar;
Button;
Text;
YStack;
// seriously, wtf

export const meta: MetaFunction = ({data}) => {
  const document: HMDocument = deserialize(data.document);
  return [
    {title: document.metadata?.name || "Untitled"},
    // {name: "description", content: "Welcome to Remix!"},
  ];
};

export const loader: LoaderFunction = async ({params, request}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  const {registeredAccountUid} = getConfig();
  if (!registeredAccountUid) throw new Error("No registered account uid");
  // todo, use version "v"
  return await loadHMDocument(registeredAccountUid, []);
};

export default function SiteDocument() {
  const data = useLoaderData<typeof loader>();
  const document: HMDocument = deserialize(data.document);
  return <DocumentPage document={document} />;
}
