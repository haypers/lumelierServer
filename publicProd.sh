set -e
cd "$(dirname "$0")"

# Public preset: simulated server disabled, tab hidden; stricter session/limits (see src/hosting.rs).
export LUMELIER_PRESET=publicProd

ports_in_use() {
  local port="$1"
  ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
}

kill_pids() {
  local pids=("$@")
  if [ "${#pids[@]}" -eq 0 ]; then
    return 0
  fi
  echo "Killing processes: ${pids[*]}"
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 0.5
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

free_ports() {
  local ports=(3002 3003 3010)
  local all_pids=()
  for port in "${ports[@]}"; do
    mapfile -t pids < <(ports_in_use "$port" || true)
    if [ "${#pids[@]}" -gt 0 ]; then
      echo "Port $port is in use by PID(s): ${pids[*]}"
      all_pids+=("${pids[@]}")
    fi
  done
  if [ "${#all_pids[@]}" -gt 0 ]; then
    mapfile -t uniq < <(printf "%s\n" "${all_pids[@]}" | sort -u)
    kill_pids "${uniq[@]}"
  fi
}

free_ports
cd client && npm run build && cd ..
cd admin && npm run build && cd ..
# Release build: optimized binary, no debug info
cargo build --release -p lumelier-server -p lumelier-simulated-server
# Run with preset so server does not start simulated server and admin hides the tab.
# Set both preset and explicit flag so the simulated server stays off even if preset is not inherited.
exec env LUMELIER_PRESET=publicProd LUMELIER_SIMULATED_SERVER_ENABLED=false cargo run --release
