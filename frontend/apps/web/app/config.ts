import {readFileSync} from "fs";
import fs from "fs/promises";
import {join} from "path";
import {z} from "zod";

const configPath = join(process.env.DATA_DIR || process.cwd(), "config.json");

const configSchema = z.object({
  availableRegistrationSecret: z.string().optional(),
  sourcePeerId: z.string().optional(),
  registeredAccountUid: z.string().optional(),
});
const configData = readFileSync(configPath, "utf-8");
const configJSON = JSON.parse(configData);
let config = configSchema.parse(configJSON);

export type Config = z.infer<typeof configSchema>;

export function getConfig() {
  return config;
}

export async function writeConfig(newConfig: Config) {
  await fs.writeFile(configPath, JSON.stringify(newConfig));
  config = newConfig;
}

export function getGRPCHost() {
  if (process.env.SITE_GRPC_HOST) {
    return process.env.SITE_GRPC_HOST;
  }
  return "http://localhost:59001";
}
