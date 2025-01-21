import type {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {SITE_BASE_URL} from "@shm/shared";
import {queryClient} from "~/client";
import {getConfig} from "~/config";
import {parseRequest} from "~/request";

export const loader: LoaderFunction = async ({request}) => {
  const {hostname} = parseRequest(request);
  const config = await getConfig(hostname);
  if (!config) throw new Error(`No config defined for ${hostname}`);
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
