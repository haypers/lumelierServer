#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
cd client && npm run build && cd ..
cd admin && npm run build && cd ..
# Build main + simulated-server so main can spawn simulated server (port 3003).
# `cargo build` alone only builds the default package; build both workspace packages explicitly.
cargo build -p lumelier-server -p lumelier-simulated-server
cargo run
