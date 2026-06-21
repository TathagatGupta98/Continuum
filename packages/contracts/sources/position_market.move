/// Continuum secondary market for `Position` objects, built on Sui's Kiosk +
/// TransferPolicy standard.
///
/// A `Position` (minted by `continuum::market::buy_yes`/`buy_no`) is an owned
/// object that today lives in the bettor's wallet until settlement. This module
/// makes positions **tradeable before settlement**: a holder can list a position
/// in a Kiosk, and a buyer can purchase it — but only while the underlying market
/// is still open.
///
/// The trading rule travels with the asset, enforced at the Move level via a
/// `TransferPolicy<Position>` carrying a single `MarketOpenRule`: a purchase is
/// only confirmable while `market.is_resolved() == false`, and the supplied
/// market must be the position's own market. A settled position can therefore
/// never be sold to an unsuspecting buyer — the transaction aborts.
///
/// Design notes:
///   * Positions are *placed* (takeable by the owner), not *locked*, so a winner
///     can always reclaim a position to redeem it (`take_and_claim`). The rule is
///     enforced on every kiosk purchase, which is the buyer-protection path.
///   * Kiosk purchases settle in `Coin<SUI>` (the framework hard-types it), so
///     listing prices are SUI-denominated (MIST). A USDC-denominated secondary
///     market would require a custom marketplace and is out of scope.
///
/// Payouts/positions are sent to `ctx.sender()`; the self-transfer lint is
/// intentional here and suppressed (matches `continuum::market`).
#[allow(lint(self_transfer))]
module continuum::position_market {

    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};
    use sui::package;
    use sui::coin::Coin;
    use sui::sui::SUI;
    use continuum::market::{Self, Position, Market};

    // ── Errors ────────────────────────────────────────────────────────────

    /// The market supplied to the transfer rule is not the position's market.
    const EWrongMarket: u64 = 0;
    /// The market has already resolved — its positions can no longer be sold.
    const EMarketResolved: u64 = 1;
    /// The position proved against is not the item this request is transferring.
    const EWrongItem: u64 = 2;

    // ── Witnesses / config ────────────────────────────────────────────────

    /// One-time witness used to claim the package `Publisher` at publish.
    public struct POSITION_MARKET has drop {}

    /// Witness for the market-open transfer rule.
    public struct MarketOpenRule has drop {}

    /// Empty per-rule config (the open guard takes no parameters).
    public struct Config has store, drop {}

    // ── Publish ───────────────────────────────────────────────────────────

    /// Runs at publish: claim the `Publisher`, create a `TransferPolicy<Position>`
    /// carrying the market-open rule, share the policy, and hand the policy/admin
    /// caps to the deployer.
    fun init(otw: POSITION_MARKET, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        let (mut policy, cap) = transfer_policy::new<Position>(&publisher, ctx);
        transfer_policy::add_rule(MarketOpenRule {}, &mut policy, &cap, Config {});
        transfer::public_share_object(policy);
        transfer::public_transfer(cap, ctx.sender());
        transfer::public_transfer(publisher, ctx.sender());
    }

    // ── Transfer rule ─────────────────────────────────────────────────────

    /// Satisfy the market-open rule for a pending purchase. Bound to the *actual*
    /// item the request is transferring and the position's own `Market`: asserts
    /// the proved position IS that item, that the market matches it, and that the
    /// market is still open, then stamps the receipt that lets `confirm_request`
    /// unpack the transfer.
    ///
    /// The item binding is load-bearing: `prove`, `kiosk::purchase` and
    /// `confirm_request` are all public, so without it a buyer could hand-craft a
    /// PTB that purchases a resolved position yet satisfies the rule with a decoy
    /// open position. Tying the proof to `transfer_policy::item(request)` makes the
    /// guard unbypassable regardless of how the PTB is assembled.
    public fun prove<T>(
        _policy: &TransferPolicy<Position>,
        request: &mut TransferRequest<Position>,
        position: &Position,
        market: &Market<T>,
    ) {
        assert!(object::id(position) == transfer_policy::item(request), EWrongItem);
        let (pos_market_id, _tok, _yes, _amt) = market::position_info(position);
        assert!(pos_market_id == market::market_id(market), EWrongMarket);
        assert!(!market::is_resolved(market), EMarketResolved);
        transfer_policy::add_receipt(MarketOpenRule {}, request);
    }

    // ── Listing (owner) ───────────────────────────────────────────────────

    /// Place a position into the caller's kiosk and list it for sale at `price`
    /// (SUI/MIST). Owner-only via the `KioskOwnerCap`.
    public fun list_position(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        position: Position,
        price: u64,
    ) {
        kiosk::place_and_list<Position>(kiosk, cap, position, price);
    }

    /// Remove a listing, keeping the position in the kiosk (owner-only).
    public fun delist_position(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        position_id: ID,
    ) {
        kiosk::delist<Position>(kiosk, cap, position_id);
    }

    // ── Purchase (buyer) ──────────────────────────────────────────────────

    /// Buy a listed position from `seller_kiosk`. Pays `payment` (SUI, must equal
    /// the listed price), proves the market-open rule against the position's own
    /// `market`, finalises the transfer, and delivers the position to the buyer.
    /// Aborts if the market has resolved or the wrong market is supplied. SUI
    /// proceeds accrue to the seller's kiosk profits (withdrawn via `kiosk::withdraw`).
    public fun buy_listed_position<T>(
        seller_kiosk: &mut Kiosk,
        policy: &TransferPolicy<Position>,
        market: &Market<T>,
        position_id: ID,
        payment: Coin<SUI>,
        ctx: &TxContext,
    ) {
        let (position, mut request) = kiosk::purchase<Position>(seller_kiosk, position_id, payment);
        prove(policy, &mut request, &position, market);
        transfer_policy::confirm_request(policy, request);
        transfer::public_transfer(position, ctx.sender());
    }

    // ── Reclaim + redeem (owner) ──────────────────────────────────────────

    /// Take a position back out of the caller's kiosk and redeem it for collateral
    /// in one call. `take` is owner reclaim, not a sale, so the transfer policy
    /// does not apply. Delists first if the position is still listed.
    public fun take_and_claim<T>(
        kiosk: &mut Kiosk,
        cap: &KioskOwnerCap,
        market: &mut Market<T>,
        position_id: ID,
        ctx: &mut TxContext,
    ) {
        if (kiosk::is_listed(kiosk, position_id)) {
            kiosk::delist<Position>(kiosk, cap, position_id);
        };
        let position = kiosk::take<Position>(kiosk, cap, position_id);
        market::claim_winnings<T>(market, position, ctx);
    }

    // ── Test hooks ────────────────────────────────────────────────────────

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(sui::test_utils::create_one_time_witness<POSITION_MARKET>(), ctx);
    }
}
