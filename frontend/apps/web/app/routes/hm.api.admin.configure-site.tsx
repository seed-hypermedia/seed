import {
  adminSecret,
  getServiceConfig,
  siteConfigSchema,
  writeConfig,
} from "@/site-config";
import {ActionFunction, json} from "@remix-run/node";
import {z} from "zod";

const postServiceSchema = z
  .object({
    name: z.string(),
    adminSecret: z.string(),
    config: siteConfigSchema,
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

  await writeConfig(
    `${payload.name}.${serviceConfig.rootHostname}`,
    payload.config
  );

  return json({
    message: "Success",
  });
};
