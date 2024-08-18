#!/bin/sh
set -e

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
auto_update=0
profile=""
allow_push="false"
clean_images_cron="0 3 * * * docker rmi \$(docker images | grep -E 'seedhypermedia/' | awk '{print \$3}') # seed site cleanup"
testnet_name=""
password=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10)

usage()
{
    echo "group_deployment script. It links a group [options] hostname"
	echo "   hostname          :Protocol + domain this sice will be served in. Ex.: https://example.com"
    echo "Options"
	echo  "-t --tag T          :Image tag to pull. Latest by default"
	echo  "-g --gateway        :Site behaves as a gateway, storing all data. False by default."
	echo  "-a --auto-update    :Updates containers whenever a new image is available. Disabled by default"
	echo  "-m --monitoring     :Sets up monitoring system"
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
        -g | --gateway )        allow_push="true"
                                ;;
        -t | --tag )            shift
                                tag="$1"
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
curl -s -o ${workspace}/hmsite.yml https://raw.githubusercontent.com/seed-hypermedia/seed/main/docker-compose.yml

install_docker
if [ -n "$profile" ]; then
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

if [ $auto_update -eq 1 ]; then
  docker rm -f autoupdater >/dev/null 2>&1
  if ! (crontab -l 2>/dev/null || true) | grep -q "seed site cleanup"; then
    # Remove any existing cron job for this task, add the new cron job, and install the new crontab
    { crontab -l 2>/dev/null || true; echo "$clean_images_cron"; } | crontab -
  fi
  docker run -d --restart unless-stopped --name autoupdater -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower --include-restarting -i 300 seed-web seed-daemon >/dev/null 2>&1
fi

mkdir -p ~/.seed-site/web
echo "{\"availableRegistrationSecret\": \"$registration_secret\"}" > ~/.seed-site/web/config.json

SEED_P2P_TESTNET_NAME="$testnet_name" SEED_SITE_DNS="$dns" SEED_SITE_TAG="$tag" SEED_SITE_WORKSPACE="${workspace}" SEED_SITE_ALLOW_PUSH="$allow_push" SEED_SITE_HOSTNAME="$hostname" SEED_SITE_MONITORING_WORKDIR="${workspace}/monitoring" SEED_SITE_MONITORING_PORT="$SEED_SITE_MONITORING_PORT" docker compose -f ${workspace}/hmsite.yml --profile "$profile" up -d --pull always --quiet-pull 2> ${workspace}/deployment.log || true

echo "Deployment done. Your secret registration URL is:"
echo "${hostname}/hm/register?secret=${password}"

# rm -f ${workspace}/hmsite.yml
exit 0

# to test this script:

# sh <(curl -sL https://raw.githubusercontent.com/seed-hypermedia/seed/main/website_deployment.sh) https://seed.verse.link --tag main --auto-update --testnet

# to clean the server for new testing, clean up all docker containers, and wipe the workspace:
# docker rm -f $(docker ps -a -q)
# rm -rf ~/.seed-site