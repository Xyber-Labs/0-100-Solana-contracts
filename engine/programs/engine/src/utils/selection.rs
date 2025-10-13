/// Ultra-simple permutation for testing - just basic arithmetic
/// This is NOT cryptographically secure, just for testing compute unit limits
pub fn permute_u32(_seed: &[u8; 32], n: u32, x: u32) -> u32 {
    // Ultra-simple: just use x % n for testing
    // This is completely deterministic and fast
    x % n
}
