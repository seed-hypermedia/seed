import {ActionFunction, json} from "@remix-run/node";
import {hmId, packHmId} from "@shm/shared";
import {z} from "zod";
import {queryClient} from "~/client";

const discoverSchema = z.object({
  uid: z.string(),
  path: z.array(z.string()),
  version: z.string().optional(),
});

export const action: ActionFunction = async ({request}) => {
  try {
    const data = await request.json();
    const input = discoverSchema.parse(data);
    await queryClient.entities.discoverEntity({
      id: packHmId(
        hmId("d", input.uid, {
          path: input.path,
          version: input.version,
        })
      ),
    });
    return json({message: "Success"});
  } catch (e) {
    if (e.toJSON) {
      return json(e, {status: 500});
    } else {
      return json({message: e.message}, {status: 500});
    }
  }
};
