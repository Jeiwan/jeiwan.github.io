---
title: "Programming Bitcoin Network 3"
date: 2019-11-29T19:46:37+07:00
tags: [Golang, Blockchain, Bitcoin]
draft: true
---

Previous parts:
1. [Part 1](https://jeiwan.net/posts/programming-bitcoin-network/)
1. [Part 2](https://jeiwan.net/posts/programming-bitcoin-network-2/)


> DISCLAIMER. In these blog posts I describe only significant changes I made to the code
since the last part. There are also insignificant refactorings and improvements I make
along the way and don't explain them here for brevity. Please, check these links to
see all the changes:

> *Full code of this part: [Jeiwan/tinybit/part_3](https://github.com/Jeiwan/tinybit/tree/part_3)*

> *Changes since the previous part: [part2...part3](https://github.com/Jeiwan/tinybit/compare/part_2...part_3#files)*


## Introduction

Aaand we're back to continue our journey!

In the last part we finished `binary` subpackage that serializes and deserializes messages.
Also, we finished the versions handshake, i.e. initial exchange of general information between nodes.
As a result, our node can now connect to another node, send 'version' and 'verack' messages, and keep a live connection.

But, there's a problem with the latter...

## Liveliness check

If you leave the node running for several minutes, it'll get disconnected from the
`btcd` node and you'll see this in `btcd` logs:
```shell
[DBG] SRVR: New peer 127.0.0.1:57606 (inbound)
[DBG] PEER: Connected to 127.0.0.1:57606
[DBG] PEER: Sending verack to 127.0.0.1:57606 (inbound)
[DBG] PEER: Received verack from 127.0.0.1:57606 (inbound)
[DBG] PEER: Sending ping to 127.0.0.1:57606 (inbound)
[DBG] PEER: Sending ping to 127.0.0.1:57606 (inbound)
[WRN] PEER: Peer 127.0.0.1:57606 (inbound) no answer for 5m0s -- disconnecting
[INF] SYNC: Lost peer 127.0.0.1:57606 (inbound)
[DBG] SRVR: Removed peer 127.0.0.1:57606 (inbound)
```

It turns out that the `btcd` node sends 'ping' message to our node and expects an answer.
If there's no answer, it removes our node from the list of its peers.
We don't want that.

Pinging other nodes in a network is a common way of checking their liveliness, i.e. if the other node is still running and responding.
If a node fails to reply in time and with proper message, it gets removed from the list of peers.
So, we want to handle 'ping' message and send proper reply, which is a 'pong' message.

### 'ping' and 'pong' messages
Both 'ping' and 'pong' messages are identical and quite minimal:
```go
type MsgPing struct {
	Nonce uint64
}

type MsgPong struct {
	Nonce uint64
}
```

The only field they have is `Nonce`, which is just a random number that's used as an identifier of a 'ping' message.
'pong' messages simply returns the nonce that was sent in 'ping' message. This difference is reflected in their constructors:

```go
func NewPingMsg(network string) (*Message, uint64, error) {
	nonce := rand.Uint64()
	payload := MsgPing{
		Nonce: nonce,
	}

	msg, err := NewMessage("ping", network, payload)

	return msg, nonce, nil
}

func NewPongMsg(network string, nonce uint64) (*Message, error) {
	payload := MsgPong{
		Nonce: nonce,
	}

    msg, err := NewMessage("pong", network, payload)

	return msg, nil
}
```

These messages are handled differently though.
Whenever a node receives a 'ping' message, it should immediately built a 'pong' message and send it:

```go
func (n Node) handlePing(header *protocol.MessageHeader, conn io.ReadWriter) error {
	var ping protocol.MsgPing

	lr := io.LimitReader(conn, int64(header.Length))
	if err := binary.NewDecoder(lr).Decode(&ping); err != nil {
	}

	pong, err := protocol.NewPongMsg(n.Network, ping.Nonce)

	msg, err := binary.Marshal(pong)

	if _, err := conn.Write(msg); err != nil {
	}

	return nil
}
```

If a node receives a 'pong' message, it means it sent a 'ping' earlier.
Sending pings is a part of a mechanism that we haven't implemented yet, and before 
starting implementing it we should first build a list of peers our node is aware of.

## List of peers

Nodes in the Bitcoin network shouldn't depend only on one other node 
Instead, each node should be connected to several nodes and shouldn't trust one node
more than any other node in the network.
This means that nodes should be interchangeable. If one is removed it can be easily
replaced by any other node.

We haven't yet build a list of peers, and there's no better time to fix this than now.
First, let's define a peer:
```go
type Peer struct {
	Address    net.Addr
	Connection io.ReadWriteCloser
	PongCh     chan uint64
	Services   uint64
	UserAgent  string
	Version    int32
}

func (p Peer) ID() string {
	return p.Address.String()
}
```
`Peers` describes everything we want to know and remember about a peer node.

* `Address` is needed to identify a node in the list.
* `Connection` is needed to send and receive messages. Eventually, we'll be handling multiple connections at once.
* `PongCh` is used to send to pass 'pong' replies to a monitoring function (we'll implement it next).
* `Services` describes feature supported by the peer node.
* `UserAgent` keeps information about software used by the peer (we won't us it for now, but maybe one day...).
* `Version` keeps the protocol version that the peer implements.

Now, the node can have a list of peers:
```go
// node/node.go
type Node struct {
	Network      string
	NetworkMagic protocol.Magic
	Peers        map[string]*Peer
	UserAgent    string
}
```

> I decided to use a map instead of a list because it's easier to get a node by its
address, and removing one peer doesn't affect other peers in the map (doesn't change
their indexes).


At this stage, we only have one peer node. And that OK for now.

Now, when do we want to add a peer? As soon we connect to a node?
Actually, no. Before adding a peer we must first get basic information about it, i.e.
finish a version handshake.
This, we add new nodes as soon as we receive 'version' message from them:
```go
// node/cmd_version.go
func (n Node) handleVersion(header *protocol.MessageHeader, conn net.Conn) error {
	var version protocol.MsgVersion

	lr := io.LimitReader(conn, int64(header.Length))
	if err := binary.NewDecoder(lr).Decode(&version); err != nil {
	}

	peer := Peer{
		Address:    conn.RemoteAddr(),
		Connection: conn,
		PongCh:     make(chan uint64),
		Services:   version.Services,
		UserAgent:  version.UserAgent.String,
		Version:    version.Version,
	}

    n.Peers[peer.ID()] = &peer
    ...
}
```

And that's it. Having a list of peers, we're now ready to monitor their liveliness.


## Monitoring peers' liveliness

(This is where we implement handling of 'pong' messages.)

As soon as a peer is added, a peer liveliness monitor should start running.
Let's define how it should work:
1. The monitor triggers once in a while and sends a 'ping' message to the peer.
1. It waits for a 'pong' message containing the nonce from the 'ping' message.
1. If no 'pong' message is received in a certain time span, then the peer is considered dead and is removed from the list.

In Golang terms, we want to have a goroutine running for each peer managing their liveliness.
This means we want to have several concurrent processes that communicate with each other
(or maybe not, what do you think?) and update/remove peers in a list.

### Share Memory By Communicating

Traditionally, such concurrent tasks (that work on the same memory segments) are solved
with the help of mutexes.
Mutexes allow to temporarily lock certain memory segments to prevent multiple
simultaneous reads and/or writes.

Golang, on the other hand, incentivizes a different approach, which is outlined in an
official Golang blog post [Share Memory By Communicating](https://blog.golang.org/share-memory-by-communicating).
I recommend you reading it and checking this [wonderful code example](https://golang.org/doc/codewalk/sharemem/) before moving on.

So, instead of mutexes we'll be using channels and goroutines. It took me some time to
come up with this design:

1. There will be a part that sends ping messages, waits for replies, and handles 'no reply' case.
We haven't built anything related to this.
1. Another part that receives 'pong' messages from other nodes.
This will be a handler of 'pong' messages.
1. Third part that connects the two above. This part knows what nonce was sent to what
node and directs 'pong' replies.

Let's begin with the latter part. This is a simple function like:

```go
func (n Node) monitorPeers() {
	peerPings := make(map[uint64]string)

	for {
		select {
		case nonce := <-n.PongCh:
			peerID := peerPings[nonce]
			if peerID == "" {
				break
			}
			peer := n.Peers[peerID]
			if peer == nil {
				break
			}

            peer.PongCh <- nonce
            delete(peerPings, nonce)

		case pp := <-n.PingCh:
			peerPings[pp.nonce] = pp.peerID
		}
	}
}
```

We also need two new channels:
```go
// node/node.go
type Node struct {
    ...
	PingCh       chan peerPing
    PongCh       chan uint64
    ...
}
```

`peerPings` is a state data structure that couples ping nonces and peer identifiers.
`n.PingCh` is intended to pass ping notifications, that are sent whenever a 'ping'
message is sent (this will be implemented next).
This notifications are as simple as:
```go
type peerPing struct {
	nonce  uint64
	peerID string
}
```

> This is where we share memory by communicating.

Whenever a `peerPings` notification is received, the state data structure (`peerPings`)
is updated to be aware of a new ping message.

`n.PongCh` is intended to pass 'pong' messages from the handler to the monitoring
functions.
Before doing this we should check the nonce and ensure the peer is stil in the list.
After directing the nonce, it should be removed from `peerPings` to avoid memory leak.


Now, let's implement this part:
> There will be a part that sends ping messages, waits for replies, and handles 'no reply' case.

For every new peer our node will do the following:

```go
func (n *Node) monitorPeer(peer *Peer) {
	for {
		time.Sleep(pingIntervalSec * time.Second)

		ping, nonce, err := protocol.NewPingMsg(n.Network)
		if err != nil {
			logrus.Fatalf("monitorPeer, NewPingMsg: %v", err)
		}

		msg, err := binary.Marshal(ping)
		if err != nil {
			logrus.Fatalf("monitorPeer, binary.Marshal: %v", err)
		}

		if _, err := peer.Connection.Write(msg); err != nil {
			n.disconnectPeer(peer.ID())
		}
```

First, wait a few minutes.
It's very likely that a newly added peer is alive, so we don't need to fire a ping
message right away.
Then, build a 'ping' message and send it.

After a 'ping' was sent, we need to notify `monitorPeers` function:
```go
		n.PingCh <- peerPing{
			nonce:  nonce,
			peerID: peer.ID(),
		}
```

And now we can start waiting for a reply:
```go
		t := time.NewTimer(pingTimeoutSec * time.Second)

		select {
		case n := <-peer.PongCh:
			if n != nonce {
				logrus.Fatalf("nonce doesn't match for %s: want %d, got %d", peer, nonce, n)
			}
			logrus.Debugf("got 'pong' from %s", peer)
		case <-t.C:
			// TODO: clean up peerPings, memory leak possible
			n.disconnectPeer(peer.ID())
		}

        t.Stop()
    }
}
```

If the timer is triggered before we receive a 'pong', the peer must be disconnected.
If a 'pong' is received, validate the nonce and that's it – we don't need to do anything
else.

This whole cycle should run indefinitely, as long as the peer is in the list.
And it should be started as soon as a peer is added:
```go
// node/cmd_version.go
func (n Node) handleVersion(header *protocol.MessageHeader, conn net.Conn) error {
    ...
   	n.Peers[peer.ID()] = &peer
	go n.monitorPeer(&peer)
    ...
}
```

Now, the final part:
> Another part that receives 'pong' messages from other nodes. 

We already know how to build these:
```go
func (n Node) handlePong(header *protocol.MessageHeader, conn io.ReadWriter) error {
	var pong protocol.MsgPing

	lr := io.LimitReader(conn, int64(header.Length))
	if err := binary.NewDecoder(lr).Decode(&pong); err != nil {
		return err
	}

	n.PongCh <- pong.Nonce

	return nil
}
```
Yes, that's simple: read a 'pong' message, decode it, and send to `n.PongCh`.
The other guys will do all the work.

At this point we're having a node that:

1. Can stay alive by replying to 'ping' messages sent by other nodes.
1. Maintain a list of peers, check their liveliness, and remove dead ones.

Sweet! Time to add new features!

## Mempool Monitor

After so many lines of code we can finally start thinking about usefulness.
For the next several blog posts, let's set a goal of building a **Mempool Monitor**.

Mempool is simply a list of transactions that haven't been mined yet.
The Bitcoin network is organized in such way that there're no centralized nodes.
As a consequence, **all transactions and all blocks are delivered to every node in the
network**.
This means that our node too can received every transaction and every block!
But we won't go for the blocks for now.

Let's begin with receiving transactions.


## 'inv' message

As I said above, every node in the network receives every transaction.
But there's an optimization was made to reduce the bandwidth and to not literally send
every transaction to every node as soon as a new transaction is submitted.

Transactions and blocks transferring is implemented in this way:
1. When a node gets a new transaction, it sends 'inv' message to its peers.
'inv' means *inventory* and it literally says "Hey! I have these...".
But 'inv' doesn't contain full data, only hashes.
1. Any peer that receives the message can decide where it wants to get full data or not.
1. If a peer wants full data, it sends a 'getdata' reply specifying a list of hashes
it want to get full data for.
1. A node that receives 'getdata' checks what objects were requested (transactions or
blocks) and sends them in related messages: 'tx' for transaction and 'block' for block
(one transaction/block per message).

In code, 'inv' message looks like so:
```go
type MsgInv struct {
	Count     uint8
	Inventory []InvVector
}

type InvVector struct {
	Type uint32
	Hash [32]byte
}
```

1. `Count` specifies the number of objects it describes.
1. `Type` (besides other values) can be 1 for transactions or 2 for bocks.
1. `Hash` is a hash of a transaction or a block.

> Serialization and deserialization of this and other new types is omitted to save
space. They're a bit different but not hard. Check the [full code](https://github.com/Jeiwan/tinybit/tree/part_3) to see them.

'getdata' is absolutely identical.

And here comes the most difficult part: 'tx' message.

```go
type MsgTx struct {
	Version    int32
	Flag       uint16
	TxInCount  uint8
	TxIn       []TxInput
	TxOutCount uint8
	TxOut      []TxOutput
	TxWitness  TxWitnessData
	LockTime   uint32
}
```
1. `Version` specifies transaction format version. Its always 1 as of now.
1. `Flag` is very tricky to deserialize and serialize because can be missing or can be
set to 1. When it's set to 1, the **transaction uses Segwit data** to store signature
script.
When it's missing, the transaction is a legacy one.
As of December 2019 there are slightly more than 50% of Segwit transactions in the
network, which means that our node must support them too.
1. `TxInCount` is the number of inputs.
1. `TxIn` is a list of inputs.
1. `TxOutCount` is the number of outputs.
1. `TxOut` is a list of outputs.
1. `TxWitness` is only set when `Flag` is set to 1. It holds a list of witness data elements.













Share Memory By Communicating 
https://golang.org/doc/codewalk/sharemem/