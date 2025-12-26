use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    checked_mul, checked_sub,
    constants::SEED_ROOT,
    errors::ErrorCode,
    events::Claimed,
    state::{Bucket, Contribution, LaunchPreset, LaunchState, TicketsClaimed},
    utils::lottery::Lottery,
};

#[derive(Accounts)]
#[instruction(bucket: Bucket)]
pub struct Claim<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,

    pub launch_state: Account<'info, LaunchState>,

    #[account(address = launch_state.preset @ ErrorCode::MalformedPreset)]
    pub launch_preset: Account<'info, LaunchPreset>,

    #[account(
        seeds = [SEED_ROOT, b"lottery", launch_state.key().as_ref()],
        bump,
        constraint = lottery.is_finalized() @ ErrorCode::NotFinalized
    )]
    pub lottery: Account<'info, Lottery>,

    #[account(
        seeds = [SEED_ROOT, b"contributor", launch_state.key().as_ref(), participant.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    #[account(
        init_if_needed,
        payer = participant,
        space = 8 + TicketsClaimed::INIT_SPACE,
        seeds = [SEED_ROOT, b"tickets_claimed", launch_state.key().as_ref(), &[bucket as u8], participant.key().as_ref()],
        bump
    )]
    pub tickets_claimed: Account<'info, TicketsClaimed>,

    #[account(address = launch_state.base_mint.unwrap() @ ErrorCode::InvalidMint)]
    pub base_mint: Account<'info, Mint>,

    /// CHECK: PDA owning the escrow ATA for base_mint
    #[account(seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint = base_mint, associated_token::authority = escrow_authority)]
    pub base_escrow_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = participant,
        associated_token::mint = base_mint,
        associated_token::authority = participant
    )]
    pub participant_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

struct VestingParams {
    allocation: u64,
    duration: i64,
    period: i64,
}

fn vesting_params(
    bucket: Bucket,
    is_creator: bool,
    preset: &LaunchPreset,
    lottery: &Lottery,
    contribution: &Contribution,
) -> Result<VestingParams> {
    match bucket {
        Bucket::Team => {
            require!(is_creator, ErrorCode::Unauthorized);
            let (allocation, duration, period) = preset.team_vesting_params();
            Ok(VestingParams { allocation, duration, period })
        }
        Bucket::Sale => {
            let allocation = lottery.sale_allocation(&contribution.ticket_ranges);

            if is_creator {
                let winning_tickets = lottery.count_winning_in_ranges(&contribution.ticket_ranges);
                let deposit = checked_mul!(winning_tickets, preset.tau_lamports)?;
                let (duration, period) = preset.creator_vesting_params(deposit)?;
                Ok(VestingParams { allocation, duration, period })
            } else {
                Ok(VestingParams { allocation, duration: 1, period: 1 })
            }
        }
    }
}

pub fn claim(ctx: Context<Claim>, bucket: Bucket) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let launch_preset = &ctx.accounts.launch_preset;
    let lottery = &ctx.accounts.lottery;
    let tickets_claimed = &mut ctx.accounts.tickets_claimed;
    let participant = ctx.accounts.participant.key();
    let contribution = &ctx.accounts.contribution;
    let is_creator = participant == launch_state.creator;

    let now = Clock::get()?.unix_timestamp;
    let start = launch_state.claims_opened_at.expect("Expected be finalized");

    let VestingParams { allocation, duration, period } =
        vesting_params(bucket, is_creator, launch_preset, lottery, contribution)?;

    let elapsed_sec = (now - start).max(0).min(duration);
    let periods_passed = elapsed_sec / period;
    let periods_count = duration / period;

    let available_to_claim = (allocation as u128)
        .checked_mul(periods_passed as u128)
        .and_then(|mul| mul.checked_div(periods_count as u128))
        .ok_or_else(|| ErrorCode::ArithmeticOverflow)? as u64;
    let to_claim = checked_sub!(available_to_claim, tickets_claimed.value)? as u64;

    require!(to_claim > 0, ErrorCode::NothingToClaim);

    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &launch_state.key().to_bytes(),
        &[ctx.bumps.escrow_authority],
    ];
    let signer_seeds = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.base_escrow_ata.to_account_info(),
        to: ctx.accounts.participant_ata.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, to_claim)?;
    tickets_claimed.value = available_to_claim;

    emit!(Claimed {
        launch: launch_state.key(),
        participant,
        bucket: bucket as u8,
        tokens: to_claim,
    });

    Ok(())
}
