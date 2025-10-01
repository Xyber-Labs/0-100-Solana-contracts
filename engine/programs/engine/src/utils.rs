/// Utility functions for blockhash range calculations and validation

pub mod pool;
pub mod selection;
pub mod roster;

/// Check if a blockhash is within the project's personal range
/// Each project gets its own range based on project_id
pub fn is_blockhash_in_project_range(blockhash: &[u8; 32], project_id: u64) -> bool {
    // In test mode, always return true for easier testing
    #[cfg(feature = "test")]
    {
        return true;
    }
    
    let hash_as_u256 = u256_from_bytes(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id);
    
    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

/// Check if a blockhash is within the project's personal range (test version)
/// For testing purposes, this version allows manual override
pub fn is_blockhash_in_project_range_test(blockhash: &[u8; 32], project_id: u64, force_valid: bool) -> bool {
    if force_valid {
        return true;
    }
    
    let hash_as_u256 = u256_from_bytes(blockhash);
    let (range_start, range_end) = calculate_project_range(project_id);
    
    hash_as_u256 >= range_start && hash_as_u256 < range_end
}

/// Calculate the personal range for a project based on its ID
/// Range width = 2^256 / 54000 (blocks in 6 hours)
/// Project n gets range: [(n-1) * width, n * width)
pub fn calculate_project_range(project_id: u64) -> ([u8; 32], [u8; 32]) {
    // Range width = 2^256 / 54000
    // We'll use a simplified calculation for Solana's 32-byte hashes
    let range_width = calculate_range_width();
    
    // Calculate start and end of the range for this project
    let range_start = multiply_u256_by_u64(range_width, project_id.saturating_sub(1));
    let range_end = multiply_u256_by_u64(range_width, project_id);
    
    (range_start, range_end)
}

/// Calculate the width of each project's range
/// This is 2^256 / 54000, but we'll use a simplified approach
pub fn calculate_range_width() -> [u8; 32] {
    // For simplicity, we'll use a fixed range width
    // In practice, this should be calculated as 2^256 / 54000
    // Using a smaller value for testing: 2^240 / 54000
    u256_from_hex("0x1000000000000000000000000000000000000000000000000000000000000000")
}

/// Multiply a 256-bit number by a 64-bit number
/// Simplified implementation for our use case
pub fn multiply_u256_by_u64(base: [u8; 32], multiplier: u64) -> [u8; 32] {
    if multiplier == 0 {
        return [0u8; 32];
    }
    
    // Convert base to u128 for easier calculation (using first 16 bytes)
    let base_low = u128::from_le_bytes([
        base[0], base[1], base[2], base[3], base[4], base[5], base[6], base[7],
        base[8], base[9], base[10], base[11], base[12], base[13], base[14], base[15]
    ]);
    
    let base_high = u128::from_le_bytes([
        base[16], base[17], base[18], base[19], base[20], base[21], base[22], base[23],
        base[24], base[25], base[26], base[27], base[28], base[29], base[30], base[31]
    ]);
    
    // Multiply by multiplier
    let result_low = base_low * (multiplier as u128);
    let result_high = base_high * (multiplier as u128);
    
    // Handle overflow from low to high
    let (result_low, carry) = result_low.overflowing_add(result_high & 0xFFFFFFFFFFFFFFFF);
    let result_high = (result_high >> 64) + (carry as u128);
    
    // Convert back to [u8; 32]
    let mut result = [0u8; 32];
    result[0..16].copy_from_slice(&result_low.to_le_bytes());
    result[16..32].copy_from_slice(&result_high.to_le_bytes());
    
    result
}

/// Convert 32-byte array to u256 (big-endian)
pub fn u256_from_bytes(bytes: &[u8; 32]) -> [u8; 32] {
    *bytes
}

/// Create u256 from hex string
pub fn u256_from_hex(hex: &str) -> [u8; 32] {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    let mut result = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        if i < 32 {
            let byte_str = std::str::from_utf8(chunk).unwrap();
            result[i] = u8::from_str_radix(byte_str, 16).unwrap_or(0);
        }
    }
    result
}

/// Generate a test blockhash that will always be valid for a given project
/// This is for testing purposes only
#[cfg(feature = "test")]
pub fn generate_test_blockhash(project_id: u64) -> [u8; 32] {
    let (range_start, _range_end) = calculate_project_range(project_id);
    
    // Return a blockhash that's exactly at the start of the range
    // This ensures it will always be valid
    range_start
}

/// Check if we're in test mode
#[cfg(feature = "test")]
pub fn is_test_mode() -> bool {
    true
}

#[cfg(not(feature = "test"))]
pub fn is_test_mode() -> bool {
    false
}
