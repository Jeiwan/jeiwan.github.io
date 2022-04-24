---
title: "Programming DeFi: Uniswap V2. Part 4"
date: 2022-04-24T00:00:00+00:00
tags: ["Uniswap", "Ethereum", "DeFi", "Blockchain", "Solidity"]
katex: true
---

![Machine](/images/british-library-Y1S0ApwC054-unsplash.jpg)
Photo by
[British Library](https://unsplash.com/@britishlibrary?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on [Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction
Welcome to the final part of this series! Yes, we've almost done implementing a Uniswap V2 clone from scratch,
and today we're going to fill missing gaps. There's a lot of things to do, so let's get straight to business.

> You can find full source code of this part here: 
[source code, part 4](https://github.com/Jeiwan/zuniswapv2/tree/part_4).

## LP-tokens burning bug
We'll begin with finishing the Router contract. Last time we stopped at implementing `addLiquidity` function,
and now we're going to implement `removeLiquidity`, which removes liquidity from a pool.

Before implementing `removeLiquidity`, we need to fix a bug in Pair contract. To understand the bug, let's
look at `testBurn` function in Pair contract tests:
```solidity
function testBurn() public {
    token0.transfer(address(pair), 1 ether);
    token1.transfer(address(pair), 1 ether);

    pair.mint(address(this));
    pair.burn();

    assertEq(pair.balanceOf(address(this)), 0);
}
```

When someone provides liquidity to a pool, they get LP-tokens in return. When liquidity is removed, these
LP-tokens are exchange for pool liquidity and burned. In this test, you can see that we're not transferring
our LP-tokens to the pool, but it's still able to burn our tokens. If you now look in the `burn` function,
you'll see this line
```solidity
_burn(msg.sender, liquidity);
```
**The contract can burn sender's tokens without sender explicitly allowing that!** This is wrong. Instead, the
user needs to have a way to tell the contract how much tokens to burn–this can be achieved in two steps:
1. Let user send some amount of their LP-tokens to the contract.
2. Change the contract so it burns its LP-tokens.

You can find the fix of this bug in [this commit](https://github.com/Jeiwan/zuniswapv2/commit/babf8509b8be96796e2d944710bfcb22cc1fe77d#diff-835d3f34100b5508951336ba5a961932492eaa6923e3c5299f77007019bf2b6fR84).

Now, we're ready to implement liquidity removal in the Router contract.

## Liquidity removal
Router contract is a high-level contract that makes interaction with Uniswap easier. As a result, its
functions perform multiple actions, as opposed to the pair contract, in which functions perform only one core
action. In addition to that, Router's functions are general–they can be used to interact with any pair.

So, we need a function that:
1. Abstracts away pairs–users operate with tokens, not pairs.
1. Transfers user's LP-tokens to a pair contract. User needs to be able to select the amount.
1. Removes user's liquidity from a pair.
1. Protects user from slippage. Yes, liquidity removal is also affected by slippage–check out `testBurnUnbalancedDifferentUsers` test in Pair contract.

Let's implement this function:
```solidity
function removeLiquidity(
    address tokenA,
    address tokenB,
    uint256 liquidity,
    uint256 amountAMin,
    uint256 amountBMin,
    address to
) public returns (uint256 amountA, uint256 amountB) {
  ...
```
1. `tokenA`, `tokenB` are token addresses of the pair. Since users operate with tokens, they don't need to
specify pair address.
1. `liquidity` is the amount of LP-tokens to burn.
1. `amountAMin`, `amountBMin` is the minimal amounts of tokenA and tokenB that we want to get in return for
burning our LP-tokens. It's these parameters that protect us from slippage.
1. `to` – the address that will receive tokens.

First step is to find the pair:
```solidity
address pair = ZuniswapV2Library.pairFor(
    address(factory),
    tokenA,
    tokenB
);
```

Next: sending LP-tokens to the pair and burning the exact amount of tokens.
```solidity
IZuniswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity);
(amountA, amountB) = IZuniswapV2Pair(pair).burn(to);
```

In the end, we're checking that amounts returned are within the tolerated slippage chosen by user.
```solidity
if (amountA < amountAMin) revert InsufficientAAmount();
if (amountA < amountBMin) revert InsufficientBAmount();
```

And, that's it! Simple and elegant.

## Output amount calculation
We're now approaching the moment when we can implement high-level swapping, including chained swapping (e.g.
swap Token A for Token C via Token B). Before implementing it, we need to learn about how output amounts are
calculated in Uniswap. Let's first figure out how amounts are related to prices.

What is price? It's the amount of one thing you get in exchange for **1 unit** of another thing. When trading,
price, in a sense, is an intermediate entity: what matters is the amount of tokens you have and the amount of
tokens you get in return.

In a constant product exchange, price is simply a relation between reserves–we already implement price
calculation in the `quote` function of `ZuniswapV2Library`. However, when actually doing a swap, this price
is incorrect because it represents only the relation between reserves at a moment. But when a swap is made,
reserves are changed, and what we expect in fact is **the price to fall**, following the change in reserves.

To make this all clear, let's recall the constant product formula:
$$x*y=k$$
Where *x* and *y* are pair reserves (`reserve0` and `reserve1`).

When doing a swap, *x* and *y* are changed but *k* remains the same (or, actually, it grows slowly thanks to
 swap fees). We can write this as a formula:
$$(x+r\Delta x)(y-\Delta y)=xy$$

Where *r* is `1 - swap fee` (1 - 0.3% = 0.997), \\(\Delta x\\) is the amount we give in exchange for
\\(\Delta y\\), the amount we get.

This is a very nice and concise formula that shows that the product of reserves after a swap must be equal to
the product of reserves before the swap, which is the definition of the constant product formula. And we can
use this formula to calculate the amount we get during a swap. After doing some basic algebraic operations, we
get this:
$$\Delta y = \frac{yr\Delta x}{x + r\Delta x}$$
As you can see, this is a relation of two reserves (\\(y/x\\)) that takes into consideration the input
amount (\\(r\Delta x\\)), including the fee.

Let's now program this formula:
```solidity
function getAmountOut(
    uint256 amountIn,
    uint256 reserveIn,
    uint256 reserveOut
) public pure returns (uint256) {
  if (amountIn == 0) revert InsufficientAmount();
  if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
  ...
```
`amountIn` is \\(\Delta x\\), `reserveIn` is *x*, `reserveOut` is *y*.

Because of Solidity not supporting float point division, we need to multiply numerator and denominator by
1000 and then subtract 3 from the multiplier applied to `amountIn`–this will apply the 0.3% fee to `amountIn`:
```solidity
uint256 amountInWithFee = amountIn * 997;
uint256 numerator = amountInWithFee * reserveOut;
uint256 denominator = (reserveIn * 1000) + amountInWithFee;

return numerator / denominator;
```

And this is it! Now we can proceed with swapping.

## swapExactTokensForTokens
The Router contract implements different ways of swapping tokens. The most common of them is when we have an
exact amount of tokens and want to get some, calculated, amount in exchange. Let's implement this:
```solidity
function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to
) public returns (uint256[] memory amounts) {
  ...
```
This is a function that swaps an exact input amount (`amountIn`) for some output amount not smaller than
`amountOutMin`. It makes **chained swaps** along the specified `path` (which is simply a sequence of token
addresses). The final amount is sent to address `to`.

The `path` parameter might seem like something complex, but it's just an array of token addresses. If we want
to swap Token A for Token B directly, the path will contain only Token A and Token B addresses. If we want
to swap Token A for Token C via Token B, the path will contain: Token A address, Token B address, Token C
address; the contract would swap Token A for Token B and then Token B for Token C. We'll see how this works
in tests.

In the function, we begin with pre-calculating all output amounts along the path:
```solidity
amounts = ZuniswapV2Library.getAmountsOut(
    address(factory),
    amountIn,
    path
);
```
`getAmountsOut` (notice the plural "amounts") is the new function that we haven't implemented yet. For
brevity, I won't explain its implementation, you can check the code to see it. This function simply extracts
pairs of tokens from the path (e.g. `[[tokenA, tokenB], [tokenB, tokenC]]`) and then iteratively calls
`getAmountOut` for each of them to build an array of output amounts.

After obtaining output amounts, we can verify the final amount right away:
```solidity
if (amounts[amounts.length - 1] < amountOutMin)
    revert InsufficientOutputAmount();
```

If the final amount is good, the contract initializes a swap by sending input tokens to the first pair:
```solidity
_safeTransferFrom(
    path[0],
    msg.sender,
    ZuniswapV2Library.pairFor(address(factory), path[0], path[1]),
    amounts[0]
);
```

And then it performs chained swaps:
```solidity
_swap(amounts, path, to);
```

Let's look at this function closely: the function takes an array of **output** amounts and a path, and
iterates over the path.
```solidity
function _swap(
    uint256[] memory amounts,
    address[] memory path,
    address to_
) internal {
    for (uint256 i; i < path.length - 1; i++) {
      ...
```
It takes current and next token address from the path and sorts them. Sorting is required because, in pair
contracts, token addresses are stored in ascending order, but, in the path, they're sorted logically: input token
goes first, then there's 0 or multiple intermediate output tokens, then there's final output token.
```solidity
(address input, address output) = (path[i], path[i + 1]);
(address token0, ) = ZuniswapV2Library.sortTokens(input, output);
```

Next, we're sorting amounts so they match the order of tokens in pairs. When doing a swap, we want to
correctly choose output token.
```solidity
uint256 amountOut = amounts[i + 1];
(uint256 amount0Out, uint256 amount1Out) = input == token0
    ? (uint256(0), amountOut)
    : (amountOut, uint256(0));
```

After figuring out amounts, we need to find swap destination address. We have two options here:
1. If current pair is not final in the path, we want to send tokens to next pair directly. This allows to save
gas.
2. If current pair is final, we want to send tokens to address `to_`, which is the address that initiated the
swap.
```solidity
address to = i < path.length - 2
    ? ZuniswapV2Library.pairFor(
        address(factory),
        output,
        path[i + 2]
    )
    : to_;
```

After we obtained all the swap parameters, we're ready to make actual swap:
```solidity
IZuniswapV2Pair(
    ZuniswapV2Library.pairFor(address(factory), input, output)
).swap(amount0Out, amount1Out, to, "");
```

We've just implemented the core functionality of Uniswap! Congratulations! It wasn't that hard, right?

## swapTokensForExactTokens
The original Router contract [implements many different ways of swapping](https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router02.sol#L224-L400).
We're not going to implement all of them, but I want to show you how an inverted swapping is implemented:
swapping unknown amount of input tokens for exact amount of output tokens.
This is an interesting use case and it's probably not used very often but it's still possible.

Let's return to the swapping formula:
$$(x+r\Delta x)(y-\Delta y)=xy$$

Now, instead of \\(\Delta y\\), we want to find \\(\Delta x\\): we know the exact amount of output tokens we
want to get but we don't know how much input tokens we need to give.

Again, after applying basic algebraic operations we get:
$$\Delta x = \frac{x \Delta y}{(y-\Delta y)r}$$
And again, this is a relation of reserves (\\(x/y\\)) that takes into consideration output amount 
(\\(\Delta y\\)) and fee *r*.

We can now implement this formula:
```solidity
function getAmountIn(
    uint256 amountOut,
    uint256 reserveIn,
    uint256 reserveOut
) public pure returns (uint256) {
    if (amountOut == 0) revert InsufficientAmount();
    if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

    uint256 numerator = reserveIn * amountOut * 1000;
    uint256 denominator = (reserveOut - amountOut) * 997;

    return (numerator / denominator) + 1;
}
```
Everything is clear, except the 1 added to the final result–why is that? The reason is that division,
which is integer division, in Solidity rounds result down, which means that result gets truncated. In input
amount calculation, we want to guarantee that the calculated amount will result in the requested `amountOut`.
If result is truncated, output amount will be slightly smaller.

Next, we need `getAmountsIn` function:
```solidity
function getAmountsIn(
    address factory,
    uint256 amountOut,
    address[] memory path
) public returns (uint256[] memory) {
    if (path.length < 2) revert InvalidPath();
    uint256[] memory amounts = new uint256[](path.length);
    amounts[amounts.length - 1] = amountOut;

    for (uint256 i = path.length - 1; i > 0; i--) {
        (uint256 reserve0, uint256 reserve1) = getReserves(
            factory,
            path[i - 1],
            path[i]
        );
        amounts[i - 1] = getAmountIn(amounts[i], reserve0, reserve1);
    }

    return amounts;
}
```
It copies `getAmountsOut` with on significant change: the path is traversed in reversed order. Since we know
the output amount and want to find input amounts, we start from the end of the path and fill `amounts` array
with input amounts in reverse order.

The high-level swap function also looks very familiar:
```solidity
function swapTokensForExactTokens(
    uint256 amountOut,
    uint256 amountInMax,
    address[] calldata path,
    address to
) public returns (uint256[] memory amounts) {
    amounts = ZuniswapV2Library.getAmountsIn(
        address(factory),
        amountOut,
        path
    );
    if (amounts[amounts.length - 1] > amountInMax)
        revert ExcessiveInputAmount();
    _safeTransferFrom(
        path[0],
        msg.sender,
        ZuniswapV2Library.pairFor(address(factory), path[0], path[1]),
        amounts[0]
    );
    _swap(amounts, path, to);
}
```
It's almost identical to the swap function we implemented earlier, but it calls `getAmountsIn` instead. It's
also interesting that we can use the same `_swap` function even when amounts are input ones.

Phew, we're done with the router contract! There's one more feature that I'd want to show you: flash loans.

## Fixing swap fee bug
Before we implement flash loans, there's another bug that we need to fix. In the pair contract, we have these
lines:
```solidity
uint256 balance0 = IERC20(token0).balanceOf(address(this)) - amount0Out;
uint256 balance1 = IERC20(token1).balanceOf(address(this)) - amount1Out;

if (balance0 * balance1 < uint256(reserve0_) * uint256(reserve1_))
    revert InvalidK();
```

This is a crucial check because it ensures that the swap was correct, i.e. correct input amount was provided
and correct output amount was requested. However, these lines don't guarantee that swap fee was paid! The way
the pair contract is currently implemented, there are no swap fees! Let's fix that.

Let's look closely at what we're doing in those lines:
1. First, we're getting current token balances (not reserves) of the pair contract.
2. Then we subtract output amounts from them because we expect to send those amounts to user.
3. We end up with balances that include input amount (sent to the contract by user) and exclude output
amounts. They don't include swap fee.
4. Then, we calculate a new `k` and compare it with the previous one. The new one must be equal or bigger.

It's clear that the new `k` considers only input and output amount, not the swap fee. And this is wrong.

To fix the bug, we need to rewrite the function.

First thing we do after obtaining reserves and doing pre-checks, is transferring tokens to users. Interesting
that we can do this early, which makes this an optimistic operation (there's a price for doing that, we'll
take a look at it later). After transfers are made, we calculate input amounts:
```solidity
if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);

uint256 balance0 = IERC20(token0).balanceOf(address(this));
uint256 balance1 = IERC20(token1).balanceOf(address(this));

uint256 amount0In = balance0 > reserve0 - amount0Out
    ? balance0 - (reserve0 - amount0Out)
    : 0;
uint256 amount1In = balance1 > reserve1 - amount1Out
    ? balance1 - (reserve1 - amount1Out)
    : 0;

if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();
```
To make the logic of this piece clear, we can think of `reserve0` and `reserve1` as "old balances", balances
that the contract had before the swap started.

When swapping tokens, we usually provide either `amount0Out` or `amount1Out`. So, usually, there will be
either `amount0In` or `amount1In` (the other one will be zero). But this piece (as well as the swap function)
allows us to set both `amount0Out` and `amount1Out`, so it's also possible that both `amount0In` and
`amount1In` will be greater than zero. But if both of them are zero, the user hasn't sent any tokens to the
contract, which is not allowed.

So, in these lines, we're finding out new balances: they don't include output amounts but include input ones.

Next lines are fixed versions of the bugged implementation:
```solidity
uint256 balance0Adjusted = (balance0 * 1000) - (amount0In * 3);
uint256 balance1Adjusted = (balance1 * 1000) - (amount1In * 3);

if (
    balance0Adjusted * balance1Adjusted <
    uint256(reserve0_) * uint256(reserve1_) * (1000**2)
) revert InvalidK();
```
First, we calculate adjusted balances: these are **current balances minus swap fees**, which are applied to
input amounts. Again, because of
integer division, we have to multiply balances by 1000 and amounts by 3 to "emulate" multiplication of the
input amounts by 0.003 (0.3%).

Next, we're calculating a new *k* for the adjusted balances and comparing it to the current one.
To compensate for the multiplication by 1000 in the adjusted balances, we multiply old reserves by 1000 * 1000.

We're basically calculating a new *k* on new balances minus the swap fee. And this new *k* must be greater or
equal to the old *k*.

Let's test the case when we're trying to get too much of output tokens and are getting the `InvalidK` error:
```solidity
function testSwapUnpaidFee() public {
    token0.transfer(address(pair), 1 ether);
    token1.transfer(address(pair), 2 ether);
    pair.mint(address(this));

    token0.transfer(address(pair), 0.1 ether);

    vm.expectRevert(encodeError("InvalidK()"));
    pair.swap(0, 0.181322178776029827 ether, address(this), "");
}
```
Here, we're trying to swap 0.1 ether of token0 for 0.181322178776029827 ether of token1 and fail. If you
reduce the token1 amount by 1, the test will pass. I used `getAmountOut` to calculate this amount–
feel free to experiment with it!

This is a tricky piece, you might need to experiment with tests and number to get it. Hopefully, it'll be
clear in the end!

And now we're ready to implement flash loans 🎃

## Flash loans
Everybody likes them! Or not? Well, maybe not the developers who got their contracts hacked using flash loans 🤭

Flash loans is a very powerful financial instrument that has no analogues in traditional finances. It's an
**unlimited** and **uncollateralized** loan that must be repaid in **the same transaction** where it's taken.
Uniswap is one of the platforms that's able to give flash loans. Let's add them to our contracts and see how
they work.

First thing you need to know about flash loans implementation is that **they can only be used by smart
contracts**. Here's how borrowing and repaying happens with flash loans:
1. A smart contract borrows a flash loan from another contract.
2. The lender contract sends tokens to the borrowing contract and calls a special function in this contract.
3. In the special function, the borrowing contract performs some operations with the loan and then transfers
the loan back.
4. The lender contract ensures that the whole amount was paid back. In case when there are fees, it also
ensures that they were paid.
5. Control flow returns to the borrowing contract.

To add flash loans to Zuniswap, we need to make a few changes. First, update `swap` to take an additional
parameter:
```solidity
function swap(
    uint256 amount0Out,
    uint256 amount1Out,
    address to,
    bytes calldata data
) public {
```
The new parameter is a byte array `data`. It can contain literary anything.

Next step is to actually issue a loan. Remember that we have optimistic transfers in the `swap` function:
```solidity
...
if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);
...
```
And this means that we're already giving an arbitrary amount (the output amounts are specified by user) of
tokens without asking for collateral! The only thing we need to change is to let the caller to repay the loan.
We're doing this by calling a special function in the caller contract:
```solidity
...
if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);
if (data.length > 0) IZuniswapV2Callee(to).zuniswapV2Call(msg.sender, amount0Out, amount1Out, data);
...
```
By the convention we define, we expect the caller contract to implement `zuniswapV2Call` function that receives:
sender address, first output amount, second output amount, and the new data parameter. Everything else remains
unchanged in the contract! Again, very elegant and simple solution.

And that's basically it! It turns out, we've already implemented the logic that checks if the loan was repaid–
it's the same logic that checks that a new *k* is valid!

Now, let's test the flash loans! I hope the whole flow will be clearer after we add a test.

As I said above, to use flash loans we need a smart contract. And to test flash loans we need a separate
contract–let's call it `Flashloaner`:
```solidity
contract Flashloaner {
    error InsufficientFlashLoanAmount();

    uint256 expectedLoanAmount;

    ...
}
```
The contract will implement two functions:
1. First function will borrow a flash loan from Zuniswap.
2. Second function, `zuniswapV2Call`, will handle the loan and repay it.

Taking a flash loan is as easy as making a swap:
```solidity
function flashloan(
    address pairAddress,
    uint256 amount0Out,
    uint256 amount1Out,
    address tokenAddress
) public {
    if (amount0Out > 0) {
        expectedLoanAmount = amount0Out;
    }
    if (amount1Out > 0) {
        expectedLoanAmount = amount1Out;
    }

    ZuniswapV2Pair(pairAddress).swap(
        amount0Out,
        amount1Out,
        address(this),
        abi.encode(tokenAddress)
    );
}
```
Before making the swap, we want to set `expectedLoanAmount` so we can later check that requested amount of
tokens was in fact given to us.

In the swap function, notice that we're passing `tokenAddress` as the `data` parameter–we'll use it later to
repay the loan. Alternatively, we could've stored this address in a state variable. Since data is a byte
array, we need a way to convert an address to bytes, and `abi.encode` is a common solution for that.

Now, the flash loan handler:
```solidity
function zuniswapV2Call(
    address sender,
    uint256 amount0Out,
    uint256 amount1Out,
    bytes calldata data
) public {
    address tokenAddress = abi.decode(data, (address));
    uint256 balance = ERC20(tokenAddress).balanceOf(address(this));

    if (balance < expectedLoanAmount) revert InsufficientFlashLoanAmount();

    ERC20(tokenAddress).transfer(msg.sender, balance);
}
```
This is the function that will be called by the pair contract in the swap function that we call in
`flashloan`. The pair contract will also pass whatever data we passed to the swap call.

In the handler function, we're ensuring that we in fact got the requested loan and we're simply paying it
back. Instead of repaying it, we could've used it for something like [leveraging](https://medium.com/coinmonks/evaluating-defi-strategies-using-foundry-151bf8cb8759),
arbitraging, or exploiting bugs in smart contracts. Flash loans is a very powerful instrument that can be used
for the good or the bad.

Finally, let's add a test that takes a loan and ensures that a correct amount is repaid:
```solidity
function testFlashloan() public {
    token0.transfer(address(pair), 1 ether);
    token1.transfer(address(pair), 2 ether);
    pair.mint(address(this));

    uint256 flashloanAmount = 0.1 ether;
    uint256 flashloanFee = (flashloanAmount * 1000) / 997 - flashloanAmount + 1;

    Flashloaner fl = new Flashloaner();

    token1.transfer(address(fl), flashloanFee);

    fl.flashloan(address(pair), 0, flashloanAmount, address(token1));

    assertEq(token1.balanceOf(address(fl)), 0);
    assertEq(token1.balanceOf(address(pair)), 2 ether + flashloanFee);
}
```
The thing is, Uniswap V2 imposes fees on flash loans: **we must pay the swap fee on them**. Recall that we
didn't implement any additional checks for whether a flash loan was repaid or not–we simply used the new *k*
calculation. And this calculation subtracts the swap fee from balances! So, when returning a flash loan we
must pay the amount we've taken + 0.3% (slightly above that actually: 0.3009027%).

For Flashloaner to repay full amount, we calculate `flashloanFee` and send it to the contract. After the flash
loan is repaid, Flashloaner's balance is 0 and the pair contract gets the fee.

## Fixing re-entrancy vulnerability
And the final touch: with the new changes in the pair contract, we introduced a very dangerous vulnerability–re-entrancy.
 We have already discussed this in a previous part: when implementing functions that make external
calls, we must be very cautious to not make re-entrancy attacks possible. We have also discussed that the
[Checks Effects Interactions pattern](https://fravoll.github.io/solidity-patterns/checks_effects_interactions.html)
is one way of preventing the attack. However, in the rewritten `swap` function, we cannot use the pattern
because the implementation forces us to make external calls (token transfers) before applying effects
(updating reserves). We want the optimistic transfers and we like the simplicity of the flash loans
implementation! So, we need a different protection. And it's not hard to implement.

In situations when the Checks Effects Interactions patterns cannot be applied, we can use [the Guard Check
pattern](https://fravoll.github.io/solidity-patterns/guard_check.html): we simply need to add a flag that is
set when `swap` function is called; and we won't allow to call the function if flag is set. Here's how to do
this.

First, add the flag. We'll call it `isEntered`:
```solidity
contract ZuniswapV2Pair is ERC20, Math {
    ...
    bool private isEntered;
    ...
}
```
Yes, it's stored in the contract's storage, which increases the gas cost of the swap function. And this is why
Checks Effects Interactions pattern is better.

Next, we add a modifier:
```solidity
  modifier nonReentrant() {
      require(!isEntered);
      isEntered = true;

      _;

      isEntered = false;
  }
```
The modifier:
1. Ensures that the flag is not set.
1. Sets the flag.
1. Executes function body (`_` is replaced with the body of the function this modifier is applied to).
1. When the function is done, it unsets the flag.

Finally, we need to apply this modifier to the swap function:
```solidity
function swap(
    uint256 amount0Out,
    uint256 amount1Out,
    address to,
    bytes calldata data
) public nonReentrant {
    ...
}
```

That's it! I'll leave it to you to test this vulnerability 😉

## Protocol fees
Last thing we haven't implemented is protocol fees.

Protocol fees are fees collected by Uniswap every time someone adds liquidity to a pool. These fees go
directly to the Uniswap team, not to liquidity providers or traders. However, at the moment of writing,
**protocol fees are not enabled, which means that the Uniswap team earns nothing from the exchange that they
built**.

Since this post is already quite long, I'm not going to implement protocol fees in our clone. By this moment,
I'm pretty sure you'll be able to implement them yourself! You can use [the original implementation](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol#L88-L107)
as a reference. Also, PRs are welcomed 😉

## Conclusion
This is it, our journey has come to its end. I really hope you enjoyed it and learned a lot along the way.
Uniswap V2 is a fantastic project that combines simplicity, elegance, and unique invention. Its code is a gift
to us, it let's us see that a truly decentralized platform and an integral DeFi solution can be implemented
as a set of simple and elegant smart contracts–a role model for every Solidity developer!