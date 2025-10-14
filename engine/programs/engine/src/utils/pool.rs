use super::U256;
use anchor_lang::prelude::*;

use crate::SEED_ROOT;

/// Calculate escrow address for a launch
pub fn escrow_address(launch: Pubkey) -> Pubkey {
    let (address, _) = Pubkey::find_program_address(
        &[SEED_ROOT, b"escrow", launch.as_ref()],
        &crate::ID,
    );
    address
}

/// Check if a blockhash is within the project's personal range.
pub fn is_blockhash_in_project_range(
    blockhash: &[u8; 32],
    project_id: u64,
    num_blocks: u64,
) -> bool {
    let hash_as_u256 = U256::from_big_endian(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id, num_blocks);

    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

/// Calculate the personal range for a project based on its ID.
/// Range width = 2^256 / N
/// Project n gets range: [(n-1) * width, n * width)
pub fn calculate_project_range(project_id: u64, num_blocks: u64) -> (U256, U256) {
    if num_blocks == 0 {
        return (U256::zero(), U256::zero());
    }
    let n = U256::from(num_blocks);
    let range_width = U256::MAX / n;

    let project_id_u256 = U256::from(project_id);
    let range_start = range_width
        .checked_mul(
            project_id_u256
                .checked_sub(U256::one())
                .expect("project_id must be > 0"),
        )
        .expect("range start calculation failed");
    let range_end = range_start
        .checked_add(range_width)
        .expect("range end calculation failed");

    (range_start, range_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_project_range() {
        let project_id = 10;
        let num_blocks = 150;
        let (start, end) = calculate_project_range(project_id, num_blocks);

        // n = 10, so range is [9 * width, 10 * width)
        let width = U256::MAX / U256::from(num_blocks);
        let expected_start = width * U256::from(9);
        let expected_end = width * U256::from(10);

        assert_eq!(start, expected_start);
        assert_eq!(end, expected_end);
    }

    #[test]
    fn test_is_blockhash_in_project_range() {
        let project_id = 20;
        let num_blocks = 81000;

        let (start, end) = calculate_project_range(project_id, num_blocks);

        let mut hash_inside_bytes = [0u8; 32];
        start.to_big_endian(&mut hash_inside_bytes);

        let mut hash_outside_bytes = [0u8; 32];
        end.to_big_endian(&mut hash_outside_bytes);

        let mut hash_before_bytes = [0u8; 32];
        if start > U256::zero() {
            (start - U256::one()).to_big_endian(&mut hash_before_bytes);
        }

        assert!(is_blockhash_in_project_range(
            &hash_inside_bytes,
            project_id,
            num_blocks
        ));
        assert!(!is_blockhash_in_project_range(
            &hash_outside_bytes,
            project_id,
            num_blocks
        ));
        if start > U256::zero() {
            assert!(!is_blockhash_in_project_range(
                &hash_before_bytes,
                project_id,
                num_blocks
            ));
        }
    }
}
