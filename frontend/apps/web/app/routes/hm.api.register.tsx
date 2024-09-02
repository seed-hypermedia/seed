import type {ActionFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {hmId} from "@shm/shared";
import {z} from "zod";
import {queryClient} from "~/client";
import {getConfig, writeConfig} from "~/config";

const registerSchema = z.object({
  registrationSecret: z.string(),
  accountUid: z.string(),
  peerId: z.string(),
  addrs: z.array(z.string()),
});

async function waitFor(check: () => Promise<void>, timeBetweenChecks = 1000) {
  while (true) {
    try {
      await check();
      return;
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, timeBetweenChecks));
    }
  }
}

export const action: ActionFunction = async ({request}) => {
  try {
    const data = await request.json();
    const input = registerSchema.parse(data);
    const config = getConfig();
    if (!config.availableRegistrationSecret) {
      throw {message: "Registration is not available"};
    }
    if (input.registrationSecret !== config.availableRegistrationSecret) {
      throw {message: "Invalid registration secret"};
    }
    console.log("REGISTERING SITE", JSON.stringify(input, null, 2));
    const addrs = input.addrs.map((addr) => `${addr}/p2p/${input.peerId}`);
    console.log("networking.connect", addrs);
    try {
      await queryClient.networking.connect({
        addrs,
      });
    } catch (e) {
      console.error("direct connect failed", e);
    }
    console.log("subscribe");
    try {
      await queryClient.subscriptions.subscribe({
        account: input.accountUid,
        path: "",
        recursive: true,
      });
    } catch (e) {
      console.error("subscribe failed", e);
      // probably this was an attempt to create a duplicate subscription, and this error can be ignored
    }
    console.log("discover");
    await queryClient.entities.discoverEntity({
      id: hmId("d", input.accountUid).id,
    });
    console.log("daemon.forceSync");
    await queryClient.daemon.forceSync({});
    console.log("writing config");
    await writeConfig({
      registeredAccountUid: input.accountUid,
      sourcePeerId: input.peerId,
    });
    await waitFor(async () => {
      console.log("querying document", input.accountUid);
      await queryClient.documents.getDocument({account: input.accountUid});
    });
    console.log("Registration succeeded.");
    return json({message: "Success"});
  } catch (e) {
    if (e.toJSON) {
      return json(e, {status: 500});
    } else {
      return json({message: e.message}, {status: 500});
    }
  }
};

export const loader = async ({request}: {request: Request}) => {
  return null;
};
