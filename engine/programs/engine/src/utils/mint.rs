use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token,
    metadata::{self, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3},
    token::{self, MintTo},
};

use crate::{state::TokenMetadataConfig, LaunchState, SEED_ROOT};

pub fn create_ata_for_authority<'info>(
    associated_token_program: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    associated_token: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    associated_token::create(CpiContext::new(
        associated_token_program.clone(),
        associated_token::Create {
            payer: payer.clone(),
            associated_token: associated_token.clone(),
            authority: authority.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.clone(),
        },
    ))?;
    Ok(())
}

pub fn mint_to_escrow_for_launch<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    escrow_authority: &AccountInfo<'info>,
    launch_key: &Pubkey,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[
        SEED_ROOT,
        b"escrow_authority",
        &launch_key.to_bytes(),
        &[LaunchState::mint_auth_bump_for(launch_key)],
    ];
    let signer_seeds = &[seeds];
    let mint_accounts = MintTo {
        mint: mint.clone(),
        to: to.clone(),
        authority: escrow_authority.clone(),
    };
    let mint_ctx = CpiContext::new_with_signer(token_program.clone(), mint_accounts, signer_seeds);
    token::mint_to(mint_ctx, amount)?;
    Ok(())
}

pub fn derive_metadata_pda(metaplex_program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let seeds = &[
        b"metadata".as_ref(),
        metaplex_program_id.as_ref(),
        mint.as_ref(),
    ];
    Pubkey::find_program_address(seeds, metaplex_program_id).0
}

pub fn ensure_token_metadata_for_launch<'info>(
    token_metadata_program: &AccountInfo<'info>,
    metadata_account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    escrow_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    rent: &AccountInfo<'info>,
    token_metadata_config: &TokenMetadataConfig,
    launch_key: &Pubkey,
) -> Result<()> {
    let expected = derive_metadata_pda(&token_metadata_program.key(), &mint.key());
    require_keys_eq!(metadata_account.key(), expected, crate::errors::ErrorCode::InvalidOwner);

    if metadata_account.lamports() == 0 {
        let data = DataV2 {
            name: token_metadata_config.name.clone(),
            symbol: token_metadata_config.symbol.clone(),
            uri: token_metadata_config.uri.clone(),
            seller_fee_basis_points: token_metadata_config.seller_fee_basis_points,
            creators: None,
            collection: None,
            uses: None,
        };

        let seeds: &[&[u8]] = &[
            SEED_ROOT,
            b"escrow_authority",
            &launch_key.to_bytes(),
            &[LaunchState::mint_auth_bump_for(launch_key)],
        ];
        let signer_seeds = &[seeds];

        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: metadata_account.clone(),
            mint: mint.clone(),
            mint_authority: escrow_authority.clone(),
            payer: payer.clone(),
            update_authority: escrow_authority.clone(),
            system_program: system_program.clone(),
            rent: rent.clone(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(token_metadata_program.clone(), cpi_accounts, signer_seeds);
        metadata::create_metadata_accounts_v3(
            cpi_ctx,
            data,
            token_metadata_config.is_mutable,
            true,
            None,
        )?;
    }
    Ok(())
}
