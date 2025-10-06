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
	@echo "  deploy-remote - Deploy to remote server"
	@echo "  test-remote   - Run tests on remote server"
	@echo "  setup-remote  - Full remote setup (build + deploy + test)"

# Environment variables
ANCHOR_PROVIDER_URL := http://127.0.0.1:8899
ANCHOR_WALLET := ~/.config/solana/id.json
SOLANA_URL := http://127.0.0.1:8899
REMOTE_SOLANA_URL := http://10.186.0.84:8899

# Test commands
.PHONY: test
test: validator-bg build-all deploy
	@echo "Running tests..."
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
test-local-quick: build-all-test deploy
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

.PHONY: build-test
build-test:
	@echo "Building program with --features test..."
	anchor build -- --features test

.PHONY: sync-idl
sync-idl:
	@echo "Syncing IDL files to SDK..."
	cp target/types/engine.ts ts-sdk/idl/engine.ts
	cp target/idl/engine.json ts-sdk/idl/engine.json
	@echo "IDL files synced successfully!"

.PHONY: build-sdk
build-sdk:
	@echo "Building SDK..."
	cd ts-sdk && yarn build
	@echo "SDK built successfully!"

.PHONY: build-all
build-all: build sync-idl build-sdk
	@echo "Full build completed (program + IDL sync + SDK)!"

.PHONY: build-all-test
build-all-test: build-test sync-idl build-sdk
	@echo "Full test build completed (program + IDL sync + SDK)!"

.PHONY: deploy
deploy:
	@echo "Deploying program..."
	anchor deploy

.PHONY: build-deploy
build-deploy: build deploy

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
	@echo "Setting Solana config to devnet..."
	solana config set --url https://api.devnet.solana.com

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
	solana program show HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb

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
.PHONY: deploy-remote
deploy-remote: config-remote
	@echo "Deploying to remote server..."
	anchor deploy

.PHONY: test-remote
test-remote: config-remote
	@echo "Running tests on remote server..."
	ANCHOR_PROVIDER_URL=$(REMOTE_SOLANA_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: build-deploy-remote
build-deploy-remote: config-remote build deploy-remote

.PHONY: setup-remote
setup-remote: build-deploy-remote test-remote
	@echo "Remote setup completed!"

# Install dependencies
.PHONY: install
install:
	@echo "Installing dependencies..."
	yarn install

# Default target
.DEFAULT_GOAL := help
