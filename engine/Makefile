# Makefile for Engine Solana Program Tests

# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  test          - Run all tests (comprehensive coverage)"
	@echo "  test-quick    - Run tests without rebuilding"
	@echo "  test-basic    - Run only basic tests (6 tests)"
	@echo "  build         - Build the program"
	@echo "  build-all     - Build program + sync IDL + build SDK"
	@echo "  sync-idl      - Sync IDL files to SDK"
	@echo "  build-sdk     - Build SDK only"
	@echo "  deploy        - Deploy the program"
	@echo "  clean         - Clean build artifacts"
	@echo "  validator     - Start local validator"
	@echo "  validator-stop - Stop local validator"
	@echo "  setup         - Full setup (build + deploy + test)"
	@echo "  test-local    - Run the full flow test on the local validator"
	@echo "  test-local-quick - Run the full flow test on an already running validator"
	@echo "  test-litesvm  - Run tests using litesvm simulator"
	@echo ""
	@echo "Remote development:"
	@echo "  config-remote - Set config to remote server (10.186.0.84)"
	@echo "  airdrop-remote - Request 5 SOL from the remote faucet"
	@echo "  deploy-remote - Deploy to remote server"
	@echo "  test-remote   - Run tests on remote server"
	@echo "  test-remote-flow - Run the full flow script on the remote server"
	@echo "  setup-remote  - Full remote setup (build + deploy + test)"

# Environment variables
ANCHOR_PROVIDER_URL := http://127.0.0.1:8899
ANCHOR_WALLET := ~/.config/solana/id.json
SOLANA_URL := http://127.0.0.1:8899
REMOTE_SOLANA_URL := http://10.186.0.84:8899
DEVNET_SOLANA_URL := https://api.devnet.solana.com

# Test commands
.PHONY: test
test: validator-bg build-all deploy
	@echo "Running tests..."
	cargo fmt
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: test-quick
test-quick:
	@echo "Running tests (quick mode)..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: test-verbose
test-verbose: validator-bg build-all deploy
	@echo "Running tests with verbose output..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts --reporter spec

.PHONY: test-local
test-local: validator-bg build-all-test deploy
	@echo "Running full flow script on local validator..."
	yarn run script:local-flow

.PHONY: test-local-quick
test-local-quick: build-all deploy
	@echo "Running full flow script on existing local validator..."
	yarn run script:local-flow

.PHONY: test-litesvm
test-litesvm: build-all
	@echo "Running litesvm tests..."
	anchor run litesvm

# Build and deploy commands
.PHONY: build
build:
	@echo "Building program..."
	anchor build

.PHONY: sync-idl
sync-idl:
	@echo "Syncing IDL files to SDK..."
	cp target/types/engine.ts ts-sdk/idl/engine.ts
	cp target/idl/engine.json ts-sdk/idl/engine.json
	@echo "IDL files synced successfully!"

.PHONY: build-sdk
build-sdk:
	@echo "Building SDK..."
	cd ts-sdk && rm -rf dist && yarn build
	@echo "SDK built successfully!"

.PHONY: build-all
build-all: build sync-idl build-sdk
	@echo "Full build completed (program + IDL sync + SDK)!"

.PHONY: deploy
deploy:
	@echo "Deploying program..."
	anchor deploy

.PHONY: deploy-local
deploy-local: config-local
	@echo "Deploying program to local validator..."
	anchor deploy --program-name engine --provider.cluster $(SOLANA_URL) --program-keypair ./deploy-keypair.json

.PHONY: build-deploy
build-deploy: build deploy

.PHONY: build-deploy-local
build-deploy-local: build deploy-local sync-idl build-sdk

# Validator management
.PHONY: validator
validator:
	@echo "Starting local validator..."
	solana-test-validator --reset

.PHONY: validator-stop
validator-stop:
	@echo "Stopping local validator..."
	pkill -f solana-test-validator || true

.PHONY: validator-bg
validator-bg:
	@echo "Starting local validator in background..."
	solana-test-validator --reset &

# Setup commands
.PHONY: setup
setup: validator-bg build-all deploy test
	@echo "Full setup completed!"

.PHONY: setup-quick
setup-quick: build-all deploy test-quick
	@echo "Quick setup completed!"

# Configuration commands
.PHONY: config-local
config-local:
	@echo "Setting Solana config to localhost..."
	solana config set --url $(SOLANA_URL)

.PHONY: config-remote
config-remote:
	@echo "Setting Solana config to remote server..."
	solana config set --url $(REMOTE_SOLANA_URL)

.PHONY: config-devnet
config-devnet:
	@echo "Setting Solana config to devnet ($(DEVNET_SOLANA_URL))..."
	solana config set --url $(DEVNET_SOLANA_URL)

# Clean commands
.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	anchor clean
	rm -rf target/
	rm -rf node_modules/.cache/

.PHONY: clean-all
clean-all: clean
	@echo "Cleaning all artifacts..."
	rm -rf node_modules/
	yarn install

# Development commands
.PHONY: dev
dev: config-local validator-bg
	@echo "Development environment ready!"
	@echo "Run 'make test' to run tests"

.PHONY: check
check:
	@echo "Checking program status..."
	solana program show DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7

# Individual test commands
.PHONY: test-basic
test-basic: validator-bg build-all deploy
	@echo "Running basic tests only..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts --grep "Initializes the launch state|Closes funding after period ends|Sets the VRF seed|Allows deposits|Allows withdrawals"


# Debug commands
.PHONY: debug
debug:
	@echo "Debug information:"
	@echo "ANCHOR_PROVIDER_URL: $(ANCHOR_PROVIDER_URL)"
	@echo "ANCHOR_WALLET: $(ANCHOR_WALLET)"
	@echo "SOLANA_URL: $(SOLANA_URL)"
	solana config get

# Remote development commands
.PHONY: airdrop-remote
airdrop-remote: config-remote
	@echo "Requesting 5 SOL airdrop from remote server..."
	solana airdrop 5 --url $(REMOTE_SOLANA_URL)

.PHONY: deploy-remote
deploy-remote:
	@echo "Deploying to remote server..."
	anchor deploy --program-name engine --provider.cluster $(REMOTE_SOLANA_URL) --program-keypair ./deploy-keypair.json

.PHONY: test-remote
test-remote: config-remote
	@echo "Running tests on remote server..."
	ANCHOR_PROVIDER_URL=$(REMOTE_SOLANA_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: test-remote-flow
test-remote-flow:
	@echo "Running full flow script on remote server..."
	ANCHOR_PROVIDER_URL=$(REMOTE_SOLANA_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node scripts/run-local-flow.ts

.PHONY: build-deploy-remote
build-deploy-remote: build deploy-remote

.PHONY: deploy-devnet
deploy-devnet: config-devnet
	@echo "Deploying to devnet..."
	bash -c 'set -euo pipefail; \
	  mkdir -p ./tmp; \
	  BUFFER_SIGNER=./tmp/devnet-buffer-signer.json; \
	  if [ ! -f "$$BUFFER_SIGNER" ]; then \
	    echo "Creating persistent buffer signer..."; \
	    solana-keygen new --no-passphrase --outfile "$$BUFFER_SIGNER" >/dev/null; \
	  fi; \
	  attempts=0; max_attempts=10; \
	  until [ $$attempts -ge $$max_attempts ]; do \
	    attempts=$$((attempts+1)); \
	    echo "Attempt $$attempts/$$max_attempts"; \
	    if solana program deploy target/deploy/engine.so "$$BUFFER_SIGNER" \
	        --program-id ./deploy-keypair.json \
	        --url $(DEVNET_SOLANA_URL) \
	        --commitment processed \
	        --upgrade-authority ~/.config/solana/id.json; then \
	      echo "Deploy succeeded"; \
	      exit 0; \
	    fi; \
	    echo "Deploy failed, retrying in 5s..."; \
	    sleep 5; \
	  done; \
	  echo "Deploy failed after $$max_attempts attempts"; \
	  exit 1'

.PHONY: airdrop-devnet
airdrop-devnet: config-devnet
	@echo "Requesting 5 SOL airdrop on devnet..."
	solana airdrop 5 --url $(DEVNET_SOLANA_URL)

.PHONY: build-deploy-devnet
build-deploy-devnet: build deploy-devnet

.PHONY: setup-remote
setup-remote: build-deploy-remote test-remote
	@echo "Remote setup completed!"

# Install dependencies
.PHONY: install
install:
	@echo "Installing dependencies..."
	yarn install

create-program-id:
	solana-keygen new --no-passphrase --outfile ./deploy-keypair.json

get-program-id:
	solana-keygen pubkey ./deploy-keypair.json

logs:
	solana logs DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7

litesvm:
	anchor run litesvm-full && anchor run litesvm-basic && anchor run litesvm-raydium

# Default target
.DEFAULT_GOAL := help

check-amm-config:
	solana account 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy --url http://127.0.0.1:8899