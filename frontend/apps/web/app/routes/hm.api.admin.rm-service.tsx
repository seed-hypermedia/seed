import {adminSecret, getServiceConfig, rmService} from "@/site-config";
import {ActionFunction, json} from "@remix-run/node";
import {z} from "zod";

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
  console.log("payload", payload);
  await rmService(payload.name);

  return json({
    message: "Success",
  });
};
