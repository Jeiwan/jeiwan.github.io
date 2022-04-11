---
title: "Evaluating DeFi Strategies Using Foundry"
date: 2022-04-11T00:00:00+00:00
tags: ["Blockchain", "Ethereum", "DeFi", "Solidity", "Foundry"]
---

![Plan, make](/images/brett-jordan-cBY2CtqQ6YI-unsplash.jpg)
Photo by
[Brett Jordan](https://unsplash.com/@brett_jordan?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on [Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

## Introduction

Nowadays, the ecosystem of Ethereum is quite rich and complex. There are multitudes of DeFi applications: decentralized
exchanges, staking protocols, money markets, yield farming vaults, derivatives, leverages, etc. As DeFi protocol evolve,
they become more and more intertwined, allowing for new complex strategies.

In this article, I'll show you how to program a custom DeFi strategy that interacts with several DeFi platforms to produce
**a leveraged position that earns passive income**. Moreover, we'll run it against the Ethereum mainnet without deploying
and paying for gas–this will allow us to validate the strategy before deploying it.

> The approach I'm going to show requires programming skills and the knowledge of the Solidity programming language. If
you're not a programmer or you prefer a shorter path, there's a user-friendly service that allows to build an exact same
strategy–[DeFi Saver](https://app.defisaver.com/). Also, [Instadapp](https://instadapp.io) provide a 1-click solution for the same
strategy.

Let's begin!

## Case study
In the strategy that we're going to implement, we'll try to earn passive income on staking ETH. Moreover, we'll try to
maximize our profit by taking a flash loan.

You're probably aware that Ethereum is in the process of migrating from Proof-of-Work to Proof-of-Stake. Without going
into details, PoS replaces miners by block validators and frees them from solving the PoW puzzle. To become a validator,
one has to stake 32 ETH–an amount that's not affordable to everyone these days. As a reward for blocks production,
validators get a share of ETH emission.

[Lido](https://lido.fi/) is a service that makes Ethereum PoS staking available to anyone: with Lido, anyone who has
ETH can stake it and start getting reward (around 4% APR at the moment of writing). In exchange for ETH, Lido gives you
stETH, which is a rebase token–that is, a token that has its supply changed overtime.

In February 2022, [Aave](https://aave.com) added stETH as an asset and allowed to use it as collateral. This means that
we can stake our ETH in Lido and then deposit stETH into Aave to get a loan and use that loan somewhere else. And we'll
still keep receiving the reward from Lido. Nice!

And the final piece in our strategy is [Balancer](https://balancer.fi/), which is a decentralized exchange. But we'll
use it to take a flash loan–a loan that must be returned in the same transaction.

Let's see how all these elements play together.

## The strategy
1. Take some ETH via a flash loan.
1. Stake our ETH + the flash loaned ETH in Lido. Lido gives us stETH in exchange.
1. Stake the stETH in Aave.
1. Borrow enough ETH from Aave to repay the flash loan.

We'll end up having more stETH deposited in Aave, which means higher profit! But since around 2/3 ETH in this amount are
loaned, there's a risk of liquidation.

Aave borrowings must be collateralized up to a specific collateral factor. To
maximize our profit, we'll take all available ETH. Since stETH (our collateral) and ETH (what we borrow) are correlated
assets (stETH is issued 1-to-1 to staked ETH), the risk of stETH losing correlation with ETH is low. But this is still
a risk and this is our biggest one.

Another fact worth noting: we'll pay an interest on the borrowed amount. The rate is as low as 0.23% APY at the moment
of writing and it might grow higher if there's a high demand for ETH on Aave.

## Tools
To implement the strategy, we'll write a smart contract in Solidity. Hardcore! But this gives us full control over the
process.

We'll use [Foundry](https://github.com/gakonst/foundry), which is a fantastic modern toolkit for Ethereum smart contracts
development. We'll use Forge to build, test, and validate our strategy.

Let's write a contract! 

## Strategy contract
Initialize a new project and create Strategy contract:
```shell
$ mkdir defi-strategy
$ cd defi-strategy
$ forge init
```

Create `Strategy.sol`:
```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

contract Strategy {
    error NotOwner();

    uint256 constant funds = 1 ether;
    uint256 constant flashLoanFunds = (funds * 230) / 100;

    address constant aaveAddress = 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9;
    address constant balancerAddress =
        0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant lidoAddress = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant stethAddress = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant wethAddress = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    address private immutable owner;

    constructor() public {
        owner = msg.sender;
    }

    function go() public payable {
        if (msg.sender != owner) revert NotOwner();

        ...
    }
}
```
`1 ether` is our own funds that we'll stake in Lido and deposit in
Aave. `flashLoanFunds` is the amount that we want to take as a flash loan, it equals to x2.3 of our own
funds. This multiplier is calculated as 0.7/0.3, where 0.7 is the collateral factor of stETH on Aave, and
0.3 is 1 minus the collateral factor.
Correctly calculating this amount is important: it's also this amount that we'll later borrow from Aave to
repay the flash loan, and it's this amount that we'll owe Aave in the end.

> I rounded the number down a little since stETH price in ETH was slightly below 1 and Aave didn't allow to
loan 2.33 ETH.

We're also setting addresses of all the DeFi services that we're going to use. Since we'll only use this
strategy on mainnet, the addresses can be hardcoded as constants.

As the first step, we want to take a flash loan, we'll do this by calling `flashLoan` method in the Balancer
contract:
```solidity
import {IBalancer} from "./interfaces.sol";

...

function go() public payable {
    if (msg.sender != owner) revert NotOwner();

    address[] memory tokens = new address[](1);
    tokens[0] = wethAddress;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = flashLoanFunds;

    IBalancer(balancerAddress).flashLoan(
        address(this),
        tokens,
        amounts,
        ""
    );
}
```
First parameter of `flashLoan` is the address that will receive funds–we're receiving them on the contract.
Next parameter is a list of tokens (only WETH in our case) and loan amounts (`flashLoanFunds`).

When we're calling `flashLoan`, Balancer sends required amounts to the receiver address and calls a special
method on that address. This means that **flash loans can be taken and used only by smart contracts**!

Our contract needs to implement a special function that will be called by the Balancer contract after it has
sent tokens. It's this function where we'll implement the rest of the strategy. And it's this function that
will need to returned the loaned amounts.

In the case of Balancer, the function is called `receiveFlashLoan`:
```solidity
function receiveFlashLoan(
    IERC20[] memory tokens,
    uint256[] memory amounts,
    uint256[] memory feeAmounts,
    bytes memory userData
) public {
    if (msg.sender != balancerAddress) revert NotBalancer();

    ...
```
When the function is called by Balancer, the loan already deposited to our contract's address.

`tokens` and `amounts` are the same parameters that we passed to `flashLoan`. `feeAmounts` are fees that we
need to pay for taking the loan–ETH loans on Balancer are free at the moment.

Notice that the function is public, which makes it callable by other contract (the Balancer one), but we want
to let only the Balancer contract call it.

We can now proceed with the strategy. The next step is to stake our ETH + loaned ETH in Lido. However, what we
loaned is WETH, an ERC20-token representing ETH, but Lido requires ETH, not WETH. We need to unwrap the loaned
tokens:
```solidity
IERC20 loanToken = tokens[0];
uint256 loanAmount = amounts[0];

// Unwrap WETH
IWETH(wethAddress).withdraw(loanAmount);
```
The WETH contract is also responsible for ETH↔WETH conversion. To unwrap WETH (convert WETH to ETH) we need to
call `withdraw`.

We're now ready to stake ETH in Lido:
```solidity
// Stake ETH
ILido(lidoAddress).submit{value: funds + flashLoanFunds}(address(0x0));
uint256 stethBalance = IERC20(stethAddress).balanceOf(address(this));
```
To stake ETH, we're calling `submit` in the Lido contract and sending all our ETH along the call. The only
parameter of the function is a referral address, we can simply set it to zero.

Now, we can deposit our stETH on Aave:
```solidity
// Deposit stETH
IERC20(stethAddress).approve(aaveAddress, stethBalance);
IAAVE(aaveAddress).deposit(stethAddress, stethBalance, owner, 0);
```
We first need to let Aave take our stETH–we're doing this by calling `approve` (Aave calls ERC20's
`transferFrom` to pull user funds). Then, we're calling `deposit` to actually deposit funds. This is a general
function that works with all the Aave markets. As parameters, we're passing the address of stETH token, the
amount we want to deposit, and the address on behalf of which we're making the deposit.

Next step: borrow from Aave to repay the flash loan.
```solidity
// Borrow ETH
IAAVE(aaveAddress).borrow(wethAddress, loanAmount, 2, 0, owner);
```
We're borrowing WETH to repay the flash loan we took in the very beginning. The third parameter to the
function is interest rate mode. Aave supports variable and stable borrow interests, with stable often being
significantly higher. We're passing `2` here, which means the variable rate.

The last parameter is the address on behalf of which we'll take the loan. We set it to `owner`, which means
`owner` will have to allow the contract to take the loan on its behalf–we'll do this in the test.

And the final step, flash loan repaying.
```solidity
// Repay flash loan
loanToken.transfer(balancerAddress, loanAmount);
```
We're simply transferring the loaned amount of WETH to the Balancer contract address. After this function
(`receiveFlashLoan`) has finished executing, the control will return to the `flashLoan` function from the
Balancer contract. Balancer will then check that the flash loan was repaid. If it's not repaid, the
transaction will be reverted.

That's it! Our strategy is finished!

## Evaluating the strategy
To evaluate the strategy we'll write a test, in Solidity. The test will simulate deployment and execution of
the strategy. We'll then use Forge to **run the test against the Ethereum mainnet**! This will allow us to
ensure that we called all the contracts correctly and that our calculations were also correct. In the test,
we'll also get our collateral and debt information from Aave and will check the LTV and health factor.

Let's set up the test:
```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

import "ds-test/test.sol";
import {Strategy} from "../Strategy.sol";
import {IAAVE, IERC20, VariableDebtToken} from "../interfaces.sol";

contract StrategyTest is DSTest {
    address constant aaveAddress = 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9;
    address constant variableDebtWethAddress =
        0xF63B34710400CAd3e044cFfDcAb00a0f32E33eCf;

    Strategy s;

    function setUp() public {
        s = new Strategy();
    }

    ...
```
We basically only need to deploy the strategy contract during setup.

And now let's evaluate the strategy:
```solidity
function testGo() public {
    VariableDebtToken(variableDebtWethAddress).approveDelegation(
        address(s),
        2.3 ether
    );
    ...
```
The strategy contract takes a loan on Aave on behalf of the contract owner–this means that the owner needs
to allow the strategy contract to do that. For every asset supported by Aave, Aave has two special tokens
deployed: `StableDebtToken` and `VariableDebtToken`. They are used to track users' borrowed positions with
corresponding interest rate mode. They're in fact tokenized borrows. And they also allow to delegate
borrowing: `approveDelegation` function allows a delegatee to borrow assets from Aave on behalf of delegator.
This is what we're doing here: we're letting the strategy contract borrow on behalf of the test contract.

Then we're running the strategy:
```solidity
s.go{value: 1 ether}();
```

And validating its result by fetching user account data from Aave:
```solidity
(
    uint256 totalCollateralETH,
    uint256 totalDebtETH,
    uint256 availableBorrowsETH,
    uint256 currentLiquidationThreshold,
    uint256 ltv,
    uint256 healthFactor
) = IAAVE(aaveAddress).getUserAccountData(address(this));

assertEq(
    totalCollateralETH,
    3.298112774422300227 ether,
    "invalid total collateral"
);
assertEq(totalDebtETH, 2.3 ether, "invalid total debt");
assertEq(
    availableBorrowsETH,
    0.008678942095610159 ether,
    "invalid available borrows ETH"
);
assertEq(
    currentLiquidationThreshold,
    7500,
    "invalud current liquidation threshold"
);
assertEq(ltv, 7000, "invalid LTV");
assertEq(
    healthFactor,
    1.07547155687683703 ether,
    "invalid health factor"
);
```
1. Total value of our collateral is 3.2981 ETH. Since stETH trades slightly lower than 1 ETH, the value of our
collateral turns out to be slightly lower than 3.3 ETH (we deposited 1 stETH + 2.3 stETH).
1. Our total debt is 2.3 ETH–this is the amount we borrowed from Aave to repay the flash loan.
1. 0.00867 ETH is still available for us to borrow, which means the multiplier we calculated in the very
beginning was correct. We can still reduce it to lower the risk of liquidation.
1. [Current liquidation threshold](https://docs.aave.com/risk/asset-risk/risk-parameters#liquidation-threshold) is 75%, which means that our position will be liquidated when `totalDebtETH`/
`totalCollateralETH` >= 75%. The debt/collateral ratio of our position is ~70%, which means there's some room
for price movement.
1. [Loan-to-Value (LTV)](https://docs.aave.com/risk/asset-risk/risk-parameters#loan-to-value) is 70%, which means stETH, as a collateral, allows to borrow up to 70% of its value in
ETH.
1. [Health factor](https://docs.aave.com/faq/borrowing#what-is-the-health-factor) is 1.07. Which means that
our position is close to liquidation. As I said above, since stETH and ETH are correlated assets, price
fluctuations are not likely and the risk of liquidation is low. But it still exists 😉

Now, you want to ask: "But how did you get all these numbers?" I ran the test against the Ethereum mainnet.
Here's how to do this.

First, you need an Ethereum node. If you're not running a local one, you can use [Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/). You need to get an HTTP node URL.

Next, you need to run this command:
```shell
$ forge test --fork-url=$NODE_URL
```
`--fork-url` enables the fork mode, in which Forge runs as a proxy that passes all RPC API calls to the
specified `NODE_URL`. This means that **everything that we do in the test is executed against the Ethereum
mainnet**. Of course, it doesn't execute transactions in the mainnet: transactions are still executed in the
local test network.

The fork mode is a great emulation environment that allows to interact with the Ethereum mainnet without
paying for gas.

That's it! I hope you learned something new. Next time I'll show how to run such strategy without writing and
deploying a strategy contract. Stay tuned!