import type {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {SITE_BASE_URL} from "@shm/shared";
import {queryClient} from "~/client";
import {getConfig} from "~/config";

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url);
  const config = await getConfig(url.hostname);
  if (!config) throw new Error(`No config defined for ${url.hostname}`);
  const daemonInfo = await queryClient.daemon.getInfo({});
  const peerInfo = await queryClient.networking.getPeerInfo({
    deviceId: daemonInfo.peerId,
  });
  return json({
    registeredAccountUid: config.registeredAccountUid,
    peerId: daemonInfo.peerId,
    addrs: peerInfo.addrs,
    hostname: SITE_BASE_URL,
  });
};
