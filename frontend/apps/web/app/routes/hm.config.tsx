import type {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {getConfig} from "~/config";

export const loader: LoaderFunction = async () => {
  const config = getConfig();

  return json({
    registeredAccountUid: config.registeredAccountUid,
  });
};
