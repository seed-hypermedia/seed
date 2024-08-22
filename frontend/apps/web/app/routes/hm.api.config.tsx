import type {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {queryClient} from "~/client";
import {getConfig} from "~/config";

export const loader: LoaderFunction = async () => {
  const config = getConfig();
  const daemonInfo = await queryClient.daemon.getInfo({});
  const peerInfo = await queryClient.networking.getPeerInfo({
    deviceId: daemonInfo.peerId,
  });
  return json({
    registeredAccountUid: config.registeredAccountUid,
    peerId: daemonInfo.peerId,
    addrs: peerInfo.addrs,
  });
};
