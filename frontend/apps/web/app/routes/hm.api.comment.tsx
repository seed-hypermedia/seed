import {queryClient} from "@/client";
import {decode as cborDecode} from "@ipld/dag-cbor";
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
  const comment = cborDecode(new Uint8Array(cborData));
  console.log("COMMENT IN SERVER", comment);
  const storedResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        // cid: comment.id.id,
        data: new Uint8Array(cborData),
      },
    ],
  });
  console.log("STORED IN SERVER", storedResult);

  return json({
    message: "Success",
  });
};
