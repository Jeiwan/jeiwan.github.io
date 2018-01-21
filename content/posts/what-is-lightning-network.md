---
title: "What is Lightning Network and How to Try It Today"
date: 2018-01-21T10:00:30+07:00
draft: true
tags: [Blockchain, Bitcoin, LightningNetwork]
---

## Introduction

As soon as the Bitcoin network started processing more-or-less significant number of transactions, it became obvious that the network is not scalable: the size of blocks is limited to 1 Mb, and since the number of transactions is growing, one day the limit will be hit and the mempool will start growing. This scalability issue gave birth to many Bitcoin clones, which pursued the goal of building a really scalable blockchain. One of such clones was Bitcoin Cash, that addresses the scalability issue by increasing the size of blocks to 8 Mb (and plans to increase it further).

The Bitcoin Core developers were aware of this problem and also kept looking for a solution. Increasing the block size is not an option because it'll make very difficult for individuals to run a node – only companies will be able to do so. Also, bigger blocks is a temporarily solution: in the future, when Bitcoin gets much broader adoption, the block size must be increase one more time. Thus, it'll lead to a more and more centralized network. So the Bitcoin Core developers found a better solution – Segwit (Segregated Witness). Segwit modifies the way transaction size is calculated: the unlocking signatures (that are present in every transaction) are moved to the end of transactions, and their influence on the overall transaction size is reduced. Also, Segwit changes the way the block size is measured: it's now measure in units, instead of bytes. This improvement allows block size up to 1.8 Mb without doing a hard fork (Segwit is a backward compatible soft fork).

Both of these approaches, Segwit and bigger blocks, are of the same nature: they both require modification of the blockchain – such approach is called "on-chain". The opposite approach is called "off-chain" and it doesn't require blockchain modification. Instead, it requires to create an infrastructure that attaches to the blockchain and improves its performance without modifying it. The main topic of this article, Lightning Network, is an off-chain Bitcoin scaling solution.


## How does Lightning Network work?

The purpose of Lightning Network (LN) is to increase the throughput of the Bitcoin network without modifying its blockchain and forking it. The idea is to create the so called "second layer" where all the transactions are transferred. Sending transactions on this second layer doesn't require paying Bitcoin fees for each transaction and doesn't require waiting for new blocks to be mined – this is the key part. LN allows to:

1. Open channels with other people, companies or services in the Lightning Network.
2. Send transaction to these channels, which is **free and instant** – this is where the scalability issue is solved.
3. Close a channel and create one resulting transaction which is sent to the Bitcoin network.

Let's review these points in details.
As software, LN is a node, like the Bitcoin node. In order to run it, one needs a fully synchronized Bitcoin node because LN is tied to the Bitcoin network and blockchain. As the name implies, Lightning Network is a network: running nodes can connect to each other and form a network. Connecting to another node means opening a channel to it. Channel opening is 