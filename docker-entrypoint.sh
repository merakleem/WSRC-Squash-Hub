#!/bin/sh
# The server should not run as root, but the Railway volume is mounted owned
# by root, so a container that starts as the app user cannot open the
# database on it. This starts as root, gives the data directory to the `node`
# user that the base image provides, then drops to that user for the server.
# If dropping privileges is not possible for some reason, it says so and runs
# anyway: a root process beats a club with no app.
set -e

DB_FILE="${DB_PATH:-/app/squash.db}"
DATA_DIR="$(dirname "$DB_FILE")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || echo "entrypoint: could not chown $DATA_DIR" >&2
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  echo "entrypoint: setpriv not found; running as root" >&2
fi

exec "$@"
