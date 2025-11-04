#!/usr/bin/env bash
set -euo pipefail

# Path where the active Solana CLI version is usually installed
SOLANA_INSTALL_DIR="$HOME/.local/share/solana/install/active_release/bin"

# Installation command
INSTALL_CMD="curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash"

# 1st arg — path to BPF program (.so), default: ./engine.so
BPF_PROG="${1:-./engine.so}"

# Default program id (used if 2nd arg not provided)
DEFAULT_PROGRAM_ID="DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7"

# 2nd arg — program id (base58) OR path to keypair json (optional)
PROG_ARG="${2:-}"

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m%s\033[0m\n' "$*"; exit 1; }

# Ensure Solana CLI is available
if command -v solana >/dev/null 2>&1; then
  info "Found solana in PATH: $(command -v solana)"
else
  info "Solana not found. Installing..."
  /bin/bash -c "$INSTALL_CMD"
  if [ -d "$SOLANA_INSTALL_DIR" ]; then
    export PATH="$SOLANA_INSTALL_DIR:$PATH"
    info "Added $SOLANA_INSTALL_DIR to PATH for this session."
    warn "To persist, add to ~/.profile or ~/.bashrc:
  export PATH=\"$SOLANA_INSTALL_DIR:\$PATH\""
  fi
  command -v solana >/dev/null 2>&1 || err "solana still not found after install."
fi

# Validate .so path
[ -f "$BPF_PROG" ] || err "BPF program (.so) not found: $BPF_PROG"

# Resolve program id / keypair
if [ -n "$PROG_ARG" ]; then
  if [ -f "$PROG_ARG" ]; then
    PROG_ID_OR_KEYPAIR="$PROG_ARG"  # keypair file
    info "Using keypair file: $PROG_ID_OR_KEYPAIR"
  else
    PROG_ID_OR_KEYPAIR="$PROG_ARG"  # base58 program id
    info "Using program id: $PROG_ID_OR_KEYPAIR"
  fi
else
  PROG_ID_OR_KEYPAIR="$DEFAULT_PROGRAM_ID"
  info "No program id/keypair provided. Using default: $PROG_ID_OR_KEYPAIR"
fi

# Start validator with program loaded at genesis
info "Starting solana-test-validator --reset --bpf-program '$PROG_ID_OR_KEYPAIR' '$BPF_PROG'"
solana-test-validator --reset --bpf-program "$PROG_ID_OR_KEYPAIR" "$BPF_PROG"