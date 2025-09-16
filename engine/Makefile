# Makefile for Engine Solana Program Tests

# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  test          - Run all tests (comprehensive coverage)"
	@echo "  test-quick    - Run tests without rebuilding"
	@echo "  test-basic    - Run only basic tests (6 tests)"
	@echo "  build         - Build the program"
	@echo "  deploy        - Deploy the program"
	@echo "  clean         - Clean build artifacts"
	@echo "  validator     - Start local validator"
	@echo "  validator-stop - Stop local validator"
	@echo "  setup         - Full setup (build + deploy + test)"

# Environment variables
ANCHOR_PROVIDER_URL := http://127.0.0.1:8899
ANCHOR_WALLET := ~/.config/solana/id.json
SOLANA_URL := http://127.0.0.1:8899

# Test commands
.PHONY: test
test: build deploy
	@echo "Running tests..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: test-quick
test-quick:
	@echo "Running tests (quick mode)..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

.PHONY: test-verbose
test-verbose: build deploy
	@echo "Running tests with verbose output..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts --reporter spec

# Build and deploy commands
.PHONY: build
build:
	@echo "Building program..."
	anchor build

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
setup: validator-bg build-deploy test
	@echo "Full setup completed!"

.PHONY: setup-quick
setup-quick: build-deploy test-quick
	@echo "Quick setup completed!"

# Configuration commands
.PHONY: config-local
config-local:
	@echo "Setting Solana config to localhost..."
	solana config set --url $(SOLANA_URL)

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
test-basic: build deploy
	@echo "Running basic tests only..."
	ANCHOR_PROVIDER_URL=$(ANCHOR_PROVIDER_URL) ANCHOR_WALLET=$(ANCHOR_WALLET) yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts --grep "Initializes the launch state|Opens funding|Closes funding|Sets the VRF seed|Allows deposits|Allows withdrawals"


# Debug commands
.PHONY: debug
debug:
	@echo "Debug information:"
	@echo "ANCHOR_PROVIDER_URL: $(ANCHOR_PROVIDER_URL)"
	@echo "ANCHOR_WALLET: $(ANCHOR_WALLET)"
	@echo "SOLANA_URL: $(SOLANA_URL)"
	solana config get

# Install dependencies
.PHONY: install
install:
	@echo "Installing dependencies..."
	yarn install

# Default target
.DEFAULT_GOAL := help
