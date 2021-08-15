---
title: "Programming DeFi: Uniswap. Part 3"
date: 2021-06-22T00:00:00+00:00
tags: ["Uniswap", "Ethereum", "Blockchain", "Smart contracts"]
---

![Factory](/images/carlos-aranda-QMjCzOGeglA-unsplash.jpg)
Photo by
[carlos aranda](https://unsplash.com/@carlosaranda?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on
[Unsplash](https://unsplash.com/s/photos/factory?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

Here we are again building a clone of Uniswap V1! Our implementation is almost ready: we've implemented all core
mechanics of Exchange contract, including pricing functions, swapping, LP-tokens, and fees. It looks like our clone
is complete, however there's a missing piece: Factory contract. Today, we'll implement it and our Uniswap V1 clone will
be done. However, this is not the end: in the next part we'll be building Uniswap V2 and it'll be not less interesting
than V1!

> To see changes since the previous part, [click here](https://github.com/Jeiwan/zuniswap/compare/part_2...part_3).  
> To see full code of the project so far, [click here](https://github.com/Jeiwan/zuniswap/tree/part_3).

## What Factory is for

Factory contract serves as a registry of exchanges: every new deployed Exchange contract is registered with a Factory.
And this an important mechanic: any exchange can be found by querying the registry. By having such registry exchanges can
find other exchanges when user tries to swap a token for another token (and not ether).

Another handy utility provided by Factory contract is ability to deploy an exchange without dealing with code, nodes,
deploying scripts, and any other development tools. Factory implements a function that allows users to create and deploy
an exchange by simply calling this function. So, **today we'll also learn how a contract can deploy another contract**.

Uniswap has only one Factory contract, thus there's only one registry of Uniswap pairs. However, nothing prevents
other users from deploying their own Factories or even Exchange contract that are not registered with the official
Factory. While this is possible, such exchanges won't be recognized by Uniswap and there would be no way to use them
to swap tokens via the official web-site.

That's basically it. Let's get to the code!

## Factory implementation

Factory is a registry so we need a data structure to store exchanges, and that will be a mapping of addresses to
addresses – it will allow to find exchanges by their tokens (1 exchange can swap only 1 token, remember?).

```solidity
pragma solidity ^0.8.0;

import "./Exchange.sol";

contract Factory {
    mapping(address => address) public tokenToExchange;

    ...
```

Next, is the `createExchange` functions that allows to create and deploy an exchange by simply taking a token address:

```solidity
function createExchange(address _tokenAddress) public returns (address) {
  require(_tokenAddress != address(0), "invalid token address");
  require(
    tokenToExchange[_tokenAddress] == address(0),
    "exchange already exists"
  );

  Exchange exchange = new Exchange(_tokenAddress);
  tokenToExchange[_tokenAddress] = address(exchange);

  return address(exchange);
}

```

There are two checks:

1. The first ensures the token address is not the zero address (`0x0000000000000000000000000000000000000000`).
1. Next one ensures that the token hasn't already been added to the registry (default address value is the zero
   address). The idea is that we don't want to have different exchanges for the same token because we don't want
   liquidity to be scattered across multiple exchanges. It should better be concentrated on one exchange to reduce
   slippage and provide better exchange rates.

Next, we instantiate Exchange with the provided token address, this is why we needed to import "Exchange.sol" earlier.
This instantiation is similar to instantiation of classes in OOP languages, however, in Solidity, the `new` operator will
in fact deploy a contract. The returned values has the type of the contract (Exchange) and every contract can be
converted to an address – this is what we're doing on the next line to get the address of the new exchange and save it
to the registry.

To finish the contract, we need to implement only one more function – `getExchange`, which will allow us to query the
registry via an interface from another contract:

```solidity
function getExchange(address _tokenAddress) public view returns (address) {
  return tokenToExchange[_tokenAddress];
}

```

That's it for the factory! It's really simple.

Next, we need to improve the exchange contract so it could use the factory to perform token-to-token swaps.

## Linking Exchange to Factory

First, we need to link Exchange to Factory because every exchange needs to know the address of the Factory and we don't
want to hard-code so the contract is more flexible. To link Exchange to Factory, we need to add a new state variable
that will store factory address and we'll need update the constructor:

```solidity
contract Exchange is ERC20 {
    address public tokenAddress;
    address public factoryAddress; // <--- new line

    constructor(address _token) ERC20("Zuniswap-V1", "ZUNI-V1") {
        require(_token != address(0), "invalid token address");

        tokenAddress = _token;
        factoryAddress = msg.sender;  // <--- new line

    }
    ...
}
```

And that's it. It's now ready to do token-to-token swap. Let's implement that.

## Token-to-token swaps

How do we swap a token for token when we have two exchanges linked by a registry? Maybe like that:

1. Begin the standard token-to-ether swap.
1. Instead of sending ethers to user, find an exchange for the token address provided by user.
1. If the exchange exists, send the ethers to the exchange to swap them to tokens.
1. Return swapped tokens to user.

Looks good, doesn't it? Let's try building that.

We'll this function `tokenToTokenSwap`:

```solidity
// Exchange.sol

function tokenToTokenSwap(
    uint256 _tokensSold,
    uint256 _minTokensBought,
    address _tokenAddress
) public {
    ...
```

The function takes three arguments: the amount of tokens to be sold, minimal amount of tokens to get in exchange, the
address of the token to exchange sold tokens for.

We first check if there's an exchange for the token address provided by user. If there's none, it'll throw an error.

```solidity
address exchangeAddress = IFactory(factoryAddress).getExchange(
    _tokenAddress
);
require(
    exchangeAddress != address(this) && exchangeAddress != address(0),
    "invalid exchange address"
);

```

We're using `IFactory` which is an interface for the Factory contract. It's a good practice to use interfaces when
interacting with other contracts (or classes in OOP). However, interfaces don't allow to access state variables and this
is why we've implemented the `getExchange` function in the Factory contract – so we can use the contract via an
interface.

```solidity
interface IFactory {
  function getExchange(address _tokenAddress) external returns (address);
}

```

Next, we're using the current exchange to swap tokens for ethers and transfer user's tokens to the exchange. This is the
standard procedure of ether-to-tokens swapping:

```solidity
uint256 tokenReserve = getReserve();
uint256 ethBought = getAmount(
    _tokensSold,
    tokenReserve,
    address(this).balance
);

IERC20(tokenAddress).transferFrom(
    msg.sender,
    address(this),
    _tokensSold
);


```

Final step of the function is using the other exchange to swap ethers to tokens:

```solidity
IExchange(exchangeAddress).ethToTokenSwap{value: ethBought}(
    _minTokensBought
);

```

And we're done!

Not really, actually. Can you see a problem? Let's looks at the last line of `etherToTokenSwap`:

```solidity
IERC20(tokenAddress).transfer(msg.sender, tokensBought);
```

A-ha! It sends bought tokens to `msg.sender`. In Solidity, `msg.sender` is dynamic, not static, and it points at the one
who (or what, in the case of a contract) initiated the current call. When user calls a contract function, it would point
to user's address. But when a contract calls another contract, `msg.sender` is the address of the calling contract!

Thus, `tokenToTokenSwap` would send tokens to the address of the first exchange! This is not a problem though because we
can call `ERC20(_tokenAddress).transfer(...)` to send those tokens to the user. However, there's a getter solution: let's
save some gas and send tokens directly to the user. For this, we'll need to split the `etherToTokenSwap` function into
two functions:

```solidity
function ethToToken(uint256 _minTokens, address recipient) private {
  uint256 tokenReserve = getReserve();
  uint256 tokensBought = getAmount(
    msg.value,
    address(this).balance - msg.value,
    tokenReserve
  );

  require(tokensBought >= _minTokens, "insufficient output amount");

  IERC20(tokenAddress).transfer(recipient, tokensBought);
}

function ethToTokenSwap(uint256 _minTokens) public payable {
  ethToToken(_minTokens, msg.sender);
}

```

`ethToToken` is private function that everything `ethToTokenSwap` is used to do with only one difference: it takes a
tokens recipient address, which gives us the flexibility of choosing who we want to send tokens to. `ethToTokenSwap`,
in its turn, is now simply a wrapper for `ethToToken` that always passes `msg.sender` as a recipient.

Now, we need another function to send tokens to a custom recipient. We could've used `ethToToken` for that but let's
leave it private and non-payable.

```solidity
function ethToTokenTransfer(uint256 _minTokens, address _recipient)
  public
  payable
{
  ethToToken(_minTokens, _recipient);
}

```

This is simply a copy of `ethToTokenSwap` that allows to send tokens to a custom recipient. We can now use it in the
`tokenToTokenSwap` function:

```solidity
    ...

    IExchange(exchangeAddress).ethToTokenTransfer{value: ethBought}(
        _minTokensBought,
        msg.sender
    );
}
```

We're sending tokens tokens to whoever initiated the swap.

And now, we're done!

## Conclusion

Our copy of Uniswap V1 is now finished. If you have any ideas about how to improve it, give them a try! For example,
there can a function in Exchange to calculate the output amount of tokens in token-to-token swap.
If you have any problems understanding how something works, feel free to check
[the tests](https://github.com/Jeiwan/zuniswap/tree/part_3/test). I have covered all the functions, including
`tokenToTokenSwap`.

Next time, we'll start learning Uniswap V2. While it's mostly the same thing, the same set or core principles, it
provides some new powerful features.

Until next time!

## Useful links

1. [Full code of this part](https://github.com/Jeiwan/zuniswap/tree/part_3)
1. [Uniswap V1 Whitepaper](https://hackmd.io/@HaydenAdams/HJ9jLsfTz)
1. [Original Uniswap V1 source code](https://github.com/Uniswap/uniswap-v1)
