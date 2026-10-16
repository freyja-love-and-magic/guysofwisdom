#!/usr/bin/env bash
# Stand up the slice of allyabase that guysofwisdom needs (continuebee, fount, bdo, addie) in Docker.
#
#   scripts/base-up.sh            start (or reuse) the container
#   scripts/base-up.sh --recreate remove and recreate the container (data volumes are kept)
#   scripts/base-up.sh down       stop and remove the container (data volumes are kept)
#   scripts/base-up.sh logs       follow the container's logs
#
# Needs docker/addie.env with your Stripe keys (see docker/addie.env.template).
# Uses the existing `allyabase` image, and mounts the local addie source over the image's copy so
# local changes (the payment status route) apply. Host ports: BDO 23003, addie 23005.
# Env: ADDIE_SRC (local addie repo), BDO_PORT, ADDIE_PORT.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ADDIE_SRC="${ADDIE_SRC:-$(cd "$HERE/.." && pwd)/addie}"
BDO_PORT="${BDO_PORT:-23003}"
ADDIE_PORT="${ADDIE_PORT:-23005}"
CONTAINER="guysofwisdom-allyabase"
IMAGE="allyabase"
ENV_FILE="${ENV_FILE:-$HERE/docker/addie.env}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"
DOCKER_TIMEOUT="${DOCKER_TIMEOUT:-120}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

docker_running() { docker info >/dev/null 2>&1; }

ensure_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker isn't installed."
  docker_running && return 0
  if [[ "$(uname)" == "Darwin" && -d /Applications/Docker.app ]]; then
    say "Starting Docker Desktop (up to ${DOCKER_TIMEOUT}s)..."
    open -a Docker
    local waited=0
    until docker_running; do
      (( waited >= DOCKER_TIMEOUT )) && die "Docker didn't come up in ${DOCKER_TIMEOUT}s."
      sleep 2; waited=$((waited + 2))
    done
    return 0
  fi
  die "Start Docker and run this again."
}

container_state() { docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true; }

check_keys() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE; copy docker/addie.env.template and add your Stripe test keys"
  grep -Eq '^STRIPE_KEY=sk_(test|live)_[A-Za-z0-9]+' "$ENV_FILE" || die "STRIPE_KEY in $ENV_FILE isn't set to a Stripe secret key"
  grep -Eq '^STRIPE_PUBLISHING_KEY=pk_(test|live)_[A-Za-z0-9]+' "$ENV_FILE" || die "STRIPE_PUBLISHING_KEY in $ENV_FILE isn't set to a Stripe publishable key"
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

run_container() {
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "no '$IMAGE' image; build it from allyabase/deployment/docker first"
  [[ -f "$ADDIE_SRC/src/server/node/addie.js" ]] || die "no addie source at $ADDIE_SRC (set ADDIE_SRC)"
  for p in "$BDO_PORT" "$ADDIE_PORT"; do
    port_busy "$p" && die "host port $p is already in use (set BDO_PORT / ADDIE_PORT)"
  done
  local node=/usr/src/app
  docker run -d --name "$CONTAINER" \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${BDO_PORT}:3003" -p "127.0.0.1:${ADDIE_PORT}:3005" \
    -v "$HERE/docker/start.sh:$node/start.sh:ro" \
    -v "$ADDIE_SRC/src/server/node/addie.js:$node/addie/src/server/node/addie.js:ro" \
    -v "$ADDIE_SRC/src/server/node/src:$node/addie/src/server/node/src:ro" \
    -v gow-continuebee-data:$node/continuebee/src/server/node/data \
    -v gow-fount-data:$node/fount/src/server/node/data \
    -v gow-bdo-data:$node/bdo/src/server/node/data \
    -v gow-addie-data:$node/addie/src/server/node/data \
    "$IMAGE" >/dev/null
}

# addie answers with a JSON error for an unsigned request; connection refused means it isn't up
addie_up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${ADDIE_PORT}/user/x"; }
bdo_up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${BDO_PORT}/user/x/bdo"; }

wait_ready() {
  say "Waiting for addie and bdo (up to ${READY_TIMEOUT}s)..."
  local waited=0
  until addie_up && bdo_up; do
    [[ "$(container_state)" == "running" ]] || { docker logs --tail 30 "$CONTAINER" >&2 || true; die "the container stopped while starting"; }
    (( waited >= READY_TIMEOUT )) && { docker logs --tail 40 "$CONTAINER" >&2 || true; die "not ready after ${READY_TIMEOUT}s"; }
    sleep 3; waited=$((waited + 3))
  done
}

up() {
  ensure_docker
  check_keys
  local state; state="$(container_state)"
  if [[ "${1:-}" == recreate && -n "$state" ]]; then
    docker rm -f "$CONTAINER" >/dev/null; state=""
  fi
  case "$state" in
    running) say "$CONTAINER is already running." ;;
    "")      run_container ;;
    *)       docker start "$CONTAINER" >/dev/null ;;
  esac
  wait_ready
  say "allyabase is up."
  say "export BDO_URL=http://127.0.0.1:${BDO_PORT}/ ADDIE_URL=http://127.0.0.1:${ADDIE_PORT}/"
}

case "${1:-up}" in
  up)          up ;;
  --recreate)  up recreate ;;
  down)        ensure_docker; docker rm -f "$CONTAINER" >/dev/null 2>&1 && say "Removed $CONTAINER." || say "$CONTAINER wasn't there." ;;
  logs)        ensure_docker; docker logs -f "$CONTAINER" ;;
  *)           die "usage: $0 [up|--recreate|down|logs]" ;;
esac
