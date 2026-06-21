/// Continuum market: a unified continuous-distribution prediction market.
///
/// This single module collapses what the Stylus implementation split across the
/// DistributionAmm, BinaryRouter, LpToken and ContinuumFactory contracts. On Sui
/// there are no proxies or cross-contract delegatecalls — each market is one
/// shared `Market<T>` object that owns its collateral vault and all accounting:
///
///   * AMM role     — curve params (μ/σ), liquidity, fees, collateral vault.
///   * Router role  — `buy_yes`/`buy_no`, CDF pricing, settlement, positions.
///   * LP token     — per-address `LpAccount` rows (inherently non-transferable).
///   * Factory      — `create_market<T>` + a shared `Registry` that counts markets.
///
/// The curve is demand-responsive: bettors move μ/σ (stake-weighted), liquidity
/// providers never do. Positions are owned `Position` objects. Collateral is any
/// `Coin<T>` (use the real USDC type on testnet, `mock_usdc` locally).
///
/// Payouts and minted positions are sent to `ctx.sender()`; the lint that flags
/// such transfers as non-composable is intentional here and suppressed.
#[allow(lint(self_transfer))]
module continuum::market {

    use std::string::{Self, String};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::table::{Self, Table};
    use sui::event;
    use sui::hash;
    use sui::bcs;
    use sui::clock::{Self, Clock};
    use continuum::fixed_point::{Self as fp, Fp};
    use continuum::gaussian;
    // Pyth pull-oracle: read an on-chain price feed for trustless settlement of
    // financial markets (BTC, ETH, …). See `resolve_with_pyth`.
    use pyth::pyth;
    use pyth::price::{Self, Price};
    use pyth::price_info::{Self, PriceInfoObject};
    use pyth::price_identifier;
    use pyth::i64 as pyth_i64;

    // ── Constants ─────────────────────────────────────────────────────────

    /// WAD scaling factor: 1e18.
    const WAD: u256 = 1_000_000_000_000_000_000;
    /// WAD(1e18) ÷ USDC(1e6) decimal gap.
    const USDC_SCALE: u256 = 1_000_000_000_000;
    /// Default virtual stake (WAD) backing the owner-seeded μ/σ: ~100 units.
    const DEFAULT_PRIOR_WEIGHT: u256 = 100_000_000_000_000_000_000;
    /// Two-phase resolution timelock: 24h in milliseconds (Sui `Clock` is ms).
    const RESOLUTION_DELAY_MS: u64 = 86_400_000;
    /// `sweep_dust` floor/cap: only sweep dust strictly above 1 USDC, up to 10.
    const DUST_MIN: u64 = 1_000_000;
    const DUST_MAX: u64 = 10_000_000;
    /// Pyth resolution: max staleness (seconds) tolerated for the price. The
    /// caller updates the feed in the same PTB, so 60s is ample headroom.
    const MAX_PRICE_AGE_SECS: u64 = 60;
    /// Length (bytes) of a Pyth price-feed identifier.
    const PRICE_FEED_ID_LEN: u64 = 32;

    // ── Errors ────────────────────────────────────────────────────────────

    const EUnauthorized: u64 = 0;
    const ETradesStarted: u64 = 1;
    const EVarianceTooLow: u64 = 2;
    const EZeroAmount: u64 = 3;
    const EPriceZero: u64 = 4;
    const EZeroTokens: u64 = 5;
    const EInsufficientLiquidity: u64 = 6;
    const EInsufficientShares: u64 = 7;
    const ENotResolved: u64 = 8;
    const EAlreadyResolved: u64 = 9;
    const ENotWinner: u64 = 10;
    const ENoTokens: u64 = 11;
    const EWrongMarket: u64 = 12;
    const EPositionWinning: u64 = 13;
    const ENonPositiveWeight: u64 = 14;
    const EAlreadyProposed: u64 = 15;
    const ENoProposal: u64 = 16;
    const ETimelockActive: u64 = 17;
    /// Resolution attempted before the market's scheduled `resolves_at` time.
    const EMarketNotClosed: u64 = 18;
    /// A market must be created with a non-zero scheduled resolution time.
    const EInvalidResolutionTime: u64 = 19;
    /// Pyth resolution attempted on a market with no bound price-feed id.
    const ENoPriceFeed: u64 = 20;
    /// The supplied Pyth `PriceInfoObject` is not the market's bound feed.
    const EWrongPriceFeed: u64 = 21;
    /// Trading attempted after the market's scheduled close (`resolves_at`).
    const EMarketClosed: u64 = 22;
    /// Manual resolution attempted on a market bound to a Pyth feed — those must
    /// settle trustlessly via `resolve_with_pyth`, never by a human submitter.
    const EFeedBoundMarket: u64 = 23;

    // ── Objects ───────────────────────────────────────────────────────────

    /// Global factory/registry. Created once at publish and shared. Mirrors the
    /// Stylus factory: counts markets and maps each `market_id` to its shared
    /// `Market` object address for discovery.
    public struct Registry has key {
        id: UID,
        owner: address,
        market_count: u64,
        markets: Table<u64, address>,
    }

    /// Per-address LP bookkeeping. MasterChef-style: pending fees =
    /// shares·acc_fee_per_share/WAD − reward_debt. Living in a `Table` keyed by
    /// address makes LP positions non-transferable by construction.
    public struct LpAccount has store {
        shares: u256,        // WAD
        reward_debt: Fp,     // WAD
    }

    /// An owned YES/NO position. Replaces the Stylus ERC-1155 balance. Each buy
    /// mints a fresh `Position`; `claim_winnings` consumes one.
    public struct Position has key, store {
        id: UID,
        market_id: u64,
        token_id: u256,      // keccak(market_id, target_x, is_yes)
        target_x: Fp,        // strike (WAD, signed)
        is_yes: bool,
        amount_wad: u256,    // tokens held (WAD); pays 1 USDC / token if it wins
    }

    /// A single prediction market and its collateral vault.
    public struct Market<phantom T> has key {
        id: UID,
        owner: address,
        market_id: u64,
        title: String,

        // ── Gaussian curve (signed WAD) ──
        mu: Fp,
        sigma: Fp,
        sigma_min: Fp,
        prior_weight: Fp,
        // Stake-weighted accumulators — only bettors touch these.
        acc_stake_weight: Fp,   // Σ wᵢ
        acc_weighted_x: Fp,     // Σ wᵢ·xᵢ
        acc_weighted_x_sq: Fp,  // Σ wᵢ·xᵢ²
        trades_started: bool,

        // ── Liquidity accounting (signed WAD) ──
        available_liquidity: Fp,
        locked_collateral: Fp,
        acc_fee_per_share: Fp,

        // ── Collateral custody ──
        vault: Balance<T>,

        // ── LP shares ──
        total_shares: u256,
        lp_accounts: Table<address, LpAccount>,

        // ── Per-token liability ──
        token_liabilities: Table<u256, Fp>,

        // ── Settlement (pull-based, real-world price) ──
        final_price: Fp,
        market_resolved: bool,
        /// Scheduled close: earliest `Clock` time (ms) at which any resolution
        /// path (`set_final_price` / `propose_resolution`) may be invoked. Fixed
        /// at creation and never mutated thereafter.
        resolves_at: u64,
        /// Pyth price-feed identifier (32 bytes) this market settles against, or
        /// empty for a manual-only market. When set, `resolve_with_pyth` reads
        /// the bound feed trustlessly instead of trusting a human submitter. Fixed
        /// at creation so the settlement source can never be swapped underneath
        /// open positions.
        price_feed_id: vector<u8>,

        // ── Two-step ownership (mirrors the Stylus pending_owner pattern) ──
        pending_owner: address,

        // ── Two-phase resolution timelock ──
        proposed_final_price: Fp,
        resolution_time: u64, // 0 = no active proposal; else ms deadline
    }

    // ── Events ────────────────────────────────────────────────────────────

    public struct MarketCreated has copy, drop {
        market_id: u64,
        market: address,
        title: String,
        resolves_at: u64,
    }
    public struct CurveUpdated has copy, drop {
        market_id: u64,
        mu_mag: u256,
        mu_neg: bool,
        sigma_mag: u256,
    }
    public struct LiquidityAdded has copy, drop { market_id: u64, provider: address, amount_wad: u256 }
    public struct LiquidityRemoved has copy, drop { market_id: u64, provider: address, amount_wad: u256 }
    public struct TradeExecuted has copy, drop {
        market_id: u64,
        user: address,
        token_id: u256,
        is_yes: bool,
        tokens_minted: u256,
        // Strike (signed WAD) the position was opened at — indexers reconstruct
        // each position's `targetValueX` from this (mirrors the Stylus event).
        target_mag: u256,
        target_neg: bool,
    }
    public struct FeeDistributed has copy, drop { market_id: u64, amount_wad: u256 }
    public struct MarketResolved has copy, drop { market_id: u64, final_mag: u256, final_neg: bool }
    public struct WinningsClaimed has copy, drop { market_id: u64, user: address, amount_wad: u256 }

    // ── Publish ───────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        transfer::share_object(Registry {
            id: object::new(ctx),
            owner: ctx.sender(),
            market_count: 0,
            markets: table::new<u64, address>(ctx),
        });
    }

    // ── Factory ───────────────────────────────────────────────────────────

    /// Permissionless market creation (mirrors the Stylus M3 decision). Creates
    /// and shares a new `Market<T>` collateralized by coin type `T`.
    public fun create_market<T>(
        registry: &mut Registry,
        title: vector<u8>,
        sigma_min_mag: u256,
        resolves_at: u64,
        price_feed_id: vector<u8>,
        ctx: &mut TxContext,
    ) {
        // The scheduled resolution time is mandatory and fixed for the market's
        // lifetime — it gates every resolution path (Clock time, ms).
        assert!(resolves_at > 0, EInvalidResolutionTime);
        // A bound Pyth feed id, if supplied, must be a full 32-byte identifier.
        // Empty = a manual-only market (settled via `set_final_price`).
        assert!(
            vector::is_empty(&price_feed_id) || vector::length(&price_feed_id) == PRICE_FEED_ID_LEN,
            ENoPriceFeed,
        );

        let market_id = registry.market_count;
        registry.market_count = market_id + 1;

        let title_str = string::utf8(title);
        let market = Market<T> {
            id: object::new(ctx),
            owner: ctx.sender(),
            market_id,
            title: title_str,
            mu: fp::zero(),
            sigma: fp::zero(),
            sigma_min: fp::from(sigma_min_mag, false),
            prior_weight: fp::from(DEFAULT_PRIOR_WEIGHT, false),
            acc_stake_weight: fp::zero(),
            acc_weighted_x: fp::zero(),
            acc_weighted_x_sq: fp::zero(),
            trades_started: false,
            available_liquidity: fp::zero(),
            locked_collateral: fp::zero(),
            acc_fee_per_share: fp::zero(),
            vault: balance::zero<T>(),
            total_shares: 0,
            lp_accounts: table::new<address, LpAccount>(ctx),
            token_liabilities: table::new<u256, Fp>(ctx),
            final_price: fp::zero(),
            market_resolved: false,
            resolves_at,
            price_feed_id,
            pending_owner: @0x0,
            proposed_final_price: fp::zero(),
            resolution_time: 0,
        };
        let addr = object::uid_to_address(&market.id);
        table::add(&mut registry.markets, market_id, addr);
        transfer::share_object(market);
        event::emit(MarketCreated { market_id, market: addr, title: title_str, resolves_at });
    }

    // ── Two-step ownership (AMM + Router owner role) ──────────────────────

    /// Begin transferring market ownership. Owner-only; completes when the new
    /// owner calls `accept_ownership` (mirrors the Stylus pending_owner pattern).
    public fun transfer_ownership<T>(market: &mut Market<T>, new_owner: address, ctx: &TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        market.pending_owner = new_owner;
    }

    /// Finalize an ownership transfer. Callable only by the pending owner.
    public fun accept_ownership<T>(market: &mut Market<T>, ctx: &TxContext) {
        assert!(ctx.sender() == market.pending_owner, EUnauthorized);
        market.owner = market.pending_owner;
        market.pending_owner = @0x0;
    }

    // ── Owner configuration (pre-trading) ─────────────────────────────────

    /// Seed the prior μ/σ. Owner-only, before any trade. Seeds the stake-weighted
    /// accumulators with `prior_weight` of virtual stake at this μ/σ so the first
    /// real bet can't yank the curve to a single point.
    public fun set_distribution<T>(
        market: &mut Market<T>,
        mu_mag: u256,
        mu_neg: bool,
        sigma_mag: u256,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.trades_started, ETradesStarted);
        let sigma = fp::from(sigma_mag, false);
        assert!(fp::gt(sigma, market.sigma_min), EVarianceTooLow);

        let mu = fp::from(mu_mag, mu_neg);
        market.mu = mu;
        market.sigma = sigma;

        let pw = if (fp::gt(market.prior_weight, fp::zero())) market.prior_weight
                 else fp::from(DEFAULT_PRIOR_WEIGHT, false);
        // E[x²] = μ² + σ², so reconstructing μ/σ from the accumulators is exact.
        let ex2 = fp::add(fp::mul(mu, mu), fp::mul(sigma, sigma));
        market.acc_stake_weight = pw;
        market.acc_weighted_x = fp::mul(pw, mu);
        market.acc_weighted_x_sq = fp::mul(pw, ex2);

        emit_curve(market);
    }

    /// Tune how strongly the seeded μ/σ resists demand. Owner-only, pre-trading.
    public fun set_prior_weight<T>(market: &mut Market<T>, weight_mag: u256, ctx: &TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.trades_started, ETradesStarted);
        assert!(weight_mag > 0, ENonPositiveWeight);
        market.prior_weight = fp::from(weight_mag, false);
    }

    /// Update the minimum allowed σ floor. Owner-only; must be > 0. Mirrors the
    /// Stylus `set_sigma_min`, which is *not* gated on `trades_started` — the
    /// owner can retune the floor at any time and it applies on the next
    /// `recompute_curve`.
    public fun set_sigma_min<T>(market: &mut Market<T>, min_mag: u256, ctx: &TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(min_mag > 0, EVarianceTooLow);
        market.sigma_min = fp::from(min_mag, false);
    }

    // ── Liquidity ─────────────────────────────────────────────────────────

    /// Deposit collateral and receive LP shares. Curve-neutral: liquidity never
    /// moves μ/σ — that is the core anti-manipulation rule. Settles any pending
    /// fees first so the new share count doesn't dilute past rewards.
    public fun add_liquidity<T>(market: &mut Market<T>, payment: Coin<T>, ctx: &mut TxContext) {
        let user = ctx.sender();
        claim_fees_internal(market, user, ctx);

        let units = coin::value(&payment);
        assert!(units > 0, EZeroAmount);
        let amount_wad = (units as u256) * USDC_SCALE;

        market.available_liquidity = fp::add(market.available_liquidity, fp::from(amount_wad, false));
        balance::join(&mut market.vault, coin::into_balance(payment));

        let new_shares = lp_shares(market, user) + amount_wad;
        market.total_shares = market.total_shares + amount_wad;
        let rd = reward_debt_for(new_shares, market.acc_fee_per_share);
        set_lp(market, user, new_shares, rd);

        event::emit(LiquidityAdded { market_id: market.market_id, provider: user, amount_wad });
    }

    /// Burn `shares_to_remove` (WAD) and withdraw the equivalent collateral.
    /// Solvency-checked against free liquidity. Output coin is sent to the caller.
    public fun remove_liquidity<T>(market: &mut Market<T>, shares_to_remove: u256, ctx: &mut TxContext) {
        let user = ctx.sender();
        claim_fees_internal(market, user, ctx);

        let shares_fp = fp::from(shares_to_remove, false);
        assert!(fp::ge(market.available_liquidity, shares_fp), EInsufficientLiquidity);

        let cur = lp_shares(market, user);
        assert!(cur >= shares_to_remove, EInsufficientShares);
        let new_shares = cur - shares_to_remove;

        market.total_shares = market.total_shares - shares_to_remove;
        market.available_liquidity = fp::sub(market.available_liquidity, shares_fp);
        let rd = reward_debt_for(new_shares, market.acc_fee_per_share);
        set_lp(market, user, new_shares, rd);

        let units = ((shares_to_remove / USDC_SCALE) as u64);
        if (units > 0) {
            transfer::public_transfer(coin::take(&mut market.vault, units, ctx), user);
        };
        event::emit(LiquidityRemoved { market_id: market.market_id, provider: user, amount_wad: shares_to_remove });
    }

    /// Claim accumulated trading fees for the caller.
    public fun claim_fees<T>(market: &mut Market<T>, ctx: &mut TxContext) {
        claim_fees_internal(market, ctx.sender(), ctx);
    }

    // ── Trading ───────────────────────────────────────────────────────────

    /// Buy a YES position (wins iff final_price ≥ strike). `payment` is the full
    /// stake in collateral units; a 1% fee goes to LPs, the rest underwrites the
    /// position and folds into the demand-weighted curve.
    public fun buy_yes<T>(
        market: &mut Market<T>,
        payment: Coin<T>,
        target_mag: u256,
        target_neg: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        buy_internal(market, payment, fp::from(target_mag, target_neg), true, clock, ctx);
    }

    /// Buy a NO position (wins iff final_price < strike).
    public fun buy_no<T>(
        market: &mut Market<T>,
        payment: Coin<T>,
        target_mag: u256,
        target_neg: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        buy_internal(market, payment, fp::from(target_mag, target_neg), false, clock, ctx);
    }

    fun buy_internal<T>(
        market: &mut Market<T>,
        payment: Coin<T>,
        target: Fp,
        is_yes: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Trading closes at resolution and at the scheduled close. Without this,
        // once the market is resolved (and `final_price` is public) anyone could
        // buy a guaranteed-winning strike priced below 1.0 and immediately
        // `claim_winnings` for a multiple of their stake — draining LP collateral.
        assert!(!market.market_resolved, EAlreadyResolved);
        assert!(clock::timestamp_ms(clock) < market.resolves_at, EMarketClosed);

        let stake_units = coin::value(&payment);
        assert!(stake_units > 0, EZeroAmount);

        // Price against the *pre-update* curve (μ/σ before this bet shifts them).
        let p_no = gaussian::normal_cdf(target, market.mu, market.sigma);
        let price = if (is_yes) fp::sub(fp::wad(), p_no) else p_no;
        let price_mag = fp::to_u256(price);
        assert!(price_mag > 0, EPriceZero);

        let stake_wad = (stake_units as u256) * USDC_SCALE;
        let fee_wad = stake_wad / 100;            // 1% fee
        let net_wad = stake_wad - fee_wad;
        let tokens_wad = (net_wad * WAD) / price_mag;
        assert!(tokens_wad > 0, EZeroTokens);

        let token_id = derive_token_id(market.market_id, target, is_yes);

        // Custody the full stake, distribute the fee, lock the liability, and
        // fold the bet into the curve (weight = net stake, x = strike).
        balance::join(&mut market.vault, coin::into_balance(payment));
        distribute_fee(market, fee_wad);
        underwrite(market, token_id, target, net_wad, tokens_wad);

        let user = ctx.sender();
        let position = Position {
            id: object::new(ctx),
            market_id: market.market_id,
            token_id,
            target_x: target,
            is_yes,
            amount_wad: tokens_wad,
        };
        transfer::public_transfer(position, user);

        event::emit(TradeExecuted {
            market_id: market.market_id,
            user,
            token_id,
            is_yes,
            tokens_minted: tokens_wad,
            target_mag: fp::mag(target),
            target_neg: fp::is_neg(target),
        });
    }

    // ── Settlement (pull-based, against the real world) ───────────────────

    /// Owner records the externally-observed final price (no oracle; manual for
    /// the PoC). Single-shot, and only once the scheduled `resolves_at` time has
    /// passed. Users then claim per position.
    public fun set_final_price<T>(
        market: &mut Market<T>,
        price_mag: u256,
        price_neg: bool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.market_resolved, EAlreadyResolved);
        // A feed-bound market must settle trustlessly via `resolve_with_pyth`; the
        // owner cannot override the bound source with an arbitrary manual price.
        assert!(vector::is_empty(&market.price_feed_id), EFeedBoundMarket);
        assert!(clock::timestamp_ms(clock) >= market.resolves_at, EMarketNotClosed);
        market.final_price = fp::from(price_mag, price_neg);
        market.market_resolved = true;
        event::emit(MarketResolved { market_id: market.market_id, final_mag: price_mag, final_neg: price_neg });
    }

    /// Two-phase resolution, phase 1: propose a final price and start the 24h
    /// timelock dispute window (Key Design Decision #5). Owner-only.
    public fun propose_resolution<T>(
        market: &mut Market<T>,
        price_mag: u256,
        price_neg: bool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.market_resolved, EAlreadyResolved);
        // A feed-bound market settles only via `resolve_with_pyth` (see above).
        assert!(vector::is_empty(&market.price_feed_id), EFeedBoundMarket);
        assert!(market.resolution_time == 0, EAlreadyProposed);
        // Cannot even begin resolution before the scheduled close.
        assert!(clock::timestamp_ms(clock) >= market.resolves_at, EMarketNotClosed);
        market.proposed_final_price = fp::from(price_mag, price_neg);
        market.resolution_time = clock::timestamp_ms(clock) + RESOLUTION_DELAY_MS;
    }

    /// Two-phase resolution: abort a pending proposal during the dispute window.
    public fun cancel_resolution<T>(market: &mut Market<T>, ctx: &TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.market_resolved, EAlreadyResolved);
        market.resolution_time = 0;
        market.proposed_final_price = fp::zero();
    }

    /// Two-phase resolution, phase 2: finalize after the timelock elapses.
    public fun execute_resolution<T>(market: &mut Market<T>, clock: &Clock, ctx: &TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);
        assert!(!market.market_resolved, EAlreadyResolved);
        assert!(market.resolution_time != 0, ENoProposal);
        assert!(clock::timestamp_ms(clock) >= market.resolution_time, ETimelockActive);

        market.final_price = market.proposed_final_price;
        market.market_resolved = true;
        event::emit(MarketResolved {
            market_id: market.market_id,
            final_mag: fp::mag(market.proposed_final_price),
            final_neg: fp::is_neg(market.proposed_final_price),
        });
    }

    // ── Settlement via Pyth (trustless, for financial markets) ────────────

    /// Resolve a financial market directly from its bound Pyth price feed —
    /// no trusted submitter. **Permissionless**: anyone may settle once the
    /// scheduled `resolves_at` has passed, because the outcome is read from
    /// Pyth rather than asserted by a human (this is the whole point — it
    /// closes the manual-oracle gap that `set_final_price` leaves open).
    ///
    /// The market must have been created with a 32-byte `price_feed_id`, and the
    /// supplied `price_info_object` must be exactly that feed (checked against the
    /// on-chain identifier) — so a caller can't settle BTC against the ETH feed.
    ///
    /// Pyth is a *pull* oracle: the caller must refresh the feed in the **same
    /// PTB** (e.g. `pyth::pyth::update_single_price_feed` with a Hermes price
    /// update) before this call, or the staleness check (`MAX_PRICE_AGE_SECS`)
    /// aborts. The Pyth price `(price · 10^expo)` is converted to the market's
    /// signed-WAD `final_price`; settlement then proceeds per-position exactly as
    /// the manual path (`claim_winnings` / `release_losing_collateral`).
    public fun resolve_with_pyth<T>(
        market: &mut Market<T>,
        price_info_object: &PriceInfoObject,
        clock: &Clock,
        _ctx: &TxContext,
    ) {
        assert!(!market.market_resolved, EAlreadyResolved);
        assert!(vector::length(&market.price_feed_id) == PRICE_FEED_ID_LEN, ENoPriceFeed);
        assert!(clock::timestamp_ms(clock) >= market.resolves_at, EMarketNotClosed);

        // Bind the supplied feed to this market: its on-chain identifier must
        // match the id fixed at creation.
        let info = price_info::get_price_info_from_price_info_object(price_info_object);
        let id = price_identifier::get_bytes(&price_info::get_price_identifier(&info));
        assert!(id == market.price_feed_id, EWrongPriceFeed);

        // Read a fresh price (pull oracle: caller refreshed it this PTB) and
        // convert Pyth's `(price · 10^expo)` to our signed-WAD final price.
        let p = pyth::get_price_no_older_than(price_info_object, clock, MAX_PRICE_AGE_SECS);
        let final_fp = pyth_price_to_fp(&p);

        market.final_price = final_fp;
        market.market_resolved = true;
        event::emit(MarketResolved {
            market_id: market.market_id,
            final_mag: fp::mag(final_fp),
            final_neg: fp::is_neg(final_fp),
        });
    }

    /// Convert a Pyth `Price` (`value = price · 10^expo`, both signed) into the
    /// market's signed-WAD `Fp`: `value · 1e18 = price · 10^(expo + 18)`.
    fun pyth_price_to_fp(p: &Price): Fp {
        let price_i = price::get_price(p);
        let expo_i = price::get_expo(p);

        let price_neg = pyth_i64::get_is_negative(&price_i);
        let price_mag = (pyth_i64_magnitude(&price_i) as u256);

        let expo_neg = pyth_i64::get_is_negative(&expo_i);
        let expo_mag = pyth_i64_magnitude(&expo_i);

        // WAD adds 18 decimals; Pyth expos are typically negative (e.g. −8).
        let scaled = if (expo_neg) {
            if (expo_mag <= 18) price_mag * pow10(18 - expo_mag)
            else price_mag / pow10(expo_mag - 18)
        } else {
            price_mag * pow10(18 + expo_mag)
        };
        fp::from(scaled, price_neg)
    }

    /// Absolute magnitude of a Pyth `I64` (its two getters each abort on the
    /// wrong sign, so branch first).
    fun pyth_i64_magnitude(i: &pyth_i64::I64): u64 {
        if (pyth_i64::get_is_negative(i)) pyth_i64::get_magnitude_if_negative(i)
        else pyth_i64::get_magnitude_if_positive(i)
    }

    /// 10^n as u256.
    fun pow10(n: u64): u256 {
        let mut r: u256 = 1;
        let mut i = 0;
        while (i < n) { r = r * 10; i = i + 1; };
        r
    }

    /// Redeem a winning position for collateral (1 USDC per token). Consumes the
    /// `Position` object.
    public fun claim_winnings<T>(market: &mut Market<T>, position: Position, ctx: &mut TxContext) {
        assert!(market.market_resolved, ENotResolved);
        assert!(position.market_id == market.market_id, EWrongMarket);

        let Position { id, market_id: _, token_id, target_x, is_yes, amount_wad } = position;
        object::delete(id);

        let won = if (is_yes) fp::ge(market.final_price, target_x)
                  else fp::lt(market.final_price, target_x);
        assert!(won, ENotWinner);
        assert!(amount_wad > 0, ENoTokens);

        let amt = fp::from(amount_wad, false);
        reduce_liability(market, token_id, amt);
        market.locked_collateral = fp::sub(market.locked_collateral, amt);

        let user = ctx.sender();
        let units = ((amount_wad / USDC_SCALE) as u64);
        if (units > 0) {
            transfer::public_transfer(coin::take(&mut market.vault, units, ctx), user);
        };
        event::emit(WinningsClaimed { market_id: market.market_id, user, amount_wad });
    }

    /// Permissionless: free the collateral locked by a losing token id back into
    /// available liquidity. Anyone may call after resolution.
    public fun release_losing_collateral<T>(
        market: &mut Market<T>,
        target_mag: u256,
        target_neg: bool,
        is_yes: bool,
        _ctx: &TxContext,
    ) {
        assert!(market.market_resolved, ENotResolved);
        let target = fp::from(target_mag, target_neg);
        let won = if (is_yes) fp::ge(market.final_price, target)
                  else fp::lt(market.final_price, target);
        assert!(!won, EPositionWinning);

        let token_id = derive_token_id(market.market_id, target, is_yes);
        if (table::contains(&market.token_liabilities, token_id)) {
            let liab = *table::borrow(&market.token_liabilities, token_id);
            *table::borrow_mut(&mut market.token_liabilities, token_id) = fp::zero();
            market.locked_collateral = fp::sub(market.locked_collateral, liab);
            market.available_liquidity = fp::add(market.available_liquidity, liab);
        };
    }

    /// Owner recovers USDC rounding dust (vault balance beyond accounted
    /// liquidity). Capped at 10 USDC and floored above 1 USDC, matching the
    /// Stylus `sweep_dust` guard.
    public fun sweep_dust<T>(market: &mut Market<T>, ctx: &mut TxContext) {
        assert!(ctx.sender() == market.owner, EUnauthorized);

        let expected_wad = fp::add(market.available_liquidity, market.locked_collateral);
        if (fp::is_neg(expected_wad)) { return };
        let expected_units = ((fp::mag(expected_wad) / USDC_SCALE) as u64);

        let actual = balance::value(&market.vault);
        if (actual > expected_units) {
            let dust = actual - expected_units;
            if (dust > DUST_MIN && dust <= DUST_MAX) {
                transfer::public_transfer(coin::take(&mut market.vault, dust, ctx), market.owner);
            };
        };
    }

    // ── Internal: fees / curve / liabilities ──────────────────────────────

    fun distribute_fee<T>(market: &mut Market<T>, fee_wad: u256) {
        if (market.total_shares > 0) {
            let inc = fp::from((fee_wad * WAD) / market.total_shares, false);
            market.acc_fee_per_share = fp::add(market.acc_fee_per_share, inc);
            market.available_liquidity = fp::add(market.available_liquidity, fp::from(fee_wad, false));
            event::emit(FeeDistributed { market_id: market.market_id, amount_wad: fee_wad });
        };
    }

    fun claim_fees_internal<T>(market: &mut Market<T>, user: address, ctx: &mut TxContext) {
        let shares = lp_shares(market, user);
        if (shares == 0) { return };

        let total = reward_debt_for(shares, market.acc_fee_per_share);
        let pending = fp::sub(total, lp_reward_debt(market, user));
        if (fp::gt(pending, fp::zero())) {
            market.available_liquidity = fp::sub(market.available_liquidity, pending);
            set_lp(market, user, shares, total);

            let units = ((fp::mag(pending) / USDC_SCALE) as u64);
            if (units > 0) {
                transfer::public_transfer(coin::take(&mut market.vault, units, ctx), user);
            };
        };
    }

    /// Lock collateral for a bet and fold it into the stake-weighted curve.
    /// Only bets reach this path — liquidity never does — which is exactly why
    /// LP deposits cannot move μ/σ.
    fun underwrite<T>(market: &mut Market<T>, token_id: u256, target: Fp, premium_wad: u256, liability_wad: u256) {
        market.trades_started = true;

        let premium = fp::from(premium_wad, false);
        let liability = fp::from(liability_wad, false);
        assert!(fp::ge(market.available_liquidity, liability), EInsufficientLiquidity);

        market.available_liquidity = fp::sub(fp::add(market.available_liquidity, premium), liability);
        market.locked_collateral = fp::add(market.locked_collateral, liability);
        add_liability(market, token_id, liability);

        // Curve accumulators: weight = net stake, x = strike.
        let x_sq = fp::mul(target, target);
        market.acc_stake_weight = fp::add(market.acc_stake_weight, premium);
        market.acc_weighted_x = fp::add(market.acc_weighted_x, fp::mul(premium, target));
        market.acc_weighted_x_sq = fp::add(market.acc_weighted_x_sq, fp::mul(premium, x_sq));
        recompute_curve(market);
    }

    /// Recompute μ = Σwx/Σw and σ = sqrt(E[x²] − μ²), floored at sigma_min.
    fun recompute_curve<T>(market: &mut Market<T>) {
        let tw = market.acc_stake_weight;
        if (!fp::gt(tw, fp::zero())) { return };

        let mu = fp::div(market.acc_weighted_x, tw);
        let ex2 = fp::div(market.acc_weighted_x_sq, tw);
        let variance = fp::sub(ex2, fp::mul(mu, mu));

        let mut sigma = if (fp::gt(variance, fp::zero())) gaussian::sqrt_wad(variance) else fp::zero();
        if (fp::lt(sigma, market.sigma_min)) { sigma = market.sigma_min };

        market.mu = mu;
        market.sigma = sigma;
        emit_curve(market);
    }

    fun emit_curve<T>(market: &Market<T>) {
        event::emit(CurveUpdated {
            market_id: market.market_id,
            mu_mag: fp::mag(market.mu),
            mu_neg: fp::is_neg(market.mu),
            sigma_mag: fp::mag(market.sigma),
        });
    }

    fun add_liability<T>(market: &mut Market<T>, token_id: u256, amt: Fp) {
        if (table::contains(&market.token_liabilities, token_id)) {
            let cur = table::borrow_mut(&mut market.token_liabilities, token_id);
            *cur = fp::add(*cur, amt);
        } else {
            table::add(&mut market.token_liabilities, token_id, amt);
        };
    }

    fun reduce_liability<T>(market: &mut Market<T>, token_id: u256, amt: Fp) {
        assert!(table::contains(&market.token_liabilities, token_id), EInsufficientLiquidity);
        let cur = table::borrow_mut(&mut market.token_liabilities, token_id);
        assert!(fp::ge(*cur, amt), EInsufficientLiquidity);
        *cur = fp::sub(*cur, amt);
    }

    // ── Internal: LP table helpers ────────────────────────────────────────

    fun reward_debt_for(shares: u256, acc: Fp): Fp {
        // acc is always non-negative.
        fp::from((shares * fp::mag(acc)) / WAD, false)
    }

    fun lp_shares<T>(market: &Market<T>, user: address): u256 {
        if (table::contains(&market.lp_accounts, user)) table::borrow(&market.lp_accounts, user).shares
        else 0
    }

    fun lp_reward_debt<T>(market: &Market<T>, user: address): Fp {
        if (table::contains(&market.lp_accounts, user)) table::borrow(&market.lp_accounts, user).reward_debt
        else fp::zero()
    }

    fun set_lp<T>(market: &mut Market<T>, user: address, shares: u256, reward_debt: Fp) {
        if (!table::contains(&market.lp_accounts, user)) {
            table::add(&mut market.lp_accounts, user, LpAccount { shares, reward_debt });
        } else {
            let a = table::borrow_mut(&mut market.lp_accounts, user);
            a.shares = shares;
            a.reward_debt = reward_debt;
        };
    }

    // ── Internal: token id ────────────────────────────────────────────────

    /// keccak256(market_id ‖ strike_mag ‖ strike_sign ‖ is_yes) folded to u256.
    fun derive_token_id(market_id: u64, target: Fp, is_yes: bool): u256 {
        let mut data = bcs::to_bytes(&market_id);
        vector::append(&mut data, bcs::to_bytes(&fp::mag(target)));
        vector::push_back(&mut data, if (fp::is_neg(target)) 1u8 else 0u8);
        vector::push_back(&mut data, if (is_yes) 1u8 else 0u8);
        bytes_to_u256(hash::keccak256(&data))
    }

    fun bytes_to_u256(v: vector<u8>): u256 {
        let mut res: u256 = 0;
        let n = vector::length(&v);
        let mut i = 0;
        while (i < n) {
            res = (res << 8) | (*vector::borrow(&v, i) as u256);
            i = i + 1;
        };
        res
    }

    // ── Views ─────────────────────────────────────────────────────────────

    /// Current μ as (magnitude, is_negative).
    public fun get_mu<T>(market: &Market<T>): (u256, bool) {
        (fp::mag(market.mu), fp::is_neg(market.mu))
    }

    /// Current σ magnitude (always non-negative).
    public fun get_sigma<T>(market: &Market<T>): u256 { fp::mag(market.sigma) }

    /// CDF-derived price (WAD) for a strike/direction, against the live curve.
    public fun get_price<T>(market: &Market<T>, target_mag: u256, target_neg: bool, is_yes: bool): u256 {
        let target = fp::from(target_mag, target_neg);
        let cdf = gaussian::normal_cdf(target, market.mu, market.sigma);
        let p = if (is_yes) fp::sub(fp::wad(), cdf) else cdf;
        fp::to_u256(p)
    }

    public fun is_resolved<T>(market: &Market<T>): bool { market.market_resolved }
    public fun final_price<T>(market: &Market<T>): (u256, bool) {
        (fp::mag(market.final_price), fp::is_neg(market.final_price))
    }
    /// Scheduled close (ms): earliest `Clock` time at which the market may be
    /// resolved. Fixed at creation.
    public fun resolves_at<T>(market: &Market<T>): u64 { market.resolves_at }
    /// Bound Pyth price-feed id (32 bytes), or empty for a manual-only market.
    public fun price_feed_id<T>(market: &Market<T>): vector<u8> { market.price_feed_id }
    /// Whether this market is wired to a Pyth feed (settled via `resolve_with_pyth`).
    public fun has_price_feed<T>(market: &Market<T>): bool {
        vector::length(&market.price_feed_id) == PRICE_FEED_ID_LEN
    }
    public fun market_id<T>(market: &Market<T>): u64 { market.market_id }
    public fun owner<T>(market: &Market<T>): address { market.owner }
    public fun pending_owner<T>(market: &Market<T>): address { market.pending_owner }
    public fun title<T>(market: &Market<T>): String { market.title }
    public fun total_shares<T>(market: &Market<T>): u256 { market.total_shares }
    public fun lp_balance<T>(market: &Market<T>, user: address): u256 { lp_shares(market, user) }
    public fun vault_value<T>(market: &Market<T>): u64 { balance::value(&market.vault) }

    /// σ floor, as (magnitude). Always non-negative.
    public fun sigma_min<T>(market: &Market<T>): u256 { fp::mag(market.sigma_min) }
    /// Virtual stake backing the seeded μ/σ.
    public fun prior_weight<T>(market: &Market<T>): u256 { fp::mag(market.prior_weight) }
    /// Σ of all stake weights folded into the curve.
    public fun acc_stake_weight<T>(market: &Market<T>): u256 { fp::mag(market.acc_stake_weight) }
    /// MasterChef fee-per-share accumulator (WAD).
    public fun acc_fee_per_share<T>(market: &Market<T>): u256 { fp::mag(market.acc_fee_per_share) }
    /// Free collateral, as (magnitude, is_negative).
    public fun available_liquidity<T>(market: &Market<T>): (u256, bool) {
        (fp::mag(market.available_liquidity), fp::is_neg(market.available_liquidity))
    }
    /// Collateral encumbered by open positions.
    public fun locked_collateral<T>(market: &Market<T>): (u256, bool) {
        (fp::mag(market.locked_collateral), fp::is_neg(market.locked_collateral))
    }
    public fun trades_started<T>(market: &Market<T>): bool { market.trades_started }
    /// ms deadline of an active resolution proposal; 0 if none.
    public fun resolution_time<T>(market: &Market<T>): u64 { market.resolution_time }

    /// An LP's MasterChef reward-debt snapshot (WAD). Mirrors the Stylus AMM's
    /// `reward_debt(user)` view; always non-negative.
    public fun reward_debt<T>(market: &Market<T>, user: address): u256 {
        fp::mag(lp_reward_debt(market, user))
    }

    /// Unclaimed trading fees for an LP (WAD): shares·acc/WAD − reward_debt.
    public fun pending_fees<T>(market: &Market<T>, user: address): u256 {
        let shares = lp_shares(market, user);
        if (shares == 0) { return 0 };
        let total = (shares * fp::mag(market.acc_fee_per_share)) / WAD;
        let rd = fp::mag(lp_reward_debt(market, user)); // reward_debt is non-negative
        if (total > rd) total - rd else 0
    }

    /// Derive the token id for a (strike, direction) — the on-chain analogue of
    /// the Stylus router's `compute_token_id`.
    public fun compute_token_id<T>(market: &Market<T>, target_mag: u256, target_neg: bool, is_yes: bool): u256 {
        derive_token_id(market.market_id, fp::from(target_mag, target_neg), is_yes)
    }

    /// Position fields, for off-chain indexers and the frontend.
    public fun position_info(p: &Position): (u64, u256, bool, u256) {
        (p.market_id, p.token_id, p.is_yes, p.amount_wad)
    }

    // ── Registry views (factory lookups) ──────────────────────────────────

    public fun market_count(registry: &Registry): u64 { registry.market_count }
    /// The shared `Market` object address for a market id.
    public fun get_market(registry: &Registry, market_id: u64): address {
        *table::borrow(&registry.markets, market_id)
    }
    public fun market_exists(registry: &Registry, market_id: u64): bool {
        table::contains(&registry.markets, market_id)
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

    /// Expose the Pyth-price → signed-WAD conversion for unit tests (constructing
    /// a full `PriceInfoObject` in tests would require live Pyth/Wormhole state).
    #[test_only]
    public fun pyth_price_to_fp_for_testing(p: &Price): (u256, bool) {
        let fp_val = pyth_price_to_fp(p);
        (fp::mag(fp_val), fp::is_neg(fp_val))
    }
}
