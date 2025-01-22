import {ActionFunction, json} from "@remix-run/node";
import {z} from "zod";
import {adminSecret, getServiceConfig, writeConfig} from "~/site-config";

const postServiceSchema = z
  .object({
    name: z.string(),
    adminSecret: z.string(),
  })
  .strict();

export const action: ActionFunction = async ({request}) => {
  if (request.method !== "POST") {
    return json({message: "Method not allowed"}, {status: 405});
  }
  const data = await request.json();
  const payload = postServiceSchema.parse(data);
  if (payload.adminSecret !== adminSecret || !adminSecret) {
    return json({message: "Invalid admin secret"}, {status: 401});
  }
  const serviceConfig = await getServiceConfig();
  if (!serviceConfig) {
    return json({message: "Service config not found"}, {status: 404});
  }
  // generate a 10 character random secret
  const secret = Math.random().toString(36).slice(0, 10);
  await writeConfig(`${payload.name}.${serviceConfig.rootHostname}`, {
    availableRegistrationSecret: secret,
  });

  return json({
    message: "Success",
    secret,
    setupUrl: `https://${payload.name}.${serviceConfig.rootHostname}/hm/register?secret=${secret}`,
  });
};
