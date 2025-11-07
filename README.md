### 0-100 Engine (Solana) — Fair Launch + CLMM

In short: this is an on-chain engine for a fair token launch on Solana. It collects SOL deposits, distributes “tickets” (multiples of τ), randomly and transparently selects winners, creates a liquidity pool on Raydium CLMM, and opens token claiming for users and the creator under strict rules (escrow, refunds, vesting, limits).

### Key Features

*   **Fair Drawing**: deterministic winner selection based on a public seed (recent blockhash), with no admin trust required
*   **Scalability**: roster sharding, batch processing, and independent “crunching” execution
*   **Fund Security**: deposits are held in escrow; losers can claim refunds; token claiming opens only after the pool is prepared
*   **Raydium Integration**: on-chain CLMM pool creation and liquidity addition
*   **SDK Approach**: all operations are performed via SDK and txBuilder, no manual transaction assembly

### High-Level Mechanism (Step-by-Step)

1.  **Initialize engine configuration** (treasury, fee, XYBER mint) — `init_engine_config` / `update_engine_config`
2.  **Create a launch** — `init_launch`: PDAs, escrow, parameters: `hard_cap`, `min_raise`, `per_wallet_cap`, `τ`, `sale/lp`, `funding_duration`, `roster_shards`
3.  **Initialize roster** — `init_roster`, shards — `init_roster_shard`
4.  **Fundraising**: `deposit` (multiples of τ); within the funding window, `withdraw` is available
5.  **Close funding window and set seed** — `set_seed` (permissionless, recent blockhash)
6.  **Finalize shards** — `finalize_roster_shard` (prefix sums, aggregation, preparation for drawing)
7.  **Pool preparation** — `prepare_pool_creation`, then `create_clmm_pool` (Raydium CLMM) and `add_clmm_liquidity`
8.  **Open claiming**: winners call `claim_tokens`, losers — `claim_refund`
9.  **Creator**: special deposit (`creator_deposit` / `creator_withdraw`), vesting and withdrawal limits — `claim_creator_tokens`
10. **Team**: vesting — `init_team_vesting` / `claim_team_tokens`

### Surface Security Model

*   The seed for the drawing is set after the funding closes and cannot be controlled by admins
*   Deposits remain in escrow until pool initialization is complete; losers can always claim refunds
*   Token claiming by users is tied to pool creation and initial liquidity provision
*   Creator token claims are limited daily and locked between claim periods — cannot withdraw all at once

### Program Instructions (API)

See the full list and function signatures in `engine/programs/engine/src/lib.rs`.

*   `init_engine_config`, `update_engine_config` — engine configuration
*   `init_launch` — create launch and PDAs
*   `init_roster`, `init_roster_shard`, `finalize_roster_shard` — roster and shards
*   `set_seed` — seed setup (permissionless)
*   `prepare_pool_creation`, `create_clmm_pool`, `add_clmm_liquidity` — pool setup and liquidity addition
*   `deposit`, `withdraw` — deposits and withdrawals during funding
*   `claim_tokens`, `claim_refund` — user claims
*   `creator_deposit`, `creator_withdraw`, `claim_creator_tokens` — creator deposit and vesting
*   `init_team_vesting`, `claim_team_tokens` — team vesting

### End-User Flow (Summary)

*   Admin defines launch parameters and initializes it
*   Users deposit SOL (multiples of τ); they can withdraw until the window closes
*   After closing, anyone can set the seed; roster gets finalized
*   A Raydium CLMM pool is created and minimal liquidity added
*   Winners claim tokens; others claim refunds; the creator claims according to vesting

### SDK and Integration

All scripts and UI use the SDK and its `txBuilder`; no manual transaction assembly is used.

```
import EngineSDK from "../engine/ts-sdk/src/engine";
// or packaged import in UI: import EngineSDK from "@xyber-labs/0-100-sdk";
```

### Quick Start for Developers

Requires Node.js + Yarn, Solana CLI, and Anchor. Main scripts are located in `engine/scripts`, with a UI demo in `engine/app`.

Build / Deploy Contract:

```
anchor build
anchor deploy
```

The full demo flow is implemented in `engine/app/src/utils/flowRunner.ts` and covers: configuration, `init_launch`, sharding, parallel deposits, `set_seed`, finalization, pool creation (Raydium), liquidity addition, user/creator claims, and basic fee estimation.

### Run Tests from Scratch (in `engine/`)

Execute sequentially in the `engine` directory:

```
cd engine
make build-test
make litesvm
make setup-validator-raydium
make run-validator-raydium
make deploy-local
make predeploy-setup
make deploy-config-auto
make test-raydium-clmm-anchor
```

### Mini UI and Full Contract Run (in `engine/app`)

In `engine/app`, you’ll find a mini UI and a full-flow script. Run:

```
cd engine/app
yarn install
yarn dev
```

For local testing, specify a wallet with XYBER tokens:

`engine/tmp/admin-1.json`

Conceptual project flow: `engine/app/src/utils/flowRunner.ts`.
