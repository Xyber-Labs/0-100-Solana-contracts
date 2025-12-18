use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub struct TicketRange {
    pub start: u32,
    pub count: u32,
}

impl TicketRange {
    pub fn new(start: u32, count: u32) -> Self {
        Self { start, count }
    }
}

// -------------------------------
// Account Structures
// -------------------------------

#[account]
#[derive(InitSpace)]
pub struct VacantRanges {
    pub launch: Pubkey,
    #[max_len(100)]
    pub ranges: Vec<TicketRange>,
}

impl VacantRanges {
    pub fn push(&mut self, range: TicketRange) {
        self.ranges.push(range);
    }
}

#[account]
#[derive(InitSpace)]
pub struct LaunchState {
    // Project identification
    pub project_id: u64,

    // creator
    pub creator: Pubkey,

    // Config
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub unlock_time_sec: i64,

    pub base_mint: Option<Pubkey>,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,

    // Funding
    pub funding_end: i64,
    pub total_deposited: u64,
    pub total_tickets: u32,
    pub k_capacity: u32,

    // Selection
    pub vrf_seed: Option<[u8; 32]>,
    pub selection_finalized: bool,

    // Claims
    pub tokens_per_ticket: Option<u64>,

    // Creator grant fields
    pub creator_reserved_tickets: u32,
    pub creator_grant_present: bool,
    pub claims_opened_at: Option<i64>,
    pub creator_claim_lock_period_sec: i64,
    pub creator_initial_deposit: u64,
    pub creator_max_deposit: u64,
    // --- appended for upgrade safety ---
    pub funding_start: i64,
    pub pool_creation_grace_period_sec: i64,
    pub team_allocation_basis_points: u64,
    pub team_vesting_duration_sec: i64,
    pub raydium_pool_state: Option<Pubkey>,
    pub raydium_position_nft_mint: Option<Pubkey>,
}

impl LaunchState {
    pub fn mint_auth_bump_for(launch_key: &Pubkey) -> u8 {
        let (_, bump) = Pubkey::find_program_address(
            &[
                crate::constants::SEED_ROOT,
                b"escrow_authority",
                launch_key.as_ref(),
            ],
            &crate::ID,
        );
        bump
    }

    pub fn is_funding_active(&self) -> bool {
        let now = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);
        now >= self.funding_start && now < self.funding_end
    }
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub launch: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserContribution {
    pub tickets_claimed: u32,
    pub tickets_refunded: u32,
    pub withdraw_count: u8,
    #[max_len(10)]
    pub ticket_ranges: Vec<TicketRange>,
}

impl UserContribution {
    pub fn total_tickets(&self) -> u32 {
        self.ticket_ranges.iter().map(|r| r.count).sum()
    }

    pub fn remove_tickets(&mut self, count: u32) -> Vec<TicketRange> {
        let mut removed = Vec::new();
        let mut remaining = count;
        while remaining > 0 && !self.ticket_ranges.is_empty() {
            let last_idx = self.ticket_ranges.len() - 1;
            let range = &mut self.ticket_ranges[last_idx];
            let take = remaining.min(range.count);
            let removed_start = range.start + range.count - take;
            removed.push(TicketRange::new(removed_start, take));
            range.count -= take;
            remaining -= take;
            if range.count == 0 {
                self.ticket_ranges.pop();
            }
        }
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remove_tickets() {
        let mut uc = UserContribution {
            tickets_claimed: 0,
            tickets_refunded: 0,
            withdraw_count: 0,
            ticket_ranges: vec![
                TicketRange::new(0, 10),
                TicketRange::new(20, 5),
                TicketRange::new(30, 8),
            ],
        };
        assert_eq!(uc.total_tickets(), 23);

        let removed = uc.remove_tickets(3);
        assert_eq!(removed, vec![TicketRange::new(35, 3)]);
        assert_eq!(uc.ticket_ranges, vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 5),
            TicketRange::new(30, 5),
        ]);

        let removed = uc.remove_tickets(7);
        assert_eq!(removed, vec![TicketRange::new(30, 5), TicketRange::new(23, 2)]);
        assert_eq!(uc.ticket_ranges, vec![
            TicketRange::new(0, 10),
            TicketRange::new(20, 3),
        ]);

        let removed = uc.remove_tickets(100);
        assert_eq!(removed, vec![TicketRange::new(20, 3), TicketRange::new(0, 10)]);
        assert!(uc.ticket_ranges.is_empty());
    }
}

#[account]
#[derive(InitSpace)]
pub struct ProjectCounter {
    pub last_project_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub launch: Pubkey,
    pub pool_id: u64,
    pub project_id: u64,
    pub created_slot: u64,
    pub created_blockhash: [u8; 32],
    pub created: bool,
    pub claims_ready: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CreatorGrant {
    pub launch: Pubkey,
    pub creator: Pubkey,

    // Creator's special deposit locked in escrow
    pub locked_lamports: u64,

    // How many tickets are guaranteed (8 SOL / τ)
    pub reserved_tickets: u32,

    // Daily limit in lamports (usually = 1 SOL)
    pub daily_lamports_limit: u64,

    // Cap in tickets/day = floor(daily_lamports_limit / τ)
    pub daily_ticket_cap: u32,

    // How many "tickets" they have already claimed
    pub claimed_tickets: u32,

    pub refunded: bool,
}

#[account]
#[derive(InitSpace)]
pub struct TeamVesting {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub total_allocation: u64,
    pub claimed: u64,
    pub start_ts: i64,
    pub duration_sec: i64,
    pub min_interval_sec: i64,
    pub last_claim_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct EngineConfig {
    pub treasury: Pubkey,
    pub creation_fee: u64,
    pub xyber_mint: Pubkey,
    pub admins: [Pubkey; 3],
    pub threshold: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TokenMetadataConfig {
    pub launch: Pubkey,
    #[max_len(64)]
    pub name: String,
    #[max_len(16)]
    pub symbol: String,
    #[max_len(256)]
    pub uri: String,
    pub is_mutable: bool,
    pub seller_fee_basis_points: u16,
}

#[account]
#[derive(InitSpace)]
pub struct LaunchPreset {
    pub id: u8,
    pub hard_cap_lamports: u64,
    pub min_raise_lamports: u64,
    pub per_wallet_cap: u64,
    pub tau_lamports: u64,
    pub base_total_allocation: u64,
    pub base_sale_basis_points: u64,
    pub team_allocation_basis_points: u64,
    pub funding_duration_seconds: i64,
    pub unlock_time_sec: i64,
    pub creator_initial_deposit_lamports: u64,
    pub creator_daily_lamports_limit: u64,
    pub creator_claim_lock_period_sec: i64,
    pub creator_max_deposit: u64,
    pub pool_creation_grace_period_sec: i64,
    pub team_vesting_duration_sec: i64,
    pub free_withdrawals_limit: u8,
    pub withdraw_fee_lamports: u64,
}

impl LaunchPreset {
    pub fn is_valid(&self) -> Result<()> {
        require!(self.tau_lamports > 0, crate::errors::ErrorCode::MalformedPreset);
        require!(
            self.hard_cap_lamports % self.tau_lamports == 0,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.per_wallet_cap >= self.tau_lamports,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.min_raise_lamports >= crate::utils::clmm::AMMV3_CREATION_RESERVE,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(
            self.min_raise_lamports <= self.hard_cap_lamports,
            crate::errors::ErrorCode::MalformedPreset
        );
        require!(self.creator_claim_lock_period_sec > 0, crate::errors::ErrorCode::MalformedPreset);
        require!(
            self.funding_duration_seconds > 0 && self.funding_duration_seconds <= 60 * 60 * 24 * 7,
            crate::errors::ErrorCode::MalformedPreset
        );
        Ok(())
    }
}
