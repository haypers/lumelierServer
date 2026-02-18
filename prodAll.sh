#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
cd client && npm run build && cd ..
cd admin && npm run build && cd ..
# Release build: optimized binary, no debug info
cargo build --release
cargo run --release
