import {ActionFunction, json} from "@remix-run/node";
import {z} from "zod";

const createCommentSchema = z.object({
  // username: z.string(),
  // publicKey: z.string(),
  // credId: z.string(),
});
//   .strict(); // TODODODOODODO

export const action: ActionFunction = async ({request}) => {
  if (request.method !== "POST") {
    return json({message: "Method not allowed"}, {status: 405});
  }
  const data = await request.json();
  console.log("posted comment data", data);
  const payload = createCommentSchema.parse(data);
  console.log(payload);
  //   await createComment(payload);

  return json({
    message: "Success",
  });
};
