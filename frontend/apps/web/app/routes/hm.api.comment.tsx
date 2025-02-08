import {decode as cborDecode} from "@ipld/dag-cbor";
import {ActionFunction, json} from "@remix-run/node";
import {base58} from "@scure/base";
import {
  HMBlockNodeSchema,
  HMTimestampSchema,
  normalizeDate,
  SITE_BASE_URL,
} from "@shm/shared";
import {verifyAuthenticationResponse} from "@simplewebauthn/server";
import {z} from "zod";
import {getUser} from "~/db";

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
  const data = await request.json();
  const payload = createCommentSchema.parse(data);
  console.log("Comment Payload Data", payload);
  const {username, hostname, response} = payload;

  const user = await getUser(username);
  if (!user) throw new Error("User not found");
  const rawClientDataJSON = base58.decode(response.clientDataJSON);
  const clientDataActualJson = new TextDecoder("utf-8").decode(
    rawClientDataJSON
  );
  const clientData = JSON.parse(clientDataActualJson);
  const challengeBytes = new Uint8Array(
    Buffer.from(clientData.challenge, "base64")
  );
  const challengeData = cborDecode(challengeBytes);
  const comment = hmUnsignedCommentSchema.parse(challengeData);
  const commentTime = normalizeDate(comment.createTime);
  if (!commentTime) {
    throw new Error("Invalid comment time");
  }
  // make sure comment time is within the last 2 minutes (to account for server time drift + network + 60sec signature timeout)
  if (commentTime?.getTime() < Date.now() - 2 * 60 * 1000) {
    throw new Error("Comment time is too old");
  }
  const publicKey = base58.decode(user.publicKey);
  const rpid = hostname || stripProtocol(SITE_BASE_URL);
  const verificationData: Parameters<typeof verifyAuthenticationResponse>[0] = {
    credential: {
      id: user.credId,
      counter: 0,
      publicKey,
    },
    response: {
      id: b58toBase64(user.credId),
      rawId: b58toBase64(user.credId),
      type: "public-key",
      response: {
        clientDataJSON: b58toBase64(response.clientDataJSON),
        authenticatorData: b58toBase64(response.authenticatorData),
        signature: b58toBase64(response.signature),
        userHandle: user.username,
      },
      clientExtensionResults: {}, // not sure what this is supposed to be, the library type requires it but it is not used
    },
    expectedChallenge: clientData.challenge,
    expectedOrigin: SITE_BASE_URL,
    expectedRPID: rpid,
  };
  console.log("verificationData", verificationData);
  const {verified, authenticationInfo} =
    await verifyAuthenticationResponse(verificationData);
  if (!verified) throw new Error("Authentication failed");
  console.log("COMMENT VERIFIED. ", {verified, authenticationInfo});
  // TODO: authenticationInfo.newCounter should be saved back to DB, and we should not hardcode counter: 0
  console.log(
    "SAVE THIS TO DAEMON: ",
    JSON.stringify(
      {
        ...comment,
        signature: response.signature,
        signingMetadata: {
          // some of this is redundant.
          clientDataJSON: response.clientDataJSON,
          authenticatorData: response.authenticatorData,
          userHandle: user.username,
          userCredId: user.credId,
          userPubKey: user.publicKey,
          userCounter: authenticationInfo.newCounter,
          origin: SITE_BASE_URL,
          rpid,
        },
      },
      null,
      2
    )
  );
  return json({
    message: "Success",
  });
};

function b58toBase64(b58: string) {
  return base64UrlEncode(Buffer.from(base58.decode(b58)));
}

function base64UrlEncode(data: Buffer) {
  return data
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//, "");
}
