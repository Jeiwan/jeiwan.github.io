---
title: "Building Blockchain in Go. Part 6: Transactions 2"
tags: [Golang, Blockchain, Bitcoin]
date: 2017-09-18T13:02:26+07:00
draft: true
---

## Introduction
In the very first part of this series I said that blockchain is a distributed database. Back then, we decided to skip the "distributed" part and focus on the "database" part. So far, we've implemented almost all the things that make a blockchain database. In this post, we'll cover some mechanisms that were skipped in previous parts, and in the next part we'll start implementing the "distributed" nature of blockchain.

Previous parts:

1. [Basic Prototype](https://jeiwan.cc/posts/building-blockchain-in-go-part-1/)
2. [Proof-of-Work](https://jeiwan.cc/posts/building-blockchain-in-go-part-2/)
3. [Persistence and CLI](https://jeiwan.cc/posts/building-blockchain-in-go-part-3/)
4. [Transactions 1](https://jeiwan.cc/posts/building-blockchain-in-go-part-4/)
5. [Addresses](https://jeiwan.cc/posts/building-blockchain-in-go-part-5/)


## Reward
One tiny thing we skipped in a previous article is the reward for mining blocks. And we already have everything to implement it.

Reward is just a coinbase transaction. When a mining node starts mining a new block, it takes transactions from the queue and prepends a coinbase transaction to them. The coinbase transaction's only output contains miner's public key hash.

Implementing rewards is as easy as updating the `send` command:

```go
func (cli *CLI) send(from, to string, amount int) {
	...
	bc := NewBlockchain()
	UTXOSet := UTXOSet{bc}
	defer bc.db.Close()

	tx := NewUTXOTransaction(from, to, amount, &UTXOSet)
	cbTx := NewCoinbaseTX(from, "")
	txs := []*Transaction{cbTx, tx}

	newBlock := bc.MineBlock(txs)
	fmt.Println("Success!")
}
```
In our implementation, the one who creates a transaction, mines the new block, and thus, receives a reward.

## The UTXO Set
In [Part 3: Persistence and CLI](https://jeiwan.cc/posts/building-blockchain-in-go-part-3/) we reviewed the way Bitcoin Core stores blocks in a database. It was said blocks are stored in `blocks` database and transaction outputs are stored in `chainstate` database. Let me remind you what the structure of `chainstate` is:

1. `'c' + 32-byte transaction hash -> unspent transaction output record for that transaction`
2. `'B' -> 32-byte block hash: the block hash up to which the database represents the unspent transaction outputs`

Since that article we've already implemented transactions, but we haven't used the `chainstate` to store their outputs. So, this is what we're going to do now.

The database stores, what is called, the UTXO set, or the set of unspent transaction outputs. What is it needed for?

Consider the `Blockchain.FindUnspentTransactions` method we've implemented:

```go
func (bc *Blockchain) FindUnspentTransactions(pubKeyHash []byte) []Transaction {
	...
	bci := bc.Iterator()

	for {
		block := bci.Next()

		for _, tx := range block.Transactions {
			...
		}

		if len(block.PrevBlockHash) == 0 {
			break
		}
	}
	...
}
```
The function finds transactions with unspent outputs. Since transactions are stored in blocks, it iterates over each block in the blockchain and checks transactions containing in them. As of September 18, 2017, there're 485,860 blocks in Bitcoin and the whole database takes 140+ Gb of disk space. Iterating all the blocks takes dozens of hours! This means that the same amount of time is required to get the balance of a single address. Very inefficient!

The solution to the problem is to have an index that stores only unspent outputs, and this is what the UTXO set does: this is a cache that is built from all blockchain transactions (via iteration over blocks, yes, but this is done only once), and is later used to calculate balance and validate new transactions. The set also makes wallet nodes possible: there's no need to download the whole Bitcoin database if you're using Bitcoin just as a payment system. Instead, only the UTXO set is to be downloaded (which is about 2.7 Gb as of September 2017).

Alright, let's think what we need to change to implement the UTXO set. Currently, the following methods are used to find transactions:

1. `Blockchain.FindUnspentTransactions` – the main function that finds transactions with unspent outputs. It's this function where iteration of all blocks happens.
2. `Blockchain.FindSpendableOutputs` – this function is used when a new transaction is created. If finds minimal number of outputs that can be used to send the required amount of coins. Uses `Blockchain.FindUnspentTransactions`.
3. `Blockchain.FindUTXO` – finds unspent outputs for a public key hash, used to get balance. Uses `Blockchain.FindUnspentTransactions`.
4. `Blockchain.FindTransaction` – finds a transaction in the blockchain by its ID. Iterates over all blocks until finds it.

As you can see, all the methods iterate over blocks in the database. But we cannot improve all of them for now, because the UTXO set doesn't store all transactions, but only those that have unspent outputs. Thus, it cannot be used in `Blockchain.FindTransaction`.

So, we want the following methods:

1. `Blockchain.FindUTXO` – finds all unspent outputs by iterating over blocks.
2. `UTXOSet.Reindex` —  uses `FindUTXO` to find unspent outputs, and stores them in a database. This is where caching happens.
3. `UTXOSet.FindSpendableOutputs` – analogue of `Blockchain.FindSpendableOutputs`, but uses the UTXO set.
4. `UTXOSet.FindUTXO` – analogue of `Blockchain.FindUTXO`, but uses the UTXO set.
5. `Blockchain.FindTransaction` remains the same.

Thus, the two most frequently used functions will use the cache from now on! Let's start coding!

```go
type UTXOSet struct {
	Blockchain *Blockchain
}
```
We'll use single database, but will use a different bucket for the UTXO set. Thus, we `UTXOSet` to be coupled with `Blockchain`.

```go
func (u UTXOSet) Reindex() {
	db := u.Blockchain.db
	bucketName := []byte(utxoBucket)

	err := db.Update(func(tx *bolt.Tx) error {
		err := tx.DeleteBucket(bucketName)

		_, err = tx.CreateBucket(bucketName)
	})

	UTXO := u.Blockchain.FindUTXO()

	err = db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketName)

		for txID, outs := range UTXO {
			key, err := hex.DecodeString(txID)

			err = b.Put(key, outs.Serialize())
		}
	})
}
```
This method initially creates the UTXO set. First, it removes the bucket if it exists, then it get all unspent outputs from blockchain, and finally it saves the outputs to the bucket.

`Blockchain.FindUTXO` is almost identical to `Blockchain.FindUnspentTransactions`, but now it returns a map of `TransactionID → TransactionOutputs` pairs.

Now, the UTXO set can be used to send coins:

```go
func (u UTXOSet) FindSpendableOutputs(pubkeyHash []byte, amount int) (int, map[string][]int) {
	unspentOutputs := make(map[string][]int)
	accumulated := 0
	db := u.Blockchain.db

	err := db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(utxoBucket))
		c := b.Cursor()

		for k, v := c.First(); k != nil; k, v = c.Next() {
			txID := hex.EncodeToString(k)
			outs := DeserializeOutputs(v)

			for outIdx, out := range outs.Outputs {
				if out.IsLockedWithKey(pubkeyHash) && accumulated < amount {
					accumulated += out.Value
					unspentOutputs[txID] = append(unspentOutputs[txID], outIdx)
				}
			}
		}
	})

	return accumulated, unspentOutputs
}
```

Or check balance:

```go
func (u UTXOSet) FindUTXO(pubKeyHash []byte) []TXOutput {
	var UTXOs []TXOutput
	db := u.Blockchain.db

	err := db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(utxoBucket))
		c := b.Cursor()

		for k, v := c.First(); k != nil; k, v = c.Next() {
			outs := DeserializeOutputs(v)

			for _, out := range outs.Outputs {
				if out.IsLockedWithKey(pubKeyHash) {
					UTXOs = append(UTXOs, out)
				}
			}
		}

		return nil
	})

	return UTXOs
}
```
These are slightly modified versions of corresponding `Blockchain` methods. Those `Blockchain` methods are not needed anymore.

Having the UTXO set means that our data (transactions) are now split into to storages: actual transactions are stored in the blockchain, and unspent outputs are stored in the UTXO set. Such separation requires solid synchronization mechanism, because we want the UTXO set to always be updated and store outputs of most recent transactions. But we don't want to reindex every time a new block is mined, because it is frequent blockchain scanning that we want to avoid. Thus, we need an updating mechanism:

```go
func (u UTXOSet) Update(block *Block) {
	db := u.Blockchain.db

	err := db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(utxoBucket))

		for _, tx := range block.Transactions {
			if tx.IsCoinbase() == false {
				for _, vin := range tx.Vin {
					updatedOuts := TXOutputs{}
					outsBytes := b.Get(vin.Txid)
					outs := DeserializeOutputs(outsBytes)

					for outIdx, out := range outs.Outputs {
						if outIdx != vin.Vout {
							updatedOuts.Outputs = append(updatedOuts.Outputs, out)
						}
					}

					if len(updatedOuts.Outputs) == 0 {
						err := b.Delete(vin.Txid)
					} else {
						err := b.Put(vin.Txid, updatedOuts.Serialize())
					}

				}
			}

			newOutputs := TXOutputs{}
			for _, out := range tx.Vout {
				newOutputs.Outputs = append(newOutputs.Outputs, out)
			}

			err := b.Put(tx.ID, newOutputs.Serialize())
		}
	})
}
```

The method looks big, but what it does is quite straightforward. When a new block is mined, the UTXO set should be updated. Updating means removing spent outputs and adding unspent outputs from newly mined transactions. If a transaction which outputs were removed, contains no more outputs, it's removed as well. Quite simple!

Let's now use the UTXO set where it's necessary:

```go
func (cli *CLI) createBlockchain(address string) {
	...
	bc := CreateBlockchain(address)
	defer bc.db.Close()

	UTXOSet := UTXOSet{bc}
	UTXOSet.Reindex()
	...
}
```
Reindexing happens right after a new blockchain is created. For now, this is the only place where `Reindex` is used, even though it looks excessive here, because in the beginning of a blockchain there's only one block with one transactions, and `Update` could've been used instead. But in next article, we'll need to rebuild the UTXO set from time to time.

```go
func (cli *CLI) send(from, to string, amount int) {
	...
	newBlock := bc.MineBlock(txs)
	UTXOSet.Update(newBlock)
}
```
And the UTXO set is updated after a new block is mined.

Let's check that it works

```go
$ blockchain_go createblockchain -address 1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif
00000086a725e18ed7e9e06f1051651a4fc46a315a9d298e59e57aeacbe0bf73

Done!

$ blockchain_go getbalance -address 1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif
Balance of '1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif': 10

$ blockchain_go send -from 1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif -to 1XWu6nitBWe6J6v6MXmd5rhdP7dZsExbx -amount 6
0000001f75cb3a5033aeecbf6a8d378e15b25d026fb0a665c7721a5bb0faa21b

Success!

$ blockchain_go send -from 1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif -to 13UASQpCR8Nr41PojH8Bz4K6cmTCqweskL -amount 4

$ blockchain_go getbalance -address 1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif
Balance of '1F4MbuqjcuJGymjcuYQMUVYB37AWKkSLif': 10

$ blockchain_go getbalance -address 1XWu6nitBWe6J6v6MXmd5rhdP7dZsExbx
Balance of '1XWu6nitBWe6J6v6MXmd5rhdP7dZsExbx': 10

$ blockchain_go getbalance -address 13UASQpCR8Nr41PojH8Bz4K6cmTCqweskL
Balance of '13UASQpCR8Nr41PojH8Bz4K6cmTCqweskL': 10
```


## Merkle Tree

## P2PKH

## Conclusion

Links:

1. [The UTXO Set](https://en.bitcoin.it/wiki/Bitcoin_Core_0.11_(ch_2):_Data_Storage#The_UTXO_set_.28chainstate_leveldb.29)
2. [Merkle Tree](https://en.bitcoin.it/wiki/Protocol_documentation#Merkle_Trees)
3. [Script](https://en.bitcoin.it/wiki/Script)
4. ["Ultraprune" Bitcoin Core commit](https://github.com/sipa/bitcoin/commit/450cbb0944cd20a06ce806e6679a1f4c83c50db2)
5. [UTXO set statistics](https://statoshi.info/dashboard/db/unspent-transaction-output-set)
