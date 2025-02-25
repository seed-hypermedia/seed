import {queryClient} from "@/client";
import {ActionFunction, json} from "@remix-run/node";
import {HMBlockNodeSchema, HMTimestampSchema} from "@shm/shared";
import {z} from "zod";

const createCommentSchema = z
  .object({
    username: z.string(),
    hostname: z.string().optional(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
    }),
  })
  .strict();

export type CreateCommentPayload = z.infer<typeof createCommentSchema>;

const hmUnsignedCommentSchema = z.object({
  content: z.array(HMBlockNodeSchema),
  createTime: HMTimestampSchema,
});

export type HMUnsignedComment = z.infer<typeof hmUnsignedCommentSchema>;

export const action: ActionFunction = async ({request}) => {
  if (request.method !== "POST") {
    return json({message: "Method not allowed"}, {status: 405});
  }
  if (request.headers.get("Content-Type") !== "application/cbor") {
    return json(
      {message: "Content-Type must be application/cbor"},
      {status: 400}
    );
  }

  const cborData = await request.arrayBuffer();
  // in case we actually want to read the comment in this server:
  // const comment = cborDecode(new Uint8Array(cborData));
  await queryClient.daemon.storeBlobs({
    blobs: [
      {
        data: new Uint8Array(cborData),
      },
    ],
  });

  return json({
    message: "Success",
  });
};
