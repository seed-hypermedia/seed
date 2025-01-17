import type {ActionFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
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
    const url = new URL(request.url);
    const hostname = request.headers.get("x-forwarded-host") || url.hostname;
    const config = await getConfig(hostname);
    if (!config) throw new Error(`No config defined for ${hostname}`);
    if (!config.availableRegistrationSecret) {
      throw {message: "Registration is not available"};
    }
    if (input.registrationSecret !== config.availableRegistrationSecret) {
      throw {message: "Invalid registration secret"};
    }
    console.log("REGISTERING SITE", JSON.stringify(input, null, 2));
    const addrs = input.addrs.map((addr) => `${addr}/p2p/${input.peerId}`);
    console.log("networking.connect", addrs);
    await queryClient.networking.connect({
      addrs,
    });
    console.log("subscribe");
    await queryClient.subscriptions.subscribe({
      account: input.accountUid,
      path: "",
      recursive: true,
    });
    console.log("writing config for", url.hostname);
    await writeConfig(url.hostname, {
      registeredAccountUid: input.accountUid,
      sourcePeerId: input.peerId,
    });
    console.log("Registration Done.");
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
