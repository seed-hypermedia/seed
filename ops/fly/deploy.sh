#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: SITE=<name> [DOMAIN=<custom domain>] [REGION=iad] %s\n' "$0" >&2
  exit 2
}

site=${SITE:-}
region=${REGION:-iad}
org=${FLY_ORG:-personal}
domain=${DOMAIN:-}

[[ -n "$site" ]] || usage
if [[ ! "$site" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || ((${#site} > 56)); then
  printf 'SITE must be a lowercase Fly app-name prefix of at most 56 characters.\n' >&2
  exit 2
fi
if [[ ! "$region" =~ ^[a-z]{3}$ ]]; then
  printf 'REGION must be a three-letter Fly region code.\n' >&2
  exit 2
fi

if [[ -z "$domain" ]]; then
  domain="${site}-web.fly.dev"
elif [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  printf 'DOMAIN must be a lowercase hostname without a scheme, port, or path.\n' >&2
  exit 2
fi

if [[ -n "${FLYCTL:-}" ]]; then
  flyctl=$FLYCTL
elif command -v flyctl >/dev/null 2>&1; then
  flyctl=$(command -v flyctl)
else
  flyctl="$HOME/.fly/bin/flyctl"
fi
if [[ ! -x "$flyctl" ]]; then
  printf 'flyctl was not found; install it or set FLYCTL to its path.\n' >&2
  exit 1
fi

for dependency in grep jq openssl; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$dependency" >&2
    exit 1
  fi
done

daemon_app="${site}-daemon"
web_app="${site}-web"
daemon_volume="seed_daemon_data"
web_volume="seed_web_data"
daemon_config="$(dirname "$0")/daemon/fly.toml"
web_config="$(dirname "$0")/web/fly.toml"
site_url="https://${domain}"
generated_secret=""

ensure_app() {
  local app=$1
  local apps

  apps=$("$flyctl" apps list --org "$org" --json)
  if jq -e --arg app "$app" 'any(.[]; ((.Name // .name) == $app))' <<<"$apps" >/dev/null; then
    printf 'App %s already exists.\n' "$app"
  else
    "$flyctl" apps create "$app" --org "$org" --yes
  fi
}

ensure_volume() {
  local app=$1
  local volume=$2
  local volumes

  volumes=$("$flyctl" volumes list --app "$app" --json)
  if jq -e --arg name "$volume" 'any(.[]; ((.name // .Name) == $name))' <<<"$volumes" >/dev/null; then
    if jq -e --arg name "$volume" --arg region "$region" \
      'any(.[]; ((.name // .Name) == $name) and ((.region // .Region) == $region))' \
      <<<"$volumes" >/dev/null; then
      printf 'Volume %s already exists in %s.\n' "$volume" "$region"
      return
    fi
    printf 'Volume %s already exists for %s outside region %s; refusing to create a second volume.\n' \
      "$volume" "$app" "$region" >&2
    exit 1
  fi

  "$flyctl" volumes create "$volume" --app "$app" --region "$region" --size 1 --yes
}

ensure_dedicated_ipv4() {
  local app=$1
  local ips

  ips=$("$flyctl" ips list --app "$app" --json)
  if jq -e \
    'any(.[]; ((.type // .Type) | ascii_downcase) == "v4" and ((.shared // .Shared // false) == false))' \
    <<<"$ips" >/dev/null; then
    printf 'App %s already has a dedicated IPv4 address.\n' "$app"
    return
  fi

  "$flyctl" ips allocate-v4 --app "$app" --yes
}

ensure_app "$daemon_app"
ensure_app "$web_app"
ensure_volume "$daemon_app" "$daemon_volume"
ensure_volume "$web_app" "$web_volume"
ensure_dedicated_ipv4 "$daemon_app"

if "$flyctl" secrets list --app "$web_app" --json |
  jq -e 'any(.[]; ((.name // .Name) == "SEED_LINK_SECRET"))' >/dev/null; then
  printf 'SEED_LINK_SECRET already exists for %s; keeping it.\n' "$web_app"
else
  generated_secret=$(openssl rand -hex 24)
  printf 'SEED_LINK_SECRET=%s\n' "$generated_secret" |
    "$flyctl" secrets import --app "$web_app" --stage
  printf 'Save this registration link securely; it is printed only when the secret is first created:\n%s/hm/register?secret=%s\n' \
    "$site_url" "$generated_secret"
fi

"$flyctl" deploy "$(dirname "$daemon_config")" \
  --config "$daemon_config" \
  --app "$daemon_app" \
  --ha=false \
  --primary-region "$region" \
  --vm-size shared-cpu-1x \
  --vm-memory 1024 \
  --remote-only \
  --yes \
  --env "SEED_P2P_HOST=${daemon_app}.fly.dev"

"$flyctl" deploy "$(dirname "$web_config")" \
  --config "$web_config" \
  --app "$web_app" \
  --no-cache \
  --ha=false \
  --primary-region "$region" \
  --vm-size shared-cpu-1x \
  --vm-memory 1024 \
  --remote-only \
  --yes \
  --env "DAEMON_HTTP_URL=http://${daemon_app}.internal:56001" \
  --env "SEED_BASE_URL=${site_url}" \
  --env "SEED_ASSET_HOST=${site_url}"

if [[ -n "${DOMAIN:-}" ]]; then
  if "$flyctl" certs list --app "$web_app" --json |
    jq -e --arg domain "$domain" \
      'any(.[]; ((.hostname // .Hostname // .domain // .Domain) == $domain))' >/dev/null; then
    printf 'Certificate for %s already exists.\n' "$domain"
  else
    "$flyctl" certs add "$domain" --app "$web_app"
  fi
  printf 'Create DNS records for %s using the web app addresses below (A for IPv4, AAAA for IPv6):\n' "$domain"
  "$flyctl" ips list --app "$web_app"
fi

printf 'Site URL: %s\n' "$site_url"
if [[ -n "$generated_secret" ]]; then
  printf 'The registration link was printed once above; save it securely.\n'
else
  printf 'The registration secret was preserved. Use the registration link saved when it was first created.\n'
fi
