use crate::{
    constants::SEED_ROOT,
    errors::ErrorCode as EngineErrorCode,
    events::RefundClaimed,
    state::{LaunchState, RosterShard, UserContribution},
    utils::selection::permute_u32,
};
use anchor_lang::{prelude::*, solana_program::sysvar::clock::Clock};

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub launch_state: Account<'info, LaunchState>,
    #[account(mut, seeds = [SEED_ROOT, b"user", launch_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_contribution: Account<'info, UserContribution>,
    /// CHECK: optional — only required if finalized_snapshot == false
    #[account(mut)]
    pub roster_shard: Option<AccountInfo<'info>>,
    /// CHECK:
    #[account(mut, seeds = [SEED_ROOT, b"escrow_authority", launch_state.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let launch_state = &ctx.accounts.launch_state;
    let user = &mut ctx.accounts.user_contribution;
    require!(!user.claimed_refund, EngineErrorCode::AlreadyClaimedRefund);

    // If funding is complete and min raise is not met, issue a full refund without selection
    let current_time = Clock::get()?.unix_timestamp;
    if current_time >= launch_state.funding_period_end
        && launch_state.total_deposited < launch_state.min_raise_lamports
    {
        let refund = user.deposited;
        if refund > 0 {
            let launch_key = launch_state.key();
            let seeds = [
                SEED_ROOT,
                b"escrow_authority",
                launch_key.as_ref(),
                &[ctx.bumps.escrow_authority],
            ];
            let signer = &[&seeds[..]];
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.escrow_authority.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer,
                ),
                refund,
            )?;
        }
        user.claimed_refund = true;

        emit!(RefundClaimed {
            launch: launch_state.key(),
            user: ctx.accounts.user.key(),
            refunded_lamports: refund,
            y_approved: 0,
        });

        return Ok(());
    }

    // Otherwise, proceed with permutation path
    require!(launch_state.selection_finalized, EngineErrorCode::NotFinalized);
    let seed = launch_state.vrf_seed.ok_or(EngineErrorCode::SeedMissing)?;

    let reserved = launch_state.creator_reserved_tickets.min(launch_state.k_capacity);
    let k_pub =
        launch_state.k_capacity.checked_sub(reserved).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let n = launch_state.public_total_tickets;
    let (base, tcount) = if user.finalized_snapshot {
        (user.final_t_base, user.final_ticket_count)
    } else {
        let shard_ai = ctx
            .accounts
            .roster_shard
            .as_ref()
            .ok_or(EngineErrorCode::ShardNotFinalized)?;
        require_keys_eq!(*shard_ai.owner, crate::ID, EngineErrorCode::Unauthorized);
        let data = shard_ai.data.borrow().to_vec();
        let mut cursor: &[u8] = &data;
        let shard = RosterShard::try_deserialize(&mut cursor)?;
        require!(
            launch_state.roster_finalized_up_to >= shard.shard_id as i32,
            EngineErrorCode::ShardNotFinalized
        );
        require!(
            shard.wallets.len() == shard.counts.len() && shard.prefix.len() == shard.wallets.len(),
            EngineErrorCode::ShardNotFinalized
        );
        require!(user.shard_id == shard.shard_id, EngineErrorCode::Unauthorized);
        let u = user.idx_in_shard as usize;
        let b = shard
            .shard_base
            .checked_add(*shard.prefix.get(u).ok_or(EngineErrorCode::MappingError)?)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        let c = *shard.counts.get(u).ok_or(EngineErrorCode::MappingError)?;
        (b, c)
    };
    // Early exit when no public winners exist or n==0 to avoid permute loop
    if k_pub == 0 || n == 0 {
        let approved_lamports = 0u64;
        let refund = user
            .deposited
            .checked_sub(approved_lamports)
            .ok_or(EngineErrorCode::ArithmeticOverflow)?;
        if refund > 0 {
            let launch_key = launch_state.key();
            let seeds = [
                SEED_ROOT,
                b"escrow_authority",
                launch_key.as_ref(),
                &[ctx.bumps.escrow_authority],
            ];
            let signer = &[&seeds[..]];
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.escrow_authority.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer,
                ),
                refund,
            )?;
        }
        user.claimed_refund = true;
        emit!(RefundClaimed {
            launch: launch_state.key(),
            user: ctx.accounts.user.key(),
            refunded_lamports: refund,
            y_approved: 0
        });
        return Ok(());
    }

    let mut y = 0u32;
    for j in 0..tcount {
        let t = base.checked_add(j).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        if permute_u32(&seed, n, t) < k_pub {
            y = y.checked_add(1).ok_or(EngineErrorCode::ArithmeticOverflow)?;
        }
    }

    let approved_lamports = (y as u64)
        .checked_mul(launch_state.tau_lamports)
        .ok_or(EngineErrorCode::ArithmeticOverflow)?;
    let refund =
        user.deposited.checked_sub(approved_lamports).ok_or(EngineErrorCode::ArithmeticOverflow)?;
    if refund > 0 {
        let launch_key = launch_state.key();
        let seeds = [
            SEED_ROOT,
            b"escrow_authority",
            launch_key.as_ref(),
            &[ctx.bumps.escrow_authority],
        ];
        let signer = &[&seeds[..]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow_authority.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
                signer,
            ),
            refund,
        )?;
    }
    user.claimed_refund = true;

    emit!(RefundClaimed {
        launch: launch_state.key(),
        user: ctx.accounts.user.key(),
        refunded_lamports: refund,
        y_approved: y,
    });

    Ok(())
}
