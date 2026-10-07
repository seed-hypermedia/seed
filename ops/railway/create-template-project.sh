#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: WORKSPACE_ID=<id> RAILWAY_API_TOKEN=<token> [REGION=us-west2] %s <project-name>\n' "$0" >&2
  exit 2
}

project_name=${1:-}
workspace_id=${WORKSPACE_ID:-}
region=${REGION:-us-west2}
graphql_url=https://backboard.railway.com/graphql/v2

[[ -n "$project_name" && -n "$workspace_id" && -n "${RAILWAY_API_TOKEN:-}" ]] || usage
if [[ ! "$RAILWAY_API_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'RAILWAY_API_TOKEN may contain only letters, numbers, underscores, and hyphens.\n' >&2
  exit 2
fi
if [[ ! "$project_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  printf 'Project name must use lowercase letters, numbers, and single hyphens.\n' >&2
  exit 2
fi
if [[ ! "$region" =~ ^[a-z0-9-]+$ ]]; then
  printf 'REGION must be a valid Railway region slug.\n' >&2
  exit 2
fi

for dependency in curl jq railway; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$dependency" >&2
    exit 1
  fi
done

graphql() {
  local request=$1
  local encoded_request response status body

  encoded_request=$(jq -Rn --arg request "$request" '$request')
  response=$(
    printf 'url = "%s"\nrequest = "POST"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata = %s\n' \
      "$graphql_url" "$RAILWAY_API_TOKEN" "$encoded_request" |
      curl --config - --silent --show-error --connect-timeout 15 --max-time 60 --write-out $'\n%{http_code}'
  )
  status=${response##*$'\n'}
  body=${response%$'\n'*}

  if ((status < 200 || status >= 300)); then
    printf 'Railway GraphQL returned HTTP %s: ' "$status" >&2
    jq -c '.errors // .message // "request failed"' <<<"$body" >&2 || true
    return 1
  fi
  if jq -e '(.errors // []) | length > 0' <<<"$body" >/dev/null; then
    jq -r '.errors[]?.message' <<<"$body" >&2
    return 1
  fi

  printf '%s\n' "$body"
}

projects_request=$(jq -nc --arg workspace "$workspace_id" '{
  query: "query ListProjects($workspaceId: String, $first: Int) { projects(workspaceId: $workspaceId, first: $first) { edges { node { id name } } } }",
  variables: {workspaceId: $workspace, first: 100}
}')
projects_response=$(graphql "$projects_request")
existing_project_id=$(jq -r --arg name "$project_name" \
  '[.data.projects.edges[].node | select(.name == $name) | .id] | first // empty' <<<"$projects_response")
if [[ -n "$existing_project_id" ]]; then
  if [[ -z "${PROJECT_ID:-}" || "$PROJECT_ID" != "$existing_project_id" ]]; then
    printf 'Project %s already exists in workspace %s; pass its exact PROJECT_ID only to resume a project created by this script.\n' \
      "$project_name" "$workspace_id" >&2
    exit 1
  fi
  project_request=$(jq -nc --arg id "$existing_project_id" '{
    query: "query GetProject($id: String!) { project(id: $id) { id name baseEnvironmentId environments { edges { node { id name } } } services { edges { node { id name } } } } }",
    variables: {id: $id}
  }')
  project_response=$(graphql "$project_request")
  existing_services=$(jq -c '[.data.project.services.edges[].node]' <<<"$project_response")
  if jq -e 'any(.[]; .name != "Seed Daemon" and .name != "Seed Web")' <<<"$existing_services" >/dev/null; then
    printf 'Project %s has unexpected services; refusing to modify it.\n' "$project_name" >&2
    exit 1
  fi
  if jq -e '[.[].name] | length != (unique | length)' <<<"$existing_services" >/dev/null; then
    printf 'Project %s has duplicate service names; refusing to modify it.\n' "$project_name" >&2
    exit 1
  fi
  project_id=$(jq -r '.data.project.id // empty' <<<"$project_response")
  environment_id=$(jq -r \
    '(.data.project.baseEnvironmentId // "") as $base | if $base != "" then $base else ([.data.project.environments.edges[].node | select(.name == "production") | .id] | first // empty) end' \
    <<<"$project_response")
else
  if [[ -n "${PROJECT_ID:-}" ]]; then
    printf 'PROJECT_ID was provided, but no matching project named %s exists in workspace %s.\n' \
      "$project_name" "$workspace_id" >&2
    exit 1
  fi
  project_request=$(jq -nc --arg name "$project_name" --arg workspace "$workspace_id" '{
    query: "mutation CreateProject($input: ProjectCreateInput!) { projectCreate(input: $input) { id name baseEnvironmentId environments { edges { node { id name } } } } }",
    variables: {input: {name: $name, workspaceId: $workspace, defaultEnvironmentName: "production", isPublic: false}}
  }')
  project_response=$(graphql "$project_request")
  existing_services='[]'
  project_id=$(jq -r '.data.projectCreate.id // empty' <<<"$project_response")
  environment_id=$(jq -r \
    '(.data.projectCreate.baseEnvironmentId // "") as $base | if $base != "" then $base else ([.data.projectCreate.environments.edges[].node | select(.name == "production") | .id] | first // empty) end' \
    <<<"$project_response")
fi
if [[ -n "$project_id" && -z "$environment_id" ]]; then
  environment_request=$(jq -nc --arg project "$project_id" '{
    query: "mutation CreateEnvironment($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id name } }",
    variables: {input: {projectId: $project, name: "production", skipInitialDeploys: true}}
  }')
  environment_response=$(graphql "$environment_request")
  environment_id=$(jq -r '.data.environmentCreate.id // empty' <<<"$environment_response")
fi
[[ -n "$project_id" && -n "$environment_id" ]] || {
  printf 'Railway did not return a project and production environment ID.\n' >&2
  exit 1
}

create_service() {
  local name=$1
  local request response id

  request=$(jq -nc --arg name "$name" --arg project "$project_id" --arg environment "$environment_id" '{
    query: "mutation CreateService($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }",
    variables: {input: {name: $name, projectId: $project, environmentId: $environment}}
  }')
  response=$(graphql "$request")
  id=$(jq -r '.data.serviceCreate.id // empty' <<<"$response")
  [[ -n "$id" ]] || {
    printf 'Railway did not return an ID for service %s.\n' "$name" >&2
    return 1
  }
  printf '%s\n' "$id"
}

upsert_variables() {
  local service_id=$1
  local variables=$2
  local request response

  request=$(jq -nc \
    --arg project "$project_id" \
    --arg environment "$environment_id" \
    --arg service "$service_id" \
    --argjson variables "$variables" \
    '{
      query: "mutation UpsertVariables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
      variables: {input: {projectId: $project, environmentId: $environment, serviceId: $service, variables: $variables, skipDeploys: true}}
    }')
  response=$(graphql "$request")
  [[ $(jq -r '.data.variableCollectionUpsert // false' <<<"$response") == true ]] || {
    printf 'Railway did not confirm the variable update for service %s.\n' "$service_id" >&2
    return 1
  }
}

delete_variables() {
  local service_id=$1
  local variable_names=$2
  local existing_variables name request response

  existing_variables=$(RAILWAY_API_TOKEN="$RAILWAY_API_TOKEN" railway variable list \
    --service "$service_id" \
    --environment "$environment_id" \
    --project "$project_id" \
    --json)
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if ! jq -e --arg name "$name" 'has($name)' <<<"$existing_variables" >/dev/null; then
      continue
    fi
    request=$(jq -nc \
      --arg project "$project_id" \
      --arg environment "$environment_id" \
      --arg service "$service_id" \
      --arg name "$name" \
      '{
        query: "mutation DeleteVariable($input: VariableDeleteInput!) { variableDelete(input: $input) }",
        variables: {input: {projectId: $project, environmentId: $environment, serviceId: $service, name: $name}}
      }')
    response=$(graphql "$request")
    [[ $(jq -r '.data.variableDelete // false' <<<"$response") == true ]] || {
      printf 'Railway did not confirm deletion of variable %s from service %s.\n' "$name" "$service_id" >&2
      return 1
    }
  done < <(jq -r '.[]' <<<"$variable_names")
}

ensure_volume() {
  local service_name=$1
  local service_id=$2
  local mount_path=$3
  local volumes existing_count existing_mount_path request response volume_id

  volumes=$(RAILWAY_API_TOKEN="$RAILWAY_API_TOKEN" railway volume \
    --project "$project_id" --environment "$environment_id" list --json)
  existing_count=$(jq --arg service "$service_name" \
    '[.volumes[]? | select(.serviceName == $service)] | length' <<<"$volumes")
  if ((existing_count > 1)); then
    printf 'Service %s has multiple volumes; refusing to add another.\n' "$service_name" >&2
    return 1
  fi
  if ((existing_count == 1)); then
    existing_mount_path=$(jq -r --arg service "$service_name" \
      '.volumes[] | select(.serviceName == $service) | .mountPath' <<<"$volumes")
    if [[ "$existing_mount_path" != "$mount_path" ]]; then
      printf 'Service %s already has a volume mounted at %s, expected %s.\n' \
        "$service_name" "$existing_mount_path" "$mount_path" >&2
      return 1
    fi
    printf 'Volume for %s is already mounted at %s.\n' "$service_name" "$mount_path"
    return
  fi
  request=$(jq -nc \
    --arg project "$project_id" \
    --arg environment "$environment_id" \
    --arg service "$service_id" \
    --arg path "$mount_path" \
    --arg region "$region" \
    '{
      query: "mutation CreateVolume($input: VolumeCreateInput!) { volumeCreate(input: $input) { id name } }",
      variables: {input: {projectId: $project, environmentId: $environment, serviceId: $service, mountPath: $path, region: $region}}
    }')
  response=$(graphql "$request")
  volume_id=$(jq -r '.data.volumeCreate.id // empty' <<<"$response")
  [[ -n "$volume_id" ]] || {
    printf 'Railway did not return a volume ID for %s.\n' "$mount_path" >&2
    return 1
  }
  printf 'Volume %s created for %s at %s (ID %s).\n' \
    "$(jq -r '.data.volumeCreate.name' <<<"$response")" "$service_name" "$mount_path" "$volume_id"
}

update_service() {
  local service_id=$1
  local image=$2
  local start_command=$3
  local healthcheck_path=${4:-}
  local input request response

  input=$(jq -nc \
    --arg image "$image" \
    --arg start "$start_command" \
    --arg region "$region" \
    --arg healthcheck "$healthcheck_path" \
    '{
      source: {image: $image},
      startCommand: $start,
      region: $region,
      numReplicas: 1
    } + {healthcheckPath: $healthcheck}')
  request=$(jq -nc \
    --arg service "$service_id" \
    --arg environment "$environment_id" \
    --argjson input "$input" \
    '{
      query: "mutation UpdateService($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }",
      variables: {serviceId: $service, environmentId: $environment, input: $input}
    }')
  response=$(graphql "$request")
  [[ $(jq -r '.data.serviceInstanceUpdate // false' <<<"$response") == true ]] || {
    printf 'Railway did not confirm the configuration update for service %s.\n' "$service_id" >&2
    return 1
  }
}

deploy_service() {
  local service_id=$1
  local request response deployment_id

  request=$(jq -nc --arg service "$service_id" --arg environment "$environment_id" '{
    query: "mutation DeployService($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }",
    variables: {serviceId: $service, environmentId: $environment}
  }')
  response=$(graphql "$request")
  deployment_id=$(jq -r '.data.serviceInstanceDeployV2 // empty' <<<"$response")
  [[ -n "$deployment_id" ]] || {
    printf 'Railway did not return a deployment ID for service %s.\n' "$service_id" >&2
    return 1
  }
  printf 'Deployment requested for service %s (ID %s).\n' "$service_id" "$deployment_id"
}

daemon_service_id=$(jq -r '[.[] | select(.name == "Seed Daemon") | .id] | first // empty' <<<"$existing_services")
web_service_id=$(jq -r '[.[] | select(.name == "Seed Web") | .id] | first // empty' <<<"$existing_services")
[[ -n "$daemon_service_id" ]] || daemon_service_id=$(create_service "Seed Daemon")
[[ -n "$web_service_id" ]] || web_service_id=$(create_service "Seed Web")

daemon_literal_variables=$(jq -nc '[
  "LIGHTNING_API_URL",
  "SENTRY_DSN",
  "SEED_LOG_LEVEL",
  "SEED_P2P_TESTNET_NAME"
]')
web_literal_variables=$(jq -nc '[
  "DATA_DIR",
  "NOTIFY_SERVICE_HOST",
  "PORT",
  "SEED_ENABLE_STATISTICS",
  "SEED_IS_GATEWAY"
]')
delete_variables "$daemon_service_id" "$daemon_literal_variables"
delete_variables "$web_service_id" "$web_literal_variables"
web_variables=$(jq -nc '{
  RAILWAY_RUN_UID: "${{secret(1, \"0\")}}",
  DAEMON_HTTP_URL: "http://${{Seed Daemon.RAILWAY_PRIVATE_DOMAIN}}:56001",
  SEED_BASE_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
  SEED_ASSET_HOST: "https://${{RAILWAY_PUBLIC_DOMAIN}}"
}')
upsert_variables "$web_service_id" "$web_variables"

ensure_volume "Seed Daemon" "$daemon_service_id" /data
ensure_volume "Seed Web" "$web_service_id" /data

domains_request=$(jq -nc --arg project "$project_id" '{
  query: "query ServiceDomains($id: String!) { project(id: $id) { environments { edges { node { id name serviceInstances { edges { node { id serviceId serviceName region numReplicas startCommand healthcheckPath domains { serviceDomains { id domain targetPort } } latestDeployment { id status } } } } } } } } }",
  variables: {id: $project}
}')
domains_response=$(graphql "$domains_request")
public_domain=$(jq -r --arg service "$web_service_id" --arg environment "$environment_id" \
  '[.data.project.environments.edges[].node | select(.id == $environment) | .serviceInstances.edges[].node | select(.serviceId == $service) | .domains.serviceDomains[] | select(.targetPort == 3000) | .domain] | first // empty' \
  <<<"$domains_response")
if [[ -z "$public_domain" ]]; then
  domain_request=$(jq -nc --arg service "$web_service_id" --arg environment "$environment_id" '{
    query: "mutation CreateDomain($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain targetPort } }",
    variables: {input: {serviceId: $service, environmentId: $environment, targetPort: 3000}}
  }')
  domain_response=$(graphql "$domain_request")
  public_domain=$(jq -r '.data.serviceDomainCreate.domain // empty' <<<"$domain_response")
fi
[[ -n "$public_domain" ]] || {
  printf 'Railway did not return the generated web domain.\n' >&2
  exit 1
}

daemon_start_command=$(printf '%s' "/bin/sh -c 'set -eu
export LIGHTNING_API_URL=\"\${LIGHTNING_API_URL:-https://ln.seed.hyper.media}\"
export SENTRY_DSN=\"\${SENTRY_DSN:-https://47c66bd7a6d64db68a59c03f2337e475@o4504088793841664.ingest.sentry.io/4505527493328896}\"
export SEED_LOG_LEVEL=\"\${SEED_LOG_LEVEL:-info}\"
export SEED_P2P_TESTNET_NAME=\"\${SEED_P2P_TESTNET_NAME:-}\"
: \"\${RAILWAY_TCP_PROXY_DOMAIN:?RAILWAY_TCP_PROXY_DOMAIN must be set by the Railway TCP proxy}\"
: \"\${RAILWAY_TCP_PROXY_PORT:?RAILWAY_TCP_PROXY_PORT must be set by the Railway TCP proxy}\"
exec seed-daemon -data-dir=/data -keystore-dir=/data/keys -lndhub.mainnet -p2p.port=56000 -http.port=56001 -grpc.port=56002 -p2p.no-relay=true -p2p.force-reachability-public=true -syncing.smart=true -syncing.no-sync-back=true -syncing.no-pull=false -p2p.listen-addrs=/ip4/0.0.0.0/tcp/56000,/ip6/::/tcp/56000 -p2p.announce-addrs=/dns4/\$RAILWAY_TCP_PROXY_DOMAIN/tcp/\$RAILWAY_TCP_PROXY_PORT'")
web_start_command=$(printf '%s' "/bin/sh -c 'set -eu
export DATA_DIR=\"\${DATA_DIR:-/data}\"
export NOTIFY_SERVICE_HOST=\"\${NOTIFY_SERVICE_HOST:-https://notify.seed.hyper.media}\"
export PORT=3000
export SEED_ENABLE_STATISTICS=\"\${SEED_ENABLE_STATISTICS:-false}\"
export SEED_IS_GATEWAY=\"\${SEED_IS_GATEWAY:-false}\"
if [ ! -f \"\$DATA_DIR/config.json\" ]; then
  secret=\${SEED_LINK_SECRET:-}
  if [ -z \"\$secret\" ]; then
    secret=\$(node -e \"process.stdout.write(require(\\\"node:crypto\\\").randomBytes(24).toString(\\\"hex\\\"))\")
  fi
  SEED_LINK_SECRET=\"\$secret\" DATA_DIR=\"\$DATA_DIR\" node -e \"const fs=require(\\\"node:fs\\\"); fs.writeFileSync(process.env.DATA_DIR + \\\"/config.json\\\", JSON.stringify({availableRegistrationSecret: process.env.SEED_LINK_SECRET}) + \\\"\\\\n\\\");\"
  printf \"Seed registration link: https://%s/hm/register?secret=%s\\\\n\" \"\$RAILWAY_PUBLIC_DOMAIN\" \"\$secret\"
fi
exec npm run start:prod'")

proxy_list=$(RAILWAY_API_TOKEN="$RAILWAY_API_TOKEN" railway tcp-proxy list \
  --service "$daemon_service_id" \
  --environment "$environment_id" \
  --project "$project_id" \
  --json)
proxy_count=$(jq '.proxies | length' <<<"$proxy_list")
if ((proxy_count > 1)); then
  printf 'Seed Daemon has multiple TCP proxies; refusing to continue.\n' >&2
  exit 1
fi
if ((proxy_count == 1)); then
  proxy_port=$(jq -r '.proxies[0].applicationPort' <<<"$proxy_list")
  if [[ "$proxy_port" != "56000" ]]; then
    printf 'Seed Daemon TCP proxy targets port %s, expected 56000.\n' "$proxy_port" >&2
    exit 1
  fi
  proxy_output=$proxy_list
else
  proxy_output=$(RAILWAY_API_TOKEN="$RAILWAY_API_TOKEN" railway tcp-proxy create \
    --port 56000 \
    --service "$daemon_service_id" \
    --environment "$environment_id" \
    --project "$project_id" \
    --json)
fi
printf 'TCP proxy for Seed Daemon:\n%s\n' "$proxy_output"

update_service "$daemon_service_id" seedhypermedia/site:latest "$daemon_start_command"
update_service "$web_service_id" seedhypermedia/web:latest "$web_start_command"
deploy_service "$daemon_service_id"
deploy_service "$web_service_id"

template_request=$(jq -nc --arg project "$project_id" --arg environment "$environment_id" '{
  query: "mutation GenerateTemplate($input: TemplateGenerateInput!) { templateGenerate(input: $input) { id code name status serializedConfig } }",
  variables: {input: {projectId: $project, environmentId: $environment}}
}')
template_response=$(graphql "$template_request")
template_id=$(jq -r '.data.templateGenerate.id // empty' <<<"$template_response")
template_code=$(jq -r '.data.templateGenerate.code // empty' <<<"$template_response")
[[ -n "$template_id" && -n "$template_code" ]] || {
  printf 'Railway did not return an ID and code for the generated template.\n' >&2
  exit 1
}

printf 'Project: %s (ID %s)\n' "$project_name" "$project_id"
printf 'Environment: production (ID %s)\n' "$environment_id"
printf 'Seed Daemon service ID: %s\n' "$daemon_service_id"
printf 'Seed Web service ID: %s\n' "$web_service_id"
printf 'Web domain: https://%s\n' "$public_domain"
printf 'Unpublished template ID: %s\n' "$template_id"
printf 'Unpublished template URL: https://railway.com/template/%s\n' "$template_code"
printf 'Generate another template from this project with:\n  templateGenerate(input: { projectId: "%s", environmentId: "%s" })\n' \
  "$project_id" "$environment_id"
