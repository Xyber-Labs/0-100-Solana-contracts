use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

const BASIS_POINTS: u128 = 10_000;

macro_rules! mcap {
    ($market_cap_sol:expr) => {{
        let mcap: f64 = $market_cap_sol;
        if mcap == 0.0 {
            u128::MAX
        } else {
            const TOTAL_SUPPLY_TOKENS: f64 = 1_000_000_000.0;
            let inverse_price = TOTAL_SUPPLY_TOKENS / mcap;
            let sqrt_inverse = inverse_price.sqrt();
            (sqrt_inverse * raydium_amm_v3::libraries::fixed_point_64::Q64 as f64) as u128
        }
    }};
}

pub(crate) use mcap;

#[derive(
    Clone, Copy, PartialEq, Eq, Ord, PartialOrd, AnchorSerialize, AnchorDeserialize, InitSpace,
)]
pub enum Role {
    Treasure = 0,
    Creator = 1,
    Community = 2,
    BuyBack = 3,
}

impl Role {
    pub const COUNT: usize = 4;
}

#[account]
#[derive(InitSpace)]
pub struct IncomeCalculator {
    base_decimals: u8,
    #[max_len(40)]
    rules: Vec<DistributionRule>,
}

#[account]
#[derive(InitSpace)]
pub struct DistributionRule {
    pub sqrt_price_x64: u128,
    pub recipient: Role,
    pub rate: u128,
    pub priority: u8,
}

impl DistributionRule {
    pub fn new(sqrt_price_x64: u128, recipient: Role, rate: u128, priority: u8) -> Self {
        Self {
            sqrt_price_x64,
            recipient,
            rate,
            priority,
        }
    }
}

#[derive(Clone)]
pub struct Income {
    pub recipient: Role,
    pub base_token: u128,
    pub quote_token: u128,
}

pub struct Distribution {
    pub incomes: Vec<Income>,
    pub price_in_quote: u128,
    pub base_decimals: u8,
}

impl IncomeCalculator {
    pub fn new(base_decimals: u8) -> Result<Self> {
        require!(base_decimals < 18, ErrorCode::InvalidBaseDecimals);
        Ok(Self {
            base_decimals,
            rules: Vec::default(),
        })
    }

    pub fn add_rule(mut self, rule: DistributionRule) -> Self {
        let insert_pos = self
            .rules
            .binary_search_by_key(&(rule.sqrt_price_x64, rule.priority), |r| {
                (r.sqrt_price_x64, r.priority)
            })
            .unwrap_or_else(|pos| pos);
        self.rules.insert(insert_pos, rule);
        self
    }

    pub fn is_valid(&self) -> bool {
        if self.rules.is_empty() {
            return true;
        }

        let mut current_price = self.rules[0].sqrt_price_x64;
        let mut share_sum: u128 = 0;

        for rule in &self.rules {
            if rule.sqrt_price_x64 != current_price {
                if share_sum != BASIS_POINTS {
                    return false;
                }
                current_price = rule.sqrt_price_x64;
                share_sum = 0;
            }
            share_sum = match share_sum.checked_add(rule.rate) {
                Some(sum) => sum,
                None => return false,
            };
        }
        share_sum == BASIS_POINTS
    }

    pub fn get_rules_by_price(&self, sqrt_price_x64: u128) -> Result<&[DistributionRule]> {
        let start = self.rules.partition_point(|r| r.sqrt_price_x64 < sqrt_price_x64);
        if start >= self.rules.len() {
            return Err(ErrorCode::NoDistributionRules.into());
        }
        let threshold = self.rules[start].sqrt_price_x64;
        let end = self.rules.partition_point(|r| r.sqrt_price_x64 <= threshold);
        Ok(&self.rules[start..end])
    }

    pub fn get_distribution(
        &self,
        sqrt_price_x64: u128,
        base_token_volume: u128,
        quote_token_volume: u128,
    ) -> Result<Box<Distribution>> {
        let applicable_rules = self.get_rules_by_price(sqrt_price_x64)?;

        let base_decimals_divisor = 10u128.pow(self.base_decimals as u32);

        // Calculate price dynamically: price_in_quote = (quote_volume * 10^base_decimals) / base_volume
        let price_in_quote = if base_token_volume > 0 {
            quote_token_volume
                .checked_mul(base_decimals_divisor)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(base_token_volume)
                .ok_or(ErrorCode::ArithmeticOverflow)?
        } else {
            // If no base tokens harvested yet, use a default price of 1:1
            base_decimals_divisor
        };

        let base_in_quote = base_token_volume
            .checked_mul(price_in_quote)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(base_decimals_divisor)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let total_income_in_quote =
            base_in_quote.checked_add(quote_token_volume).ok_or(ErrorCode::ArithmeticOverflow)?;
        let mut rem_base = base_token_volume;
        let mut rem_quote = quote_token_volume;
        let mut distributions = Vec::new();

        for rule in applicable_rules {
            let share_in_quote = total_income_in_quote
                .checked_mul(rule.rate)
                .and_then(|v| v.checked_div(BASIS_POINTS))
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            let quote_taken = rem_quote.min(share_in_quote);
            rem_quote = rem_quote.checked_sub(quote_taken).expect("Not reachable: rem_q < taken_q");

            let rem_share_in_quote =
                share_in_quote.checked_sub(quote_taken).expect("Not reachable: share_q < taken_q");
            let base_needed = rem_share_in_quote
                .checked_mul(base_decimals_divisor)
                .and_then(|v| v.checked_div(price_in_quote))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            let base_taken = rem_base.min(base_needed);
            rem_base = rem_base.checked_sub(base_taken).expect("Not reachable: rem_b < taken_b");

            distributions.push(Income {
                recipient: rule.recipient,
                base_token: base_taken,
                quote_token: quote_taken,
            });
        }

        Ok(Box::new(Distribution {
            incomes: distributions,
            price_in_quote,
            base_decimals: self.base_decimals,
        }))
    }
}

#[cfg(test)]
mod tests {
    use raydium_amm_v3::libraries::Q64;

    use super::*;

    const TOTAL_SUPPLY_TOKENS: f64 = 1_000_000_000.0;

    fn sqrt_price_x64_to_market_cap(sqrt_price_x64: u128) -> f64 {
        let sqrt_price = (sqrt_price_x64 as f64) / (Q64 as f64);
        let inverse_price = sqrt_price * sqrt_price;
        TOTAL_SUPPLY_TOKENS / inverse_price
    }

    struct TestSetup {
        calculator: IncomeCalculator,
        treasure: Role,
        community: Role,
        creator: Role,
    }

    #[test]
    fn test_validate() {
        let setup = create_calculator_with_mcap_tiers(6);
        assert!(setup.calculator.is_valid());
    }

    #[test]
    fn test_real_sqrt_price_from_raydium() {
        let sqrt_price_x64: u128 = 21723472191457830933981;
        let q64 = Q64 as f64;
        let sqrt_price = (sqrt_price_x64 as f64) / q64;
        let price = sqrt_price * sqrt_price;
        let inverse_price = 1.0 / price;
        let quote_amount = 300.0;
        let base_amount = 481400000.0;
        let price_growing_rate = 1.15;
        let expected_price = quote_amount / base_amount * price_growing_rate;
        let expected_inverse: f64 = 1.0 / expected_price;
        let expected_sqrt = expected_inverse.sqrt();
        let expected_sqrt_x64 = expected_sqrt * q64;
        let market_cap = sqrt_price_x64_to_market_cap(sqrt_price_x64);
        let setup = create_calculator_with_mcap_tiers(6);
        let rules = setup.calculator.get_rules_by_price(sqrt_price_x64).unwrap();

        assert!(market_cap > 500.0 && market_cap < 1500.0, "Expected market cap ~721 SOL");
        assert_eq!(rules.len(), 3, "Expected 3 rules for tier 501");

        let platform_rule = rules.iter().find(|r| r.recipient == Role::Treasure).unwrap();
        let creator_rule = rules.iter().find(|r| r.recipient == Role::Creator).unwrap();
        let community_rule = rules.iter().find(|r| r.recipient == Role::Community).unwrap();

        assert_eq!(platform_rule.rate, 3000, "Platform should be 30%");
        assert_eq!(creator_rule.rate, 5600, "Creator should be 56%");
        assert_eq!(community_rule.rate, 1400, "Community should be 14%");
        assert_eq!(
            platform_rule.rate + creator_rule.rate + community_rule.rate,
            BASIS_POINTS,
            "Total should be 100%"
        );
    }

    fn market_cap_to_sqrt_price_x64(market_cap_sol: f64) -> u128 {
        if market_cap_sol == 0.0 {
            u128::MAX
        } else {
            let inverse_price = TOTAL_SUPPLY_TOKENS / market_cap_sol;
            let sqrt_inverse = inverse_price.sqrt();
            (sqrt_inverse * Q64 as f64) as u128
        }
    }

    fn test_tier_selection(
        market_cap_sol: f64,
        expected_platform: u128,
        expected_creator: u128,
        expected_community: u128,
    ) {
        let sqrt_price_x64 = market_cap_to_sqrt_price_x64(market_cap_sol);
        let inverse_price = TOTAL_SUPPLY_TOKENS / market_cap_sol;

        let setup = create_calculator_with_mcap_tiers(6);
        let rules = setup.calculator.get_rules_by_price(sqrt_price_x64).unwrap();

        let platform_rule = rules.iter().find(|r| r.recipient == Role::Treasure).unwrap();
        let creator_rule = rules.iter().find(|r| r.recipient == Role::Creator).unwrap();
        let community_rule = rules.iter().find(|r| r.recipient == Role::Community).unwrap();

        assert_eq!(platform_rule.rate, expected_platform, "Platform rate mismatch");
        assert_eq!(creator_rule.rate, expected_creator, "Creator rate mismatch");
        assert_eq!(community_rule.rate, expected_community, "Community rate mismatch");
        assert_eq!(
            platform_rule.rate + creator_rule.rate + community_rule.rate,
            BASIS_POINTS,
            "Total should be 100%"
        );
    }

    #[test]
    fn test_tier_0_market_cap_100() {
        test_tier_selection(100.0, 6000, 2500, 1500);
    }

    #[test]
    fn test_tier_0_market_cap_500() {
        test_tier_selection(500.0, 6000, 2500, 1500);
    }

    #[test]
    fn test_tier_501_market_cap_600() {
        test_tier_selection(600.0, 3000, 5600, 1400);
    }

    #[test]
    fn test_tier_501_market_cap_1500() {
        test_tier_selection(1500.0, 3000, 5600, 1400);
    }

    #[test]
    fn test_tier_1501_market_cap_2000() {
        test_tier_selection(2000.0, 3400, 5300, 1300);
    }

    #[test]
    fn test_tier_1501_market_cap_4000() {
        test_tier_selection(4000.0, 3400, 5300, 1300);
    }

    #[test]
    fn test_tier_4001_market_cap_5000() {
        test_tier_selection(5000.0, 3700, 5100, 1200);
    }

    #[test]
    fn test_tier_4001_market_cap_10000() {
        test_tier_selection(10000.0, 3700, 5100, 1200);
    }

    #[test]
    fn test_tier_10001_market_cap_15000() {
        test_tier_selection(15000.0, 4000, 4900, 1100);
    }

    #[test]
    fn test_tier_10001_market_cap_20000() {
        test_tier_selection(20000.0, 4000, 4900, 1100);
    }

    #[test]
    fn test_tier_20001_market_cap_25000() {
        test_tier_selection(25000.0, 4300, 4700, 1000);
    }

    #[test]
    fn test_tier_20001_market_cap_30000() {
        test_tier_selection(30000.0, 4300, 4700, 1000);
    }

    #[test]
    fn test_tier_30001_market_cap_40000() {
        test_tier_selection(40000.0, 4700, 4400, 900);
    }

    #[test]
    fn test_tier_30001_market_cap_50000() {
        test_tier_selection(50000.0, 4700, 4400, 900);
    }

    #[test]
    fn test_tier_50001_market_cap_60000() {
        test_tier_selection(60000.0, 5100, 4100, 800);
    }

    #[test]
    fn test_tier_50001_market_cap_70000() {
        test_tier_selection(70000.0, 5100, 4100, 800);
    }

    #[test]
    fn test_tier_70001_market_cap_80000() {
        test_tier_selection(80000.0, 5600, 3700, 700);
    }

    #[test]
    fn test_tier_70001_market_cap_100000() {
        test_tier_selection(100000.0, 5600, 3700, 700);
    }

    #[test]
    fn test_tier_100001_market_cap_150000() {
        test_tier_selection(150000.0, 6000, 3400, 600);
    }

    #[test]
    fn test_tier_100001_market_cap_1000000() {
        test_tier_selection(1000000.0, 6000, 3400, 600);
    }

    fn create_calculator_with_mcap_tiers(base_decimals: u8) -> TestSetup {
        let treasure = Role::Treasure;
        let community = Role::Community;
        let creator = Role::Creator;

        let calculator = IncomeCalculator::new(base_decimals)
            .expect("Expected to be created well")
            .add_rule(DistributionRule::new(mcap!(0.0), treasure, 6000, 1))
            .add_rule(DistributionRule::new(mcap!(0.0), creator, 2500, 2))
            .add_rule(DistributionRule::new(mcap!(0.0), community, 1500, 3))
            .add_rule(DistributionRule::new(mcap!(501.0), treasure, 3000, 1))
            .add_rule(DistributionRule::new(mcap!(501.0), creator, 5600, 2))
            .add_rule(DistributionRule::new(mcap!(501.0), community, 1400, 3))
            .add_rule(DistributionRule::new(mcap!(1_501.0), treasure, 3400, 1))
            .add_rule(DistributionRule::new(mcap!(1_501.0), creator, 5300, 2))
            .add_rule(DistributionRule::new(mcap!(1_501.0), community, 1300, 3))
            .add_rule(DistributionRule::new(mcap!(4_001.0), treasure, 3700, 1))
            .add_rule(DistributionRule::new(mcap!(4_001.0), creator, 5100, 2))
            .add_rule(DistributionRule::new(mcap!(4_001.0), community, 1200, 3))
            .add_rule(DistributionRule::new(mcap!(10_001.0), treasure, 4000, 1))
            .add_rule(DistributionRule::new(mcap!(10_001.0), creator, 4900, 2))
            .add_rule(DistributionRule::new(mcap!(10_001.0), community, 1100, 3))
            .add_rule(DistributionRule::new(mcap!(20_001.0), treasure, 4300, 1))
            .add_rule(DistributionRule::new(mcap!(20_001.0), creator, 4700, 2))
            .add_rule(DistributionRule::new(mcap!(20_001.0), community, 1000, 3))
            .add_rule(DistributionRule::new(mcap!(30_001.0), treasure, 4700, 1))
            .add_rule(DistributionRule::new(mcap!(30_001.0), creator, 4400, 2))
            .add_rule(DistributionRule::new(mcap!(30_001.0), community, 900, 3))
            .add_rule(DistributionRule::new(mcap!(50_001.0), treasure, 5100, 1))
            .add_rule(DistributionRule::new(mcap!(50_001.0), creator, 4100, 2))
            .add_rule(DistributionRule::new(mcap!(50_001.0), community, 800, 3))
            .add_rule(DistributionRule::new(mcap!(70_001.0), treasure, 5600, 1))
            .add_rule(DistributionRule::new(mcap!(70_001.0), creator, 3700, 2))
            .add_rule(DistributionRule::new(mcap!(70_001.0), community, 700, 3))
            .add_rule(DistributionRule::new(mcap!(100_001.0), treasure, 6000, 1))
            .add_rule(DistributionRule::new(mcap!(100_001.0), creator, 3400, 2))
            .add_rule(DistributionRule::new(mcap!(100_001.0), community, 600, 3));

        TestSetup {
            calculator,
            treasure,
            community,
            creator,
        }
    }
}
