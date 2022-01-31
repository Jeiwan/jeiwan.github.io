---
title: "Programming DeFi: Uniswap V2. Part 2"
date: 2022-01-31T00:00:00+00:00
katex: true
tags: ["Uniswap", "Ethereum", "DeFi", "Blockchain", "Solidity"]
---

![Best rates](/images/jon-cellier-7JoXNRbx6Qg-unsplash.jpg)
Photo by
[Jon Cellier](https://unsplash.com/@frenchieeye?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on [Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

Welcome back! Today we'll add the core functionality to our clone of [Uniswap V2](https://uniswap.org)–swapping.
Decentralized tokens exchanging is what Uniswap was created for, and today we'll see how it's done. We're still working
on the core pair contract, which means that our implementation will be very low-level and minimal. There's no convenient
interface and we won't even have price calculation at this point!

Also, we're going to implement a price oracle: the design of the pair contract allows to implement one
with only a few lines.

Additionally, I'll explain some details and ideas behind the pair contract implementation, on which I didn't focus enough
in the previous part.

Let's begin!

## Tokens swapping

At this point, we have everything we need to perform actual tokens exchanging. Let's think how we will implement it.

Exchanging means giving away some amount of Token A in exchange for Token B. But we need some kind of a mediator that:

1. Provides actual exchange rates.
1. Guarantees that all exchanges are paid in full, i.e. all exchanges are made under correct rate.

We learned something about pricing of DEXes when we were working on liquidity provision: it's the amount of liquidity
in a pool that defines exchange rates. In [the Uniswap V1 series](https://jeiwan.net/posts/programming-defi-uniswap-1/),
I explained in details how the constant product formula works and what is the main condition for a successful swap.
Namely: **the product of reserves after a swap must be equal or greater than that before the swap**. That's it: the
constant product must remain the same, no matter what's the amount of reserves in pool. This is basically the only
condition we must guarantee and, surprisingly, this condition frees us from calculating swap price.

As I mentioned in the introduction, the pair contract is a core contract, which means it must be as low-level and minimal
as possible. This also affects how we send tokens to the contract. There a two ways of transferring tokens to someone:

1. By calling `transfer` method of the token contract and passing recipient's address and the amount to be sent.
1. By calling `approve` method to allow the other user or contract to transfer some amount of your tokens to their
   address. The other party would have to call `transferFrom` to get your tokens. You pay only for approving a certain
   amount; the other party pays for the actual transfer.

The approval pattern is very common in Ethereum applications: dapps ask users to approve spending of the maximum amount
so users don't need to call `approve` again and again (which costs gas). This improces user experience. And this is
not what we're looking for at this moment. So we'll go with the manual transferring to the pair contract.

Let's get to code!

The function takes two output amounts, one for each token. These are the amounts that caller wants to get in exchange
for their tokens. Why doing it like that? Because we don't even want to enforce the direction of swap: caller can
specify either of the amounts or both of them, and we'll just perform necessary checks.

```solidity
function swap(
    uint256 amount0Out,
    uint256 amount1Out,
    address to
) public {
    if (amount0Out == 0 && amount1Out == 0)
        revert InsufficientOutputAmount();

    ...
```

Next, we need to ensure that there are enough of reserves to send to user.

```solidity
    ...

    (uint112 reserve0_, uint112 reserve1_, ) = getReserves();

    if (amount0Out > reserve0_ || amount1Out > reserve1_)
        revert InsufficientLiquidity();

    ...
```

Next, we're calculating token balances of this contract minus the amounts we're expected to send to the caller. At this
point, it's expected that the caller has sent tokens they want to trade in to this contract. So, either or both of the
balances is expected to be greater than corresponding reserve.

```solidity
    ...
    uint256 balance0 = IERC20(token0).balanceOf(address(this)) - amount0Out;
    uint256 balance1 = IERC20(token1).balanceOf(address(this)) - amount1Out;
    ...
```

And here's the constant product check we talked about above. We expect that this contract token balances are different than its
reserves (the balances will be saved to reserves soon) and we need to ensure that their product is equal or greater than
the product of current reserves. If this requirement is met then:

1. The caller has calculated the exchange rate correctly (including slippage).
1. The output amount is correct.
1. The amount transferred to the contract is also correct.

```solidity
    ...
    if (balance0 * balance1 < uint256(reserve0_) * uint256(reserve1_))
        revert InvalidK();
    ...
```

It's now safe to transfer tokens to the caller and to update the reserves. The swap is complete.

```solidity
    _update(balance0, balance1, reserve0_, reserve1_);

    if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
    if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);

    emit Swap(msg.sender, amount0Out, amount1Out, to);
}
```

Feel free to write tests for this function. And don't forget about the case when both output amounts are specified. 😉

> Keep in mind that this implementation is not complete: the contract doesn't collect exchange fees and, as a result,
> liquidity providers don't get profit on their assets. We'll fill this gap after implementing price calculation.

## Re-entrancy attacks and protection

One of the most common attacks on Ethereum smart contracts is re-entrancy attack. This attack is possible when contract
makes external calls without doing necessary checks or updating state. Attacker can trick the contract into calling
attacker's contract, which, in its turn, calls the attacked contract again (but usually it calls it many times). As a
result, that second call (which re-enters the contract) exploits incorrectly updated state of the contract, which causes
lost of funds (that's the main goal of the attack).

In the pair contract, there's `safeTransfer` calls in `swap` function–the contract sends tokens to caller. Re-entrancy
attacks are targeted at exactly such calls. It's very naive to assume that the called `transfer` method does exactly
what we expect it to do. In fact, nothing forces a token contract to implement any of the ERC20 functions according to
the standard–they can do whatever their developers programmed them to do.

There are two common ways of preventing re-entrancy attacks:

1. Using a re-entrancy guard.  
   For example, [the one from OpenZeppelin contracts](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/security/ReentrancyGuard.sol).
   UniswapV2 uses [its own implementation](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol#L30-L36), since it's not hard to implement.
   The main idea is to set a flag when a function is called and not allow to call the function when the flag is set; the
   flag is unset when the call is done. This mechanism doesn't allow to call a function when it's being called (since
   transactions are applied atomically, there's only caller at a time and locking a function won't make it inaccessible
   for other callers).
1. Following the [Checks, Effects, Interactions Pattern](https://fravoll.github.io/solidity-patterns/checks_effects_interactions.html).  
   The pattern enforces a strict order of operations in a contract function: first, all necessary checks are made to
   ensure the function is working with correct state. Second, the function updates its own state according to its logic.
   Finally, the function makes external calls.
   Such order guarantees that every function call is made when function's state is finalized and correct, i.e. there are
   no pending state updates.

Is our implementation of `swap` vulnerable? Can one trick it into sending all its reserves to caller? Theoretically, yes,
since it depends on third-party contracts (tokens), and either of the token contracts can provide it wrong
balances to trick it into sending all its reserves to caller. However, if a token contract is malicious, a re-entrancy
attack is a lesser evil, and an exploit would still be possible without it.

## Price oracle

The idea of oracles, bridges that connect blockchain with off-chain services so that real-world data can be queried from
smart contracts, has been around for quite a while. Chainlink, one of the biggest (or the biggest one?) oracle networks,
was created in 2017 and, today, it's a crucial part of many DeFi applications.

Uniswap, while being an on-chain application, can also serve as an oracle. Each Uniswap pair contract that is
regularly used by traders also attracts arbitrageurs, who make money on minimizing price differences between exchanges.
Arbitrageurs make Uniswap prices as close to those on centralized exchanges as possible, which can also be seemed as
feeding prices from centralized exchanges to blockchain. Why not use this fact to turn the pair contract into a price
oracle? And this is what was done in Uniswap V2.

The kind of prices provided by the price oracle in Uniswap V2 is called **time-weighted average price**, or TWAP. It
basically allows to get an average price between two moments in time. To make this possible, the contract stores
accumulated prices: before every swap, it calculates current marginal prices (excluding fees), multiplies them by
the amount of seconds that has passed since last swap, and adds that number to the previous one.

I mentioned marginal price in the previous paragraph–this is simply a relation of two reserves:
$$price_0 = \frac{reserve_1}{reserve_0}$$
or
$$price_1 = \frac{reserve_0}{reserve_1}$$
For the price oracle functionality, Uniswap V2 uses marginal prices, which don't include slippage and swap fee and also
don't depend on swapped amount.

Since Solidity doesn't support float point division, calculating such prices can be tricky: if, for example, the ratio of
two reserves is \\(\frac{2}{3}\\), then the price is 0. We need to increase precision when calculating marginal prices,
and Unsiwap V2 uses [UQ112.112 numbers](https://en.wikipedia.org/wiki/Q_%28number_format%29) for that.

UQ112.112 is basically a number that uses 112 bits for the fractional part and 112 for the integer part. 112 bits were
chosen to make storage of the reserve state variables more optimal (more on this in the next section)-that's why the
variables use type `uint112`. Reserves, on the other hand, are stored as the integer part of a UQ112.112 number–this is
why they're multiplied by `2**112` before price calculation. Check out `UQ112x112.sol` for more details, it's very
simple.

I hope this all will be clearer for you from code, so let's implement prices accumulation. We only need to add one state
variable:

```solidity
uint32 private blockTimestampLast;
```

Which will store last swap (or, actually, reserves update) timestamp. And then we need to modify the reserves updating
function:

```solidity
function _update(
    uint256 balance0,
    uint256 balance1,
    uint112 reserve0_,
    uint112 reserve1_
) private {
    ...
    unchecked {
        uint32 timeElapsed = uint32(block.timestamp) - blockTimestampLast;

        if (timeElapsed > 0 && reserve0_ > 0 && reserve1_ > 0) {
            price0CumulativeLast +=
                uint256(UQ112x112.encode(reserve1_).uqdiv(reserve0_)) *
                timeElapsed;
            price1CumulativeLast +=
                uint256(UQ112x112.encode(reserve0_).uqdiv(reserve1_)) *
                timeElapsed;
        }
    }

    reserve0 = uint112(balance0);
    reserve1 = uint112(balance1);
    blockTimestampLast = uint32(block.timestamp);

    ...
}
```

`UQ112x112.encode` multiplies a ` uint112` value by `2**112`, which makes it a `uint224` value. Then, it's divided by
the other reserve and multiplied by `timeElapsed`. The result is **added** to the currently stored one–this makes it
cumulative. Notice the `unchecked` block–we'll discuss it shortly.

## Storage optimization

What's that weird `uint112` type? Why not using `uint256`? The answer is: gas optimization.

Every EVM operation consumes some amount of gas. Simple operations, like arithmetics ones, consume very little
gas, but there are operations that consume a lot of gas. The most expensive one is `SSTORE`–saving value to contract
storage. Its counterpart, `SLOAD`, is also expensive. So, it's beneficial to users if smart contract developers try to
optimize gas consumption of their contracts. Using `uuint112` for the reserve variables serves exactly this purpose.

Take a look at how we laid out the variables:

```solidity
address public token0;
address public token1;

uint112 private reserve0;
uint112 private reserve1;
uint32 private blockTimestampLast;

uint256 public price0CumulativeLast;
uint256 public price1CumulativeLast;

```

This is critical–they must go in exactly this order. The reason is that each state variable corresponds to a certain
storage slot, and EVM uses 32-byte storage slots (every storage slot is exactly 32 bytes). When you read a state variable
value, it's get read from the storage slot this variable is linked to. Every `SLOAD` call reads 32 bytes at a time,
and every `SSTORE` call writes 32 bytes at a time. Since these are expensive operations, we'd really want to reduce the
number of storage reads and writes. And this is where proper laying out of state variables might help.

What if there are several consecutive state variables that take less than 32 bytes? Do we need to read each of them
separately? It turns out, no. **EMV packs neighbor variables that are less than 32 bytes**.

Take another look at our state variables:

1. First two are `address` variables. `address` takes 20 bytes, and two addresses take 40 bytes, which means they have to
   take separate storage slots. They cannot be stored in one slot since they simply won't fit.
1. Two `uint112` variables and one `uint32`–this looks interesting: 112+112+32=256! This means they can fit in one
   storage slot! This is why `uint112` was chosen for reserves: the reserves variables are always read together, and it's
   better to load them from storage at once, not separately. This saves one `SLOAD` operation, and since reserves are
   used very often, this is huge gas saving.
1. Two `uint256` variables. These cannot be packed because each of them takes a full slot.

It's also important that the two `uint112` variables go after a variable that takes a full slot–this ensures that the
first of them won't be packed in the previous slot.

## Integer overflow and underflow

We wrapped accumulated prices calculation in `unchecked`–why?

Another popular vulnerability of smart contracts is integer overflow or underflow. The maximum value of a `uint256`
integer is \\(2^{256}-1\\) and the minimum value is 0. Integer overflow means increasing the value of an integer variable
so it's greater than the maximum one, this will result in an overflow: the value wraps and starts at 0. E.g.:
$$uint256(2^{256}-1) + 1 = 0$$ Similarly, subtracting a number from 0 will result in a very big number, e.g.:
$$uint256(0) - 1 = 2^{256}-1$$

Until version 0.8.0, Solidity hadn't checked for overflows and underflows, and developers came up with a library:
[SafeMath](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/math/SafeMath.sol).
Nowadays, this library is not needed anymore as Solidity now throws exceptions when an overflow or underflow is detected.

Solidity 0.8.0 also introduced `unchecked` block which, as the name suggests, disables the overflow/underflow
detection within its boundaries.

Let's return to our code.

We're using `unchecked` block when calculating `timeElapsed` and accumulated prices. This seems to be bad for the
security of the contract, but it's expected that timestamp and accumulated prices overflow: nothing bad will happen when
either of them overflows. We want them to overflow without throwing an error so they could function properly.

Such cases are rare, and the overflow/underflow detection should almost never be disabled.

## Safe transfer

You probably have noticed the strange way of sending tokens we're using:

```solidity
function _safeTransfer(
  address token,
  address to,
  uint256 value
) private {
  (bool success, bytes memory data) = token.call(
    abi.encodeWithSignature("transfer(address,uint256)", to, value)
  );
  if (!success || (data.length != 0 && !abi.decode(data, (bool))))
    revert TransferFailed();
}

```

Why not call `transfer` method directly on ERC20 interface?

In the pair contract, when doing token transfers, we always want to be sure that they're successful. According to ERC20,
`transfer` method must return a boolean value: `true`, when it's successful; `fails`, when it's not. Most of tokens
implement this correctly, but some tokens don't–they simply return nothing. Of course, we cannot check token contract
implementation and cannot be sure that token transfer was in fact made, but we at least can check transfer result. And we
don't want to continue if a transfer has failed.

`call` here is an `address` [method](https://docs.soliditylang.org/en/latest/types.html#members-of-addresses)–this is a
low-level function that gives us a more fine-grained control over a contract call. In this specific case, it allows us to
get a result of a transfer no matter whether the `transfer` method return one or not.

## Conclusion

That's it for today! I hope this part clarifies a lot in our implementation. Next time we'll continue with adding new
features and contracts.

## Links

1. [Source code of part 2](https://github.com/Jeiwan/zuniswapv2/tree/part_2)
1. [UniswapV2 Whitepaper](https://uniswap.org/whitepaper.pdf) – worth reading and re-reading.
1. [Layout of State Variables in Storage](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)
1. [Q (number format)](<https://en.wikipedia.org/wiki/Q_(number_format)>)
1. [Check Effects Interactions Pattern](https://fravoll.github.io/solidity-patterns/checks_effects_interactions.html)
1. [Checked or Unchecked Arithmetic](https://docs.soliditylang.org/en/latest/control-structures.html#checked-or-unchecked-arithmetic)
