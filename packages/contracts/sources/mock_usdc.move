/// A minimal 6-decimal mock USDC used as collateral for local testing and as a
/// concrete `T` to instantiate `Market<T>`. On testnet/mainnet, instantiate the
/// market with the real USDC coin type instead.
///
/// Uses `coin::create_currency` (deprecated in favor of `coin_registry` in newer
/// SDKs, but kept here for portability — this is test collateral only).
#[allow(deprecated_usage, lint(self_transfer))]
module continuum::mock_usdc {

    use sui::coin::{Self, Coin, TreasuryCap};

    /// One-time witness. Must match the module name uppercased.
    public struct MOCK_USDC has drop {}

    fun init(witness: MOCK_USDC, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            witness,
            6,            // decimals — matches USDC
            b"USDC",
            b"Mock USDC",
            b"Test collateral for Continuum",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        // Hand the minting cap to the publisher so they can faucet test funds.
        transfer::public_transfer(treasury, ctx.sender());
    }

    /// Mint test USDC (6-decimal units).
    public fun mint(
        treasury: &mut TreasuryCap<MOCK_USDC>,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<MOCK_USDC> {
        coin::mint(treasury, amount, ctx)
    }

    /// Entry-friendly faucet: mint and send to a recipient.
    public fun faucet(
        treasury: &mut TreasuryCap<MOCK_USDC>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        transfer::public_transfer(coin::mint(treasury, amount, ctx), recipient);
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(MOCK_USDC {}, ctx)
    }
}
