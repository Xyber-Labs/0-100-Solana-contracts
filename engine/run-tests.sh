#!/bin/bash

# Script to run Engine Solana Program Tests
# Usage: ./run-tests.sh [quick|verbose|basic]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment variables
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if validator is running
check_validator() {
    if ! curl -s http://127.0.0.1:8899 > /dev/null 2>&1; then
        print_warning "Local validator not running. Starting validator..."
        solana-test-validator --reset &
        sleep 5
        print_success "Validator started"
    else
        print_status "Validator is already running"
    fi
}

# Function to check if program is deployed
check_program() {
    if ! solana program show HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb > /dev/null 2>&1; then
        print_warning "Program not deployed. Building and deploying..."
        anchor build
        anchor deploy
        print_success "Program deployed"
    else
        print_status "Program is already deployed"
    fi
}

# Function to run tests
run_tests() {
    local test_type=$1
    local mocha_args=""
    
    case $test_type in
        "quick")
            print_status "Running tests in quick mode..."
            ;;
        "verbose")
            print_status "Running tests with verbose output..."
            mocha_args="--reporter spec"
            ;;
        "basic")
            print_status "Running basic tests only..."
            mocha_args="--grep 'Initializes the launch state|Opens funding|Closes funding|Sets the VRF seed|Allows deposits|Allows withdrawals'"
            ;;
        *)
            print_status "Running all tests..."
            ;;
    esac
    
    yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts $mocha_args
}

# Main execution
main() {
    print_status "Starting Engine Solana Program Tests"
    
    # Check if we're in the right directory
    if [ ! -f "Anchor.toml" ]; then
        print_error "Not in the project root directory. Please run from the engine directory."
        exit 1
    fi
    
    # Set Solana config to localhost
    print_status "Setting Solana config to localhost..."
    solana config set --url http://127.0.0.1:8899
    
    # Check and start validator if needed
    check_validator
    
    # Check and deploy program if needed
    check_program
    
    # Run tests based on argument
    if [ $# -eq 0 ]; then
        run_tests "all"
    else
        run_tests $1
    fi
    
    print_success "Tests completed!"
}

# Handle script arguments
case $1 in
    "help"|"-h"|"--help")
        echo "Usage: $0 [quick|verbose|basic]"
        echo ""
        echo "Options:"
        echo "  quick         - Run tests without rebuilding/deploying"
        echo "  verbose       - Run tests with verbose output"
        echo "  basic         - Run only basic tests (6 tests)"
        echo "  (no args)     - Run all tests (comprehensive coverage)"
        echo ""
        echo "Examples:"
        echo "  $0                    # Run all tests"
        echo "  $0 quick             # Quick test run"
        echo "  $0 basic             # Run only basic tests"
        exit 0
        ;;
esac

# Run main function
main "$@"
