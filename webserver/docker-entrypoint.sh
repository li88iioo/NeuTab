#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

mkdir -p "$DATA_DIR/icons" "$DATA_DIR/favicon-cache"
chown -R neutab:neutab "$DATA_DIR"

exec su-exec neutab "$@"
