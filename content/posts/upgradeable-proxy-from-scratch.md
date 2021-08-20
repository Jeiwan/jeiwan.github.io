---
title: "Upgradeable proxy contract from scratch"
date: 2021-08-15T00:00:00+00:00
draft: true
tags: ["Ethereum", "Blockchain", "Solidity"]
---

![Proxy](/images/rafal-naczynski-FYzUGU5-9R4-unsplash.jpg)
Photo by
[Rafał Naczyński](https://unsplash.com/@naczynsky?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)
on
[Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)

Immutability gives Ethereum a big benefit: once a smart contract is deployed, there's no way to change it.
This means that smart contract logic won't change over time and it'll remain as reliable as it was from the beginning, e.g. you won't suddenly see a contract doing something no one thought it could do.

However, immutability comes with drawbacks that can be significant in some cases.
For example, due to immutability you won't be able to fix a bug in a contract or upgrade it to optimize gas consumption or to improve existing functionality.
Thus, sometimes, mutability is necessary.

Ditching immutability or making it optional would be a bad solution that would rob Ethereum of one of its core features.
Instead, an elegant and tricky solution was found.

> You can find full code of this blog post [on GitHub](https://github.com/Jeiwan/upgradeable-proxy-from-scratch).

## Proxy smart contracts

**Proxy contract** is a contract that relays all calls to another smart contract, that is called **implementation contract**.
Schematically, this looks like that:

![Proxy contract scheme](/images/proxy-contract-scheme.png#center)

Implementation contract implements some business logic users wants to interact with, but instead of interacting directly with the contract,
they call functions from the proxy contract.
As a result of such chaining, it becomes possible to **swap the implementation contract** with a different one:
proxy contract knows implementation contract address.

Let's write a simple contract and then see how we can use a proxy to call it.
We don't need something complicated, just a basic contract that allows to read and write some state variable:

```solidity
pragma solidity ^0.8.4;

contract Logic {
  uint256 magicNumber;

  constructor() {
    magicNumber = 0x42;
  }

  function setMagicNumber(uint256 newMagicNumber) public {
    magicNumber = newMagicNumber;
  }

  function getMagicNumber() public view returns (uint256) {
    return magicNumber;
  }
}

```

Now, let's build a proxy contract step-by-step:

```solidity
pragma solidity ^0.8.4;

contract Proxy {}

```

What would we begin with?

As you remember, proxy contract knows implementation contract address. Let's add that:

```solidity
contract Proxy {
  address public implementation;

  function setImplementation(address implementation_) public {
    implementation = implementation_;
  }

  function getImplementation() public view returns (address) {
    return implementation;
  }
}

```

That was the easy part. Now, how do we relay all calls to the proxy contract to the logic contract?

Solidity has a special fallback function which is called whenever a function unsupported by a contract is called.
This function is called...`fallback`!
Unfortunately, this is all Solidity can give us here since Solidity is a higher-level abstraction.
To achieve our goal we have to go deeper!

## How contract functions are called

Ethereum transactions contain a field called `data`.
This field is optional and must be empty when sending ethers, but, when interacting with a contract, it must contain something.
It contains **call data**, which is information required to call a specific contract function.
This information includes:

1. Function identifier, which is defined as the first 4 bytes of hashed function signature, e.g.:

   ```solidity
   keccak256("transfer(address,uint256)")
   ```

1. Function arguments that follow function identifier and are encoded according to [the ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html#argument-encoding).

Every smart contract compiled by Solidity has a branching logic that parses call data and decides which function to call depending on function identifier extracted from call data.
Solidity won't allow us to make decisions on that level of deepness, so we'll have to use `assembly` to write relaying logic in [the Yul language](https://docs.soliditylang.org/en/latest/yul.html).

What we want is, in the fallback function, to **get call data and pass it to the implementation contract** as is, without parsing or modifying it.
Here's how to do that:

```solidity
fallback() external {
  assembly {
    let ptr := mload(0x40)
    calldatacopy(ptr, 0, calldatasize())

    let result := delegatecall(
      gas(),
      sload(implementation.slot),
      ptr,
      calldatasize(),
      0,
      0
    )

    let size := returndatasize()
    returndatacopy(ptr, 0, size)

    switch result
    case 0 {
      revert(ptr, size)
    }
    default {
      return(ptr, size)
    }
  }
}

```

Let's break it down because it looks too complicated:

1. First, we need to load call data into memory. We do that in the first two lines:

   ```solidity
   let ptr := mload(0x40)
   calldatacopy(ptr, 0, calldatasize())
   ```

   Memory in EVM is organized in slots, with every slot having an index and occupying 32 bytes.
   We're using `calldatasize` function to get call data size and are using `calldatacopy` to copy call data of specific size to a slot located at index `ptr` (it'll occupy other slots if it doesn't fit).
   `mload` is a function that reads 32 bytes from specified index, and index `0x40` points a special slot that contains
   the index of the next free memory slot.
   So we're basically saving call data to a free memory slot.

1. Next, we relay the call:

   ```solidity
   let result := delegatecall(
       gas(),
       sload(implementation.slot),
       ptr,
       calldatasize(),
       0,
       0
   )

   ```

   `delegatecall` is a tricky way to call another contract, and we'll soon learn why it's tricky.

   First argument in `delegatecall` is how much gas is remaining in the current call – this tells the other contract
   how much of gas it's allowed to spend.

   Next argument is the address of the contract we're calling, and it looks somewhat complicated here.
   `implementation` is a state variable, it's value is stored in memory when the code is executing.
   `.slot` postfix is a feature of Solidity: it allows to easily get the slot address of a state variable.
   Having that address, we're calling `sload` function to read the value at that address.
   We need to do all that because Yul doesn't do anything with state variables, since state variables is syntactic
   sugar of Solidity.

   Last two arguments, which are zeroes, are `out` and `outsize` respectively: they allow to define where in memory to store return data.
   But since we're relaying all calls and we're not aware of what data each call returns, we won't use these variables. Instead...

1. We'll use functions similar to the two call data functions we used earlier:

   ```solidity
   let size := returndatasize()
   returndatacopy(ptr, 0, size)
   ```

   Here, we're getting the size of the data returned by the relayed call and save it in a slot at index `ptr` – we don't need its previous value (call data) anymore.

1. Finally, we're checking if the relayed call was successful and returning; otherwise, we're reverting.
   Notice that we're using the data returned by the relayed call in both of the cases: we want to return what was returned by the call and we want to revert with the same message if the call has reverted.

> In fact, Solidity also has `delegatecall` function, but we're not using it here for a reason: we want the Proxy contract
> to return whatever was returned from the callee and we don't know return data type in advance. Since Solidity is a statically-typed language,
> it requires us to define function return type before compilation.

Let's see if this works! We'll do that by testing.

First, let's set up our tests: we need to deploy both contracts:

```js
describe("Proxy", async () => {
  let owner;
  let proxy, logic;

  beforeEach(async () => {
    [owner] = await ethers.getSigners();

    const Logic = await ethers.getContractFactory("Logic");
    logic = await Logic.deploy();
    await logic.deployed();

    const Proxy = await ethers.getContractFactory("Proxy");
    proxy = await Proxy.deploy();
    await proxy.deployed();

    await proxy.setImplementation(logic.address);
  });

```

Then, let's ensure that implementation contract address was set correctly:

```js
it("points to an implementation contract", async () => {
  expect(await proxy.implementation()).to.eq(logic.address);
});
```

And then, let's ensure that proxying works:

```js
it("proxies calls to implementation contract", async () => {
  abi = [
    "function setMagicNumber(uint256 newMagicNumber) public",
    "function getMagicNumber() public view returns (uint256)",
  ];

  const proxied = new ethers.Contract(proxy.address, abi, owner);

  expect(await proxied.getMagicNumber()).to.eq("0x42");
});
```

[Ethers.js](https://docs.ethers.io/) is quite a helpful library: it parses ABI and generates contract methods in JS to make our life easier.
However, in this situation, this is not what we want.
We want to call our proxy logic using ABI from the implementation contract.
That's why we need to create a different contract instance, using the address of the proxy contract and the ABI of the implementation contract.

Let's run the test:

```plain
1) Proxy
       proxies calls to implementation contract:
     AssertionError: Expected "912823093544680850579175995568783282090442467040" to be equal 0x42
```

Uh-oh! This is not something we expected.

The time has come to learn about the trickiness of `delegatecall`.

## CALL vs DELEGATECALL

Every program consists of two components:

1. State, which is the data that's stored in memory, or in a persistent storage, and that's used by the program.
1. Logic, which is the funcitonality of the program.

Likewise, smart contracts also have state and logic.
Smart contract's persistent state is stored on blockchain and is accessible via state variables.
There's also in-memeory state, but it's not relevant for our discussion.

Both `call` and `delegatecall` are used to call another contract but **they differ in how they handle callee contract's
state**:

1. When using `call`, caller and callee have their own, separated, states. This makes sense and this is what we expect by default.
1. When `delegatecall` is used, **callee uses caller's state**.
   That's it: the contract you're calling with `delegatecall` uses the state of the caller contract.

We could've used `call` instead of `delegatecall` but that'd have broken the upgradeability!

Imagine that we're running a smart contract for long time and there's a lot of data stored on chain but then we decide to upgrade the contract
and deploy a differnet implementation.
That would mean that we would have to migrate all the data from the smart contract to the new implementation!
That can be quite pricey depending on network congesion.
With `delegatecall`, we're storing state in the proxy contract, which allows us to swap implementations **without the need of migrating data**!

Now, let's return to the error in tests.

What has happened? Let's look at state variables of our contracts:

1. In the proxy contract, we're storing implementation contract address in the first state variable:

   ```solidity
   contract Proxy {
       address public implementation;

       ...
   }
   ```

1. In the logic contract, we're storing magic number in the first state variable:

   ```solidity
   contract Logic {
       uint256 magicNumber;

       ...
   }
   ```

As I said earlier, state variables is syntactic sugar in Solidity: they simplify reading and writing to/from memory.
What happens under the hood is:

1. Every state variable has an index that starts from 0. First state variable of a contract has index 0, second one – 1,
   third one – 2, and so on.
1. Every state variable is mapped to a slot in memory. Its value is stored in memory.
1. Slot address is defined as hashed state variable index, literally:
   ```solidity
   keccak256(0)
   ```

And this is what causes the problem: when Logic contract is called via `delegatecall` from Proxy contract,
variable `magicNumber` points at the same memory slot as variable `implementation` in Proxy contract!
Since both of them have the same index 0.
And that big number that we saw in the failed test is the implementation contract address (in the decimal system)!

To better understan the idea, try changing the proxy contract like that and run the tests:

```solidity
contract Proxy {
    uint256 public woot = 0x42;
    address public implementation;

    ...
}

```

> You can learn more about the layout of state variabels [here](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html).

## Resolving the state collision

The collision we saw earlier happened because the `implementation` state variable in Proxy has the same slot index (and, thus, address) as the `magicNumber` state variable.
And since we're using `delegatecall`, Proxy's state is used when Logic is called.

There are [multiple ways](https://blog.openzeppelin.com/proxy-patterns/) of resolving such collisions, I'll show you one of them, the one that's easier to implement and that still provides
a reliable way to avoid collisions.

The idea is to **store the `implementation` variable at a unique address**, such that it's very unlikely that anything else would also use it.
Since addresses are simply `byte32` values, we can use whatever address we want!

So, we need to choose an address to store the `implementation` variable value.
Luckily, there's already a (draft) EIP – [EIP-1967](https://eips.ethereum.org/EIPS/eip-1967) – that proposes a scheme to find such address.
The idea is simple:

```solidity
bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
```

We're hashing the string "eip1967.proxy.implementation" and then subtracting 1 from the hash.
Hashing is needed to define the address in a unique way (it's unlikely someone is using this string for other purposes) and subtraction is needed
to reduce the probability of getting the hash even further.

We have a solution, let's implement it!

## Low-level storage management

As we've already learned, Solidity is a higher level language and it doesn't allow us to do low-level manipulations – we have to use Yul instead.

This time, we'll build a library to help us save an Ethereum address at a custom slot and read it from there –
that's basically it, the library is simple and has only two functions:

```solidity
library StorageSlot {
  function getAddressAt(bytes32 slot) internal view returns (address a) {
    assembly {
      a := sload(slot)
    }
  }

  function setAddressAt(bytes32 slot, address address_) internal {
    assembly {
      sstore(slot, address_)
    }
  }
}

```

`getAddressAt` wraps low-level `sload` function and `setAddressAt` wraps `sstore` function, which allows to read or write data in a specific slot respectively.

Next step, we need to define the slot address:

```solidity
contract Proxy {
    bytes32 private constant _IMPL_SLOT =
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    ...
}

```

Notice that this is a constant so it won't occupy a memory slot – the compiler will replace all its occurrences with
its value. Also, notice that the `implementaiton` state variable has gone now – we won't use it!

Next, rewrite the setter and getter functions:

```solidity
function setImplementation(address implementation_) public {
  StorageSlot.setAddressAt(_IMPL_SLOT, implementation_);

function getImplementation() public view returns (address) {
  return StorageSlot.getAddressAt(_IMPL_SLOT);
}

```

Finally, rework the fallback function to extract Yul code into `_delegate` function so we don't mix Solidity and Yul
in one function:

```solidity
fallback() external {
  _delegate(StorageSlot.getAddressAt(_IMPL_SLOT));
}

```

And slightly rework the `delegatecall` for it to take implementation address as is, without calling `sload`:

```solidity
function _delegate(address impl) internal virtual {
    assembly {
        let ptr := mload(0x40)
        calldatacopy(ptr, 0, calldatasize())

        let result := delegatecall(gas(), impl, ptr, calldatasize(), 0, 0)

        ...
    }
}
```

That's it for the proxy contract! However, if you run the tests you'll see this:

```plain
1) Proxy
       proxies calls to implementation contract:
     AssertionError: Expected "0" to be equal 0x42
```

Why do we get zero?

## Callee contract initialization

We forgot one thing: **we cannot use constructor to initialize callee contract when it's used via a Proxy**.
When constructor is used to initialize state variables, they're initialized within the state of the contract.
But we want them to be initialized within the state of the proxy contract.

There's a simple solution: use a custom initialization function instead of `constructor`.
It looks like that:

```solidity
contract Logic {
    bool initialized;
    uint256 magicNumber;

    function initialize() public {
        require(!initialized, "already initialized");

        magicNumber = 0x42;
        initialized = true;
    }

    ...
}
```

This function must be called after an implementaion contract was set in the proxy contract.
In our tests, it'll look like that:

```js
beforeEach(async () => {
  ...
  await proxy.deployed();

  await proxy.setImplementation(logic.address);

  const abi = ["function initialize() public"];
  const proxied = new ethers.Contract(proxy.address, abi, owner);

  await proxied.initialize();
});

```

If you run the tests now, they will pass.

## Changing implementations

Now, let's add a new version of the logic contract and see if we can upgrade our older implementation.

Copy `Logic.sol`, rename it to `LogicV2`, and add a new function:

```solidity
contract LogicV2 {
    ...

    function doMagic() public {
        magicNumber = magicNumber / 2;
    }
}

```

Everything else remains the same.

Now, let's check if it works.
First, deploy the new contract:

```js
it("allows to change implementations", async () => {
  const LogicV2 = await ethers.getContractFactory("LogicV2");
  logicv2 = await LogicV2.deploy();
  await logicv2.deployed();
```

Then, change implementation in the proxy contract:

```js
await proxy.setImplementation(logicv2.address);
```

Since the logic contract has already been initialized, we don't need to initialize it again.

Next, initialize a proxy contract instance with the ABI from the new implementation:

```js
abi = [
  "function initialize() public",
  "function setMagicNumber(uint256 newMagicNumber) public",
  "function getMagicNumber() public view returns (uint256)",
  "function doMagic() public",
];

const proxied = new ethers.Contract(proxy.address, abi, owner);
```

Finally, do something to ensure version 2 is working correctly:

```js
  await proxied.setMagicNumber(0x33);
  expect(await proxied.getMagicNumber()).to.eq("0x33");

  await proxied.doMagic();
  expect(await proxied.getMagicNumber()).to.eq("0x19");
});
```

Run the tests and see that they pass!

## Conclusion

Studying upgradeable proxy contracts is a good way to start learning about some deeper concepts of EVM, like storage layout, storage management, and contract calls.
If some parts are not clear to you, feel free returning and giving them another try.
They're not as hard as they might look like.
If everything was clear to you, I'd recommend checking out
[the proxy contract implementation by OpenZeppelin](https://docs.openzeppelin.com/contracts/4.x/api/proxy)
– it'll give you a deeper understanding.

## Links

1. [Source code](https://github.com/Jeiwan/upgradeable-proxy-from-scratch)
1. [Yul language documentation](https://docs.soliditylang.org/en/latest/yul.html)
1. [Contract ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html)
1. [Proxy patterns](https://blog.openzeppelin.com/proxy-patterns/), a detailed post in OpenZeppelin Blog about different
   patterns used in proxy contracts.
