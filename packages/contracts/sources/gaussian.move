/// On-chain Gaussian math: PDF, CDF, error function and the helpers they need.
///
/// Direct port of the Stylus `math_core.rs`:
///   - `erf` via the Abramowitz & Stegun 5-coefficient polynomial approximation
///   - `exp` via an 18-term Taylor series, clamped to [-20, +20] WAD
///   - WAD integer `sqrt` via Newton's method
/// All values are signed WAD fixed-point (`Fp`).
module continuum::gaussian {

    use continuum::fixed_point::{Self as fp, Fp};

    /// WAD scaling factor: 1e18.
    const WAD: u256 = 1_000_000_000_000_000_000;

    /// Construct an `Fp` literal.
    fun c(mag: u256, neg: bool): Fp { fp::from(mag, neg) }

    /// Clamp a value into the unit interval [0, 1 WAD].
    fun clamp_unit(x: Fp): Fp {
        if (fp::is_neg(x)) fp::zero()
        else if (fp::mag(x) > WAD) fp::wad()
        else x
    }

    /// e^x in WAD. Saturates to ~1e26 above +20 and underflows to 0 below -20,
    /// matching the Stylus guards that keep the I256 series from overflowing.
    public fun exp_wad(x: Fp): Fp {
        let max_exp = c(20_000_000_000_000_000_000, false);   //  20.0
        let min_exp = c(20_000_000_000_000_000_000, true);    // -20.0
        if (fp::ge(x, max_exp)) {
            return c(100_000_000_000_000_000_000_000_000, false) // 1e26
        };
        if (fp::le(x, min_exp)) {
            return fp::zero()
        };

        let mut term = fp::wad();
        let mut sum = fp::wad();
        let mut n: u256 = 1;
        while (n <= 18) {
            term = fp::mul(term, x);
            term = fp::div_int(term, n);
            sum = fp::add(sum, term);
            n = n + 1;
        };
        if (fp::is_neg(sum)) fp::zero() else sum
    }

    /// Abramowitz & Stegun erf approximation (max error ~1.5e-7).
    public fun erf_approx(x: Fp): Fp {
        if (fp::is_zero(x)) {
            return fp::zero()
        };
        let sign_neg = fp::is_neg(x);
        let ax = fp::abs(x);

        let p = c(327_591_100_000_000_000, false);
        let t = fp::div(fp::wad(), fp::add(fp::wad(), fp::mul(p, ax)));
        let t2 = fp::mul(t, t);
        let t3 = fp::mul(t2, t);
        let t4 = fp::mul(t3, t);
        let t5 = fp::mul(t4, t);

        let poly = fp::add(fp::add(fp::add(fp::add(
            fp::mul(c(254_829_592_000_000_000, false), t),
            fp::mul(c(284_496_736_000_000_000, true), t2)),
            fp::mul(c(1_421_413_741_000_000_000, false), t3)),
            fp::mul(c(1_453_152_027_000_000_000, true), t4)),
            fp::mul(c(1_061_405_429_000_000_000, false), t5));

        let exp_term = exp_wad(fp::neg(fp::mul(ax, ax)));
        let erf = clamp_unit(fp::sub(fp::wad(), fp::mul(poly, exp_term)));

        if (sign_neg) fp::neg(erf) else erf
    }

    /// CDF of N(mu, sigma) at x, i.e. Φ((x - μ)/σ). Returns [0, 1 WAD].
    /// Non-positive sigma yields 0 (matches Stylus guard).
    public fun normal_cdf(x: Fp, mu: Fp, sigma: Fp): Fp {
        if (!fp::gt(sigma, fp::zero())) {
            return fp::zero()
        };
        let z = fp::div(fp::sub(x, mu), sigma);
        let z2 = fp::div(z, c(1_414_213_562_373_095_048, false)); // / sqrt(2)
        let erf = erf_approx(z2);
        let cdf = fp::div_int(fp::add(fp::wad(), erf), 2);
        clamp_unit(cdf)
    }

    /// PDF of N(mu, sigma) at x. Returns [0, 1 WAD]. Included for parity with
    /// the Stylus implementation; pricing only needs `normal_cdf`.
    public fun normal_pdf(x: Fp, mu: Fp, sigma: Fp): Fp {
        if (!fp::gt(sigma, fp::zero())) {
            return fp::zero()
        };
        let z = fp::div(fp::sub(x, mu), sigma);
        let z2 = fp::mul(z, z);
        let exponent = fp::mul(z2, c(500_000_000_000_000_000, true)); // * -0.5
        let exp_val = exp_wad(exponent);
        let denom = fp::mul(sigma, c(2_506_628_274_631_000_502, false)); // σ·sqrt(2π)
        if (fp::is_zero(denom)) {
            return fp::zero()
        };
        let inv_denom = fp::div(fp::wad(), denom);
        clamp_unit(fp::mul(inv_denom, exp_val))
    }

    /// Integer sqrt in WAD precision via Newton's method.
    /// sqrt_wad(x_wad) = sqrt(x_wad * WAD) so the result stays WAD-scaled.
    /// Negative or zero input returns zero.
    public fun sqrt_wad(x: Fp): Fp {
        if (fp::is_neg(x) || fp::is_zero(x)) {
            return fp::zero()
        };
        let xm = fp::mag(x);
        let scaled = xm * WAD;
        let mut guess = scaled;
        if (xm > WAD) { guess = xm };

        let mut i: u64 = 0;
        while (i < 128) {
            let next = (guess + scaled / guess) / 2;
            if (next >= guess) { break };
            guess = next;
            i = i + 1;
        };
        fp::from(guess, false)
    }
}
