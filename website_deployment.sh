#!/bin/sh
set -e

echo "Building images..."

command_exists() {
	command -v "$@" > /dev/null 2>&1
}

install_docker() {
	if ! command_exists docker; then
		curl -fsSL https://get.docker.com -o install-docker.sh
		sh install-docker.sh
		rm install-docker.sh
	fi
}

userid=$(id -u)
workspace="${HOME}/.seed-site"
hostname=""
tag="latest"
log_level="info"
auto_update=0
profile=""
is_gateway="false"
clean_images_cron="0 0,4,8,12,16,20 * * * docker image prune -a -f # prune all unused images"
testnet_name=""
registration_secret=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10)

usage()
{
    echo "site deployment script. It deploys a group [options] hostname. Ready to be registered"
	echo "   hostname          :Protocol + domain this sice will be served in. Ex.: https://example.com"
    echo "Options"
	echo  "-t --tag T          :Image tag to pull. Latest by default"
	echo  "-g --gateway        :Site behaves as a gateway, serves all public data. False by default."
	echo  "-a --auto-update    :Updates containers whenever a new image is available. Disabled by default"
	echo  "-s --astro          :Uses Astro build for web server"
	echo  "-m --monitoring     :Sets up monitoring system"
	echo  "-w --workspace      :To change the localtion of the workspace. Default /home/<user>/.seed-site"
    echo  "-h --help           :Shows help and exit"
}

while [ "$1" != "" ]; do
    case $1 in
        -h | --help )           usage
                                exit
                                ;;
        -a | --auto-update )    auto_update=1
                                ;;
        -m | --monitoring )     profile="metrics"
                                ;;
		-s | --astro )			profile="astro"
                                ;;
        -g | --gateway )        allow_push="true"
                                ;;
        -t | --tag )            shift
                                tag="$1"
                                ;;
        -l | --log-level )      shift
                                log_level="$1"
                                ;;
        -w | --workspace )      shift
                                workspace="$1"
                                ;;
        --testnet )             testnet_name="dev"
                                ;;
        * )                     hostname="$1"
    esac
    shift
done

if [ -z "$hostname" ]; then
  echo "Please enter the hostname"
  exit 1
fi
hostname="${hostname%/}"
mkdir -p ${workspace}
rm -f ${workspace}/deployment.log
touch ${workspace}/deployment.log
curl -s -o ${workspace}/hmsite.yml https://raw.githubusercontent.com/seed-hypermedia/seed/feat/horacio/docker-compose.yml

install_docker
if [ "$profile" = "metrics" ]; then
	mkdir -p ${workspace}/monitoring/grafana/dashboards/libp2p
	mkdir -p ${workspace}/monitoring/grafana/dashboards/seed
	mkdir -p ${workspace}/monitoring/grafana/dashboards/system
	mkdir -p ${workspace}/monitoring/grafana/provisioning/dashboards
	mkdir -p ${workspace}/monitoring/grafana/provisioning/datasources
	mkdir -p ${workspace}/monitoring/prometheus
fi
docker stop seed-site seed-daemon seed-proxy grafana prometheus 2> ${workspace}/deployment.log 1> ${workspace}/deployment.log || true
docker rm seed-site seed-daemon seed-proxy grafana prometheus 2> ${workspace}/deployment.log 1> ${workspace}/deployment.log || true

dns=$(echo "SEED_SITE_HOSTNAME=${hostname}" | sed -n 's/.*SEED_SITE_HOSTNAME=http[s]*:\/\/\([^/]*\).*/\1/p')

mkdir -p ${workspace}/proxy

cat << BLOCK > ${workspace}/proxy/CaddyFile
{\$SEED_SITE_HOSTNAME}

@ipfsget {
	method GET HEAD OPTIONS
	path /ipfs/*
}

reverse_proxy /.metrics* grafana:{\$SEED_SITE_MONITORING_PORT:3001}

reverse_proxy @ipfsget seed-daemon:{\$HM_SITE_BACKEND_GRPCWEB_PORT:56001}

reverse_proxy * seed-web:{\$SEED_SITE_LOCAL_PORT:3000}
BLOCK

mkdir -p ${workspace}/web

site_config_file="${workspace}/web/config.json"

if [ "$auto_update" -eq "1" ]; then
  docker rm -f autoupdater >/dev/null 2>&1
  if ! (crontab -l 2>/dev/null || true) | grep -q "seed site cleanup"; then
    # Remove any existing cron job for this task, add the new cron job, and install the new crontab
    { crontab -l 2>/dev/null || true; echo "$clean_images_cron"; } | crontab -
  fi
  docker run -d --restart unless-stopped --name autoupdater -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower --include-restarting -i 300 seed-web seed-daemon >/dev/null 2>&1
fi

did_init_registration_secret="0"
if [ ! -e "$site_config_file" ]; then
  did_init_registration_secret="1"
  echo "{\"availableRegistrationSecret\": \"$registration_secret\"}" > "$site_config_file"
fi

# this user and group ID align with the ones in /frontend/apps/web/Dockerfile, so web app is allowed to write to the volume
sudo chown -R 1001:1001 "${workspace}/web"

SEED_P2P_TESTNET_NAME="$testnet_name" SEED_LOG_LEVEL="$log_level" SEED_SITE_DNS="$dns" SEED_SITE_TAG="$tag" SEED_SITE_WORKSPACE="${workspace}" SEED_IS_GATEWAY="$is_gateway" SEED_SITE_HOSTNAME="$hostname" SEED_SITE_MONITORING_WORKDIR="${workspace}/monitoring" SEED_SITE_MONITORING_PORT="$SEED_SITE_MONITORING_PORT" docker compose -f ${workspace}/hmsite.yml --profile "$profile" up -d --pull always --quiet-pull 2> ${workspace}/deployment.log || true

echo "===================="
echo "Deployment done."
echo "===================="

if [ "$did_init_registration_secret" -eq "1" ]; then
	echo "Your secret registration URL is:"
	echo "${hostname}/hm/register?secret=${registration_secret}"
	echo "===================="
fi
# rm -f ${workspace}/hmsite.yml
exit 0

# Set up Test Site:
# sh <(curl -sL https://raw.githubusercontent.com/seed-hypermedia/seed/main/website_deployment.sh) https://my.example.domain --tag main --auto-update --testnet

## To Set up Test Gateway:
# sh <(curl -sL https://raw.githubusercontent.com/seed-hypermedia/seed/main/website_deployment.sh) https://test.hyper.media --tag main --auto-update --testnet --gateway

### To clean the server for new testing:
## 1. stop and delete all running docker containers
# docker rm -f $(docker ps -a -q)
## 2. delete old images
# docker image prune -a -f
## 3. wipe the workspace:
# rm -rf ~/.seed-site