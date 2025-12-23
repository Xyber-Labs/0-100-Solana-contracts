#![allow(clippy::all)]

#[macro_export]
macro_rules! checked_add {
    ($a:expr, $b:expr) => {
        $a.checked_add($b).ok_or($crate::errors::ErrorCode::ArithmeticOverflow)
    };
}

#[macro_export]
macro_rules! checked_sub {
    ($a:expr, $b:expr) => {
        $a.checked_sub($b).ok_or($crate::errors::ErrorCode::ArithmeticOverflow)
    };
}

#[macro_export]
macro_rules! checked_mul {
    ($a:expr, $b:expr) => {
        $a.checked_mul($b).ok_or($crate::errors::ErrorCode::ArithmeticOverflow)
    };
}

#[macro_export]
macro_rules! checked_div {
    ($a:expr, $b:expr) => {
        $a.checked_div($b).ok_or($crate::errors::ErrorCode::ArithmeticOverflow)
    };
}

use uint::construct_uint;

construct_uint! {
    pub struct U256(4);
}

pub mod bitmap;
pub mod clmm;
pub mod lottery;
pub mod mint;
pub mod pool;
pub mod realloc;
pub mod selection;
