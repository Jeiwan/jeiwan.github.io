---
title: "Building Blockchain In Go: Basic Layout"
date: 2017-08-16T12:29:11+07:00
draft: true
---

## Introduction
Blockchain is one of the most revolutionary technology of the 21 century, which is still maturing and which potential is not fully realized yet. In its essence, blockchain is just a database of records. But what makes it unique is that it's not a private database, but a public one, i.e. everyone who uses it has to have a copy of it. And a new record can be added only with a consent of other keepers of the database. Also, it's blockchain that made cryptocurrencies and smart contracts possible.

In this series of articles we'll build a simplified cryptocurrency that's based on a simple blockchain implementation.

## Block
Let's start with the block. In blockchain it's blocks that store valuable information. For example, in Bitcoin blocks store transactions, the essence of any cryptocurrency. Besides this, a block contains some technical information, like its version, current timestamp and the hash of the previous block.  
In this article we're not going to implement the block as it's described in blockchain or Bitcoin specifications, instead we'll use a simplified version of it, which contains only significant information. Here's what it looks like:

```go
type Block struct {
	Timestamp int64
	Data      []byte
	PrevBlock []byte
	Hash      []byte
}
```
`Timestamp` is the current timestamp (when the block is created), `Data` is the actual valuable information containing in the block, `PrevBlock` stores the hash of the previous block, and `Hash` is the hash of the block. In Bitcoint specification `Timestamp`, `PrevBlock`, and `Hash` are block headers, which form a separate data structure, and transactions (`Data` in our case) is a separate data structure. So we're mixing them here for simplicity.

So how do we calculate the hashes? Bitcoin uses the following scheme to hash a block: `SHA256(SHA256(Block_Headers))` Where `Block_Headers` is concatenated values of the block headers. In our implementation we'll apply `SHA256` only once and will use concatenated `PrevBlock` + `Data` + `Timestamp` combination as the hashed string.

Let's implement `SetHash` method that'll calculate the hash and set it:

```go
func (b *Block) SetHash() {
	timestamp := []byte(strconv.FormatInt(b.Timestamp, 10))
	headers := bytes.Join([][]byte{b.PrevBlock, b.Data, timestamp}, []byte{})
	hash := sha256.Sum256(headers)

	b.Hash = hash[:]
}
```

Next, following a Golang convention, we'll implement a function that'll simplify creation of a block:

```go
func NewBlock(data string, prevBlock []byte) *Block {
	block := &Block{time.Now().Unix(), []byte(data), prevBlock, []byte{}}
	block.SetHash()
	return block
}
```

And that's it for the block!

## Blockchain

Now let's implement the blockchain. In its essence blockchain is a database where blocks are stored. One requirement to this database is that it must be ordered: we want to effectively get the latest block hash. Another requirement is that it must allow to quickly get a block by its hash. We're not going to use an external database and will just use standard Golang data structures. The ideal one would've been ordered map, but there's no such data structure in Go. So, we'll keep blocks in an array and ignore the "quickly take latest block hash" requirement:

```go
type Blockchain struct {
	blocks []*Block
}
```
We can also use two data structures: a map that keeps `hash: block` key-value pairs, and an array that keeps hashes in their insertion order. But this would've been too complex for our simple use case.

Ok, we have a blockchain. Now let's make it possible to add blocks to it:

```go
func (bc *Blockchain) AddBlock(data string) {
	prevBlock := bc.blocks[len(bc.blocks)-1]
	newBlock := NewBlock(data, prevBlock.Hash)
	bc.blocks = append(bc.blocks, newBlock)
}
```

That's it! Or isn't?

To add a new block we need an existing block (thus, the "chain" in blockchain), but there're not blocks in our blockchain! So, in any blockchain, there must be at least one block, and such block, the first in the chain, is called **genesis block**. Let's implement a method that creates such a block:

```go
func NewGenesisBlock() *Block {
	return NewBlock("Genesis Block", []byte{})
}
```

Now, we can implement a function that creates a blockchain with the genesis block:

```go
func NewBlockchain() *Blockchain {
	return &Blockchain{[]*Block{NewGenesisBlock()}}
}
```

## Conclusion

Let's check that the blockchain works correctly:

```go
func main() {
	bc := NewBlockchain()

	bc.AddBlock("Send 1 BTC to Ivan")
	bc.AddBlock("Send 2 more BTC to Ivan")

	for _, block := range bc.blocks {
		fmt.Printf("Prev. hash: %x\n", block.PrevBlock)
		fmt.Printf("Data: %s\n", block.Data)
		fmt.Printf("Hash: %x\n", block.Hash)
		fmt.Println()
	}
}
```

Output:

```
Prev. hash:
Data: Genesis Block
Hash: aff955a50dc6cd2abfe81b8849eab15f99ed1dc333d38487024223b5fe0f1168

Prev. hash: aff955a50dc6cd2abfe81b8849eab15f99ed1dc333d38487024223b5fe0f1168
Data: Send 1 BTC to Ivan
Hash: d75ce22a840abb9b4e8fc3b60767c4ba3f46a0432d3ea15b71aef9fde6a314e1

Prev. hash: d75ce22a840abb9b4e8fc3b60767c4ba3f46a0432d3ea15b71aef9fde6a314e1
Data: Send 2 more BTC to Ivan
Hash: 561237522bb7fcfbccbc6fe0e98bbbde7427ffe01c6fb223f7562288ca2295d1
```

That's it!


---

Full source codes: [https://github.com/Jeiwan/blockchain_go/tree/part_1](https://github.com/Jeiwan/blockchain_go/tree/part_1)

Block hashing algorithm: [https://en.bitcoin.it/wiki/Block_hashing_algorithm](https://en.bitcoin.it/wiki/Block_hashing_algorithm)