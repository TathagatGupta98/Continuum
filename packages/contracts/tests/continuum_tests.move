#[test_only]
module continuum::continuum_tests {

    use sui::test_scenario as ts;
    use sui::clock;
    use sui::coin::{Self, TreasuryCap, Coin};
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::TransferPolicy;
    use sui::sui::SUI;
    use continuum::fixed_point::{Self as fp, Fp};
    use continuum::gaussian;
    use continuum::market::{Self, Market, Registry, Position};
    use continuum::mock_usdc::{Self, MOCK_USDC};
    use continuum::position_market;
    use pyth::price;
    use pyth::i64 as pyth_i64;

    /// |a − b| < tol ?
    fun approx(a: Fp, b: Fp, tol: u256): bool {
        fp::lt(fp::from(fp::mag(fp::sub(a, b)), false), fp::from(tol, false))
    }

    // ── Gaussian math ─────────────────────────────────────────────────────

    #[test]
    fun exp_of_zero_is_one() {
        assert!(fp::eq(gaussian::exp_wad(fp::zero()), fp::wad()), 0);
    }

    #[test]
    fun cdf_at_mean_is_half() {
        // Φ(0; 0, 1) = 0.5, within 0.001.
        let mid = gaussian::normal_cdf(fp::zero(), fp::zero(), fp::wad());
        assert!(approx(mid, fp::from(500_000_000_000_000_000, false), 1_000_000_000_000_000), 0);
    }

    #[test]
    fun cdf_is_monotonic() {
        let mu = fp::zero();
        let sigma = fp::wad();
        let lo = gaussian::normal_cdf(fp::from(500_000_000_000_000_000, true), mu, sigma);  // -0.5
        let hi = gaussian::normal_cdf(fp::from(500_000_000_000_000_000, false), mu, sigma); // +0.5
        assert!(fp::lt(lo, hi), 0);
        // Symmetric: Φ(-x) + Φ(x) ≈ 1.
        assert!(approx(fp::add(lo, hi), fp::wad(), 2_000_000_000_000_000), 1);
    }

    #[test]
    fun sqrt_of_four_is_two() {
        let four = fp::from(4_000_000_000_000_000_000, false);
        let two = fp::from(2_000_000_000_000_000_000, false);
        assert!(approx(gaussian::sqrt_wad(four), two, 1_000_000_000_000_000), 0);
    }

    #[test]
    fun signed_add_and_compare() {
        // (-2) + 3 = 1
        let r = fp::add(fp::from(2_000_000_000_000_000_000, true), fp::from(3_000_000_000_000_000_000, false));
        assert!(fp::eq(r, fp::from(1_000_000_000_000_000_000, false)), 0);
        assert!(fp::lt(fp::from(1, true), fp::zero()), 1);
        assert!(fp::gt(fp::zero(), fp::from(1, true)), 2);
    }

    // ── Pyth price → signed-WAD conversion ────────────────────────────────

    #[test]
    fun pyth_price_converts_to_wad() {
        // BTC ≈ $65000.12345678 reported by Pyth as price=6500012345678, expo=-8.
        // WAD = 65000.12345678 · 1e18.
        let p = price::new(
            pyth_i64::new(6_500_012_345_678, false), // price
            0,                                        // conf
            pyth_i64::new(8, true),                   // expo = -8
            0,                                        // timestamp
        );
        let (mag, neg) = market::pyth_price_to_fp_for_testing(&p);
        assert!(!neg, 0);
        assert!(mag == 65_000_123_456_780_000_000_000, 1);
    }

    #[test]
    fun pyth_negative_price_converts() {
        // A signed feed reporting −2.5 (price=-250, expo=-2) → −2.5 · 1e18 WAD.
        let p = price::new(pyth_i64::new(250, true), 0, pyth_i64::new(2, true), 0);
        let (mag, neg) = market::pyth_price_to_fp_for_testing(&p);
        assert!(neg, 0);
        assert!(mag == 2_500_000_000_000_000_000, 1);
    }

    // ── Full market lifecycle ─────────────────────────────────────────────

    #[test]
    fun market_end_to_end() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);

        // Publish: share the Registry, create the mock USDC currency.
        {
            market::init_for_testing(ts::ctx(&mut sc));
            mock_usdc::init_for_testing(ts::ctx(&mut sc));
        };

        // Create a market collateralized by MOCK_USDC (sigma_min = 0.001 WAD).
        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            market::create_market<MOCK_USDC>(
                &mut registry,
                b"Will ETH top $5k?",
                1_000_000_000_000_000,
                1000, // resolves_at (ms)
                b"", // price_feed_id (none → manual market)
                ts::ctx(&mut sc),
            );
            ts::return_shared(registry);
        };

        // Seed μ=0, σ=1; add 1000 USDC liquidity; buy YES at strike 0.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut cap = ts::take_from_sender<TreasuryCap<MOCK_USDC>>(&sc);

            market::set_distribution(&mut m, 0, false, 1_000_000_000_000_000_000, ts::ctx(&mut sc));

            let liq = mock_usdc::mint(&mut cap, 1_000_000_000, ts::ctx(&mut sc)); // 1000 USDC
            market::add_liquidity(&mut m, liq, ts::ctx(&mut sc));
            assert!(market::total_shares(&m) == 1_000_000_000 * 1_000_000_000_000, 0);

            let stake = mock_usdc::mint(&mut cap, 1_000_000, ts::ctx(&mut sc)); // 1 USDC
            market::buy_yes(&mut m, stake, 0, false, ts::ctx(&mut sc));

            ts::return_to_sender(&sc, cap);
            ts::return_shared(m);
        };

        // The buy shifted the curve and minted a Position to the buyer.
        ts::next_tx(&mut sc, admin);
        {
            let m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            assert!(market::get_sigma(&m) > 0, 0);
            ts::return_shared(m);
        };

        // Resolve: final price 100 (≥ strike 0 ⇒ YES wins). Only allowed once the
        // scheduled close (resolves_at = 1000) has passed.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            clock::set_for_testing(&mut c, 1000);
            market::set_final_price(&mut m, 100_000_000_000_000_000_000, false, &c, ts::ctx(&mut sc));
            assert!(market::is_resolved(&m), 0);
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };

        // Claim the winning position for collateral.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let pos = ts::take_from_sender<Position>(&sc);
            market::claim_winnings(&mut m, pos, ts::ctx(&mut sc));
            ts::return_shared(m);
        };

        // Payout coin landed with the claimer.
        ts::next_tx(&mut sc, admin);
        {
            let payout = ts::take_from_sender<Coin<MOCK_USDC>>(&sc);
            assert!(coin::value(&payout) > 0, 0);
            ts::return_to_sender(&sc, payout);
        };

        ts::end(sc);
    }

    // ── Two-phase timelock resolution ─────────────────────────────────────

    #[test]
    fun two_phase_resolution_timelock() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);
        {
            market::init_for_testing(ts::ctx(&mut sc));
            mock_usdc::init_for_testing(ts::ctx(&mut sc));
        };

        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            market::create_market<MOCK_USDC>(&mut registry, b"Timelock", 1_000_000_000_000_000, 1000, b"", ts::ctx(&mut sc));
            assert!(market::market_count(&registry) == 1, 0);
            assert!(market::market_exists(&registry, 0), 1);
            ts::return_shared(registry);
        };

        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut cap = ts::take_from_sender<TreasuryCap<MOCK_USDC>>(&sc);
            market::set_distribution(&mut m, 0, false, 1_000_000_000_000_000_000, ts::ctx(&mut sc));
            let liq = mock_usdc::mint(&mut cap, 1_000_000_000, ts::ctx(&mut sc));
            market::add_liquidity(&mut m, liq, ts::ctx(&mut sc));
            let stake = mock_usdc::mint(&mut cap, 1_000_000, ts::ctx(&mut sc));
            market::buy_yes(&mut m, stake, 0, false, ts::ctx(&mut sc));
            ts::return_to_sender(&sc, cap);
            ts::return_shared(m);
        };

        // Propose at t=1000, then execute only after the 24h window elapses.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            clock::set_for_testing(&mut c, 1000);
            market::propose_resolution(&mut m, 100_000_000_000_000_000_000, false, &c, ts::ctx(&mut sc));
            assert!(market::resolution_time(&m) == 1000 + 86_400_000, 0);

            clock::set_for_testing(&mut c, 1000 + 86_400_000);
            market::execute_resolution(&mut m, &c, ts::ctx(&mut sc));
            assert!(market::is_resolved(&m), 1);
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };

        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let pos = ts::take_from_sender<Position>(&sc);
            market::claim_winnings(&mut m, pos, ts::ctx(&mut sc));
            ts::return_shared(m);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = 17, location = continuum::market)]
    fun execute_before_timelock_aborts() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);
        { market::init_for_testing(ts::ctx(&mut sc)); };
        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            market::create_market<MOCK_USDC>(&mut registry, b"M", 1_000_000_000_000_000, 1000, b"", ts::ctx(&mut sc));
            ts::return_shared(registry);
        };
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            clock::set_for_testing(&mut c, 1000);
            market::propose_resolution(&mut m, 100, false, &c, ts::ctx(&mut sc));
            // Still inside the dispute window — must abort (ETimelockActive = 17).
            market::execute_resolution(&mut m, &c, ts::ctx(&mut sc));
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };
        ts::end(sc);
    }

    // ── Scheduled resolution time ─────────────────────────────────────────

    #[test]
    #[expected_failure(abort_code = 18, location = continuum::market)]
    fun resolve_before_close_aborts() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);
        { market::init_for_testing(ts::ctx(&mut sc)); };
        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            // Market closes at t = 10_000 ms.
            market::create_market<MOCK_USDC>(&mut registry, b"Scheduled", 1_000_000_000_000_000, 10_000, b"", ts::ctx(&mut sc));
            assert!(market::market_exists(&registry, 0), 0);
            ts::return_shared(registry);
        };
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            assert!(market::resolves_at(&m) == 10_000, 0);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            // Now (5_000) is before the scheduled close → must abort (EMarketNotClosed = 18).
            clock::set_for_testing(&mut c, 5_000);
            market::set_final_price(&mut m, 100, false, &c, ts::ctx(&mut sc));
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };
        ts::end(sc);
    }

    // ── Two-step ownership ────────────────────────────────────────────────

    #[test]
    fun ownership_is_two_step() {
        let admin = @0xA;
        let new_owner = @0xB;
        let mut sc = ts::begin(admin);
        { market::init_for_testing(ts::ctx(&mut sc)); };

        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            market::create_market<MOCK_USDC>(&mut registry, b"M", 1_000_000_000_000_000, 1000, b"", ts::ctx(&mut sc));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            market::transfer_ownership(&mut m, new_owner, ts::ctx(&mut sc));
            assert!(market::pending_owner(&m) == new_owner, 0);
            assert!(market::owner(&m) == admin, 1); // not yet effective
            ts::return_shared(m);
        };

        ts::next_tx(&mut sc, new_owner);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            market::accept_ownership(&mut m, ts::ctx(&mut sc));
            assert!(market::owner(&m) == new_owner, 2);
            ts::return_shared(m);
        };
        ts::end(sc);
    }

    // ── Tradeable positions (Kiosk + TransferPolicy) ──────────────────────

    /// Publish the protocol + the position TransferPolicy, create a MOCK_USDC
    /// market closing at `resolves_at`, seed it, add liquidity, and buy a YES
    /// position at strike 0. Leaves `admin` holding one `Position`.
    fun setup_and_buy(sc: &mut ts::Scenario, admin: address, resolves_at: u64) {
        {
            market::init_for_testing(ts::ctx(sc));
            mock_usdc::init_for_testing(ts::ctx(sc));
            position_market::init_for_testing(ts::ctx(sc));
        };
        ts::next_tx(sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(sc);
            market::create_market<MOCK_USDC>(&mut registry, b"Kiosk market", 1_000_000_000_000_000, resolves_at, b"", ts::ctx(sc));
            ts::return_shared(registry);
        };
        ts::next_tx(sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(sc);
            let mut cap = ts::take_from_sender<TreasuryCap<MOCK_USDC>>(sc);
            market::set_distribution(&mut m, 0, false, 1_000_000_000_000_000_000, ts::ctx(sc));
            let liq = mock_usdc::mint(&mut cap, 1_000_000_000, ts::ctx(sc));
            market::add_liquidity(&mut m, liq, ts::ctx(sc));
            let stake = mock_usdc::mint(&mut cap, 1_000_000, ts::ctx(sc));
            market::buy_yes(&mut m, stake, 0, false, ts::ctx(sc));
            ts::return_to_sender(sc, cap);
            ts::return_shared(m);
        };
    }

    /// `admin` places its `Position` into a fresh kiosk and lists it at `price`.
    /// The kiosk is shared (so buyers can purchase from it) and the owner cap is
    /// returned to `admin`. Returns the listed position's object id.
    fun list_in_shared_kiosk(sc: &mut ts::Scenario, admin: address, price: u64): ID {
        ts::next_tx(sc, admin);
        let pos = ts::take_from_sender<Position>(sc);
        let pos_id = object::id(&pos);
        let (mut k, cap) = kiosk::new(ts::ctx(sc));
        position_market::list_position(&mut k, &cap, pos, price);
        transfer::public_share_object(k);
        transfer::public_transfer(cap, admin);
        pos_id
    }

    #[test]
    fun kiosk_resale_happy_path() {
        let admin = @0xA;
        let buyer = @0xB;
        let mut sc = ts::begin(admin);
        setup_and_buy(&mut sc, admin, 1_000_000); // closes far in the future → open
        let pos_id = list_in_shared_kiosk(&mut sc, admin, 5_000_000);

        // Buyer purchases the listed position while the market is open.
        ts::next_tx(&mut sc, buyer);
        {
            let m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut k = ts::take_shared<Kiosk>(&sc);
            let policy = ts::take_shared<TransferPolicy<Position>>(&sc);
            let pay = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut sc));
            position_market::buy_listed_position(&mut k, &policy, &m, pos_id, pay, ts::ctx(&mut sc));
            // SUI proceeds accrued to the seller's kiosk.
            assert!(kiosk::profits_amount(&k) == 5_000_000, 0);
            ts::return_shared(m);
            ts::return_shared(k);
            ts::return_shared(policy);
        };
        // The buyer now owns the position.
        ts::next_tx(&mut sc, buyer);
        {
            let pos = ts::take_from_sender<Position>(&sc);
            let (_mid, _tok, _yes, amt) = market::position_info(&pos);
            assert!(amt > 0, 1);
            ts::return_to_sender(&sc, pos);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = continuum::position_market)]
    fun kiosk_resale_blocked_after_resolution() {
        let admin = @0xA;
        let buyer = @0xB;
        let mut sc = ts::begin(admin);
        setup_and_buy(&mut sc, admin, 1000);
        let pos_id = list_in_shared_kiosk(&mut sc, admin, 5_000_000);

        // Resolve the market (now past its scheduled close).
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            clock::set_for_testing(&mut c, 1000);
            market::set_final_price(&mut m, 100_000_000_000_000_000_000, false, &c, ts::ctx(&mut sc));
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };
        // Purchase must abort with EMarketResolved (= 1): a settled position cannot be sold.
        ts::next_tx(&mut sc, buyer);
        {
            let m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut k = ts::take_shared<Kiosk>(&sc);
            let policy = ts::take_shared<TransferPolicy<Position>>(&sc);
            let pay = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut sc));
            position_market::buy_listed_position(&mut k, &policy, &m, pos_id, pay, ts::ctx(&mut sc));
            ts::return_shared(m);
            ts::return_shared(k);
            ts::return_shared(policy);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = 0, location = continuum::position_market)]
    fun kiosk_resale_wrong_market_aborts() {
        let admin = @0xA;
        let buyer = @0xB;
        let mut sc = ts::begin(admin);
        setup_and_buy(&mut sc, admin, 1_000_000); // market 0 holds the position
        let pos_id = list_in_shared_kiosk(&mut sc, admin, 5_000_000);

        // Create a second, unrelated market (id 1).
        ts::next_tx(&mut sc, admin);
        {
            let mut registry = ts::take_shared<Registry>(&sc);
            market::create_market<MOCK_USDC>(&mut registry, b"Other", 1_000_000_000_000_000, 1_000_000, b"", ts::ctx(&mut sc));
            ts::return_shared(registry);
        };

        // Buying a market-0 position while supplying market 1 must abort (EWrongMarket = 0).
        ts::next_tx(&mut sc, buyer);
        {
            let registry = ts::take_shared<Registry>(&sc);
            let m1_addr = market::get_market(&registry, 1);
            let m1 = ts::take_shared_by_id<Market<MOCK_USDC>>(&sc, object::id_from_address(m1_addr));
            let mut k = ts::take_shared<Kiosk>(&sc);
            let policy = ts::take_shared<TransferPolicy<Position>>(&sc);
            let pay = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut sc));
            position_market::buy_listed_position(&mut k, &policy, &m1, pos_id, pay, ts::ctx(&mut sc));
            ts::return_shared(registry);
            ts::return_shared(m1);
            ts::return_shared(k);
            ts::return_shared(policy);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = continuum::position_market)]
    fun kiosk_resale_decoy_item_aborts() {
        let admin = @0xA;
        let buyer = @0xB;
        let mut sc = ts::begin(admin);
        setup_and_buy(&mut sc, admin, 1_000_000); // posA → admin, market open
        let pos_a_id = list_in_shared_kiosk(&mut sc, admin, 5_000_000);

        // Admin buys a second (decoy) position in the same open market and hands it
        // to the buyer.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut cap = ts::take_from_sender<TreasuryCap<MOCK_USDC>>(&sc);
            let stake = mock_usdc::mint(&mut cap, 1_000_000, ts::ctx(&mut sc));
            market::buy_yes(&mut m, stake, 0, false, ts::ctx(&mut sc));
            ts::return_to_sender(&sc, cap);
            ts::return_shared(m);
        };
        ts::next_tx(&mut sc, admin);
        {
            let decoy = ts::take_from_sender<Position>(&sc);
            transfer::public_transfer(decoy, buyer);
        };

        // Hand-crafted bypass attempt: purchase posA but prove the rule with the
        // decoy (a valid, open, same-market position). Must abort with EWrongItem (2)
        // because the proved position is not the item being transferred.
        ts::next_tx(&mut sc, buyer);
        {
            let m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut k = ts::take_shared<Kiosk>(&sc);
            let policy = ts::take_shared<TransferPolicy<Position>>(&sc);
            let decoy = ts::take_from_sender<Position>(&sc);
            let pay = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut sc));
            let (bought, mut req) = kiosk::purchase<Position>(&mut k, pos_a_id, pay);
            position_market::prove(&policy, &mut req, &decoy, &m);
            // Unreachable — prove aborts above.
            transfer::public_transfer(bought, buyer);
            transfer::public_transfer(decoy, buyer);
            sui::transfer_policy::confirm_request(&policy, req);
            ts::return_shared(m);
            ts::return_shared(k);
            ts::return_shared(policy);
        };
        ts::end(sc);
    }

    #[test]
    fun kiosk_take_and_claim_winner() {
        let admin = @0xA;
        let mut sc = ts::begin(admin);
        setup_and_buy(&mut sc, admin, 1000);
        let pos_id = list_in_shared_kiosk(&mut sc, admin, 5_000_000);

        // Resolve YES wins (final 100 ≥ strike 0).
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut c = clock::create_for_testing(ts::ctx(&mut sc));
            clock::set_for_testing(&mut c, 1000);
            market::set_final_price(&mut m, 100_000_000_000_000_000_000, false, &c, ts::ctx(&mut sc));
            clock::destroy_for_testing(c);
            ts::return_shared(m);
        };
        // Owner reclaims the listed position from the kiosk and redeems it in one call.
        ts::next_tx(&mut sc, admin);
        {
            let mut m = ts::take_shared<Market<MOCK_USDC>>(&sc);
            let mut k = ts::take_shared<Kiosk>(&sc);
            let cap = ts::take_from_sender<KioskOwnerCap>(&sc);
            position_market::take_and_claim(&mut k, &cap, &mut m, pos_id, ts::ctx(&mut sc));
            ts::return_to_sender(&sc, cap);
            ts::return_shared(k);
            ts::return_shared(m);
        };
        // Payout coin landed with the claimer.
        ts::next_tx(&mut sc, admin);
        {
            let payout = ts::take_from_sender<Coin<MOCK_USDC>>(&sc);
            assert!(coin::value(&payout) > 0, 0);
            ts::return_to_sender(&sc, payout);
        };
        ts::end(sc);
    }
}
