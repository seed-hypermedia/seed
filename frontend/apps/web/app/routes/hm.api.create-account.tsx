import {decode as cborDecode} from "@ipld/dag-cbor";
import {ActionFunction, json} from "@remix-run/node";
import {queryClient} from "~/client";

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
  const payload = cborDecode(new Uint8Array(cborData));
  console.log("CreateAccount IN SERVER", payload);
  const storedResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.genesis.cid,
        data: payload.genesis.data,
      },
      {
        cid: payload.home.cid,
        data: payload.home.data,
      },
      {
        data: payload.ref,
      },
    ],
  });
  console.log("STORED IN SERVER", storedResult);

  return json({
    message: "Success",
  });
};
