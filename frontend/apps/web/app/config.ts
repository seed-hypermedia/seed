import {readFileSync} from "fs";
import fs, {readFile} from "fs/promises";
import {join} from "path";
import {z} from "zod";

export const adminSecret = process.env.SERVICE_ADMIN_SECRET;

const configPath = join(process.env.DATA_DIR || process.cwd(), "config.json");
const serviceConfigPath = join(
  process.env.DATA_DIR || process.cwd(),
  "service-experimental.json"
);

const configSchema = z.object({
  availableRegistrationSecret: z.string().optional(),
  sourcePeerId: z.string().optional(),
  registeredAccountUid: z.string().optional(),
});
export type Config = z.infer<typeof configSchema>;

const serviceConfigSchema = z.object({
  rootHostname: z.string(),
  rootConfig: configSchema,
  namedServices: z.record(z.string(), configSchema),
});
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

const configData = readFileSync(configPath, "utf-8");
const configJSON = JSON.parse(configData);
let config = configSchema.parse(configJSON);

let serviceConfig: ServiceConfig | null = null;
try {
  const serviceConfigData = readFileSync(serviceConfigPath, "utf-8");
  const serviceConfigJSON = JSON.parse(serviceConfigData);
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON);
} catch (e) {
  console.error("Service Config was not loaded", e);
}

export async function getConfig(hostname: string) {
  // the service config takes precedence over the regular config
  if (serviceConfig) {
    if (hostname === serviceConfig.rootHostname)
      return serviceConfig.rootConfig;
    // if the hostname isn't in the format subdomain.rootHostname, return nothing
    const parts = hostname.split(".");
    const rootParts = serviceConfig.rootHostname.split(".");
    if (parts.length !== rootParts.length + 1) return null;
    if (parts.slice(1).join(".") !== serviceConfig.rootHostname) return null;
    // get the subdomain (without the dot)
    const subdomain = parts[0];
    // return the named service config
    return serviceConfig.namedServices[subdomain] || null;
  } else {
    return config;
  }
}

export async function getServiceConfig() {
  return serviceConfig;
}

export async function writeConfig(hostname: string, newConfig: Config) {
  if (serviceConfig) {
    if (hostname === serviceConfig.rootHostname) {
      const newServiceConfig = {
        ...serviceConfig,
        rootConfig: newConfig,
      };
      await writeServiceConfig(newServiceConfig);
    } else {
      // split hostname into parts and validate format subdomain.rootHostname
      const parts = hostname.split(".");
      const rootParts = serviceConfig.rootHostname.split(".");
      if (
        parts.length !== rootParts.length + 1 ||
        parts.slice(1).join(".") !== serviceConfig.rootHostname
      ) {
        throw new Error(
          `Cannot write to service config for hostname ${hostname} - must be in format [subdomain].${serviceConfig.rootHostname}`
        );
      }
      const subdomain = parts[0];
      const newServiceConfig = {
        ...serviceConfig,
        namedServices: {
          ...serviceConfig.namedServices,
          [subdomain]: newConfig,
        },
      };
      await writeServiceConfig(newServiceConfig);
    }
  } else {
    await writeSoloConfig(newConfig);
  }
}

export async function writeSoloConfig(newConfig: Config) {
  await fs.writeFile(configPath, JSON.stringify(newConfig));
  config = newConfig;
}

export async function writeServiceConfig(newConfig: ServiceConfig) {
  await fs.writeFile(serviceConfigPath, JSON.stringify(newConfig));
  serviceConfig = newConfig;
}

export async function reloadServiceConfig() {
  const serviceConfigData = await readFile(serviceConfigPath, "utf-8");
  const serviceConfigJSON = JSON.parse(serviceConfigData);
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON);
}
