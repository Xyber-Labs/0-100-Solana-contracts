use anchor_lang::solana_program::keccak;

#[inline]
fn take_u32_salted(tag: &[u8], seed: &[u8; 32], salt: u8) -> u32 {
    let h = keccak::hashv(&[seed.as_ref(), tag, &[salt]]);
    u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]])
}

// derive 32-bit ints from seed + tag
#[inline]
fn take_u32(tag: &[u8], seed: &[u8; 32]) -> u32 {
    let h = keccak::hashv(&[seed.as_ref(), tag]);
    // take the lower 4 bytes
    u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]])
}

// Fast bijection [0..n) -> [0..n)
pub fn permute_u32(seed: &[u8; 32], n: u32, x: u32) -> u32 {
    if n <= 1 {
        return 0;
    }

    // b in [0..n-1]
    let b = take_u32(b"b", seed) % n;

    // a in [1..n-1], with gcd(a, n) = 1
    let mut salt = 0u8;
    let a = loop {
        let mut cand = (take_u32_salted(b"a", seed, salt) % (n - 1)).saturating_add(1);
        if n.is_power_of_two() {
            // for powers of two, it is enough to be odd
            cand |= 1;
        }
        if gcd(cand, n) == 1 {
            break cand;
        }
        salt = salt.wrapping_add(1);
    };

    // F(x) = (a*x + b) mod n
    let ax = (a as u64).wrapping_mul(x as u64) % (n as u64);
    ((ax + (b as u64)) % (n as u64)) as u32
}

// simple gcd (sufficient for 32-bit)
#[inline]
fn gcd(mut u: u32, mut v: u32) -> u32 {
    while v != 0 {
        let t = u % v;
        u = v;
        v = t;
    }
    u
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // Helper to check if a function is a permutation for a given n
    fn check_permutation(seed: &[u8; 32], n: u32) {
        if n == 0 {
            assert_eq!(permute_u32(seed, 0, 0), 0);
            return;
        }
        let mut outputs = (0..n)
            .map(|i| permute_u32(seed, n, i))
            .collect::<Vec<u32>>();
        outputs.sort_unstable();
        let expected: Vec<u32> = (0..n).collect();
        assert_eq!(outputs, expected, "Permutation check failed for n = {}", n);

        // Also check for uniqueness explicitly
        let unique_outputs: HashSet<u32> = outputs.into_iter().collect();
        assert_eq!(
            unique_outputs.len(),
            n as usize,
            "Uniqueness check failed for n = {}",
            n
        );
    }

    #[test]
    fn test_permute_u32_bijection() {
        let seed = &[42; 32];

        // Edge cases
        check_permutation(seed, 0);
        check_permutation(seed, 1);
        check_permutation(seed, 2);

        // Power of two
        check_permutation(seed, 4);
        check_permutation(seed, 8);
        check_permutation(seed, 16);

        // Prime numbers
        check_permutation(seed, 3);
        check_permutation(seed, 5);
        check_permutation(seed, 7);
        check_permutation(seed, 17);

        // Composite non-power-of-two
        check_permutation(seed, 6);
        check_permutation(seed, 9);
        check_permutation(seed, 10);
        check_permutation(seed, 15);
    }

    #[test]
    fn test_gcd() {
        assert_eq!(gcd(1, 1), 1);
        assert_eq!(gcd(2, 4), 2);
        assert_eq!(gcd(4, 2), 2);
        assert_eq!(gcd(7, 5), 1);
        assert_eq!(gcd(10, 5), 5);
        assert_eq!(gcd(15, 9), 3);
        assert_eq!(gcd(u32::MAX, u32::MAX - 1), 1);
    }
}
