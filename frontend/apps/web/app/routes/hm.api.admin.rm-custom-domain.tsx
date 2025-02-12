import {ActionFunction, json} from "@remix-run/node";
import {z} from "zod";
import {adminSecret, getServiceConfig, rmCustomDomain} from "~/site-config";

const postCustomDomainSchema = z
  .object({
    hostname: z.string(),
    adminSecret: z.string(),
  })
  .strict();

export const action: ActionFunction = async ({request}) => {
  if (request.method !== "POST") {
    return json({message: "Method not allowed"}, {status: 405});
  }
  const data = await request.json();
  const payload = postCustomDomainSchema.parse(data);
  if (payload.adminSecret !== adminSecret || !adminSecret) {
    return json({message: "Invalid admin secret"}, {status: 401});
  }
  const serviceConfig = await getServiceConfig();
  if (!serviceConfig) {
    return json({message: "Service config not found"}, {status: 404});
  }
  await rmCustomDomain(payload.hostname);

  return json({
    message: "Success",
  });
};
