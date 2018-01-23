---
title: "What is Lightning Network and How to Try It Today"
date: 2018-01-21T10:00:30+07:00
draft: true
tags: [Blockchain, Bitcoin, LightningNetwork]
---

![Lightning Network topology](/images/ln-topology.png)

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
As software, LN is a node, like the Bitcoin node. In order to run it, one needs a fully synchronized Bitcoin node because LN is tied to the Bitcoin network and blockchain. As the name implies, Lightning Network is a network: nodes can connect to each other and form a network. Connecting to another node means opening a channel to it. Channel opening is integrated with the Bitcoin network: when a channel is opened, a special kind of transactions is created and sent to the Bitcoin network. Such transaction **locks a certain amount of Bitcoins** of the party that opened the channel – this is a key moment: when you open a channel, you need to lock the maximum amount of BTC you're going to spend. You don't have to spend all of this BTC, but it's better for you if you know how much you're going to spend in advance because opening channels is not free. Having funds locked in a channel guarantees that the sender indeed has some funds to spend.

When a channel is opened, there's no more need to send transactions via the Bitcoin network, they now can be sent via the second layer – the Lightning Network. Sending transactions via LN is instant and free (although some minor fees are possible). When you have a channel opened to some other node, you can send BTC:

1. Directly to that node.
2. Indirectly to any other node that node is connected to.

The second scenario will probably be the most common and the fundamental one. Imagine a payments hub: one big node that has channels opened to many services and product providers. You don't need to open channel to each of these services and product providers, you can open just one channel to that hub node and pay indirectly.

![Lightning Network hubs](/images/ln-topology-hubs.png)

This use case is also the most controversial: having such big central nodes means there's centralization in the network. MORE ABOUT CENTRALIZATION?

Let's finally try LN!

## Running Lightning Network node
As of January 2018, LN was deployed and successfully tested on the Bitcoin testnet. It has also been deployed to the mainnet, but it's strictly not recommended to use it today, because it's still not stable enough. You're risking loosing your BTC! Since we don't want that, we're going to use it on the testnet.

1. First thing's first, we need a Bitcoin node connected to the testnet and fully synchronized. We'll use Bitcoin Core node, which you can download from https://bitcoin.org/en/wallets/desktop/windows/bitcoincore/
2. On the first run, Bitcoin Core will connect to the mainnet and start synchronizing. That's not what we want.
3. Don't wait for the synchronization to finish and open Settings, then click Open Configuration File button.
4. A text editor will be opened with the default Bitcoin Core configuration. Replace it with the following:
	```
	testnet=1
	server=1
	rpcuser=foo
	rpcpassword=bar
	txindex=1
	zmqpubrawblock=tcp://127.0.0.1:29000
	zmqpubrawtx=tcp://127.0.0.1:29000
	```
5. These settings switches Bitcoin Core to the testnet and setups some basic and required configurations. Save the file and restart the node. After the restart, the windows of Bitcoin Core should contain `[testnet]`, which means that it's now connected to the testnet. And this time you have to wait for full synchronization.
6. Meanwhile, go to https://github.com/ACINQ/eclair/releases and download Eclair, a LN client developed by ACINQ, which we're going to use in our experiments. If you try to run Eclair now, it won't start, because the Bitcoin node is not fully synchronized. So, continue when the node the synchronization is done.
7. While the node is being synchronized, you can visit https://explorer.acinq.co/ – this a LN topology visualization service. It also maps node locations to the world map, which is quite handy.
8. After the node is synchronized, run Eclair. It'll look like this (but in your case it won't have opened channels):

![Eclair](/images/ln-eclair.png)

9. In the left-bottom corner is your node identifier. Also, pay attention to the right-bottom corner: it should say TEST, meaning the LN node is attached to the Bitcoin testnet.
10. The tabs (All Nodes, All Channels) should have counters. If it's not the case, wait a couple of minute for the node to get nodes and channels information.
11. That's it! Now you have a fully synchronized Bitcoin node connected to the testnet and a ready LN node!


## Depositing some BTC
In order to transfer some BTC, we need those BTC, that's obvious. But getting them via mining wouldn't have been efficient. To solve this problem, there are services called *faucet*, which allow you to get free coins. (such services also exist for other blockchains, not just Bitcoin)
To get the BTC, visit https://testnet.coinfaucet.eu/en/ and enter your address (which you can get from the Bitcoin Core client). The coins will be delivered with the next mined block (yes, there's mining in the testnet), which you can track via blockchain explorers, e.g. https://live.blockcypher.com/btc-testnet/
Now, we're ready to use the Lightning Network!

## Opening LN channel
Let's start with opening a single LN channel.

1. Go to the LN explorer I mentioned above (https://explorer.acinq.co/). Type `endurance` in the search field on the site to find the node we're going to connect to. You'll see the reasoning behind this later. In the Node Informations window, find Copy URI link and click–we'll use the URI to connect to this node.
2. Go to Eclair, click Channels menu and choose Open channel. Paste the Node URI to Target Node URI. In Capacity field, enter the amount you're willing to lock in the channel (i.e. the maximum amount you're planning to spend). For our purposes, 100 milliBTC will be enough. Click Connect to open a channel.
3. In Local Channels tab, a new channel should appear:

![Lightning Network channel in Eclair](/images/ln-eclair-channel.png)

4. The new channel's state will rapidly change to `WAIT_FOR_FUNDING_CONFIRMED`, which means that a channel opening transaction is created and is sent to the Bitcoin network. Now you need to wait for two new blocks: one containing the transaction and one confirming it. You can track new blocks via a (testnet) blockchain explorer, like https://live.blockcypher.com/btc-testnet/
5. When the transaction is mined and confirmed, the status of the channel will move to `NORMAL`, meaning the channel is created and ready to receive LN transactions.

## Buying coffee for Bitcoin
The same company that created Eclair, also created a demo online shop selling coffee for Bitcoin: https://starblocks.acinq.co/ And we're going to buy coffee from it and will pay with Bitcoin via LN!

LN doesn't allow to arbitrary send coins to any address without a permission of the address' owner, unlike in the main Bitcoin network. The party willing to receive a payment has to create a **payment request**, an analogue of invoice. The party then hands (via a QU-code, link, or in raw) the payment request to the paying party, and the paying party uses an application that reads the request and performs a payment.

So, in order to buy a coffee:

1. Visit the demo shop: https://starblocks.acinq.co/
2. Add any coffee to the cart and check out. The page will show a QR-code to scan, but since we're using a desktop LN client, it won't work. We need the raw payment request, the string on the same page starting with `lnt`–just copy it to the buffer.
3. Switch to Eclair, go to Channel menu, choose Send Payment, and paste the payment request. Eclair will parse the request and extract some information from it (like node ID, payment hash, the name of the product, and its price).
4. Don't click Send right away! Let's check something. In Eclair, find the ID of the node we're connected to and compare it with the ID of the node you're going to send the payment to. They don't match! So, we're sending a payment to a node we have no opened channels to.
5. Alright, click Send... and the payment is successful! The coffee price was withdrawn from the fund locked in the channel, and the demo shop showed a successful payment message. How come? You had no channels opened to the shop's node.
It turns out, the node you connected to is connected to the node you sent payment to. The node was an intermediator!
6. Go to the LN explorer and find the both nodes. Thanks to the visualization of channels, you can see that the two nodes indeed have a channel between them.

That's it for today! I encourage you to try other use cases and other LN clients and applications – in testnet, it's painless and you're not risking anything.

## What about the mainnet
No! As of January 2018, Lightning Network is not ready for real payments. Yes, it's deployed to the mainnet and, yes, there are LN nodes in the mainnet. But the things is still in development, and it's quite risky to send real Bitcoins.

## Links and resources

1. [What is the Lightning Network and how can it help Bitcoin scale?](https://coincenter.org/entry/what-is-the-lightning-network)
2. [Lightning Network Tech Talk at Coinbase](https://www.youtube.com/watch?v=wIhAmTqXhZQ)
3. [Lightning Networks Part I: Revocable Transactions](https://rusty.ozlabs.org/?p=450) – technical explanation of LN
4. [LND Overview and Developer Guide](http://dev.lightning.community/overview/) – just enough information about LND to build applications
5. [Mobile (Android) Ecalir wallet for the testnet](https://play.google.com/store/apps/details?id=fr.acinq.eclair.wallet&hl=en)
6. [Zap](https://github.com/LN-Zap/zap-desktop) – another desktop application
7. [Lightning Charge](https://github.com/ElementsProject/lightning-charge) – a simple drop-in solution for accepting lightning payments