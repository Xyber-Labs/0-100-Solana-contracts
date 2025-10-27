use super::U256;


/// Check if a blockhash is within the project's personal range.
pub fn is_blockhash_in_project_range(
    blockhash: &[u8; 32],
    project_id: u64,
    num_partitions: u64,
) -> bool {
    let hash_as_u256 = U256::from_big_endian(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id, num_partitions);

    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

/// Calculate the personal range for a project based on its ID (0-based, modulo).
/// Range width = floor((2^256 - 1) / N) using U256::MAX / N.
/// Segment index: seg = project_id % num_partitions.
/// Range is half-open: [seg * width, (seg + 1) * width)
pub fn calculate_project_range(project_id: u64, num_partitions: u64) -> (U256, U256) {
    if num_partitions == 0 {
        return (U256::zero(), U256::zero());
    }

    let seg = project_id % num_partitions;
    let seg_u256 = U256::from(seg);
    let n_u256 = U256::from(num_partitions);

    let width = U256::MAX / n_u256;

    let start = width * seg_u256;
    let end_exclusive = start + width;

    (start, end_exclusive)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_project_range() {
        let project_id = 10;
        let num_partitions = 150;
        let (start, end) = calculate_project_range(project_id, num_partitions);

        // 0-based + modulo: seg = project_id % num_partitions
        // range = [seg * width, (seg + 1) * width)
        let width = U256::MAX / U256::from(num_partitions);
        let seg = project_id % num_partitions;
        let expected_start = width * U256::from(seg);
        let expected_end = expected_start + width;

        assert_eq!(start, expected_start);
        assert_eq!(end, expected_end);
    }

    #[test]
    fn test_is_blockhash_in_project_range() {
        let project_id = 20;
        let num_partitions = 81000;

        let (start, end) = calculate_project_range(project_id, num_partitions);

        let mut hash_inside_bytes = [0u8; 32];
        start.to_big_endian(&mut hash_inside_bytes);

        let mut hash_outside_bytes = [0u8; 32];
        end.to_big_endian(&mut hash_outside_bytes);

        let mut hash_before_bytes = [0u8; 32];
        if start > U256::zero() {
            (start - U256::one()).to_big_endian(&mut hash_before_bytes);
        }

        assert!(is_blockhash_in_project_range(&hash_inside_bytes, project_id, num_partitions));
        assert!(!is_blockhash_in_project_range(&hash_outside_bytes, project_id, num_partitions));
        if start > U256::zero() {
            assert!(!is_blockhash_in_project_range(&hash_before_bytes, project_id, num_partitions));
        }
    }
}
