/// Signed WAD (1e18) fixed-point arithmetic over `u256`.
///
/// Sui Move has no native signed integer, but the Gaussian pricing math needs
/// signed values (e.g. `x - mu` is frequently negative, `erf` is odd around 0).
/// `Fp` is a magnitude + sign pair; zero is always normalized to non-negative.
/// All values are WAD-scaled: the real number `v` is stored as `v * 1e18`.
module continuum::fixed_point {

    /// WAD scaling factor: 1e18.
    const WAD: u256 = 1_000_000_000_000_000_000;

    /// Attempted to read a negative value as an unsigned magnitude.
    const ENegativeToUnsigned: u64 = 0;

    /// A signed, WAD-scaled fixed-point number. `mag` is the absolute value in
    /// WAD units; `neg` is the sign. Zero is always `{ mag: 0, neg: false }`.
    public struct Fp has copy, drop, store {
        mag: u256,
        neg: bool,
    }

    // ── Constructors / constants ──────────────────────────────────────────

    public fun wad_u256(): u256 { WAD }

    /// Build an `Fp` from a raw magnitude and sign, normalizing zero.
    public fun from(mag: u256, neg: bool): Fp {
        Fp { mag, neg: neg && mag != 0 }
    }

    public fun zero(): Fp { Fp { mag: 0, neg: false } }

    /// 1.0 in WAD.
    public fun wad(): Fp { Fp { mag: WAD, neg: false } }

    // ── Accessors ─────────────────────────────────────────────────────────

    public fun mag(a: Fp): u256 { a.mag }
    public fun is_neg(a: Fp): bool { a.neg }
    public fun is_zero(a: Fp): bool { a.mag == 0 }

    /// Read the magnitude, asserting the value is non-negative.
    public fun to_u256(a: Fp): u256 {
        assert!(!a.neg, ENegativeToUnsigned);
        a.mag
    }

    // ── Unary ops ─────────────────────────────────────────────────────────

    public fun neg(a: Fp): Fp {
        if (a.mag == 0) a else Fp { mag: a.mag, neg: !a.neg }
    }

    public fun abs(a: Fp): Fp { Fp { mag: a.mag, neg: false } }

    // ── Binary ops ────────────────────────────────────────────────────────

    public fun add(a: Fp, b: Fp): Fp {
        if (a.neg == b.neg) {
            from(a.mag + b.mag, a.neg)
        } else if (a.mag >= b.mag) {
            from(a.mag - b.mag, a.neg)
        } else {
            from(b.mag - a.mag, b.neg)
        }
    }

    public fun sub(a: Fp, b: Fp): Fp { add(a, neg(b)) }

    /// WAD multiply: (a * b) / 1e18.
    public fun mul(a: Fp, b: Fp): Fp {
        from((a.mag * b.mag) / WAD, a.neg != b.neg)
    }

    /// WAD divide: (a * 1e18) / b. Division by zero yields zero (matches the
    /// Stylus `wad_div` guard).
    public fun div(a: Fp, b: Fp): Fp {
        if (b.mag == 0) zero() else from((a.mag * WAD) / b.mag, a.neg != b.neg)
    }

    /// Divide by a plain (unsigned) integer, preserving sign. Used by the
    /// exp/cdf series which divide by term index `n` and by 2.
    public fun div_int(a: Fp, n: u256): Fp {
        if (n == 0) zero() else from(a.mag / n, a.neg)
    }

    // ── Comparisons ───────────────────────────────────────────────────────

    public fun eq(a: Fp, b: Fp): bool {
        a.mag == b.mag && (a.neg == b.neg || a.mag == 0)
    }

    public fun lt(a: Fp, b: Fp): bool {
        if (a.neg && !b.neg) true
        else if (!a.neg && b.neg) false
        else if (!a.neg && !b.neg) a.mag < b.mag
        else a.mag > b.mag // both negative: larger magnitude is smaller
    }

    public fun gt(a: Fp, b: Fp): bool { lt(b, a) }
    public fun le(a: Fp, b: Fp): bool { !gt(a, b) }
    public fun ge(a: Fp, b: Fp): bool { !lt(a, b) }
}
