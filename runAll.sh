#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
cd client && npm run build && cd ..
cd admin && npm run build && cd ..
cargo run
