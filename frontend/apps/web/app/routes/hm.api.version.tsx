import type {LoaderFunction} from "@remix-run/node";
import {json} from "@remix-run/node";
import fs from "fs/promises";

async function getVersionInfo() {
  const version = await fs.readFile("VERSION", "utf8");
  const branch = await fs.readFile("BRANCH", "utf8");
  return {version, branch};
}

let versionInfo: Awaited<ReturnType<typeof getVersionInfo>> | null = null;

export const loader: LoaderFunction = async () => {
  if (!versionInfo) {
    versionInfo = await getVersionInfo();
  }
  return json(versionInfo);
};
