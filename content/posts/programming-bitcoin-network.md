---
title: "Programming the Bitcoin Network"
date: 2019-10-30T00:00:00+00:00
tags: [Golang, Blockchain, Bitcoin]
draft: true
---

*Full code: [Jeiwan/tinybit/part_1](https://github.com/Jeiwan/tinybit/tree/part_1)*

## Introduction

This blog starts a series of posts dedicated to programming of the Bitcoin network in Golang. 
The goal of this series is to build a tiny Bitcoin network client that's able to:  

1. Connect to a Bitcoin network (whether that's mainnet, testnet, simnet, or a local network).
1. Introduce itself to the network (what's called "version handshake").
1. Get information about current blockchain state from a node in the network.
1. Download full blockchain history (blocks with transactions).
1. Verify and relay new transactions.
1. Verify and relay new blocks.

The result will be a tiny Bitcoin node implementation that can act as a fully-fledged participant of the network.

## Bitcoin Network

Before beginning, let's look at the Bitcoin network in details to understand how it works and what it's needed for.

Whenever you see a definition of blockchain, it usually says something like:
"blockchain is a database that stores blocks, with every next block being linked to 
the previous one in a cryptographically secure way so it's not possible to change 
anything in previous blocks". 
Such definitions miss one of the cornerstones: network.
Because without network there's no blockchain.

Bitcoin implements a P2P (peer to peer) network. 
In such networks, every participant (which is called *node*) acts as **both client and server**. 
Every node in a P2P network is a full-fledged member of the network, there are no master and slave nodes.

> Actually, nodes can act differently in the network. 
There are different light client implementations that don't require full blockchain history and that rely on full nodes to get information from.
Also, it's only mining nodes that change the blockchain database (by mining new blocks).

Since there are no centralized servers that define business logic (like HTTP servers), 
every node has to define and verify the rules of mining and the structure of transactions and blocks.
Every node is responsible for supporting the consensus.

> Yes, when you're using Bitcoin Core or any other implementation of the Bitcoin protocol, you trust the piece of software to properly implement the protocol and properly handle all the operations.
What's really awesome about the Bitcoin network is that it protects itself from any malicious or misbehaving nodes.

Full Bitcoin nodes serve multiple purposes:

1. Downloading all blocks and transactions.
1. Verifying all downloaded blocks and transactions.
1. Let other nodes in the network to get blocks and transactions from this node's database. 
1. Verify and relay unconfirmed transactions.

> Often, Bitcoin node implementations come with additional features, like wallet and mining operations.
We won't discuss them in this series.

Thus, the Bitcoin network is designed to make these functions possible.
Whenever something happens in the network (a new transaction is submitted, a new block is mined, a new node is connected), 
every other node in the network should know about this. 
Whenever user submits a transaction, the network must guarantee that the transaction gets to mining nodes. 
Whenever a new block is mined, the network must guarantee that the block is delivered to every node. 
That's the goal of the network: without relying on centralized servers, letting every member of the network know about what's going on an letting every node to get all the information required to build and verify latest state of the blockchain.

## Project Layout
I'll be using [Cobra](https://github.com/spf13/cobra/) to organize files in the project. 
If you prefer other library or approach, you're free to use it, of course. By the end of this post, the project will have such structure:
```
├── btcd
│   └── <blockchain data>
├── btcd.conf
├── cmd
│   └── tinybit.go
├── go.mod
├── go.sum
├── main.go
└── protocol
    ├── command.go
    ├── message.go
    ├── message_version.go
    ├── netaddr.go
    └── protocol.go
```

As you also noticed, I'm using Go modules in this project.
If you have any troubles with them, please refer to [this comprehensive guide](https://github.com/golang/go/wiki/Modules).

## Local Bitcoin Network

While coding, we won't use the main Bitcoin network. Instead, we'll run a local network. 
For this purpose I prefer [btcd](https://github.com/btcsuite/btcd), an alternative Bitcoin full node implementation written in Golang; 
it has simple configuration, nice logging, and the Simulation network (simnet) which is quite handy when developing for Bitcoin.
Here's the `btcd` config I'll be using throughout this series:
```ini
# btcd.conf
[Application Options]
datadir=./btcd/data

listen=127.0.0.1:9333

simnet=1

nobanning=1
debuglevel=debug
```

1. `listen` is the address the node will accept connections on. Default is 8333, but we'll  use 9333.
1. `simnet` enables Simulation network. It's a local network that gives us full control over mining.
1. `nobanning` disables banning of nodes for misbehavior (we'll experiment a lot).
1. `debuglevel=debug` enables debug level logging so we can see how the node handles our requests.

Start `btcd` with `btcd --configfile ./btcd.conf` and let's start programming.

## Messages

In the Bitcoin network, nodes communicate with each other by exchanging messages. 
There are many types of messages, some of them act as requests and some of them act as responses. 
While developing a Bitcoin node, our main tasks would be:

1. Implementing messages as they're defined in [the protocol specification](https://en.bitcoin.it/wiki/Protocol_documentation) (it might be outdated though).
1. Properly encoding and decoding them.
1. Sending them over the network.
1. Properly handling incoming messages.

In this part we'll start implementing what's called "version handshake". 
According to the specification, before two nodes can start doing something (exchanging blocks, transactions, etc.) they have to exchange their versions.
This process looks like so.

1. Node A connects to Node B.
1. Node A sends information about its version to Node B.
1. Node B sends information about its version back to Node A.
1. Node B sends information "acknowledged" message to Node A.
1. Node B sets version to the minimum of these 2 versions.
1. Node A sends "acknowledged" message to Node B.
1. Node A sets version to the minimum of these 2 versions.

Eventually, the two nodes "know" about each other, about what protocol version is implemented and what features are supported by the other node.

## Message Structure

All messages use the same wrapping structure that contains general information about the message.
In Golang, it looks like so:
```go
const (
	checksumLength = 4
   	commandLength = 12
	magicLength    = 4
)

type Message struct {
	Magic    [magicLength]byte
	Command  [commandLength]byte
	Length   uint32
	Checksum [checksumLength]byte
	Payload  []byte
}
```

1. `Magic` is a four byte network identifier. We'll have it hardcoded.
1. `Command` is a 12 byte command name. The field has fixed size while actual command names can be shorter than 12 bytes. In such cases, zero bytes are appended. Commands cannot be longer than 12 characters.
1. `Length` is the length of message payload.
1. `Checksum` verifies the integrity of message payload. It's calculated as `SHA256(SHA256(payload))`.
1. `Payload` is the actual message. It's serialized (encoded) before being put here. That's why the type is a byte sequence.

As you can see, all the fields, except `Payload`, have fixed length. 
This is crucial for deserialization of messages. 
Every message received by a node must have a magic number in its first four bytes. 
If it's not so (a magic is not recognized), the message is invalid and ignored.
The same goes for all other fields.

> Messages serialization and deserialization is very important. 
Without proper (de)serialization it won't be possible to build communication between nodes. 
While the (de)serialization algorithm in the Bitcoin protocol is quite simple, Golang doesn't provide a library that fully implements it. 
Thus, we'll be busy building our own (de)serializer later in the series.
But, in this post, we'll use a basic and simple approach.

As you noticed, `Payload` is the only field that doesn't have fixed size. 
This is because messages can have different sizes, there's no way to standardize them.
To make deserialization of `Payload` possible, there's `Length` field that stores the length of payload.

## Version Message Structure

Bitcoin nodes cannot communicate before they've exchanged their versions. Thus, very first message we're going to send is "version".

```go
type MsgVersion struct {
	Version     int32
	Services    uint64
	Timestamp   int64
	AddrRecv    NetAddr
	AddrFrom    NetAddr
	Nonce       uint64
	UserAgent   VarStr
	StartHeight int32
	Relay       bool
}
```

> Please keep in mind that the order of fields in every message shouldn't be changed.
Fields must go in exact same order as shown in this and all future articles.

Let's review the fields:

1. `Version` specifies Bitcoin protocol version. We'll always use the latest version, 70015. You can find more info about protocol versions on [Protocol Versions](https://bitcoin.org/en/developer-reference#protocol-versions) page.
1. `Services` specifies features supported by our node.
For now, we'll use only value `1`, which means that our node is a Bitcoin node that can provide full blocks.
If we add support for Segwit, we're going to use a different value here to let other nodes know that we support Segwit.
1. `Timestamp` current timestamp in seconds.
1. `AddrRecv`, `AddrFrom` contain information about network addresses of  the node the message is sent to and the node that sends the message.
These fields have custom type `NetAddr`, we'll discuss it next.
1. `Nonce` a random number that allows to distinguish similar messages.
1. `UseAgent` is analogous to the `User-Agent` HTTP header:
It contains information about node's software name and version.
We'll discuss `VarStr` type next.
1. `StartHeight` holds the number of the last block received by our node. For now, we'll always use `-1`, which means we have no blocks
(`0` would mean one block).
1. `Relay` tells the node we're sending "version" message to whether it should send us transactions or not.
This flag allows to filter transactions we want to receive.
We'll always use `true` here; one day, we'll want to receive all transactions from other nodes.

## NetAddr and VarStr types

`Version` message contains two custom types, `NetAddr` and `VarStr`. Let's look at them:

```go
type IPv4 [4]byte

type NetAddr struct {
	Time     uint32
	Services uint64
	IP       *IPv4
	Port     uint16
}
```

1. `Time` can be ignored for now because it's not used in "version" message.
1. `Services` is the same as in `Version`.
1. `IP` contains four bytes of an IP address. We're going to use IPv4 addresses only, but during serialization they're converted to IPv4-mapped IPv6 addresses.
1. `Port` is a port number the node is listening connections on.

Next, `VarStr`. It's basically a type that contains a string and its length:
```go
type VarStr struct {
	Length uint8
	String string
}
```

To serialize a message, we need to know lengths of all fields. 
Since strings aren't fixed, we also need to store length of each string.

One more thing to mention here is that, in the Bitcoin protocol, field `Length` of `VarStr` type has "variable length integer" type to save space. 
We'll just use 1 unsigned byte for simplicity.

### Serialization

We now have a message to send.
Let's learn to encode it so it can be successfully sent over the network and decoded by any other Bitcoin node.

At current stage, we're having a bunch of Golang structs. 
Other Bitcoin nodes might be implemented in other languages and they won't definitely understand what Golang structs are.
We need to find a way to send these structs over the network.

Such structs (or classes, in other languages) encoding and decoding is called serialization and deserialization.
There're different formats of serialization.
For example, Golang comes with `encoding/gob` library that allows to serialize and deserialize Golang structs.
Again, this is very Golang way of serialization, other languages don't support it.

We could also use JSON, YAML, etc. to serialize the messages, but other Bitcoin nodes won't understand them as well as the Bitcoin specification describes a different way.

The Bitcoin protocol uses a very simple serialization mechanic: we just need to take byte representation of every field and concatenate them preserving the order. 
For example (in pseudocode):

```
BYTES(Msg.Magic) + BYTES(Msg.Command) + BYTES(Msg.Length) + BYTES(Msg.Checksum) + BYTES(Msg.Payload)
```

We'll be serializing messages in two steps:

1. First, serialize the payload.
2. Then, serialize the message.

Before we can serialize a message, we first need to serialize its payload to be able to calculate its length and checksum.

### Message Serialization

Message serialization looks like so:
```go
func (m Message) Serialize() ([]byte, error) {
	var buf bytes.Buffer

	if _, err := buf.Write(m.Magic[:]); err != nil {
		return nil, err
	}

	if _, err := buf.Write(m.Command[:]); err != nil {
		return nil, err
	}

	if err := binary.Write(&buf, binary.LittleEndian, m.Length); err != nil {
		return nil, err
	}

	if _, err := buf.Write(m.Checksum[:]); err != nil {
		return nil, err
	}

	if _, err := buf.Write(m.Payload); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}
```

Only two things are happening here:

1. Byte arrays and slices are written to the bytes buffer directly.
2. Number types are encoded using `encoding/binary` package.
This package does bare minimum, that's why we'll implement our own binary encoding package later.

Notice, that we're using little-endian byte order, this is required by the specification.
The only exceptions are IP address and port number, they're encoded using big-endian byte order.

### Serialization of Other Types

`Version`, `VarStr`, and `NetAddr` are serialized in absolutely identical way, except that there are no byte array fields in `Version`. 

> I won't include their `Serialize` functions here for brevity. 
Please refer to [the full code](https://github.com/Jeiwan/tinybit/tree/part_1) if you need help implementing them.

`IPv4` type is slightly different. 
It stores IPv4 address which must be mapped to IPv6 address when serialized.
This simply means the four bytes of IPv4 address are prepended with 12 other bytes, like so:
```go
func (ip IPv4) ToIPv6() []byte {
	return append([]byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF}, ip[:]...)
}
```

IPv6 addresses returned by `ToIPv6` functions are known as [IPv4-mapped IPv6 addresses](http://www.tcpipguide.com/free/t_IPv6IPv4AddressEmbedding-2.htm).

### Communicating with Bitcoin Node
Since we're in the very beginning of our journey, we're not going to build a server node.
Our node will be acting as a client for now and won't be listening for incoming connections.

This is what we want to achieve at this stage:

1. Connect to other node.
1. Send "version" message.
1. Receive proper response from the other node.
1. Investigate and understand what was responded.
1. Disconnect or get timed out.

That'll be enough to begin and have something working.

Let's begin with "version" message serialization:

```go
version := protocol.MsgVersion{
    Version:   protocol.Version, // const Version = 70015
    Services:  protocol.SrvNodeNetwork, // const SrvNodeNetwork = 1
    Timestamp: time.Now().UTC().Unix(),
    AddrRecv: protocol.NetAddr{
        Services: protocol.SrvNodeNetwork,
        IP:       protocol.NewIPv4(127, 0, 0, 1),
        Port:     9333,
    },
    AddrFrom: protocol.NetAddr{
        Services: protocol.SrvNodeNetwork,
        IP:       protocol.NewIPv4(127, 0, 0, 1),
        Port:     9334, // dummy, we're not listening
    },
    Nonce:       nonce(), // returns a random number
    UserAgent:   protocol.NewUserAgent(), // returns a user-agent as a VarStr
    StartHeight: -1,
    Relay:       true,
}
```

I hope that it's clear and self-explanatory. 
The only thing I'm not sure about are `AddrRecv` and `AddrFrom` fields, they seem to be optional and not handled by `btcd` nodes. We'll decide on them later.

Next, we're creating a message and serializing it:
```go
func NewMessage(cmd, network string, payload MessagePayload) (*Message, error) {
	serializedPayload, err := payload.Serialize()

	command, ok := commands[cmd]

	magic, ok := networks[network]

	msg := Message{
		Magic:    magic,
		Command:  command,
		Length:   uint32(len(serializedPayload)),
		Checksum: checksum(serializedPayload),
		Payload:  serializedPayload,
	}

	return &msg, nil
}

msg, err := NewMessage("version", network, version)
```

We're using a constructor function `NewMessage` that serializes message payload, validates command, network name, and builds a `Message`.

Then, we need to serialize the message and actually send it:
```go
msgSerialized, err := msg.Serialize()
```
Yes, we're simply calling `Sertialize` method which we implemented earlier.

Now, let's connect to the local btcd node:
```go
conn, err := net.Dial("tcp", "127.0.0.1:9333")
defer conn.Close()
```

And send the message right away by writing the serialized message to the TCP connection:
```go
_, err = conn.Write(msgSerialized)
```

Next, we're waiting for any response and printing it out:
```go
tmp := make([]byte, 256)

for {
    n, err := conn.Read(tmp)
    if err != nil {
        if err != io.EOF {
            logrus.Fatalln(err)
        }
        return
    }
    logrus.Infof("received: %x", tmp[:n])
}
```

One important thing to keep in mind about TCP connections is that they're streams.
TCP messages don't carry information about their sizes.
This forces use to use a buffer when reading from a TCP connection.
`tmp` is a 256 byte buffer we're reading any message into.

> Later, we'll need to find a better way of reading from a TCP connection because messages in the Bitcoin network can be bigger than 256 bytes.

That's it!

### Running and Testing

Let's run it (ensure `btcd` is also running):
```console
$ go build
$ tinybit
INFO[0000] received: 161c141276657273696f6e000000000071000000346bd6747d1101004d000000000000001f48b95d000000004d0000000000000000000000000000000000ffff7f000001d7724d000000000000000000000000000000000000000000000000001bd8588e3fcc097a1b2f627463776972653a302e352e302f627463643a302e31322e302f0000000001
INFO[0000] received: 161c141276657261636b000000000000000000005df6e0e2
```

What has happened? 

We received two messages from the `btcd` node! They are:

1. `version`, contains information about the other node's version.
1. `verack`, the "acknowledged" message.

You can know this by looking at the logs of the `btcd` node:
```shell
[DBG] PEER: Received version (agent /Satoshi:5.64/tinybit:0.0.1/, pver 70015, block -1) from 127.0.0.1:55154 (inbound)
[DBG] PEER: Negotiated protocol version 70013 for peer 127.0.0.1:55154 (inbound)
[INF] SYNC: New valid peer 127.0.0.1:55154 (inbound) (/Satoshi:5.64/tinybit:0.0.1/)
[DBG] PEER: Sending version (agent /btcwire:0.5.0/btcd:0.12.0/, pver 70013, block 0) to 127.0.0.1:55154 (inbound)
[DBG] SRVR: New peer 127.0.0.1:55154 (inbound)
[DBG] PEER: Connected to 127.0.0.1:55154
[DBG] PEER: Sending verack to 127.0.0.1:55154 (inbound)
```

As you can see, we have successfully communicated with another Bitcoin node! 
Congratulations!

The `btcd` node correctly decoded our message and replied to it. 
It sent `version` and `verack` messages as part of "version handshake" procedure.

Right now, we can also make the `btcd` node to send one more message, `getblocks`.
Try changing `StartHeight` to `0` in `MsgVersion` and see what happens.

### Conclusion

That's enough for today! 
In the next part, we'll improve serialization by implementing our own `binary` package. 
We'll implement messages deserialization and will finish "version handshake".
And maybe something more 😉

### Links

1. Full code: [Jeiwan/tinybit/part_1](https://github.com/Jeiwan/tinybit/tree/part_1)
1. [Bitcoin Protocol Specificaiton](https://en.bitcoin.it/wiki/Protocol_documentation#version)
1. [IPv6/IPv4 Address Embedding](http://www.tcpipguide.com/free/t_IPv6IPv4AddressEmbedding-2.htm)
1. [btcd](https://github.com/btcsuite/btcd)


**If you have any ideas how to improve the code, please [submit an issue](https://github.com/Jeiwan/tinybit/issues)!**