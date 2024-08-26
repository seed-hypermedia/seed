import {queryClient} from "../../client";

export async function GET({params, request}) {
  const daemonInfo = await queryClient.daemon.getInfo({});
  const peerInfo = await queryClient.networking.getPeerInfo({
    deviceId: daemonInfo.peerId,
  });
  return new Response(
    JSON.stringify({
      peerId: daemonInfo.peerId,
      addrs: peerInfo.addrs,
    })
  );
}
