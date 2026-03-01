#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ports_in_use() {
  local port="$1"
  # Try ss first (Linux), then netstat (Git Bash on Windows).
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$port" '$0 ~ p && $0 ~ /LISTENING/ {print $NF}' | sort -u
  fi
}

kill_pids() {
  local pids=("$@")
  if [ "${#pids[@]}" -eq 0 ]; then
    return 0
  fi

  echo "Killing processes: ${pids[*]}"
  for pid in "${pids[@]}"; do
    if command -v taskkill >/dev/null 2>&1; then
      taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
    else
      kill -TERM "$pid" 2>/dev/null || true
    fi
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

build_frontend() {
  local app_dir="$1"

  if [ ! -d "$app_dir/node_modules" ]; then
    echo "Installing npm dependencies in $app_dir..."
    (cd "$app_dir" && npm install)
  fi

  (cd "$app_dir" && npm run build)
}

resolve_cargo_bin() {
  if command -v cargo >/dev/null 2>&1; then
    echo "cargo"
    return 0
  fi

  if command -v cargo.exe >/dev/null 2>&1; then
    echo "cargo.exe"
    return 0
  fi

  if [ -x "$HOME/.cargo/bin/cargo.exe" ]; then
    echo "$HOME/.cargo/bin/cargo.exe"
    return 0
  fi

  return 1
}

configure_windows_cargo_target() {
  if ! command -v cmd >/dev/null 2>&1; then
    return 0
  fi

  local local_appdata
  local_appdata="$(cmd //c echo %LOCALAPPDATA% | tr -d '\r')"
  if [ -z "$local_appdata" ] || [ "$local_appdata" = "%LOCALAPPDATA%" ]; then
    return 0
  fi

  export CARGO_TARGET_DIR="${local_appdata}\\lumelierServer-target"
  cmd //c "if not exist \"%LOCALAPPDATA%\\lumelierServer-target\" mkdir \"%LOCALAPPDATA%\\lumelierServer-target\"" >/dev/null 2>&1 || true

  if [ -d "$SCRIPT_DIR/target" ]; then
    cmd //c "attrib -R /S /D \"$SCRIPT_DIR\\target\\*\"" >/dev/null 2>&1 || true
  fi
}

find_vsdevcmd() {
  local candidates=(
    "/c/Program Files/Microsoft Visual Studio/2022/BuildTools/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files (x86)/Microsoft Visual Studio/2022/Community/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files/Microsoft Visual Studio/2022/Professional/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files (x86)/Microsoft Visual Studio/2022/Professional/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files/Microsoft Visual Studio/2022/Enterprise/Common7/Tools/VsDevCmd.bat"
    "/c/Program Files (x86)/Microsoft Visual Studio/2022/Enterprise/Common7/Tools/VsDevCmd.bat"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

validate_windows_linker_env() {
  if ! command -v cmd >/dev/null 2>&1; then
    return 0
  fi

  local first_link
  first_link="$(cmd //c "where link 2>nul" | tr -d '\r' | sed -n '1p')"

  if [[ -n "$first_link" && "$first_link" == *"\\Git\\usr\\bin\\link.exe"* ]]; then
    echo ""
    echo "Error: wrong linker resolved in this shell:"
    echo "  $first_link"
    echo ""
    echo "Rust MSVC builds require Visual Studio's linker, not Git's 'link.exe'."
    if VSDEVCMD_PATH="$(find_vsdevcmd)"; then
      echo ""
      echo "Run this from cmd/PowerShell, then re-run this script:"
      echo "  \"$VSDEVCMD_PATH\" -arch=arm64 -host_arch=arm64"
      echo ""
    else
      echo "Install Visual Studio 2022 Build Tools with:"
      echo "  - Desktop development with C++"
      echo "  - MSVC v143 ARM64 build tools"
      echo "  - Windows 10/11 SDK"
      echo ""
    fi
    echo "After that, verify:"
    echo "  where link"
    echo "(it should NOT point to Git\\usr\\bin\\link.exe)"
    return 1
  fi

  return 0
}

free_ports
build_frontend "$SCRIPT_DIR/client"
build_frontend "$SCRIPT_DIR/admin"

if ! CARGO_BIN="$(resolve_cargo_bin)"; then
  echo "Error: cargo is not available in PATH."
  echo "Install Rust via rustup and ensure cargo/cargo.exe is available in this shell."
  exit 1
fi

if ! validate_windows_linker_env; then
  exit 1
fi

configure_windows_cargo_target

"$CARGO_BIN" build -p lumelier-server -p lumelier-simulated-server
"$CARGO_BIN" run
