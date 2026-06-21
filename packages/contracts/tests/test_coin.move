/// A throwaway 6-decimal coin used **only by the unit tests** as a concrete `T`
/// to instantiate `Market<T>`. It is `#[test_only]`, so it is never compiled into
/// the published package — the protocol itself is collateral-agnostic and runs on
/// real testnet/mainnet USDC. Mirrors USDC's 6 decimals so the WAD scaling under
/// test matches production.
#[test_only]
#[allow(deprecated_usage, lint(self_transfer))]
module continuum::test_coin {

    use sui::coin::{Self, Coin, TreasuryCap};

    /// One-time witness. Must match the module name uppercased.
    public struct TEST_COIN has drop {}

    fun init(witness: TEST_COIN, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            witness,
            6, // decimals — matches USDC
            b"tUSDC",
            b"Test USDC",
            b"Unit-test collateral for Continuum",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        transfer::public_transfer(treasury, ctx.sender());
    }

    /// Mint test collateral (6-decimal units).
    public fun mint(
        treasury: &mut TreasuryCap<TEST_COIN>,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<TEST_COIN> {
        coin::mint(treasury, amount, ctx)
    }

    public fun init_for_testing(ctx: &mut TxContext) {
        init(TEST_COIN {}, ctx)
    }
}
