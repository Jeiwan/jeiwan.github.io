---
title: "Programming DeFi: Uniswap V2. Part 1"
date: 2022-01-11T00:00:00+00:00
katex: true
tags: ["Uniswap", "Ethereum", "DeFi", "Blockchain", "Solidity"]
---

![Reservoir](/images/evangelos-mpikakis-ZokntvGY4WU-unsplash.jpg)
Photo by
[Evangelos Mpikakis](https://unsplash.com/@mpikman?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on [Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

Uniswap is a decentralized exchange running on the Ethereum blockchain. It's fully automated, not managed, and decentralized.
It has come through multiple iterations of development: first version was launched in November 2018; second version–in May 2020;
and final, third, version was launched in March 2021.

[In my previous series on Uniswap V1](https://jeiwan.net/posts/programming-defi-uniswap-1/), I showed how to build it from scratch and
explained its core mechanics. This blog post begins a series of posts devoted to Uniswap V2: likewise, we'll build its copy
from scratch and will learn the core principles of a decentralized exchange. Unlike the previous series, I won't go into much
details on the constant product formula and related core mathematics of Uniswap–if you want to learn about that, please read
the V1 series.

## Tooling

In this series, I'll be using [Foundry](https://github.com/gakonst/foundry/) for contracts developing and testing. Foundry
is a modern Ethereum toolkit written in Rust by [Georgios Konstantopoulos](https://twitter.com/gakonst). It's much faster
than Hardhat and, what's specifically useful to us, it allows to write tests in Solidity. Yes, we'll use Solidity for both
writing contracts and testing them and you'll see that this is much cleaner and handier than writing tests in JS.

I'll also use [solmate](https://github.com/Rari-Capital/solmate) for ERC20 implementation instead of OpenZeppelin because
the latter has got somewhat bloated and opinionated. One specific reason of not using OpenZeppelin's ERC20 implementation in
this project is that it doesn't allow to transfers tokens to the zero address. Solmate, in its turn, is a collection of
gas-optimized contracts, and it's not that limiting.

It's also worth noting that many things have changes since 2020, when Uniswap V2 was launched. For example, `SafeMath`
library has become obsolete since the release of Solidity 0.8, which introduced native overflow checks. So, we're
building a modern version of Uniswap, so to say.

> Please see [the README](https://github.com/Jeiwan/zuniswapv2) for instructions on how to set up Foundry for our project.

## Architecture of Uniswap V2

The core architectural idea of Uniswap V2 is pooling: liquidity providers are available to stake their liquidity in a
contract; that staked liquidity allows anyone else to trade in a decentralized way. Similarly to Uniswap V1, traders
pay a small fee, which gets accumulated in a contract and then gets shared by all liquidity providers.

The core contract of Uniswap V2 is [UniswapV2Pair](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol).
"Pair" and "Pool" are interchangeable terms, they mean the same thing–`UniswapV2Pair` contract. That contract's main
purpose is to accept tokens from users and use accumulated reserves of tokens to perform swaps. This is why it's a pooling
contract. Every `UniswapV2Pair` contract can pool only one pair of tokens and allows to perform swaps only between these
two tokens–this is why it's called "pair".

The codebase of Uniswap V2 contracts is split into two repositories:

1. [core](https://github.com/Uniswap/v2-core), and
1. [periphery](https://github.com/Uniswap/v2-periphery).

The core repository stores these contracts:

1. `UniswapV2ERC20` – an extended ERC20 implementation that's used for LP-tokens. It additionally implements
   [EIP-2612](https://eips.ethereum.org/EIPS/eip-2612) to support off-chain approval of transfers.
1. `UniswapV2Factory` – similarly to V1, this is a factory contract that creates pair contracts and serves as a registry
   for them. The registry uses `create2` to generate pair addresses–we'll see how it works in details.
1. `UniswapV2Pair` – the main contract that's responsible for the core logic. It's worth noting that the factory allows to
   create only unique pairs to not dilute liquidity.

The periphery repository contains multiple contracts that make it easier to use Uniswap. Among them is `UniswapV2Router`,
which is the main entrypoint for the Uniswap UI and other web and decentralized applications working on top of Uniswap.
This contracts has an interface that's very close to that of the exchange contract in Uniswap V1.

Another important contract in the periphery repository is `UniswapV2Library`, which is a collection of helper functions
that implement important calculations. We'll implement both of these contracts.

We'll start our journey with the core contracts to focus on the most important mechanics first. We'll see that these contracts
are very general and their functions require preparatory steps–this low-level structure reduces the attack surfaces and makes
the whole architecture more granular.

Alright, let's begin!

## Pooling liquidity

No trades are possible without liquidity. Thus, the first feature we need to implement is liquidity pooling. How does it
work?

Liquidity pools are simply contracts that store token liquidity and allow to perform swaps that use this liquidity. So,
"pooling liquidity" means sending tokens to a smart-contract and storing them there for some time.

As you probably already know, every contract has its own storage, and the same is true for ERC20 tokens–each of them
has a `mapping` that connects addresses and their balances. And our pools will have their own balances in ERC20 contracts.
Is this enough to pool liquidity? As it turns out, no.

The main reason is that relying only on ERC20 balances would make price
manipulations possible: imaging someone sending a big amount of tokens to a pool, makes profitable swaps, and cashes out
in the end. To avoid such situations, **we need to track pool reserves on our side**, and we also need to control when they're
updated.

We'll use `reserve0` and `reserve1` variable to track reserves in pools:

```solidity
contract ZuniswapV2Pair is ERC20, Math {
  ...

  uint256 private reserve0;
  uint256 private reserve1;

  ...
}

```

> I omit a lot of code for brevity. [Check the GitHub repo](https://github.com/Jeiwan/zuniswapv2/tree/part_1) for full code.

If you followed my [UniswapV1 series](https://jeiwan.net/posts/programming-defi-uniswap-1/), you probably remember that
we implemented `addLiquidity` function that counted new liquidity and issued LP-tokens. Uniswap V2 implements an identical
function in periphery contract `UniswapV2Router`, and, in the pair contract, this functionality is implemented at a
lower level: liquidity management is simply viewed as LP-tokens management. When you add liquidity to a pair, the contract
mints LP-tokens; when you remove liquidity, LP-tokens get burned. As I explained earlier, core contracts are lower-level
contracts that perform only core operations.

So, here's the low-level function for depositing new liquidity:

```solidity
function mint() public {
   uint256 balance0 = IERC20(token0).balanceOf(address(this));
   uint256 balance1 = IERC20(token1).balanceOf(address(this));
   uint256 amount0 = balance0 - reserve0;
   uint256 amount1 = balance1 - reserve1;

   uint256 liquidity;

   if (totalSupply == 0) {
      liquidity = ???
      _mint(address(0), MINIMUM_LIQUIDITY);
   } else {
      liquidity = ???
   }

   if (liquidity <= 0) revert InsufficientLiquidityMinted();

   _mint(msg.sender, liquidity);

   _update(balance0, balance1);

   emit Mint(msg.sender, amount0, amount1);
}
```

First, we need to calculate newly deposited amounts that haven't yet been counted (saved in reserves). Then, we calculate
the amount of LP-tokens that must be issued as a reward for provided liquidity. Then, we issue the tokens and update
reserves (function `_update` simply saves balances to the reserve variables). The function is quite minimal, isn't it?

As you can see from the code, liquidity is calculated differently when initially deposited into pool (the `totalSupply == 0` branch).
Think about this: how many LP-token do we need to issue when there's no liquidity in the pool? Uniswap V1 used the amount
of deposited ethers, which made the initial amount of LP-tokens dependent on the ratio at which liquidity was deposited. But
nothing forces users to deposit at the correct ratio that reflects actual prices at that moment. Moreover, Uniswap V2 now
supports arbitrary ERC20 token pairs, which means there might be no prices valued in ETH at all.

For initial LP-amount, Uniswap V2 ended up using geometric mean of deposited amounts:
$$Liquidity_{minted} = \sqrt{Amount_0*Amount_1}$$
The main benefit of this decision is that such formula ensures that the initial liquidity ratio doesn't affect the value
of a pool share.

Now, let's calculate LP-tokens issued when there's already some liquidity. The main requirement here is that the amount
is:

1. proportional to the deposited amount,
1. proportional to the total issued amount of LP-tokens.

Recall this formula from the V1 series:

$$Liquidity_{minted} = TotalSupply_{LP} * \frac{Amount_{deposited}}{Reserve}$$
New amount of LP-tokens, that's proportional to the deposited amount of tokens, gets minted. But, in V2, there are two
underlying tokens–which of them should we use in the formula?

We can choose either of them, but there's interesting pattern: the closer the ratio of deposited amounts to the ratio of
reserves, the smaller the difference. Consequently, if the ratio of deposited amounts is different, LP amounts will also
be different, and one of them will be bigger than the other. If we choose the bigger one, then we'll incentivize price
changing via liquidity provision and this leads to price manipulation. If we choose the smaller one, we'll punish for
depositing of unbalanced liquidity (liquidity providers would get fewer LP-tokens). It's clear that choosing smaller number
is more benefitial, and this is what Uniswap is doing. Let's fill the gaps in the above code:

```solidity
if (totalSupply == 0) {
   liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
   _mint(address(0), MINIMUM_LIQUIDITY);
} else {
   liquidity = Math.min(
      (amount0 * totalSupply) / _reserve0,
      (amount1 * totalSupply) / _reserve1
   );
}
```

In the first branch, we're subtracting `MINIMUM_LIQUIDITY` (which is a constant 1000, or 1e-15) when initial liquidity is
provided. This protect against one liquidity pool token share (1e-18) becoming too expensive, which would turn
away small liquidity providers. Simply subtracting 1000 from initial liquidity makes the price of one liquidity share
1000 times cheaper.

To solidify our understanding of minting, let's write tests.

## Writing tests in Solidity

As I said above, I'll be using Foundry to test our smart contracts–this will allow us to quickly set up our tests and
not have any business with JavaScript. Our smart contracts tests will simply be other smart contracts. That's it: **smart
contracts that test smart contracts**.

This is all we need to set up testing of the pair contract:

```solidity
contract ZuniswapV2PairTest is Test {
  ERC20Mintable token0;
  ERC20Mintable token1;
  ZuniswapV2Pair pair;

  function setUp() public {
    token0 = new ERC20Mintable("Token A", "TKNA");
    token1 = new ERC20Mintable("Token B", "TKNB");
    pair = new ZuniswapV2Pair(address(token0), address(token1));

    token0.mint(10 ether);
    token1.mint(10 ether);
  }

  // Any function starting with "test" is a test case.
}

```

Let's add a test for pair bootstrapping (providing initial liquidity):

```solidity
function testMintBootstrap() public {
  token0.transfer(address(pair), 1 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint();

  assertEq(pair.balanceOf(address(this)), 1 ether - 1000);
  assertReserves(1 ether, 1 ether);
  assertEq(pair.totalSupply(), 1 ether);
}

```

1 ether of `token0` and 1 ether of `token1` are added to the test pool. As a result, 1 ether of LP-tokens is issued and we
get 1 ether - 1000 (minus the minimal liquidity). Pool reserves and total supply get changed accordingly.

What happens when balanced liquidity is provided to a pool that already has some liquidity? Let's see:

```solidity
function testMintWhenTheresLiquidity() public {
  token0.transfer(address(pair), 1 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint(); // + 1 LP

  token0.transfer(address(pair), 2 ether);
  token1.transfer(address(pair), 2 ether);

  pair.mint(); // + 2 LP

  assertEq(pair.balanceOf(address(this)), 3 ether - 1000);
  assertEq(pair.totalSupply(), 3 ether);
  assertReserves(3 ether, 3 ether);
}

```

Everything looks correct here. Let's see what happens when unbalanced liquidity is provided:

```solidity
function testMintUnbalanced() public {
  token0.transfer(address(pair), 1 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint(); // + 1 LP
  assertEq(pair.balanceOf(address(this)), 1 ether - 1000);
  assertReserves(1 ether, 1 ether);

  token0.transfer(address(pair), 2 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint(); // + 1 LP
  assertEq(pair.balanceOf(address(this)), 2 ether - 1000);
  assertReserves(3 ether, 2 ether);
}

```

This is what we talked about: even though user provided more `token0` liquidity than `token1` liquidity,
they still got only 1 LP-token.

Alright, liquidity provision looks good. Let's now move to liquidity removal.

## Removing liquidity

Liquidity removal is opposite to provision. Likewise, burning is opposite to minting. Removing liquidity from pool means
burning of LP-tokens in exchange for proportional amount of underlying tokens. The amount of tokens returned to liquidity
provided is calculated like that:

$$Amount_{token}=Reserve_{token} * \frac{Balance_{LP}}{TotalSupply_{LP}}$$
In plain English: the amount of tokens returned is proportional to the amount of LP-tokens held over total supply of LP
tokens. The bigger your share of LP-tokens, the bigger share of reserve you get after burning.

And this is all we need to know to implement `burn` function:

```solidity
function burn() public {
  uint256 balance0 = IERC20(token0).balanceOf(address(this));
  uint256 balance1 = IERC20(token1).balanceOf(address(this));
  uint256 liquidity = balanceOf[msg.sender];

  uint256 amount0 = (liquidity * balance0) / totalSupply;
  uint256 amount1 = (liquidity * balance1) / totalSupply;

  if (amount0 <= 0 || amount1 <= 0) revert InsufficientLiquidityBurned();

  _burn(msg.sender, liquidity);

  _safeTransfer(token0, msg.sender, amount0);
  _safeTransfer(token1, msg.sender, amount1);

  balance0 = IERC20(token0).balanceOf(address(this));
  balance1 = IERC20(token1).balanceOf(address(this));

  _update(balance0, balance1);

  emit Burn(msg.sender, amount0, amount1);
}

```

As you can see, UniswapV2 doesn't support partial removal of liquidity.

> **Update**: the above statement is wrong! I made a logical bug in this function, can you spot it? If not, I explained
and fixed it in [Part 4](https://jeiwan.net/posts/programming-defi-uniswapv2-4/) ([commit](https://github.com/Jeiwan/zuniswapv2/commit/babf8509b8be96796e2d944710bfcb22cc1fe77d#diff-835d3f34100b5508951336ba5a961932492eaa6923e3c5299f77007019bf2b6fR84))

Let's test it:

```solidity
function testBurn() public {
  token0.transfer(address(pair), 1 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint();
  pair.burn();

  assertEq(pair.balanceOf(address(this)), 0);
  assertReserves(1000, 1000);
  assertEq(pair.totalSupply(), 1000);
  assertEq(token0.balanceOf(address(this)), 10 ether - 1000);
  assertEq(token1.balanceOf(address(this)), 10 ether - 1000);
}

```

We see that the pool returns to its uninitialized state except the minimum liquidity that was sent to the zero address–
it cannot be claimed.

Now, let's see what happens when we burn after providing unbalanced liquidity:

```solidity
function testBurnUnbalanced() public {
  token0.transfer(address(pair), 1 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint();

  token0.transfer(address(pair), 2 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint(); // + 1 LP

  pair.burn();

  assertEq(pair.balanceOf(address(this)), 0);
  assertReserves(1500, 1000);
  assertEq(pair.totalSupply(), 1000);
  assertEq(token0.balanceOf(address(this)), 10 ether - 1500);
  assertEq(token1.balanceOf(address(this)), 10 ether - 1000);
}

```

What we see here is that we have lost 500 wei of `token0`! This is the punishment for price manipulation we talked
above. But the amount is ridiculously small, it doesn't seem significant at all. This so because our current user (the
test contract) is the only liquidity provider. What if we provide unbalanced liquidity to a pool that was initialized
by another user? Let's see:

```solidity
function testBurnUnbalancedDifferentUsers() public {
  testUser.provideLiquidity(
    address(pair),
    address(token0),
    address(token1),
    1 ether,
    1 ether
  );

  assertEq(pair.balanceOf(address(this)), 0);
  assertEq(pair.balanceOf(address(testUser)), 1 ether - 1000);
  assertEq(pair.totalSupply(), 1 ether);

  token0.transfer(address(pair), 2 ether);
  token1.transfer(address(pair), 1 ether);

  pair.mint(); // + 1 LP

  assertEq(pair.balanceOf(address(this)), 1);

  pair.burn();

  assertEq(pair.balanceOf(address(this)), 0);
  assertReserves(1.5 ether, 1 ether);
  assertEq(pair.totalSupply(), 1 ether);
  assertEq(token0.balanceOf(address(this)), 10 ether - 0.5 ether);
  assertEq(token1.balanceOf(address(this)), 10 ether);
}

```

This looks completely different! We've now lost 0.5 ether of `token0`, which is 1/4 of what we deposited. Now that's
a significant amount!

Try to figure out who eventually gets that 0.5 ether: the pair or the test user? 😉

## Conclusion

Well, enough for today. Feel free experimenting with the code and, for example, choosing the bigger amount of LP-tokens
when adding liquidity to a pool.

## Links

1. [Source code of part 1](https://github.com/Jeiwan/zuniswapv2/tree/part_1)
1. [UniswapV2 Whitepaper](https://uniswap.org/whitepaper.pdf) – worth reading and re-reading.
1. [Foundry GitHub repo](https://github.com/gakonst/foundry)
1. [Programming DeFi: Uniswap V1](https://jeiwan.net/posts/programming-defi-uniswap-1/)
