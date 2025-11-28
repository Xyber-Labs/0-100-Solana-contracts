use super::U256;

const DEFAULT_N: u64 = 100;

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

/// Calculate the personal range for a project based on its 1-based ID.
/// Range width = floor((2^256 - 1) / N) using U256::MAX / N.
/// Segment index: seg = (project_id - 1) % num_partitions (1-based → 0-based).
/// Range is half-open: [seg * width, (seg + 1) * width)
pub fn calculate_project_range(project_id: u64, num_partitions: u64) -> (U256, U256) {
    if num_partitions == 0 {
        return (U256::zero(), U256::zero());
    }

    let seg = if project_id == 0 {
        0
    } else {
        (project_id - 1) % num_partitions
    };
    let seg_u256 = U256::from(seg);
    let n_u256 = U256::from(num_partitions);

    let width = U256::MAX / n_u256;

    let start = width * seg_u256;
    let end_exclusive = start + width;

    (start, end_exclusive)
}

/// Map an unlock time window (in seconds) to an internal partition count N.
/// Logic: N ≈ number of blocks expected in T seconds. With block time ~0.4s,
/// N = floor(T * 5 / 2). Fallback to DEFAULT_N if T <= 0.
pub fn derive_num_partitions_from_unlock(unlock_time_sec: i64) -> u64 {
    if unlock_time_sec <= 0 {
        return DEFAULT_N;
    }
    let seconds = unlock_time_sec as u64;
    let approx_blocks = seconds.saturating_mul(5).saturating_div(2);
    approx_blocks.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_num_partitions() {
        let num_partitions = derive_num_partitions_from_unlock(7200);
        assert_eq!(num_partitions, 18000);
    }

    #[test]
    fn test_calculate_project_range() {
        let project_id = 10;
        let num_partitions = 150;
        let (start, end) = calculate_project_range(project_id, num_partitions);

        // 1-based project_id → 0-based seg: // seg = (project_id - 1) % num_partitions
        // range = [seg * width, (seg + 1) * width)
        let width = U256::MAX / U256::from(num_partitions);
        let seg = (project_id - 1) % num_partitions;
        let expected_start = width * U256::from(seg);
        let expected_end = expected_start + width;

        assert_eq!(start, expected_start);
        assert_eq!(end, expected_end);
    }

    #[test]
    fn test_calculate_project_range_large_partition() {
        let project_id = 20;
        let num_partitions = 81_000;
        let (start, end) = calculate_project_range(project_id, num_partitions);

        let expected_start = U256::from_dec_str(
            "27161107351963058185775910063766299372989255662310749589502396248769746440",
        )
        .unwrap();
        let expected_end = U256::from_dec_str(
            "28590639317855850721869379014490841445251848065590262725791996051336575200",
        )
        .unwrap();

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
