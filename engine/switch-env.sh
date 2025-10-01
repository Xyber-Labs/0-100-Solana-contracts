#!/bin/bash

# Script to switch between local and remote Solana environments
# Usage: ./switch-env.sh [local|remote]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to check if remote server is reachable
check_remote_connection() {
    if ! curl -s --connect-timeout 5 http://10.186.0.84:8899 > /dev/null 2>&1; then
        print_warning "Remote server 10.186.0.84:8899 is not reachable"
        return 1
    fi
    return 0
}

# Function to switch to local environment
switch_local() {
    print_status "Switching to local environment..."
    export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
    export SOLANA_URL=http://127.0.0.1:8899
    solana config set --url http://127.0.0.1:8899
    print_success "Switched to local environment"
}

# Function to switch to remote environment
switch_remote() {
    print_status "Switching to remote environment..."
    
    if ! check_remote_connection; then
        print_error "Cannot connect to remote server. Please check if the node is running on 10.186.0.84:8899"
        exit 1
    fi
    
    export ANCHOR_PROVIDER_URL=http://10.186.0.84:8899
    export SOLANA_URL=http://10.186.0.84:8899
    solana config set --url http://10.186.0.84:8899
    print_success "Switched to remote environment"
}

# Main execution
case $1 in
    "local")
        switch_local
        ;;
    "remote")
        switch_remote
        ;;
    "status")
        print_status "Current environment status:"
        echo "ANCHOR_PROVIDER_URL: $ANCHOR_PROVIDER_URL"
        echo "SOLANA_URL: $SOLANA_URL"
        solana config get
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [local|remote|status]"
        echo ""
        echo "Options:"
        echo "  local         - Switch to local environment (127.0.0.1:8899)"
        echo "  remote        - Switch to remote environment (10.186.0.84:8899)"
        echo "  status        - Show current environment status"
        echo "  help          - Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 local      # Switch to local node"
        echo "  $0 remote     # Switch to remote node"
        echo "  $0 status     # Check current configuration"
        exit 0
        ;;
    *)
        print_error "Invalid option: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac

# Show current configuration
echo ""
print_status "Current configuration:"
echo "ANCHOR_PROVIDER_URL: $ANCHOR_PROVIDER_URL"
echo "SOLANA_URL: $SOLANA_URL"
solana config get
