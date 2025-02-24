import {getUser} from "@/db";
import {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/react";

export const loader: LoaderFunction = async ({request, params}) => {
  const url = new URL(request.url);
  const userId = params["*"]?.split("/")[0];

  if (!userId) {
    return json({error: "No user ID provided"}, {status: 400});
  }

  const user = await getUser(userId);

  if (!user) {
    return json({error: "User not found"}, {status: 404});
  }

  return json(user);
};
