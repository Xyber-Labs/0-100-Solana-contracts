# Makefile for Engine Solana Program Tests

# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  test          - Run all tests (comprehensive coverage)"
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
	@echo "  test-litesvm  - Run tests using litesvm simulator"
	@echo "  deploy-config - Run EngineConfig migration (migrations/deploy.ts)"
	@echo "                 Pass CLI args via ARGS=\"--treasury ... --fee ... --admins ... --threshold ... --admin-key ...\""
	@echo "  init-launch-preset - Initialize Launch Preset from JSON payload"
	@echo "                 Use PAYLOAD=path/to/payload.json (default: migrations/launch-preset.template.json)"
	@echo "  update-launch-preset - Update Launch Preset from JSON payload"
	@echo "                 Uses the same PAYLOAD file as init-launch-preset"
	@echo "  mint-spl      - Mint SPL token with metadata (NAME, SYMBOL, URI, DECIMALS, AMOUNT, RECIPIENT or ARGS)"
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
# ANCHOR_PROVIDER_URL := https://api.devnet.solana.com
ANCHOR_WALLET := ~/.config/solana/id.json
REMOTE_SOLANA_URL := http://10.186.0.84:8899

# Test commands
.PHONY: test
test: validator-bg build-all deploy
	@echo "Running tests..."
	cargo fmt
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

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

.PHONY: build-all-test
build-all-test: build-test sync-idl build-sdk
	@echo "Full build completed (program + IDL sync + SDK)!"

.PHONY: deploy
deploy:
	@echo "Deploying program..."
	anchor deploy

.PHONY: deploy-local
deploy-local: config-local
	@echo "Deploying program to local validator..."
	anchor deploy --program-name engine --provider.cluster localnet --program-keypair ./deploy-keypair.json

.PHONY: deploy-devnet
deploy-devnet:
	@echo "Deploying program to local validator..."
	anchor deploy --program-name engine --provider.cluster devnet --program-keypair ./deploy-keypair.json

.PHONY: build-deploy
build-deploy: build deploy

.PHONY: deploy-config
deploy-config:
	@echo "Running EngineConfig migration..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node migrations/deploy.ts $(ARGS)

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

.PHONY: config-remote
config-remote:
	@echo "Setting Solana config to remote server..."
	solana config set --url $(REMOTE_SOLANA_URL)

.PHONY: config-devnet
config-devnet:
	@echo "Setting Solana config to devnet..."
	solana config set --url https://api.devnet.solana.com

.PHONY: config-local
config-local:
	@echo "Setting Solana config to localnet..."
	solana config set --url http://127.0.0.1:8899

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
	anchor run litesvm-full && anchor run litesvm-basic

# Default target
.DEFAULT_GOAL := help

setup-validator-raydium:
	NET=mainnet-beta ./scripts/setup-local-validator.sh

run-validator-raydium:
	NET=mainnet-beta ./scripts/start-validator.sh

build-test:
	anchor build -- --features test
	make sync-idl

test-raydium-clmm-anchor:
	./scripts/test-raydium-local.sh

.PHONY: deploy-config-auto
deploy-config-auto:
	@echo "Running EngineConfig migration with payload..."
	TS_NODE_COMPILER_OPTIONS='{"target":"ES2020","module":"commonjs"}' ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node migrations/deploy.ts --payload tmp/predeploy.json

.	PHONY: update-config-auto
update-config-auto:
	@echo "Updating EngineConfig with payload..."
	TS_NODE_COMPILER_OPTIONS='{"target":"ES2020","module":"commonjs"}' ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node migrations/update-config.ts --payload tmp/predeploy.json

predeploy-setup:
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) ts-node scripts/pre-deploy-setup.ts --out tmp/predeploy.json --airdrop 2 --supply 1000000000 --decimals 9

# ------------------------------
# Preset migration
PAYLOAD ?= migrations/launch-preset.template.json
.PHONY: init-launch-preset
init-launch-preset:
	@echo "Initializing Launch Preset from payload: $(PAYLOAD)"
	TS_NODE_COMPILER_OPTIONS='{"target":"ES2020","module":"commonjs"}' ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node migrations/init-launch-preset.ts --payload $(PAYLOAD)

.PHONY: update-launch-preset
update-launch-preset:
	@echo "Updating Launch Preset from payload: $(PAYLOAD)"
	TS_NODE_COMPILER_OPTIONS='{"target":"ES2020","module":"commonjs"}' ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn ts-node migrations/update-launch-preset.ts --payload $(PAYLOAD)

# ------------------------------
# Mint SPL token (defaults)
# Override via: make mint-spl NAME="MyToken" SYMBOL="MYT" URI="https://..." DECIMALS=9 AMOUNT=0 RECIPIENT=Pubkey
NAME ?= "Xyber"
SYMBOL ?= "XBT"
URI ?= "https://ipfs.io/ipfs/QmSe9d2kRs8VGidC9588NgLjm6FLxW7xXHKZy3mCVMVXKX"
DECIMALS ?= 9
AMOUNT ?= 1000000000000000000
RECIPIENT ?= "Ab5TgPbcB8QVuormXYXHzRVkV7okAbzkS2sU2neKoWvQ"
ARGS ?=

.PHONY: mint-spl
mint-spl:
	@echo "Minting SPL token with metadata..."
	TS_NODE_COMPILER_OPTIONS='{"target":"ES2020","module":"commonjs"}' ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) ts-node scripts/mint-spl.ts $(if $(NAME),--name $(NAME)) $(if $(SYMBOL),--symbol $(SYMBOL)) $(if $(URI),--uri $(URI)) $(if $(DECIMALS),--decimals $(DECIMALS)) $(if $(AMOUNT),--amount $(AMOUNT)) $(if $(RECIPIENT),--recipient $(RECIPIENT)) $(ARGS)
