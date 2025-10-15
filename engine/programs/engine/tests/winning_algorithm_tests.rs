use engine::utils::selection::permute_u32;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_winning_algorithm_math() {
        // Test parameters similar to your case
        let seed = [42u8; 32]; // Fixed seed for reproducible results
        let n = 900u32; // Total tickets
        let k_pub = 442u32; // Public winning tickets

        println!("Testing winning algorithm with:");
        println!("  n (total tickets): {}", n);
        println!("  k_pub (winning tickets): {}", k_pub);
        println!("  Expected win rate: {:.2}%", (k_pub as f64 / n as f64 * 100.0));

        // Test all tickets
        let mut winning_count = 0u32;
        let mut winning_tickets = Vec::new();

        for ticket_index in 0..n {
            let permuted = permute_u32(&seed, n, ticket_index);
            if permuted < k_pub {
                winning_count += 1;
                winning_tickets.push(ticket_index);
            }
        }

        println!("Results:");
        println!("  Total tickets tested: {}", n);
        println!("  Winning tickets found: {}", winning_count);
        println!("  Actual win rate: {:.2}%", (winning_count as f64 / n as f64 * 100.0));
        println!("  Expected winning tickets: {}", k_pub);

        // This should NEVER happen if the algorithm is correct
        assert_eq!(
            winning_count, k_pub,
            "CRITICAL BUG: Found {} winning tickets, but mathematically only {} should win!",
            winning_count, k_pub
        );

        // Verify all winning tickets are unique
        winning_tickets.sort();
        for i in 1..winning_tickets.len() {
            assert_ne!(
                winning_tickets[i - 1],
                winning_tickets[i],
                "Duplicate winning ticket found: {}",
                winning_tickets[i]
            );
        }

        println!("✅ Test passed: Algorithm works correctly!");
    }

    #[test]
    fn test_permute_u32_bijection_property() {
        let seed = [123u8; 32];
        let n = 1000u32;

        // Test that permute_u32 is a bijection
        let mut outputs = Vec::new();
        for i in 0..n {
            outputs.push(permute_u32(&seed, n, i));
        }

        // Sort and check we get all values 0..n-1
        outputs.sort();
        for i in 0..n {
            assert_eq!(outputs[i as usize], i, "Permutation is not bijective: missing value {}", i);
        }

        println!("✅ Permutation bijection test passed for n={}", n);
    }

    #[test]
    fn test_winning_algorithm_edge_cases() {
        let seed = [99u8; 32];

        // Test edge cases
        let test_cases = vec![
            (10, 5),     // 50% win rate
            (100, 10),   // 10% win rate
            (1000, 100), // 10% win rate
            (500, 250),  // 50% win rate
        ];

        for (n, k_pub) in test_cases {
            let mut winning_count = 0u32;

            for ticket_index in 0..n {
                let permuted = permute_u32(&seed, n, ticket_index);
                if permuted < k_pub {
                    winning_count += 1;
                }
            }

            assert_eq!(
                winning_count, k_pub,
                "Test failed for n={}, k_pub={}: found {} winners instead of {}",
                n, k_pub, winning_count, k_pub
            );

            println!(
                "✅ Edge case test passed: n={}, k_pub={}, winners={}",
                n, k_pub, winning_count
            );
        }
    }

    #[test]
    fn test_shard_indexing_logic() {
        // Simulate shard indexing like in the contract
        let seed = [77u8; 32];
        let total_tickets = 900u32;
        let k_pub = 442u32;

        // Simulate 2 shards: shard 0 (0-499), shard 1 (500-899)
        let shard_0_base = 0u32;
        let shard_1_base = 500u32;
        let shard_0_tickets = 500u32;
        let shard_1_tickets = 400u32;

        let mut total_winners = 0u32;
        let mut shard_0_winners = 0u32;
        let mut shard_1_winners = 0u32;

        // Test shard 0
        for local_ticket in 0..shard_0_tickets {
            let global_ticket = shard_0_base + local_ticket;
            let permuted = permute_u32(&seed, total_tickets, global_ticket);
            if permuted < k_pub {
                shard_0_winners += 1;
                total_winners += 1;
            }
        }

        // Test shard 1
        for local_ticket in 0..shard_1_tickets {
            let global_ticket = shard_1_base + local_ticket;
            let permuted = permute_u32(&seed, total_tickets, global_ticket);
            if permuted < k_pub {
                shard_1_winners += 1;
                total_winners += 1;
            }
        }

        println!("Shard indexing test results:");
        println!("  Shard 0 winners: {}", shard_0_winners);
        println!("  Shard 1 winners: {}", shard_1_winners);
        println!("  Total winners: {}", total_winners);
        println!("  Expected winners: {}", k_pub);

        assert_eq!(
            total_winners, k_pub,
            "Shard indexing failed: total winners {} != expected {}",
            total_winners, k_pub
        );

        println!("✅ Shard indexing test passed!");
    }

    #[test]
    fn test_full_contract_simulation() {
        // Simulate a full contract run with 300 users
        let seed = [123u8; 32];
        let n = 900u32;
        let k_capacity = 450u32;
        let reserved = 8u32;
        let k_pub = k_capacity - reserved;

        println!("Full contract simulation:");
        println!("  Simulating 300 users with 1-5 tickets each");

        let mut total_tickets = 0u32;
        let mut total_winning_tickets = 0u32;
        let mut winning_users = 0u32;
        let mut global_ticket_index = 0u32;

        // Simulate 300 users with proper global indexing
        for user_id in 0..300 {
            let ticket_count = (user_id % 5) + 1; // 1-5 tickets per user
            total_tickets += ticket_count;

            // Simulate contract logic for this user with proper global indexing
            let mut y = 0u32;
            for j in 0..ticket_count {
                let t = global_ticket_index + j; // Proper global ticket index
                let permuted = permute_u32(&seed, n, t);
                if permuted < k_pub {
                    y += 1;
                }
            }

            global_ticket_index += ticket_count; // Move to next user's tickets

            if y > 0 {
                winning_users += 1;
                total_winning_tickets += y;
            }
        }

        println!("Simulation results:");
        println!("  Total users: 300");
        println!("  Total tickets: {}", total_tickets);
        println!("  Winning users: {}", winning_users);
        println!("  Total winning tickets: {}", total_winning_tickets);
        println!("  Expected max winning tickets: {}", k_pub);
        println!(
            "  Win rate: {:.2}%",
            (total_winning_tickets as f64 / total_tickets as f64 * 100.0)
        );

        // Critical check
        assert!(
            total_winning_tickets <= k_pub,
            "CRITICAL BUG: Simulation shows {} winning tickets, but max possible is {}!",
            total_winning_tickets,
            k_pub
        );

        println!("✅ Full contract simulation passed!");
    }
}
