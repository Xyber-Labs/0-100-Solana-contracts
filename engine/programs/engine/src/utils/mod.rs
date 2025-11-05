#![allow(clippy::all)]
use uint::construct_uint;

construct_uint! {
    pub struct U256(4);
}

pub mod pool;
pub mod selection;
pub mod clmm;
