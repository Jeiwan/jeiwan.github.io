---
title: "Ethernaut tips and solutions"
date: 2021-12-02T00:00:00+00:00
tags: ["Ethereum", "Solidity", "Blockchain"]
---

![First steps](/images/jukan-tateisi-bJhT_8nbUA0-unsplash.jpg)
Photo by
[Jukan Tateisi](https://unsplash.com/@tateisimikito?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on
[Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

[Ethernaut](https://ethernaut.openzeppelin.com/) is an (awesome) browser game that let's you practice Web3 and Solidity
whilte solving different tasks. The game consists of 23 levels (as of August 2021) and each level is focused on some
Solidity feature or bug, smart contract design flaw, or unexpected behaviour of a contract. Your goals in each level is
to hack it: to find a way of becoming a contract owner, to transfer all tokens to your own address, or abuse a feature
of Solidity that wasn't taken into consideration by a smart contract developer.

This is game a rare opportunity to get some real practical skills if you already know some basics of Web3 and Solidity.
This is also a good opportunity to deepen your knowledge of Solidity because some levels are very hardcore – you won't
solve them without diving into the internals of Solidity and EVM.

In this blog post, I'll tell you about my experience solving the game and will give you some hints for each of the
levels.
If want to see complete solutions, you can find them [on GitHub](https://github.com/Jeiwan/ethernaut-solutions).
Just remember: **there's more than one way of solving the levels**, finding your own solutions might be more benefitial
to you than simply solving the game.

Let's begin!

### Prerequisites

To play Ethernaut, you'll have to have some basic skils, like:

1. **JavaScript**. Being able to write basic scripts in JavaScript is enough but you'll also need to learn about
   `async`/`await` or how to get results from [Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).
1. **Solidity**. You need to know Solditiy syntax and have experience writing simple contracts.
   A good way to get the basics is [CryptoZombies](https://cryptozombies.io/) and [the official documentation](https://docs.soliditylang.org/en/v0.8.7/introduction-to-smart-contracts.html).
1. **Web3.js**. This is a library that has became the standard way of interacting with Ethereum in JavaScript.
   So, the better you know it, the easier it'll be for you to solve the levels.
   [The official documentation](https://web3js.readthedocs.io) will be a good helper if you forgot or didn't know
   something.

Nevertheless, don't set the bar too high! Give it a try and learn while playing! This is what the game was created for.

### Tools

Even though Ethernaut is a browser game, you'll want to reproduce levels on your computer to better understand them,
test ideas, and quickly iterate with solutions. That's why you'll need a tool to make smart contracts development
as easy and comfortable as possible.

[Hardhat](https://hardhat.org/) is the best Solidity development tool at the moment.
It comes with a template to set up a Solidity project and frees you from the need to run and manage a local
Ethereum network. It just works! Also, Hardhat has a configured and transparent testing environment, which allows you
to iterate super fast compared to other development environments.

One extremely useful feature of Hardhat is `hardhat/console.sol` contract that allows you print to the console from
smart contracts! It provides `console.log()` function in your Solditiy code, as well as other functions to print
different data types (e.g. `console.logBytes32()`). With this function, it'll be much easier for you to understand
what happens in a contract and find out if something goes wrong.

[Remix IDE](https://remix.ethereum.org/) is a browser IDE for writing and deploying smart contracts. The fact that it
runs in browser and that it's connected to MetaMask allows you to deploy contracts in a couple of clicks. Everyone uses
Remix. Spend some time to get comfortable with it, this will pay back.

### General recommendations

Whenever you see Solidity code:

1. Read it.
1. Ensure that you understand **every line**.
1. Re-read it.
1. Try to see the whole picture.
1. Try to see if there's something wrong.

## Hints

### 0. Hello Ethernaut

This is an introductory level, it's goal is to teach you how to use MetaMask to connect to a test network and how to
interact with Ethernaut contracts using your browser's developer console.

**My solution:** follow the instructions.

### 1. Fallback

The smart contract has a logical flaw that allows anyone to become an owner and withdraw all funds.
Find it.

1. Learn about [the `receive()` function](https://docs.soliditylang.org/en/latest/contracts.html#receive-ether-function)
1. While this is not relevant to this level, learn about [the `fallback()` function](https://docs.soliditylang.org/en/latest/contracts.html#fallback-function) as well.
   This will help in the future.
1. Learn [how to call contracts with Web3.js](https://docs.soliditylang.org/en/latest/contracts.html#receive-ether-function)
   and how to send ether allon with contract calls.

**My solution:** call `contribute()` and send some ethers to become a contributor, send some ethers to the contract
to become an owner, call `withdraw()` to withdraw all funds.

### 2. Fallout

There's a typo in the code, find it and use it to become an owner.

**My solution:** a single transaction sent via Web3.js.

### 3. Coin Flip

This is where things are getting nastier. 😈

1. Read the code.
1. Learn about the maximum value of `uint256`.
1. Try to understand the idea behind using that big number.
1. Realize that you always know current block number and hash.

**My solution:** I first tried soliving it via Web3.js but that was dull because there's no guarantee that my
tx gets into the next block. Then I've deployed it as a Solidity contract (there's no code, sorry) and it was also dull
but more reliable.

### 4. Telephone

Learn the difference between `tx.origin` and `msg.sender`.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/TelephoneAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/TelephoneAttack.test.js)

### 5. Token

Learn about [integer overflow and underflow](https://www.acunetix.com/blog/web-security-zone/what-is-integer-overflow/)
and see if the contract is vulnerable.

**My solution:** [Web3.js](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/Token.test.js),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/Token.test.js)

### 6. Delegation

Learn how contracts are called from other contracts and the difference between [`call` and `delegatecall`](https://docs.soliditylang.org/en/v0.8.7/introduction-to-smart-contracts.html#delegatecall-callcode-and-libraries).
Also, remember that `delegatecall` is always a red flag.

If you're doing this via Web3.js, you'll need to know [how to use custom ABI](https://web3js.readthedocs.io/en/v1.4.0/web3-eth-contract.html#new-contract) to call contract methods that are
not defined in the contract's ABI. Another way of achieving the same goals is by using the low level [call](https://web3js.readthedocs.io/en/v1.4.0/web3-eth.html#call) function, but it'll be harder.

**My solution:** [Web3.js](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/Delegation.test.js)

### 7. Force

You need to send ethers to a contract that doesn't allow to do that.
Here's a hint: learn about [selfdestruct](https://docs.soliditylang.org/en/v0.8.7/introduction-to-smart-contracts.html#deactivate-and-self-destruct).

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/ForceAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/ForceAttack.test.js)

### 8. Vault

Everything on blockchain is public even if it's marked as `private` in Solidity. Ethereum JSON-RPC and Web3.js provide
a way to read any value stored in a contract: [getStorageAt](https://web3js.readthedocs.io/en/v1.4.0/web3-eth.html#getstorageat).

**My solution:** a single call to `getStorageAt` via Web3.js.

### 9. King

This level requires deploying a contract. The goal is to break the contract so it cannot be used after you. You've
probably already learned about the fallback function and what happenes when you send ethers to a contract that
doesn't implement it.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/KingAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/KingAttack.test.js)

### 10. Re-entrancy

Re-entrancy attacks are probably the most common ones. Here are some useful links to learn about them:

1. [Re-entrancy](https://docs.soliditylang.org/en/v0.8.6/security-considerations.html#re-entrancy) from the official
   Solidity documentation.
1. [Re-entrancy by example](https://solidity-by-example.org/hacks/re-entrancy/)
1. [Checks-effects-interactions](https://fravoll.github.io/solidity-patterns/checks_effects_interactions.html), a pattern
   to prevent re-entrancy attacks.

After studying these resources you'll be able to spot the vulnerability.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/ReentrancyAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/ReentrancyAttack.test.js)

### 11. Elevator

You need to implement a contract that returns different results when its function is called with the same argument.
The easiest way of achieving that is via some internel state.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/ElevatorAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/ElevatorAttack.test.js)

### 12. Privacy

This is an advanced version of the `Vault` level where you need to read an element of a private array that's not the
first state variable of a contract.
These links will help you:

1. [Layout of State Variables in Storage](https://docs.soliditylang.org/en/v0.8.7/internals/layout_in_storage.html)
1. [Explicit Conversions](https://docs.soliditylang.org/en/v0.8.7/types.html#explicit-conversions)

**My solution:** a single call to `getStorageAt` via Web3.js.

### 13. Gatekeeper One

To solve this level you need to solve three sub-tasks:

1. `gateOne` requires you to use a contract to solve this level.
1. `gateTwo` requires the amount of gas left in the transaction to satisfy a condition. This is the trickiest part.
   To solve it, [learn about the way of limiting gas in contract calls](https://docs.soliditylang.org/en/v0.8.7/control-structures.html?highlight=gas%3A#external-function-calls).
1. `gateThree` requires a key that satisfies three conditions. This is not hard as soon as you [learn about type conversions](https://docs.soliditylang.org/en/v0.8.7/types.html#conversions-between-elementary-types).

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/GatekeeperOneAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/GatekeeperOneAttack.test.js)

> Notice that my solution will work only in the Hardhat environment because the gate key is derived from the address
> you're sending the transaction from.

### 14. Gatekeeper Two

This levels is the same as the previous one but it's a little bit trickier.
Similarly to Gatekeeper One, `gateOne` requires the call to be made from a contract.
But, `gateTwo` now requires the caller to have no code, which kind of contradicts to `gateOne`.
You need to find out [if and when](https://docs.soliditylang.org/en/v0.8.7/contracts.html#creating-contracts) Solidity
smart contract has no code.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/GatekeeperTwoAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/GatekeeperTwoAttack.test.js)

### 15. Naught Coin

This is a simple level where you need to transfer tokens to a different address when `transfer` method is not available.
To solve it, you need to read through [the ERC-20 EIP](https://eips.ethereum.org/EIPS/eip-20) and see if transferring is
still possible.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/NaughtCoinAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/NaughtCoinAttack.test.js)

### 16. Preservation

This is my favorite level and it's mind blowing. I highly recommend you solving this level by yourself.
For that, you'll need to learn about:

1. [delegatecall](https://docs.soliditylang.org/en/v0.8.7/introduction-to-smart-contracts.html#delegatecall-callcode-and-libraries)
1. [Layout of State Variables in Storage](https://docs.soliditylang.org/en/v0.8.7/internals/layout_in_storage.html)

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/PreservationAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/PreservationAttack.test.js)

### 17. Recovery

The correct way of solving this level is to [learn how contract address is generated when contract is deployed](https://docs.soliditylang.org/en/v0.8.7/introduction-to-smart-contracts.html#accounts)
, use Etherscan to find the nonce, and to reconstruct the address.

**My solution:**
This is the only level where I cheated.
I used [Etherscan](https://etherscan.io/) to find the transaction where the level was deployed and the token contract
was created. I then extracted the token contract address from that transaction. 🤷‍♂️

### 18. MagicNumber

This is one of the most interesting levels because you have to go beyond Solidity to solve it.
While level description says you need to write EVM bytecode, there's in fact an easier way – [Yul](https://docs.soliditylang.org/en/v0.8.7/yul.html).

1. Refer to [the ERC-20 example](https://docs.soliditylang.org/en/v0.8.7/yul.html#complete-erc20-example) to figure out
   the minimal structure of the contract and notice that you'll need the deploying part in your tiny contract.
1. Use [solc-select](https://github.com/crytic/solc-select) to install and switch between different versions of Solidity
   compiler.
1. I used this to compile my contract:
   ```shell
   $ solc --strict-assembly --optimize contracts/MagicNumber.yul
   ```
1. Use [sendTransaction](https://web3js.readthedocs.io/en/v1.4.0/web3-eth.html#sendtransaction) to deploy bytecode.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/MagicNumber.yul),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/MagicNumber.test.js)

### 19. Alien Codex

In my opinion, this is the most controversial level because you need to abuse a bug in an older Solidity version.
This level is a pain in the ass. It really hurts. But it's worth it.

In an older version of Solidity (this level uses Solidity 0.5.0) there was a bug that allowed to **change the length
of an array without adding or removing elements**. It literary looked liked `array.length--` or `array.length++`.
The idea of this level is to abuse this bug to overwrite a private state variable (`owner`) that has no public setter.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/AlienCodexAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/AlienCodexAttack.test.js)

### 20. Denial

This levels teaches you how to break some functionality of a contract that makes external calls.
You need to build a contract that, when called, causes a transaction to fail.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/DenialAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/DenialAttack.test.js)

### 21. Shop

This is a tricker version of Elevator. The difference is that the external function that's called has `view` modifier,
which doesn't allow your contract to modify internal state. Also, this levels sets a tight limit of gas available to
you contract.
However, the solution is much more straightforward.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/ShopAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/ShopAttack.test.js)

### 22. Dex

The goal is to hack a decentralized exchange and withdraw its liquidity to your address.
It'll help a lot to learn about the basics of DEXes, for example by [studying how Uniswap works](https://jeiwan.net/posts/programming-defi-uniswap-1/).
After that, it won't be a problem to spot an implementation flaw in the contract.

**My solution:** [smart contract](https://github.com/Jeiwan/ethernaut-solutions/blob/main/contracts/DexAttack.sol),
[test](https://github.com/Jeiwan/ethernaut-solutions/blob/main/test/DexAttack.test.js)

## Conclusions

And that's it! I hope this writeup was helpful and you learned a lot from this game!
