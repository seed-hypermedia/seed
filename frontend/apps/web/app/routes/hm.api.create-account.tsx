import {queryClient} from "@/client";
import {decode as cborDecode} from "@ipld/dag-cbor";
import {ActionFunction, json} from "@remix-run/node";

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
  const storedGenesisResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.genesis.cid,
        data: payload.genesis.data,
      },
    ],
  });
  console.log("saved genesis", storedGenesisResult);
  const storedHomeResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.home.cid,
        data: payload.home.data,
      },
    ],
  });
  console.log("saved home", storedHomeResult);
  const storedRefResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.ref.cid,
        data: payload.ref.data,
      },
    ],
  });
  console.log("saved ref", storedRefResult);

  return json({
    message: "Success",
  });
};
