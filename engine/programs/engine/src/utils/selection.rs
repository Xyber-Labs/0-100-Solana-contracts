use anchor_lang::solana_program::keccak;

// derive 32-bit ints from seed + tag
#[inline]
fn take_u32(tag: &[u8], seed: &[u8; 32]) -> u32 {
    let h = keccak::hashv(&[seed.as_ref(), tag]);
    // take the lower 4 bytes
    u32::from_le_bytes([h.0[0], h.0[1], h.0[2], h.0[3]])
}

// Fast bijection [0..n) -> [0..n)
pub fn permute_u32(seed: &[u8; 32], n: u32, x: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    if n == 1 {
        return 0;
    }

    // b in [0..n-1]
    let b = take_u32(b"b", seed) % n;

    // a in [1..n-1], with gcd(a, n) = 1
    // start with an odd number, then step by +2 until gcd(a,n) == 1
    let mut a = (take_u32(b"a", seed) % (n.saturating_sub(1))).saturating_add(1);
    if a % 2 == 0 {
        a = a.saturating_add(1) % n;
        if a == 0 {
            a = 1;
        }
    }

    // simple gcd (sufficient for 32-bit)
    fn gcd(mut u: u32, mut v: u32) -> u32 {
        while v != 0 {
            let t = u % v;
            u = v;
            v = t;
        }
        u
    }
    let mut guard = 0u32;
    while gcd(a, n) != 1 {
        a = (a + 2) % n;
        if a == 0 {
            a = 1;
        }
        guard = guard.saturating_add(1);
        // protection against rare pathological cases like n=2, etc.
        if guard > 8 && n.is_power_of_two() {
            a = 1;
            break;
        }
    }

    // F(x) = (a*x + b) mod n
    let ax = (a as u64).wrapping_mul(x as u64) % (n as u64);
    ((ax + (b as u64)) % (n as u64)) as u32
}
