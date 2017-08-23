---
title: "Building Blockchain in Go. Part 2: Proof-of-Work"
date: 2017-08-22T12:42:19+07:00
draft: true
---

## Introduction

In [the previous article](https://jeiwan.cc/posts/building-blockchain-in-go-part-1/) we built a very simple data structure, which is the essence of blockchain database. And we made it possible to add blocks to the data structure. Our blockchain implementation lacks one significant feature: adding blocks to the chain is easy and cheap. One of the keystones of blockchain and Bitcoin is that adding new blocks is a hard work. Today we'll fix this flaw.

## Proof-of-Work
A key idea of blockchain is that one has to perform some hard work to put data in it. Without this, adding a block would be as easy as putting a record in a DB, it wouldn't be valuable. Also, it's adding blocks to the chain that produces new coins (rewards). Considering that blockchain is a distributed system with many participants, there should be competition between them to get a reward. This is very similar to a real life situation: one has to work hard to get decent reward.

Since blockchain is a digital system, there's no one to control the hard work, no one to judge how hard a participant of the network struggled to get a reward. There's no boss. Instead, cryptography is used. Blockchain utilizes certain cryptography algorithms, which require some time to calculate things, as a proof of work.

[TELL ABOUT MINING]
[EASY TO VERIFY]

## Hashing
In this paragraph we'll discuss hashing. If you're familiar with the concept, you can skip this part.

Hashing is a process of obtaining a hash for specified data. A hash function is a function that takes data of arbitrary size and produces a fixed size hash. Here are some key features of the hash:


[ADD HASHING EXAMPLES]

1. You cannot restore original data from it. Thus, hashing is not encryption.
2. Certain data can have only one hash.
3. Changing even one byte in the input data will result in a completely different hash.

Hashing functions are widely used to check consistency of data. Some software providers publish checksums in addition to archives. After downloading an archive you can feed it to a hash function and compare produced hash with the one provided by the software developer.

As to blockchain, considering mining is a competition, the one who wins the competition must provide a proof. The proof is a hash. Mining actually means a hash of block data, that complies with certain requirements. Let's discuss these requirements.

## Hashcash

Bitcoin uses [Hashcash](https://en.wikipedia.org/wiki/Hashcash), a Proof-of-Work algorithm that was initially developed to prevent email spam. Its algorithm can be explained in the following steps:

1. Take some publicly known data (in the case of email, it's receiver's email address).
2. Add a counter to it. The counter starts at 0.
3. Get a hash of the `data+counter` combination.
4. Check that hash complies to some requirement.
	1. If it does, you're done.
	2. If it doesn't, increase the counter and repeat the steps 3 and 4.


It's worth noting that this is a brute force algorithm: you change the counter, calculate new hash, check it, increment the counter, calculate the hash, etc. That's why it's computationally expensive.

Now let's look closer at the requirement. In the original Hashcash implementation, the requirement is that the first 20 bits of a hash are all zeros. In Bitcoin, the requirement is adjusted from time to time. This is done so, because, by the design of Bitcoin, blocks must be generated every 10 minute, despite computation power increasing with time and more and more miners joining the network.

(btw, the requirement is also called "difficulty", or "target")

## Implementation
Ok, we're done with the theory, let's write code! First, let's define the difficulty of mining:

```go
const targetBits = 24 // 3 bytes
```
In Bitcoin, "target bits" is a block header storing the difficulty at which the block was mined. We won't implement the target adjusting algorithm for now, so we can just define the difficulty as a constant. 24 bits equal to 3 bytes, which means that we want the PoW hashes to start with 3 zero bytes. Don't miss the chance of changing this number after finishing the article!

```go
type ProofOfWork struct {
	block  *Block
	target *big.Int
}

func NewProofOfWork(b *Block) *ProofOfWork {
	target := big.NewInt(1)
	target.Lsh(target, uint(256-targetBits))

	pow := &ProofOfWork{b, target}

	return pow
}
```

Here we've created `ProofOfWork` structure that holds a pointer to a block and a pointer to a target. "target" is another name of the requirement described in the previous paragraph. We use a [big](https://golang.org/pkg/math/big/) integer because of the way we'll use to compare a hash to a requirement: we'll convert a hash to a big integer and check if it's less than the target.

In the `NewProofOfWork` function, we initialize a `big.Int` with the value of 1 and shift it left by `256-targetBits` bits. `256` bits is the length of a SHA-256 hashes, which we'll use later. The goal is to have a number "shorter" by `targetBits` bits from the left. The hexademical representation of `target` is:

```
0000001000000000000000000000000000000000000000000000000000000000
```

Now, we need some data to apply the hashing function to. Let's build it:

```go
func (pow *ProofOfWork) prepareData(nonce int) []byte {
	data := bytes.Join(
		[][]byte{
			pow.block.PrevBlockHash,
			pow.block.Data,
			IntToHex(pow.block.Timestamp),
			IntToHex(int64(targetBits)),
			IntToHex(int64(nonce)),
		},
		[]byte{},
	)

	return data
}
```
This piece is straightforward: we're just concatenate arrays of bytes. `nonce` here is the counter from the Hashcash description, this is a cryptographic term.

The `IntToHex` function is also simple:

```go
func IntToHex(num int64) []byte {
	buff := new(bytes.Buffer)
	err := binary.Write(buff, binary.BigEndian, num)
	if err != nil {
		log.Panic(err)
	}

	return buff.Bytes()
}
```
It's needed because we want to store integers (`targetBits` and `nonce`) as hex values.

Ok, all preparations are done, let's implement the core of the PoW algorithm:

```go
func (pow *ProofOfWork) Run() (int, []byte) {
	var hashInt big.Int
	var hash [32]byte
	nonce := 0

	fmt.Printf("Mining the block containing \"%s\"\n", pow.block.Data)
	for nonce < maxNonce {
		data := pow.prepareData(nonce)

		hash = sha256.Sum256(data)
		fmt.Printf("\r%x", hash)
		hashInt.SetBytes(hash[:])

		if hashInt.Cmp(pow.target) == -1 {
			break
		} else {
			nonce++
		}
	}
	fmt.Print("\n\n")

	return nonce, hash[:]
}
```

First, we initialize variables: `hashInt` is the integer representation of `hash`; `nonce` is the counter. Next, we run an "infinite" loop: it's limited by `maxNonce`, which equals to `math.MaxInt64`; this is done to avoid a possible overflow of `nonce`. Although, the difficulty of our PoW implementation is low for the counter to overflow, I still decided to have this check, just in case.

In the loop we:

1. Prepare data.
2. Hash it with SHA-256.
3. Convert the hash to a big integer.
4. Compare the integer with the target.

As easy as it was explained earlier. Now we can remove the `SetHash` method of `Block` and modify the `NewBlock` function:

```go
func NewBlock(data string, prevBlockHash []byte) *Block {
	block := &Block{time.Now().Unix(), []byte(data), prevBlockHash, []byte{}, 0}
	pow := NewProofOfWork(block)
	nonce, hash := pow.Run()

	block.Hash = hash[:]
	block.Nonce = nonce

	return block
}
```
Here you can see that we also save `nonce` in the `Block`. This is necessary because `nonce` is required to confirm that the proof is correct. The `Block` structure now looks so:

```go
type Block struct {
	Timestamp     int64
	Data          []byte
	PrevBlockHash []byte
	Hash          []byte
	Nonce         int
}
```

Alright! Let's run the program to see if everything works fine:

```
Mining the block containing "Genesis Block"
00000041662c5fc2883535dc19ba8a33ac993b535da9899e593ff98e1eda56a1

Mining the block containing "Send 1 BTC to Ivan"
00000077a856e697c69833d9effb6bdad54c730a98d674f73c0b30020cc82804

Mining the block containing "Send 2 more BTC to Ivan"
000000b33185e927c9a989cc7d5aaaed739c56dad9fd9361dea558b9bfaf5fbe

Prev. hash:
Data: Genesis Block
Hash: 00000041662c5fc2883535dc19ba8a33ac993b535da9899e593ff98e1eda56a1

Prev. hash: 00000041662c5fc2883535dc19ba8a33ac993b535da9899e593ff98e1eda56a1
Data: Send 1 BTC to Ivan
Hash: 00000077a856e697c69833d9effb6bdad54c730a98d674f73c0b30020cc82804

Prev. hash: 00000077a856e697c69833d9effb6bdad54c730a98d674f73c0b30020cc82804
Data: Send 2 more BTC to Ivan
Hash: 000000b33185e927c9a989cc7d5aaaed739c56dad9fd9361dea558b9bfaf5fbe
```

Yay! You can see that every hash now starts with three zero bytes, and it takes some time to get these hashes.


There's one more thing left to do: let's make it possible to validate proof-of-works.

```go
func (pow *ProofOfWork) ValidateProof() bool {
	var hashInt big.Int

	data := pow.prepareData(pow.block.Nonce)
	hash := sha256.Sum256(data)
	hashInt.SetBytes(hash[:])

	confirmation := hashInt.Cmp(pow.target) == -1

	return confirmation
}
```
And this is where why we saved `nonce` in `Block`.

## Conclusion