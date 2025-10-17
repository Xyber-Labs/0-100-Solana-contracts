use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

use crate::errors::ErrorCode;

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy)]
struct DistributionRule {
    market_cap: u128,
    recipient: Pubkey,
    share: u128,
    priority: u8,
}

impl DistributionRule {
    fn new(market_cap: u128, recipient: Pubkey, share: u128, priority: u8) -> Self {
        Self {
            market_cap,
            recipient,
            share,
            priority,
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize)]
struct IncomeCalculator {
    price_in_quote: u128,
    base_decimals: u8,
    rules: Vec<DistributionRule>,
}

#[derive(Default, Clone)]
struct Income {
    recipient: Pubkey,
    base_token: u128,
    quote_token: u128,
}

struct Distribution {
    incomes: Vec<Income>,
    price_in_quote: u128,
    base_decimals: u8,
}

impl Distribution {
    fn get(&self, recipient: &Pubkey) -> Result<&Income> {
        self.incomes
            .iter()
            .find(|d| d.recipient == *recipient)
            .ok_or(ErrorCode::RecipientNotFound.into())
    }

    #[cfg(test)]
    fn total_in_quote(&self, recipient: &Pubkey) -> Result<u128> {
        let income = self.get(recipient)?;
        let base_decimals_divisor = 10u128.pow(self.base_decimals as u32);
        let base_in_quote = income
            .base_token
            .checked_mul(self.price_in_quote)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(base_decimals_divisor)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        base_in_quote.checked_add(income.quote_token).ok_or(ErrorCode::ArithmeticOverflow.into())
    }

    fn len(&self) -> usize {
        self.incomes.len()
    }
}

impl IncomeCalculator {
    const BASIS_POINTS: u128 = 10_000;

    pub(super) fn new(price_in_quote: u128, base_decimals: u8) -> Self {
        Self {
            price_in_quote,
            base_decimals,
            rules: Vec::new(),
        }
    }

    pub(super) fn add_rule(mut self, rule: DistributionRule) -> Self {
        let insert_pos = self
            .rules
            .binary_search_by_key(&(rule.market_cap, rule.priority), |r| (r.market_cap, r.priority))
            .unwrap_or_else(|pos| pos);
        self.rules.insert(insert_pos, rule);
        self
    }

    pub(super) fn is_valid(&self) -> bool {
        if self.rules.is_empty() {
            return true;
        }

        let mut current_cap = self.rules[0].market_cap;
        let mut share_sum: u128 = 0;

        for rule in &self.rules {
            if rule.market_cap != current_cap {
                if share_sum != Self::BASIS_POINTS {
                    return false;
                }
                current_cap = rule.market_cap;
                share_sum = 0;
            }
            share_sum = match share_sum.checked_add(rule.share) {
                Some(sum) => sum,
                None => return false,
            };
        }
        share_sum == Self::BASIS_POINTS
    }

    pub(super) fn get_distribution(
        &self,
        market_cap: u128,
        base_token_volume: u128,
        quote_token_volume: u128,
    ) -> Result<Distribution> {
        let end = self.rules.partition_point(|r| r.market_cap <= market_cap);
        let index = end.checked_sub(1).ok_or(ErrorCode::NoDistributionRules)?;
        let max_applicable_cap_value = self.rules[index].market_cap;
        let start = self.rules.partition_point(|r| r.market_cap < max_applicable_cap_value);

        let base_decimals_divisor = 10u128.pow(self.base_decimals as u32);
        let base_in_quote = base_token_volume
            .checked_mul(self.price_in_quote)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(base_decimals_divisor)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let total_income_in_quote =
            base_in_quote.checked_add(quote_token_volume).ok_or(ErrorCode::ArithmeticOverflow)?;
        let mut rem_base = base_token_volume;
        let mut rem_quote = quote_token_volume;
        let mut distributions = Vec::new();

        for rule in &self.rules[start..end] {
            let share_in_quote = total_income_in_quote
                .checked_mul(rule.share)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(Self::BASIS_POINTS)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            let quote_taken = rem_quote.min(share_in_quote);
            rem_quote = rem_quote.checked_sub(quote_taken).expect("Not reachable: rem_q < taken_q");

            let rem_share_in_quote =
                share_in_quote.checked_sub(quote_taken).expect("Not reachable: share_q < taken_q");
            let base_needed = rem_share_in_quote
                .checked_mul(base_decimals_divisor)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(self.price_in_quote)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let base_taken = rem_base.min(base_needed);
            rem_base = rem_base.checked_sub(base_taken).expect("Not reachable: rem_b < taken_b");

            distributions.push(Income {
                recipient: rule.recipient,
                base_token: base_taken,
                quote_token: quote_taken,
            });
        }

        Ok(Distribution {
            incomes: distributions,
            price_in_quote: self.price_in_quote,
            base_decimals: self.base_decimals,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestSetup {
        calculator: IncomeCalculator,
        platform: Pubkey,
        community: Pubkey,
        creator: Pubkey,
    }

    #[test]
    fn test_low_tier_for_sol() {
        let TestSetup {
            calculator,
            platform,
            community,
            creator,
        } = create_calculator_with_tiers(10_000_000, 6);
        let dist_tier1 = calculator
            .get_distribution(250, 100_000_000, 2_125_000_000)
            .expect("distribution calculation failed");

        assert_eq!(dist_tier1.len(), 3);
        let platform_dist = dist_tier1.get(&platform).expect("platform not found");
        let community_dist = dist_tier1.get(&community).expect("community not found");
        let creator_dist = dist_tier1.get(&creator).expect("creator not found");

        let total_platform = dist_tier1.total_in_quote(&platform).expect("calculation failed");
        let total_community = dist_tier1.total_in_quote(&community).expect("calculation failed");
        let total_creator = dist_tier1.total_in_quote(&creator).expect("calculation failed");

        assert_eq!(total_platform + total_community + total_creator, 3_125_000_000);
        assert_eq!(total_platform, 1_875_000_000);
        assert_eq!(total_community, 468_750_000);
        assert_eq!(total_creator, 781_250_000);
        assert_eq!(platform_dist.base_token, 0);
        assert_eq!(platform_dist.quote_token, 1_875_000_000);
        assert_eq!(community_dist.base_token, 46_875_000);
        assert_eq!(community_dist.quote_token, 0);
        assert_eq!(creator_dist.base_token, 53_125_000);
        assert_eq!(creator_dist.quote_token, 250_000_000);
    }

    #[test]
    fn test_high_tier_for_sol() {
        let TestSetup {
            calculator,
            platform,
            community,
            creator,
        } = create_calculator_with_tiers(10_000_000, 6);

        let dist = calculator
            .get_distribution(150_000, 200_000_000, 500_000_000)
            .expect("distribution calculation failed");

        assert_eq!(dist.len(), 3);
        let platform_dist = dist.get(&platform).expect("platform not found");
        let community_dist = dist.get(&community).expect("community not found");
        let creator_dist = dist.get(&creator).expect("creator not found");

        let total_platform = dist.total_in_quote(&platform).expect("calculation failed");
        let total_community = dist.total_in_quote(&community).expect("calculation failed");
        let total_creator = dist.total_in_quote(&creator).expect("calculation failed");

        assert_eq!(total_platform + total_community + total_creator, 2_500_000_000);
        assert_eq!(total_platform, 1_500_000_000);
        assert_eq!(total_creator, 850_000_000);
        assert_eq!(total_community, 150_000_000);

        assert_eq!(platform_dist.base_token, 100_000_000);
        assert_eq!(platform_dist.quote_token, 500_000_000);
        assert_eq!(creator_dist.base_token, 85_000_000);
        assert_eq!(creator_dist.quote_token, 0);
        assert_eq!(community_dist.base_token, 15_000_000);
        assert_eq!(community_dist.quote_token, 0);
    }

    #[test]
    fn test_validate() {
        let TestSetup {
            calculator,
            platform: _,
            community: _,
            creator: _,
        } = create_calculator_with_tiers(1, 6);
        assert!(calculator.is_valid());
    }

    #[test]
    fn test_minimum_price() {
        let max_base_volume = 1_000_000_000_000_000;

        let TestSetup {
            calculator,
            platform,
            community,
            creator,
        } = create_calculator_with_tiers(1, 6);

        let dist = calculator
            .get_distribution(100, max_base_volume, 0)
            .expect("distribution calculation failed");

        assert_eq!(dist.len(), 3);
        let total_platform = dist.total_in_quote(&platform).expect("calculation failed");
        let total_community = dist.total_in_quote(&community).expect("calculation failed");
        let total_creator = dist.total_in_quote(&creator).expect("calculation failed");
        assert!(total_platform + total_community + total_creator > 0);
    }

    #[test]
    fn test_price_overflow() {
        let max_base_volume = 1_000_000_000_000_000;
        let overflow_price = u128::MAX / max_base_volume + 1; // not reachable
        let TestSetup {
            calculator,
            platform: _,
            community: _,
            creator: _,
        } = create_calculator_with_tiers(overflow_price, 6);
        assert!(calculator.get_distribution(100, max_base_volume, 0).is_err());
    }

    #[test]
    fn test_maximum_price() {
        let max_base_volume = 1_000_000_000_000_000;
        let max_price = u128::MAX / max_base_volume;
        let TestSetup {
            calculator,
            platform,
            community,
            creator,
        } = create_calculator_with_tiers(max_price, 6);

        let dist = calculator
            .get_distribution(100, max_base_volume, 0)
            .expect("distribution calculation failed");

        assert_eq!(dist.len(), 3);
        let total_platform = dist.total_in_quote(&platform).expect("calculation failed");
        let total_community = dist.total_in_quote(&community).expect("calculation failed");
        let total_creator = dist.total_in_quote(&creator).expect("calculation failed");

        assert!(total_platform + total_community + total_creator > 0);
    }

    fn create_calculator_with_tiers(price_in_quote: u128, base_decimals: u8) -> TestSetup {
        let platform = Pubkey::new_unique();
        let community = Pubkey::new_unique();
        let creator = Pubkey::new_unique();

        let calculator = IncomeCalculator::new(price_in_quote, base_decimals)
            .add_rule(DistributionRule::new(0, platform, 6000, 1))
            .add_rule(DistributionRule::new(0, creator, 2500, 2))
            .add_rule(DistributionRule::new(0, community, 1500, 3))
            .add_rule(DistributionRule::new(501, platform, 3000, 1))
            .add_rule(DistributionRule::new(501, creator, 5600, 2))
            .add_rule(DistributionRule::new(501, community, 1400, 3))
            .add_rule(DistributionRule::new(1_501, platform, 3400, 1))
            .add_rule(DistributionRule::new(1_501, creator, 5300, 2))
            .add_rule(DistributionRule::new(1_501, community, 1300, 3))
            .add_rule(DistributionRule::new(4_001, platform, 3700, 1))
            .add_rule(DistributionRule::new(4_001, creator, 5100, 2))
            .add_rule(DistributionRule::new(4_001, community, 1200, 3))
            .add_rule(DistributionRule::new(10_001, platform, 4000, 1))
            .add_rule(DistributionRule::new(10_001, creator, 4900, 2))
            .add_rule(DistributionRule::new(10_001, community, 1100, 3))
            .add_rule(DistributionRule::new(20_001, platform, 4300, 1))
            .add_rule(DistributionRule::new(20_001, creator, 4700, 2))
            .add_rule(DistributionRule::new(20_001, community, 1000, 3))
            .add_rule(DistributionRule::new(30_001, platform, 4700, 1))
            .add_rule(DistributionRule::new(30_001, creator, 4400, 2))
            .add_rule(DistributionRule::new(30_001, community, 900, 3))
            .add_rule(DistributionRule::new(50_001, platform, 5100, 1))
            .add_rule(DistributionRule::new(50_001, creator, 4100, 2))
            .add_rule(DistributionRule::new(50_001, community, 800, 3))
            .add_rule(DistributionRule::new(70_001, platform, 5600, 1))
            .add_rule(DistributionRule::new(70_001, creator, 3700, 2))
            .add_rule(DistributionRule::new(70_001, community, 700, 3))
            .add_rule(DistributionRule::new(100_001, platform, 6000, 1))
            .add_rule(DistributionRule::new(100_001, creator, 3400, 2))
            .add_rule(DistributionRule::new(100_001, community, 600, 3));

        TestSetup {
            calculator,
            platform,
            community,
            creator,
        }
    }
}
