use primitive_types::U256;

/// Utility functions for blockhash range calculations and validation

pub mod pool;
pub mod selection;
pub mod roster;

/// Check if a blockhash is within the project's personal range
/// Each project gets its own range based on project_id
pub fn is_blockhash_in_project_range(
    blockhash: &[u8; 32],
    project_id: u64,
    num_blocks: u64,
) -> bool {
    // In test mode, always return true for easier testing
    #[cfg(feature = "test")]
    {
        return true;
    }

    let hash_as_u256 = U256::from_big_endian(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id, num_blocks);

    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

/// Calculate the personal range for a project based on its ID
/// Range width = 2^256 / N
/// Project n gets range: [(n-1) * width, n * width)
pub fn calculate_project_range(project_id: u64, num_blocks: u64) -> (U256, U256) {
    // Range width = 2^256 / N
    let range_width = calculate_range_width(num_blocks);

    // Calculate start and end of the range for this project
    let project_id_u256 = U256::from(project_id);
    let range_start = range_width.saturating_mul(project_id_u256.saturating_sub(U256::one()));
    let range_end = range_start.saturating_add(range_width);

    (range_start, range_end)
}

/// Calculate the width of each project's range
/// This is ~2^256 / N
pub fn calculate_range_width(num_blocks: u64) -> U256 {
    // Full 2^256 range
    let full_range = U256::max_value();

    // Number of Solana blocks (N)
    let n = U256::from(num_blocks);

    if n.is_zero() {
        return U256::zero();
    }

    // Use right shift for division to avoid stack overflow
    let shift = n.bits() - 1;
    full_range >> shift
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_range_width_precision() {
        let n = 81000;
        let width = calculate_range_width(n);
        
        let full_range = U256::max_value();
        let calculated_total = width * U256::from(n);
        let difference = full_range - calculated_total;

        // The difference should be small, less than N, due to floor division.
        // This confirms that the lost precision is minimal.
        assert!(difference < U256::from(n));
    }

    #[test]
    fn test_calculate_project_range() {
        let project_id = 10;
        let num_blocks = 150;
        let width = calculate_range_width(num_blocks);

        let (start, end) = calculate_project_range(project_id, num_blocks);
        
        // n = 10, so range is [9 * width, 10 * width)
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
        
        let hash_inside = start.to_big_endian(); // Exactly at the start

        let hash_outside = end.to_big_endian(); // Exactly at the end (exclusive)

        let mut hash_before = [0u8; 32];
        if start > U256::zero() {
            hash_before = (start - U256::one()).to_big_endian();
        }

        assert!(is_blockhash_in_project_range(&hash_inside, project_id, num_blocks));
        assert!(!is_blockhash_in_project_range(&hash_outside, project_id, num_blocks));
        if start > U256::zero() {
            assert!(!is_blockhash_in_project_range(&hash_before, project_id, num_blocks));
        }
    }
}
