#[cfg(test)]
mod tests {
    use crate::{
        state::TicketRange,
        utils::lottery::{Lottery, LotteryStatus},
    };

    #[test]
    fn test_required_words() {
        assert_eq!(Lottery::required_words(0), 0);
        assert_eq!(Lottery::required_words(1), 1);
        assert_eq!(Lottery::required_words(64), 1);
        assert_eq!(Lottery::required_words(65), 2);
        assert_eq!(Lottery::required_words(128), 2);
        assert_eq!(Lottery::required_words(129), 3);
        assert_eq!(Lottery::required_words(1000), 16);
        assert_eq!(Lottery::required_words(18000), 282);
    }

    #[test]
    fn test_get_bit() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b1010],
        };
        assert!(!lottery.get_bit(0));
        assert!(lottery.get_bit(1));
        assert!(!lottery.get_bit(2));
        assert!(lottery.get_bit(3));
        assert!(!lottery.get_bit(100));
    }

    #[test]
    fn test_get_bit_second_word() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0, 0b101],
        };
        assert!(!lottery.get_bit(63));
        assert!(lottery.get_bit(64));
        assert!(!lottery.get_bit(65));
        assert!(lottery.get_bit(66));
    }

    #[test]
    fn test_set_bit_simple() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        assert_eq!(lottery.set_bit(5, &[]), Some(5));
        assert!(lottery.get_bit(5));
    }

    #[test]
    fn test_set_bit_second_word() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        assert_eq!(lottery.set_bit(70, &[]), Some(70));
        assert!(lottery.get_bit(70));
    }

    #[test]
    fn test_set_bit_collision() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b111],
        };
        assert_eq!(lottery.set_bit(0, &[]), Some(3));
    }

    #[test]
    fn test_set_bit_collision_cross_word() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX, 0],
        };
        assert_eq!(lottery.set_bit(60, &[]), Some(64));
    }

    #[test]
    fn test_set_bit_wraparound() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![!0b11],
        };
        assert_eq!(lottery.set_bit(60, &[]), Some(0));
    }

    #[test]
    fn test_set_bit_wraparound_cross_word() {
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b1, u64::MAX],
        };
        assert_eq!(lottery.set_bit(100, &[]), Some(1));
    }

    #[test]
    fn test_set_bit_full() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        assert_eq!(lottery.set_bit(0, &[]), None);
    }

    #[test]
    fn test_set_bit_out_of_bounds() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0],
        };
        assert_eq!(lottery.set_bit(100, &[]), None);
    }

    #[test]
    fn test_set_bit_skips_withdrawn() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0],
        };
        let withdrawn = vec![TicketRange::new(5, 10)];
        assert_eq!(lottery.set_bit(5, &withdrawn), Some(10));
        assert!(!lottery.get_bit(5));
        assert!(lottery.get_bit(10));
    }

    #[test]
    fn test_set_bit_skips_withdrawn_wraparound() {
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b1111],
        };
        let withdrawn = vec![TicketRange::new(4, 10)];
        assert_eq!(lottery.set_bit(4, &withdrawn), Some(10));
    }

    #[test]
    fn test_count_ones_empty() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 128)), 0);
    }

    #[test]
    fn test_count_ones_all_set() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 64)), 64);
    }

    #[test]
    fn test_count_ones_partial() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b11111],
        };
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 10)), 5);
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 5)), 5);
        assert_eq!(lottery.count_ones(&TicketRange::new(2, 7)), 3);
    }

    #[test]
    fn test_count_ones_cross_word() {
        let lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX, 0b1111],
        };
        assert_eq!(lottery.count_ones(&TicketRange::new(60, 70)), 8);
    }

    #[test]
    fn test_allocate() {
        let mut lottery = Lottery::default();
        assert_eq!(lottery.allocate(10, false), Some(0));
        assert_eq!(lottery.bits_allocated, 10);
        assert_eq!(lottery.bits.len(), 1);

        assert_eq!(lottery.allocate(60, false), Some(10));
        assert_eq!(lottery.bits_allocated, 70);
        assert_eq!(lottery.bits.len(), 2);
    }

    #[test]
    fn test_allocate_overflow() {
        let mut lottery = Lottery {
            bits_allocated: u64::MAX - 5,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![],
        };
        assert_eq!(lottery.allocate(10, false), None);
    }

    #[test]
    fn test_allocate_winning() {
        let mut lottery = Lottery::default();
        lottery.allocate(60, false);
        lottery.allocate(10, true);
        lottery.allocate(10, false);

        assert!(!lottery.get_bit(0));
        assert!(!lottery.get_bit(59));
        assert!(lottery.get_bit(60));
        assert!(lottery.get_bit(69));
        assert!(!lottery.get_bit(70));
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 80)), 10);
    }

    #[test]
    fn test_clear_range() {
        let mut lottery = Lottery::default();
        lottery.allocate(10, true);
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 10)), 10);

        lottery.clear_range(&TicketRange::new(3, 7));
        assert!(lottery.get_bit(2));
        assert!(!lottery.get_bit(3));
        assert!(!lottery.get_bit(6));
        assert!(lottery.get_bit(7));
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 10)), 6);
    }

    #[test]
    fn test_finalize_no_overflow() {
        let seed = [1u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0],
        };
        let winners = lottery.finalize(&seed, 100, &[], 64000).unwrap();
        assert_eq!(winners, 64);
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 64)), 64);
        assert_eq!(
            lottery.status,
            LotteryStatus::Finalized {
                tokens_per_ticket: 1000
            }
        );
    }

    #[test]
    fn test_finalize_overflow() {
        let seed = [2u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 128,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        let winners = lottery.finalize(&seed, 50, &[], 50000).unwrap();
        assert_eq!(winners, 50);
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 128)), 50);
        assert_eq!(
            lottery.status,
            LotteryStatus::Finalized {
                tokens_per_ticket: 1000
            }
        );
    }

    #[test]
    #[should_panic]
    fn test_finalize_zero_tickets_panics() {
        let seed = [3u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 0,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![],
        };
        let _ = lottery.finalize(&seed, 50, &[], 0);
    }

    #[test]
    fn test_finalize_with_withdrawn() {
        let seed = [4u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 100,
            inactive: 20,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        let withdrawn = vec![TicketRange::new(10, 30)];
        let winners = lottery.finalize(&seed, 50, &withdrawn, 50000).unwrap();
        assert_eq!(winners, 50);
        for i in 10..30 {
            assert!(!lottery.get_bit(i));
        }
        assert!(matches!(lottery.status, LotteryStatus::Finalized { .. }));
    }

    #[test]
    fn test_finalize_with_withdrawn_all_win() {
        let seed = [5u8; 32];
        let mut lottery = Lottery {
            bits_allocated: 100,
            inactive: 20,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0; 2],
        };
        let withdrawn = vec![TicketRange::new(20, 40)];
        let winners = lottery.finalize(&seed, 100, &withdrawn, 80000).unwrap();
        assert_eq!(winners, 80);
        for i in 20..40 {
            assert!(!lottery.get_bit(i));
        }
        assert_eq!(lottery.count_ones(&TicketRange::new(0, 100)), 80);
        assert_eq!(
            lottery.status,
            LotteryStatus::Finalized {
                tokens_per_ticket: 1000
            }
        );
    }

    #[test]
    fn test_count_winning_in_ranges_empty() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0],
        };
        assert_eq!(lottery.count_winning_in_ranges(&[]), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_no_winners() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0],
        };
        let ranges = vec![TicketRange::new(0, 10), TicketRange::new(20, 25)];
        assert_eq!(lottery.count_winning_in_ranges(&ranges), 0);
    }

    #[test]
    fn test_count_winning_in_ranges_all_winners() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![u64::MAX],
        };
        let ranges = vec![TicketRange::new(0, 10), TicketRange::new(20, 25)];
        assert_eq!(lottery.count_winning_in_ranges(&ranges), 15);
    }

    #[test]
    fn test_count_winning_in_ranges_partial() {
        let lottery = Lottery {
            bits_allocated: 64,
            inactive: 0,
            status: LotteryStatus::InProgress { _padding: 0 },
            bits: vec![0b11111111],
        };
        let ranges = vec![TicketRange::new(0, 10), TicketRange::new(20, 25)];
        assert_eq!(lottery.count_winning_in_ranges(&ranges), 8);
    }
}
