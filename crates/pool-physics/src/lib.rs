//! Deterministic fixed-point billiards physics (plan P1-POOL-01).
//!
//! All maths uses Q32.32 fixed-point integers so the server (Node + WASM) and every
//! browser produce bit-identical results. Floats are never used in the simulation.

/// Q32.32 fixed-point number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Fx(pub i64);

impl Fx {
    pub const FRAC_BITS: u32 = 32;
    pub const ONE: Fx = Fx(1 << Self::FRAC_BITS);
    pub const ZERO: Fx = Fx(0);

    pub const fn from_int(v: i32) -> Fx {
        Fx((v as i64) << Self::FRAC_BITS)
    }

    /// Builds a value from a ratio of integers (for tuning constants).
    pub const fn from_ratio(num: i64, den: i64) -> Fx {
        Fx(((num as i128) << Self::FRAC_BITS) as i64 / den)
    }

    pub fn mul(self, o: Fx) -> Fx {
        Fx(((self.0 as i128 * o.0 as i128) >> Self::FRAC_BITS) as i64)
    }

    pub fn add(self, o: Fx) -> Fx {
        Fx(self.0 + o.0)
    }

    pub fn sub(self, o: Fx) -> Fx {
        Fx(self.0 - o.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Vec2 {
    pub x: Fx,
    pub y: Fx,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Ball {
    pub pos: Vec2,
    pub vel: Vec2,
    pub pocketed: bool,
}

/// Rolling friction per step (placeholder value, tuned in P1-POOL-01).
pub const FRICTION: Fx = Fx::from_ratio(985, 1000);
/// Fixed timestep in seconds (1/120 s).
pub const DT: Fx = Fx::from_ratio(1, 120);

/// Advances one fixed step: integrate position, apply friction. Collisions come in P1-POOL-01.
pub fn step(balls: &mut [Ball]) {
    for b in balls.iter_mut().filter(|b| !b.pocketed) {
        b.pos.x = b.pos.x.add(b.vel.x.mul(DT));
        b.pos.y = b.pos.y.add(b.vel.y.mul(DT));
        b.vel.x = b.vel.x.mul(FRICTION);
        b.vel.y = b.vel.y.mul(FRICTION);
    }
}

/// Order-independent hash of the table state for desync detection.
pub fn state_hash(balls: &[Ball]) -> u64 {
    // FNV-1a over the raw fixed-point integers.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in balls {
        for v in [b.pos.x.0, b.pos.y.0, b.vel.x.0, b.vel.y.0, b.pocketed as i64] {
            for byte in v.to_le_bytes() {
                h ^= byte as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rack() -> Vec<Ball> {
        vec![Ball {
            pos: Vec2 { x: Fx::from_int(1), y: Fx::from_int(0) },
            vel: Vec2 { x: Fx::from_int(3), y: Fx::from_ratio(1, 3) },
            pocketed: false,
        }]
    }

    #[test]
    fn simulation_is_deterministic() {
        let mut a = rack();
        let mut b = rack();
        for _ in 0..10_000 {
            step(&mut a);
            step(&mut b);
        }
        assert_eq!(state_hash(&a), state_hash(&b));
    }

    #[test]
    fn friction_slows_balls_down() {
        let mut balls = rack();
        let v0 = balls[0].vel.x;
        step(&mut balls);
        assert!(balls[0].vel.x < v0);
    }

    #[test]
    fn fixed_point_basics() {
        assert_eq!(Fx::from_int(2).mul(Fx::from_int(3)), Fx::from_int(6));
        assert_eq!(Fx::ONE.add(Fx::ONE), Fx::from_int(2));
    }
}
