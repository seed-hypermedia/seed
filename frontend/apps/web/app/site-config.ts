import {SITE_BASE_URL} from "@shm/shared";
import {readFileSync} from "fs";
import fs, {readFile} from "fs/promises";
import {join} from "path";
import {z} from "zod";
import {queryClient} from "~/client";

export const adminSecret = process.env.SERVICE_ADMIN_SECRET;

const configPath = join(process.env.DATA_DIR || process.cwd(), "config.json");
const serviceConfigPath = join(
  process.env.DATA_DIR || process.cwd(),
  "service-config.json"
);

export const siteConfigSchema = z.object({
  availableRegistrationSecret: z.string().optional(),
  sourcePeerId: z.string().optional(),
  registeredAccountUid: z.string().optional(),
});
export type SiteConfig = z.infer<typeof siteConfigSchema>;

const serviceConfigSchema = z.object({
  rootHostname: z.string(),
  rootConfig: siteConfigSchema,
  namedServices: z.record(z.string(), siteConfigSchema),
  customDomains: z
    .record(
      z.string(),
      z.object({
        service: z.string(),
      })
    )
    .optional(),
});
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

const configData = readFileSync(configPath, "utf-8");
const configJSON = JSON.parse(configData);
let config = siteConfigSchema.parse(configJSON);

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
    if (serviceConfig.customDomains && serviceConfig.customDomains[hostname]) {
      const customDomain = serviceConfig.customDomains[hostname];
      if (
        customDomain.service &&
        serviceConfig.namedServices[customDomain.service]
      ) {
        return serviceConfig.namedServices[customDomain.service] || null;
      }
    }
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

export async function writeConfig(hostname: string, newConfig: SiteConfig) {
  if (serviceConfig) {
    if (hostname === serviceConfig.rootHostname) {
      const newServiceConfig = {
        ...serviceConfig,
        rootConfig: newConfig,
      };
      await writeServiceConfig(newServiceConfig);
    } else {
      let subdomain: string | null = null;
      if (
        serviceConfig.customDomains &&
        serviceConfig.customDomains[hostname]
      ) {
        subdomain = serviceConfig.customDomains[hostname].service;
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
        subdomain = parts[0];
      }
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
  await applyConfigSubscriptions();
}

export async function applyConfigSubscriptions() {
  const siteAccounts = new Set<string>();
  if (serviceConfig) {
    Object.values(serviceConfig.namedServices).forEach((config) => {
      if (config.registeredAccountUid)
        siteAccounts.add(config.registeredAccountUid);
    });
    if (serviceConfig.rootConfig.registeredAccountUid)
      siteAccounts.add(serviceConfig.rootConfig.registeredAccountUid);
  } else {
    if (config.registeredAccountUid)
      siteAccounts.add(config.registeredAccountUid);
  }
  const subs = await queryClient.subscriptions.listSubscriptions({});
  const toUnsubscribe: {account: string; path: string}[] = [];
  subs.subscriptions.forEach((sub) => {
    if (!siteAccounts.has(sub.account) || sub.path !== "")
      toUnsubscribe.push({account: sub.account, path: sub.path});
  });
  await Promise.all(
    toUnsubscribe.map(async ({account, path}) => {
      console.log("Unsubscribing from ", account, path);
      await queryClient.subscriptions.unsubscribe({
        account,
        path,
      });
    })
  );
  const toSubscribe: {account: string}[] = [];
  siteAccounts.forEach((account) => {
    if (
      !subs.subscriptions.some(
        (sub) => sub.account === account && sub.path === ""
      )
    )
      toSubscribe.push({account});
  });
  await Promise.all(
    toSubscribe.map(async ({account}) => {
      console.log("Subscribing to ", account);
      await queryClient.subscriptions.subscribe({
        account,
        path: "",
        recursive: true,
      });
    })
  );
}

export async function writeCustomDomainConfig(
  hostname: string,
  serviceName: string
) {
  if (!serviceConfig) throw new Error("Service config not loaded");
  await writeServiceConfig({
    ...serviceConfig,
    customDomains: {
      ...serviceConfig.customDomains,
      [hostname]: {service: serviceName},
    },
  });
}

export async function writeSoloConfig(newConfig: SiteConfig) {
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

export function getHostnames() {
  if (serviceConfig) {
    const rootHostname = serviceConfig.rootHostname;
    return [
      rootHostname,
      ...Object.keys(serviceConfig.namedServices).map(
        (subdomain) => `${subdomain}.${rootHostname}`
      ),
    ];
  }
  const baseDomainWithPort = SITE_BASE_URL?.split("://")[1];
  const baseDomain = baseDomainWithPort?.split(":")[0];
  if (!baseDomain) return [];
  return [baseDomain];
}
