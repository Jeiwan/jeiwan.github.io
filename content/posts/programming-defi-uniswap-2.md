---
title: "Programming DeFi: Uniswap. Part 2"
date: 2021-06-16T00:00:00+00:00
katex: true
tags: ["Uniswap", "Ethereum", "Blockchain"]
---

![Asymmetry](/images/susan-kuriakose-66qaQoudwdo-unsplash.jpg)
Photo by
[Susan Kuriakose](https://unsplash.com/@susan_kuriakose?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on
[Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

This is part two of my series on programming DeFi smart contracts.
[In the previous part](https://jeiwan.net/posts/programming-defi-uniswap-1/), we learned about Uniswap and its core
mechanics and started building an exchange contract.
The contract can accept liquidity from users, calculate output amounts, and perform swaps.

Today, we're going to finish Uniswap V1 implementation.
While it won't be a full copy of Uniswap V1, it'll have all core features.

This part is packed with new code, so let's get straight to it.

> To see changes since the previous part, [click here](https://github.com/Jeiwan/zuniswap/compare/part_1...part_2).  
> To see full code of the project so far, [click here](https://github.com/Jeiwan/zuniswap/tree/part_2).

## Adding more liquidity

In the previous part, we discussed that our implementation of `addLiquidity` is not complete.
There was a reason for that and today we're going to finish the function.

So far, the function looks like that:

```solidity
function addLiquidity(uint256 _tokenAmount) public payable {
  IERC20 token = IERC20(tokenAddress);
  token.transferFrom(msg.sender, address(this), _tokenAmount);
}

```

Can you identify the problem?

The function allows to add arbitrary amounts of liquidity at any moment.

As you remember, exchange rate is calculated as a ratio of reserves:
$$P_X=\frac y x, P_Y=\frac x y$$
Where \\(P_X\\) and \\(P_Y\\) are prices of ether and token; \\(x\\) and \\(y\\) are reserves of ether and token.

We also learned that swapping tokens changes reserves in a non-linear way, which affects prices, and that arbitrageurs
make profit by balancing prices so they match those of big central exchanges.

The problem with our implementation is that it allows to significantly change prices at any point of time.
Or, in other words, **it doesn't enforce current reserves ratio on new liquidity**.
This is a problem because this allows price manipulations, and we want prices on decentralized exchanges to be as close
to those on centralized exchanges. We want our exchange contracts to act as price oracles.

So, we must ensure that additional liquidity is added in the same proportion that has already established in the pool.
At the same time, we want to allow liquidity in an arbitrary proportion when reserves are empty, i.e. when a pool hasn't yet been
initialized. And this is an important moment because **this is when the price is set initially**.

Now, `addLiquidity` will have two branches:

1. If this is a new exchange (no liquidity), allow an arbitrary liquidity proportion when pool is empty.
1. Else, enforce established reserves proportion when there's some liquidity.

The first branch remains unchanged:

```solidity
if (getReserve() == 0) {
    IERC20 token = IERC20(tokenAddress);
    token.transferFrom(msg.sender, address(this), _tokenAmount);
```

The second branch is where the new code goes to:

```solidity
} else {
    uint256 ethReserve = address(this).balance - msg.value;
    uint256 tokenReserve = getReserve();
    uint256 tokenAmount = (msg.value * tokenReserve) / ethReserve;
    require(_tokenAmount >= tokenAmount, "insufficient token amount");

    IERC20 token = IERC20(tokenAddress);
    token.transferFrom(msg.sender, address(this), tokenAmount);
}

```

The only difference is that we're not depositing all tokens provided by user but only an amount calculated based on current reserves ratio.
To get the amount, we multiply the ratio (`tokenReserve / ethReserve`) by the amount of deposited ethers.
Then, an error is thrown if user deposited less than this amount.

This will preserve a price when liquidity is added to a pool.

## LP-tokens

We haven't discussed this concept but it's a crucial part of the Uniswap design.

We need to have a way to reward liquidity providers for their tokens. If they're not incentivized, they won't
provide liquidity because no one would put their tokens in a third-party contract for nothing. Moreover, that reward
shouldn't be paid by us because we'd have to get investments or issue an inflationary token to fund it.

The only good solution is to collect a small fee on each token swap and distribute accumulated fees among liquidity
providers. This also seems pretty much fair: users (traders) pay for services (liquidity) provided by other people.

For rewards to be fair, we need to reward liquidity providers proportionally to their contribution, i.e. the amount of
liquidity they provide. If someone has provided 50% of pool liquidity, they should get 50% of accumulated fees. This
makes sense, right?

Now, the task seems pretty complicated. However, there's an elegant solution: LP-tokens.

LP-tokens are basically ERC20 tokens issued to liquidity providers in exchange for their liquidity. In fact, **LP-tokens
are shares**:

1. You get LP-tokens in exchange for your liquidity.
1. The amount of tokens you get is proportional to the share of your liquidity in pool's reserves.
1. Fees are distributed proportionally to the amount of tokens you hold.
1. LP-tokens can be exchanged back for liquidity + accumulated fees.

Ok, how will we calculate the amount of issued LP-tokens depending on the amount of provided liquidity? This is not so
obvious because there a some requirements we need to meet:

1. Every issued share must be always correct. When someone deposits or removes liquidity after me my share must remain correct.
1. Write operations (e.g. storing new data or updating existing data in a contract) on Ethereum are very expensive.
   So we'd want to reduce maintenance costs of LP-tokens (i.e. we don't want to run a scheduled job that regularly
   recalculates and updates shares).

Imagine if we issue a lot of tokens (say, 1 billion) and distribute them among all liquidity providers. If we always
distribute all the tokens (first liquidity provider gets 1 billion, second one gets a share of it, etc.) we are forced to
recalculate issued shares, which is expensive. If we distribute only a portion of the tokens initially, then we're
risking hitting the supply limit, which will eventually force use into redistributing existing shares.

The only good solution seems to not have supply limit at all and mint new tokens when new liquidity is added. This
allows infinite growth and, if we use a proper formula, all issued shares will remain correct (will scale
proportionally) when liquidity is added or removed. Luckily, inflation doesn't reduce value of LP-tokens because
they're always backed by some amount of liquidity that doesn't depend on the number of issued tokens.

Now, the final piece in this puzzle: how to calculated the amount of minted LP-tokens when liquidity is deposited?

The exchange contract stores reserves of ether and token, so we'd want to calculate based on reserves of both... or
only one of them? Or both? I don't know 😁 Uniswap V1 calculates the amount proportionally to the ether reserve, but
Uniswap V2 allows only swaps between tokens (not between ether and token), so it's not clear how to choose between them.
Let's stick to what Uniswap V1 does and later we'll see how to solve this problem when there are two ERC20 tokens.

This equation shows how the amount of new LP-tokens is calculated depending on the amount of ethers deposited:

$$amountMinted = totalAmount * \frac{ethDeposited}{ethReserve}$$

Every liquidity depositing issues LP-tokens proportionally to the share of deposited ethers in ether reserve.
This is tricky, try putting different numbers in this equation and see how total amount changes. For example,
what `amountMinted` and `totalAmount` would be when someone deposits `etherReserve` amount of ethers? Are issued shares
still valid after that?

Let's get to the code.

Before modifying `addLiquidity`, we need to make our Exchange contract an ERC20 contract and change its constructor:

```solidity
contract Exchange is ERC20 {
    address public tokenAddress;

    constructor(address _token) ERC20("Zuniswap-V1", "ZUNI-V1") {
        require(_token != address(0), "invalid token address");

        tokenAddress = _token;
    }
```

Our LP-tokens will have a constant name and a symbol, this is how Uniswap does it. Feel free to improve this by taking
the underlaying token's name and symbol.

Now, let's update `addLiquidity`: when adding initial liquidity, the amount of LP-tokens issued equals to the amount
of ethers deposited.

```solidity
function addLiquidity(uint256 _tokenAmount)
    public
    payable
    returns (uint256)
{
    if (getReserve() == 0) {
        ...

        uint256 liquidity = address(this).balance;
        _mint(msg.sender, liquidity);

        return liquidity;

```

Additional liquidity mints LP-tokens proportionally to the amount of ethers deposited:

```solidity
    } else {
        ...

        uint256 liquidity = (totalSupply() * msg.value) / ethReserve;
        _mint(msg.sender, liquidity);

        return liquidity;
    }
}

```

Just a few lines and we now have LP-tokens!

## Fees

We're now ready to collect fees on swaps. Before that, we need to answer a couple of questions:

1. Do we want to take fees in ether or tokens? Do we want to pay rewards to liquidity providers in ether or tokens?
1. How to collect a small fixed fee from each swap?
1. How to distribute accumulated fees to liquidity providers proportionnaly to their contribution?

Again, this might be seemed as a difficult task but we already have everything to solve it.

Let's think about the last two questions. We might introduce an extra payment that's sent along with a swap
transaction. Such payments then get accumulated in a fund from which any liquidity provider can withdraw an amount
proportional to their share. This sounds like a reasonable idea and, surprisingly, it's almost done:

1. Traders already send ethers/tokens to the exchange contract. Instead of asking for a fee we can simply subtract it
   from ethers/tokens that are sent to the contract.
1. We already have the fund – it's the exchange reserves! The reserves can be used to accumulated fees. This also
   means that **reserves will grow over time**, so the constant product formula is not that constant! However, this doesn't
   invalidate it: the fee is small compared to reserves and there's no way to manipulate it to try to significantly change reserves.
1. And now we have an answer to the first question: fees are paid in the currency of the traded in asset. Liquidity providers
   get a balanced amount of ethers and tokens plus a share of accumulated fees proportional to the share of their LP-tokens.

That's it! Let's get to the code.

Uniswap takes 0.3% in fees from each swap. We'll take 1% just so that it's easier to see the difference in tests.
Adding fees to the contract is as easy as adding a couple of multipliers to `getAmount` function:

```solidity
function getAmount(
  uint256 inputAmount,
  uint256 inputReserve,
  uint256 outputReserve
) private pure returns (uint256) {
  require(inputReserve > 0 && outputReserve > 0, "invalid reserves");

  uint256 inputAmountWithFee = inputAmount * 99;
  uint256 numerator = inputAmountWithFee * outputReserve;
  uint256 denominator = (inputReserve * 100) + inputAmountWithFee;

  return numerator / denominator;
}

```

Since Solidity doesn't support floating point division, we have to use a trick: both numerator and denominator are
multiplied by a power of 10, and fee is subtracted from the multiplier in the numerator. Normally, we would calculate it
like that:
$$amountWithFee = amount * \frac{100 - fee}{100}$$

In Solidity, we have to do it like that:

$$amountWithFee = \frac{(amount * (100 - fee))}{100}$$

But it's still the same thing.

## Removing liquidity

Finally, last function on our list: `removeLiquidity`.

To remove liquidity we can again use LP-tokens: we don't need to remember amounts deposited by each liquidity provider
and can calculate the amount of removed liquidity based on an LP-tokens share.

```solidity
function removeLiquidity(uint256 _amount) public returns (uint256, uint256) {
  require(_amount > 0, "invalid amount");

  uint256 ethAmount = (address(this).balance * _amount) / totalSupply();
  uint256 tokenAmount = (getReserve() * _amount) / totalSupply();

  _burn(msg.sender, _amount);
  payable(msg.sender).transfer(ethAmount);
  IERC20(tokenAddress).transfer(msg.sender, tokenAmount);

  return (ethAmount, tokenAmount);
}

```

When liquidity is removed, it's returned in both ethers and tokens and their amounts are, of course, balanced. This is
the moment that causes [impermanent loss](https://pintail.medium.com/uniswap-a-good-deal-for-liquidity-providers-104c0b6816f2):
the ratio of reserves changes over time following changes in their prices in USD. When liquidity is removed the balance
can be different from what it was when liquidity was deposited. This means that you would get different amounts of
ethers and tokens and their total price might be lower than if you have just held them in a wallet.

To calculate the amounts we multiply reserves by the share of LP-tokens:

$$removedAmount = reserve * \frac{amountLP}{totalAmountLP}$$

Notice that LP-tokens are burnt each time liquidity is removed. LP-tokens are only backed by deposited liquidity.

## LP reward and impermanent loss demonstration

Let's write a test that reproduces the full cycle of adding liquidity, swapping tokens, accumulating fees, and removing
liquidity:

1. First, liquidity provider deposits 100 ethers and 200 tokens. This makes 1 token being equal to 0.5 ethers and 1
   ether being equal to 2 tokens.
   ```js
   exchange.addLiquidity(toWei(200), { value: toWei(100) });
   ```
1. A user swaps 10 ethers and expects to get at least 18 tokens. In fact, they got 18.0164 tokens. It includes slippage
   (traded amounts are relatively big) and the 1% fee.

   ```js
   exchange.connect(user).ethToTokenSwap(toWei(18), { value: toWei(10) });
   ```

1. Liquidity provider then removes their liquidity:
   ```js
   exchange.removeLiquidity(toWei(100));
   ```
1. Liquidity provider got 109.9 ethers (transaction fees included) and 181.9836 tokens.
   As you can see, these numbers are different from those that were deposited: we got the 10 ethers traded in by the
   user but had to give 18.0164 tokens in exchange. However, that amount includes the 1% fee the user has paid to us.
   Since the liquidity provider has provided all the liquidity, they got all the fees.

## Conclusion

That was a big post!
Hopefully LP-tokens are not a mystery for you anymore and Uniswap is easy as pie (not cake 😉).

However, we're not done yet: Exchange contract is now finished, but we also need to implement Factory contract, which serves
as a registry of exchanges and a bridge that connects multiple exchanges and makes token-to-token swaps possible.
We'll implement it in the next part!

## Useful links

1. [Full code of this part](https://github.com/Jeiwan/zuniswap/tree/part_2)
1. [Uniswap V1 Whitepaper](https://hackmd.io/@HaydenAdams/HJ9jLsfTz)
