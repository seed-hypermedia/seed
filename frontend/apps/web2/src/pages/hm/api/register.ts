import type {APIRoute} from "astro";
import {readFileSync} from "fs";
import {join} from "path";

const configPath = join(process.env.DATA_DIR || process.cwd(), "config.json");
const configData = configPath ? readFileSync(configPath, "utf-8") : "{}";
const configJSON = JSON.parse(configData);

export const GET: APIRoute = async ({params, request}) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (!secret) {
    return new Response(
      JSON.stringify({error: "Missing required query parameter: secret"}),
      {status: 400, headers: {"Content-Type": "application/json"}}
    );
  }

  if (secret != configJSON.secret) {
    return new Response(
      JSON.stringify({error: "Invalid registration secret"}),
      {status: 400, headers: {"Content-Type": "application/json"}}
    );
  }

  // return new Response(
  //   JSON.stringify({
  //     params,
  //     attrs: url.searchParams.get("secret"),
  //   })
  // );
};
