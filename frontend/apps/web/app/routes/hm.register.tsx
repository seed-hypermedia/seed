import type {ActionFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import {YStack} from "@tamagui/stacks";
import {Heading} from "@tamagui/text";
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
  const data = await request.json();
  const input = registerSchema.parse(data);
  const config = getConfig();
  if (!config.availableRegistrationSecret) {
    throw new Error("Registration is not available");
  }
  if (input.registrationSecret !== config.availableRegistrationSecret) {
    throw new Error("Invalid registration secret");
  }
  // await queryClient.networking.connect({addrs: [input.peerId]});
  await queryClient.networking.connect({
    addrs: input.addrs.map((addr) => `${addr}/p2p/${input.peerId}`),
  });
  await queryClient.daemon.forceSync({});
  await writeConfig({
    registeredAccountUid: input.accountUid,
    sourcePeerId: input.peerId,
  });
  await waitFor(async () => {
    await queryClient.documents.getDocument({account: input.accountUid});
  });
  return json({message: "Success"});
};

export const loader = async ({request}: {request: Request}) => {
  return null;
};

export default function RegisterPage() {
  return (
    <YStack>
      <Heading>Paste this URL into the app</Heading>
    </YStack>
  );
}
