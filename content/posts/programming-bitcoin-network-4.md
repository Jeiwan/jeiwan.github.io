---
title: "Programming Bitcoin Network, part 4"
date: 2020-01-22T00:00:00+00:00
tags: [Golang, Blockchain, Bitcoin]
---

Previous parts:

1. [Part 1](https://jeiwan.net/posts/programming-bitcoin-network/)
1. [Part 2](https://jeiwan.net/posts/programming-bitcoin-network-2/)
1. [Part 3](https://jeiwan.net/posts/programming-bitcoin-network-3/)


> DISCLAIMER. In these blog posts I describe only significant changes I made to the code
since the last part. There are also insignificant refactorings and improvements I make
along the way and don't explain them here for brevity. Please, check these links to
see all the changes:

> *Full code of this part: [Jeiwan/tinybit/part_4](https://github.com/Jeiwan/tinybit/tree/part_4)*

> *Changes since the previous part: [part3...part4](https://github.com/Jeiwan/tinybit/compare/part_3...part_4#files)*


## Introduction

In the last part, we learned to keep our node connected to another node, check liveliness
of peers, and receive transactions.
We also set a goal of building a mempool monitor.

In this part we'll face some difficulties that'll make us change the goal.
It turns out, building a mempool monitor requires implementing a mechanism that's beyond
the scope of this series and that requires a separate series of posts.

But don't get disappointed! We'll set a new goal! And let's first try to build a mempool monitor to see why it's too difficult.

## Mempool
Mempool is a data structure that keeps all unconfirmed (i.e. not included in any block)
transactions in memory.
As soon a transaction was added to a block and the block was mined, the transaction gets
removed from mempool.

> Miners trend to order transactions in mempool by amount of fees, but that's not
mandatory. Any miner can take any transaction from mempool and put it in a block.

Where mempool is stored? **On every node in the network (that opted in)**.
Are there content rules that enforce the content of mempool? **Nope**. Every node has its own
mempool. While there might be discrepancies between mempools of different nodes (caused
by network latency, for example), this doesn't bring any danger or harm.

When you create, sign, and send a new transaction, it's received by all other nodes in 
the network and is stored in their mempools.
When a new block containing your transaction is mined, it gets delivered to all nodes
and each node removes your (and other transactions from the block) from its mempool.

> What happens if the only node holding your transaction in its mempool crushes? Right,
your transaction disappears.

### Mempool in code

We'll keep following the "share memory by communicating" approach when implementing
mempool. So, `Mempool` looks like so:

```go
type Mempool struct {
    NewBlockCh chan protocol.MsgBlock
    NewTxCh    chan protocol.MsgTx
    
    txs map[string]*protocol.MsgTx
}
```

`NewBlockCh` receives new blocks, `NewTxCh` receives new transactions, and `txs` is the
mempool state. We have to make it a field in the structure because we'll want to access
it from outside later.

`txs` uses transaction hashes as keys, but we haven't yet implemented transaction hash
calculation. Let's fix this:
```go
// protocol/msg_tx.go
func (tx MsgTx) Hash() ([]byte, error) {
    serialized, err := tx.MarshalBinary()    

    hash := sha256.Sum256(serialized)
    hash = sha256.Sum256(hash[:])    
    txid := hash[:]    

    sort.SliceStable(txid, func(i, j int) bool {
        return true
    })    

    return txid, nil
}
```
Transaction hash is basically a double-SHA-256 hash of raw transaction. And because
Bitcoin uses little-endian byte ordering, we need to reverse the hash to get actual
transaction hash that can be recognized by other nodes.

Now we're ready to run `Mempool`:

```go
// node/mempool.go
func (m Mempool) Run() {
    for {
        select {
        case tx := <-m.NewTxCh:
            hash, err := tx.Hash()

            txid := hex.EncodeToString(hash)
            m.txs[txid] = &tx
        }
    }
}
```
Running `Mempool` simply handles new transactions and blocks. When a new
transaction comes, it's added to the mempool; when a new block comes, mined transactions
are removed from the mempool.
We'll add blocks handling a little bit later.

No, lets add `Mempool` to `Node`:

```go
// node/node.go
type Node struct {
    ...
    mempool *Mempool
}
```
We'll have it in a private field because mempool is an internal mechanism of the node.

Run the mempool:
```go
// node/node.go
func (no Node) Run(nodeAddr string) error {
    ...
    go no.monitorPeers()
    go no.mempool.Run()
    ...
}
```

Now we can add new transactions to the mempool:
```go
// node/cmd_tx.go
func (no Node) handleTx(header *protocol.MessageHeader, conn io.ReadWriter) error {
    var tx protocol.MsgTx
    ...

    no.mempool.NewTxCh <- tx

    return nil
}
```

That's actually it for the mempool. But how do we peek at the mempool when our node
is running?

## Mempool monitor
Currently, our node keeps everything internally and doesn't allow to access its state
from the outside. Until this moment this was fine, but now we want to be able to see 
transactions in the mempool. In the end, this is what mempool monitor is for!

### JSON-RPC interface
We're going to add RPC interface to our node to allow seeing current mempool state,
and we'll use JSON as data encoding algorithm.

RPC stands for *remote procedure call* protocol, which basically means calling
functions/methods on a remote server over HTTP or TCP. We'll use JSON-RPC protocol,
which uses JSON to encode protocol messages. Golang has `net/rpc` and `net/jsonrpc` packages that implement the protocol, so let's use them.

When implementing a REST interface you're using an HTTP server and define
request handlers (in web-frameworks, they're called controllers) that handle incoming requests.
Each handler is assigned to a separate HTTP path and method.

When implementing a RPC interface you're defining a structure and its methods, and its
these methods that are called remotely. **RPC makes remote method calls look like they're
local**.

Thus, we need to define a structure that we'll implement the interface:
```go
// rpc/rpc.go
type Node interface {
    Mempool() map[string]*protocol.MsgTx
}

type RPC struct {
    node Node
}
```
We called the structure simply `RPC`. It needs to communicate with the node to get data
from it. Following best Golang practices we're defining `Node` interface that connects
`RPC` and `Node`, and defines what `Node` methods are available to `RPC`. As I said
above, we need a way to read the mempool from outside the node, let's add a public
method `Mempool` method:

```go
// node/mempool.go
func (n Node) Mempool() map[string]*protocol.MsgTx {
    m := make(map[string]*protocol.MsgTx)

    for k, v := range n.mempool.txs {
        m[string(k)] = v
    }

    return m
}
```
The method makes a copy of the mempool and returns it. We don't want to return actual
mempool because it's an internal part of the node. We also don't care if something is
being added or removed from the mempool at this moment; we're just making a copy of
what's in there return it.

Now, let's add our first and only RPC method:
```go
// rpc/rpc.go
type MempoolArgs interface{}
type MempoolReply string

func (r RPC) GetMempool(args *MempoolArgs, reply *MempoolReply) error {
    txs := r.node.Mempool()

    *reply = MempoolReply(formatMempoolReply(txs))

    return nil
}
```

> If you've ever worked with GRPC, you'll notice the similarity: here, we also have to
define custom argument types.

The method simply gets a copy of mempool and writes it to `reply`. Let's look at the
formatting function:
```go
func formatMempoolReply(txs map[string]*protocol.MsgTx) string {
    var result string

    for k := range txs {
        result += fmt.Sprintf("%s\n", k)
    }
    result += fmt.Sprintf("Total %d transactions", len(txs))

    return result
}
```
It defines what we want the output of `GetMempool` call look like. In this case, it's a
list of transaction IDs and a total transactions counter. We won't need more information,
but feel free to add something else here.

This is all we need to define the interface. No, let's add a way to expose it.

> There were no mentions of JSON. At this point we only defined an interface in pure Go code following some specific requirements.

### JSON-RPC server
RPC server is responsible for reading data from a connection, parsing it, handling, 
and sending a reply. Pretty similar to HTTP server, but we don't need to define
paths and there are no methods.

```go
// rpc/server.go
type Server struct {
    port int
    rpc  *rpc.Server
}
```
Our `rpc.Server` is a wrapper around the `Server` from `net/rpc` package. It'll
additionally hold a port number so we could later run the server on the specified port.

```go
func NewServer(port int, node Node) (*Server, error) {
    rpcs := rpc.NewServer()

    handlers := RPC{node: node}
    if err := rpcs.Register(handlers); err != nil {
        return nil, err
    }

    s := Server{
        port: port,
        rpc:  rpcs,
    }

    return &s, nil
}
```

`rpcs` is the actual RPC server. In Golang, it's an abstraction that doesn't depend on
transport layer: we can use TCP or HTTP, RPC server doesn't need to know which we choose.

`Register` method registers our interface `RPC` on this server. Now, the server can
handle the `GetMempool` call we defined earlier.

Final step: running the server.
```go
func (s Server) Run() {
    l, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))

    for {
        conn, err := l.Accept()

        go s.rpc.ServeCodec(jsonrpc.NewServerCodec(conn))
    }
}
```
As you can see, we're simply listening on a TCP port, and as soon as there's a new
connection, it's wrapped in a JSON-RPC codec and passed to the RPC-server.
The codec does JSON encoding/decoding for us and the RPC-server parses RPC messages and
calls corresponding methods.

This is all we need to have an RPC server!

Now, let's run it together with the node:
```go
// cmd/tinybit.go
func init() {
    tinybitCmd.Flags().IntVar(&jsonrpcPort, "jsonrpc-port", 9334, "Port to listen JSON-RPC connections on")
    ...
}

var tinybitCmd = &cobra.Command{
    Use: "tinybit",
    RunE: func(cmd *cobra.Command, args []string) error {
        node, err := node.New(network, userAgent)

        rpc, err := rpc.NewServer(jsonrpcPort, node)
		
        logrus.Infof("Running JSON-RPC server on port %d", jsonrpcPort)
        go rpc.Run()
        ...
    }
}
```

Now, we need a client to connect to the server and call RPC methods.

### JSON-RPC client
A general practice is to separate RPC server and client by running the server in the
background and providing a separate CLI tool to interact with the server.
For simplicity, we'll keep these things together and define a new CLI command, `showmempool`:

```go
// cmd/showmempool.go
func init() {
    showMempoolCmd.Flags().IntVar(&jsonrpcPort, "jsonrpc-port", 9334, "JSON-RPC port to connect to.")
}

var showMempoolCmd = &cobra.Command{
    Use: "showmempool",
    RunE: func(cmd *cobra.Command, args []string) error {
        // TODO: call 'GetMempool' RPC method

        return nil
    },
}
```
The command should call the `GetMempool` RPC method and print the response. To do this,
we need a JSON-RPC client:
```go
// rpc/client.go
type Client struct {
    conn    net.Conn
    jsonrpc *rpc.Client
}

func NewClient(port int) (*Client, error) {
    conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))

    c := jsonrpc.NewClient(conn)

    client := &Client{
        conn:    conn,
        jsonrpc: c,
    }

    return client, nil
}
```
Our `rpc.Client` is a thin wrapper around a TCP connection and Golang's JSON-RPC client.
We're saving a TCP connection because we want to close it later, even though
`jsonrpc.NewClient(conn)` also wraps it.

To call RPC methods we're just calling the underlying `jsonrpc.Call` passing all
the arguments as is:
```go
func (c Client) Call(serviceMethod string, args interface{}, reply interface{}) error {
    return c.jsonrpc.Call(serviceMethod, args, reply)
}
```

Don't forget to close a connection when we're done:
```go
func (c Client) Close() {
    c.conn.Close()
}
```

And now we're ready to finish the `showmempool` command:
```go
// cmd/showmempool.go
...
    RunE: func(cmd *cobra.Command, args []string) error {
        c, err := rpc.NewClient(jsonrpcPort)
        defer c.Close()

        var reply string
        if err := c.Call("RPC.GetMempool", nil, &reply); err != nil {
            return err
        }

        fmt.Println(reply)

        return nil
    },
...
```
Here, we're calling "RPC.GetMempool" procedure, where "RPC" is the name of our interface (`RPC` structure, remember?) and "GetMempool" is the name of the method.


### Checking mempool
Let's send a transaction and see if it gets to the mempool:
```shell
// run btcd and create default and 'alice' wallet accounts
$ btcd --configfile ./btcd.conf
$ btcwallet -C ./btcwallet.conf --create
$ btcwallet -C ./btcwallet.conf
$ btcctl -C ./btcctl-wallet.conf walletpassphrase PASSPHRASE 3600
$ btcctl -C ./btcctl-wallet.conf createnewaccount alice
// generate some BTC
$ btcctl -C ./btcctl-wallet.conf getnewaddress
MINER_ADDRESS
$ btcctl -C ./btcctl-wallet.conf getnewaddress alice
ALICE_ADDRESS
$ btcd --configfile ./btcd.conf --miningaddr=MINER_ADDRESS
$ btcctl -C ./btcctl.conf generate 101
$ btcctl -C ./btcctl-wallet.conf getbalance
50
// send a transaction
$ DEBUG=1 tinybit
$ btcctl -C ./btcctl-wallet.conf sendtoaddress ALICE_ADDRESS 0.00001
// check the mempool
$ tinybit showmempool
285a5fc96a492661809145ee7578dc570fac4da1249715f8217423aaa963bcd8
Total 1 transactions
```

Yay!

## 'block' message
Our node only adds to the mempool, but not removes from it. To remove transactions we
need to know what transactions were mined. And to know this, we need to learn to receive
and process new blocks. Let's begin with 'block' message:
```go
// protocol/block.go
type MsgBlock struct {
    Version    int32
    PrevBlock  [32]byte
    MerkleRoot [32]byte
    Timestamp  uint32
    Bits       [4]byte
    Nonce      uint32
    TxCount    uint8
    Txs        []MsgTx
}
```
Let's review the fields:

1. `Version` specifies block version based on software used to mine this block.
2. `PrevBlock` is the hash of the previous block.
3. `MerkleRoot` is the root of a Merkle tree that has all block transactions as its
nodes. Having such tree helps to check if a certain transaction included in a block
without getting all block transactions.
4. `Timestamp` is the moment when the block was mined.
5. `Bits` contains compressed difficulty target that was used to mine this block. This field is explained below.
6. `Nonce` is a random number that was used to get the block hash that satisfies the difficulty target stored in `Bits`.
7. `TxCount` and `Txs` are the number of transactions in this block and the list of all transactions.

First 6 fields in this exact order former block header, which is used to calculate
block hash. We'll use this information later in this post.

> Because of `TxCount` and `Txs` fields, we have to implement a custom `UnmarshalBinary`
method so our binary decoding library can decode raw 'block' messages. I omitted this
part for brevity.

Now we're ready to handle 'block' messages in the node:
```go
// node/cmd_block.go
func (no Node) handleBlock(header *protocol.MessageHeader, conn io.ReadWriter) error {
    var block protocol.MsgBlock

    lr := io.LimitReader(conn, int64(header.Length))
    if err := binary.NewDecoder(lr).Decode(&block); err != nil {
        return err
    }

    no.mempool.NewBlockCh <- block

    return nil
}
```

And let's tell the mempool how to process new blocks:
```go
// node/mempool.go
func (m Mempool) Run() {
    for {
        select {
        case tx := <-m.NewTxCh:
            ...

        case block := <-m.NewBlockCh:
            for _, tx := range block.Txs {
                hash, err := tx.Hash()

                txid := hex.EncodeToString(hash)
                delete(m.txs, txid)
            }
        }
    }
}
```

As simple as that!

Let's reproduce the test scenario and mine a new block after sending BTC to Alice:

```shell
...
$ tinybit showmempool
285a5fc96a492661809145ee7578dc570fac4da1249715f8217423aaa963bcd8
Total 1 transactions
$ btcctl -C ./btcctl.conf generate 1
$ tinybit showmempool
Total 0 transactions
```

It worked!

The mempool is working, but there's a huuuge flaw...

## Verification
We cannot simply add to the mempool any transaction that comes and we cannot simply
accept any block that the node receives. We have to verify all transactions an all
blocks. And the problem is that **transaction verification goes far beyond the scope of
this blog series**. To make our mempool 100% valid, we have to use the same verification
rules as mining nodes use. We just cannot accept any transactions that are not accepted
byt mining nodes. This protects the network from spamming: if someone submits an invalid
transaction it'll get rejected quickly and won't get to mempools. If someone wants to
spam the network with transactions, they have to construct valid transactions and, thus,
they have to pay for including them in blocks. And it's transaction fees that prevent the network from spamming.

So, to build a valid mempool we need to implement full transaction verification process.
This includes signatures verification, which is really not difficult, but since
signatures a part of transaction scripts, we also need to verify the scripts as well.
And this means we need a virtual machine that executes Bitcoin scripts and that's fully
compatible with Script language specification. That's too difficult!

Thus, we'll set a different goal, that looks more realistic. We'll make this node an
**SPV-node**. SPV stands for Simplified Payment Verification, which is a method for
verification if particular transaction is included in a block. This method is used in
lightweight Bitcoin nodes and wallets. **We'll try to make our node a light Bitcoin node
that builds full chain without downloading full blocks and without verifying all
transactions.**
And we'll try to figure out how SPV clients validate payments by downloading only block
headers.

But since we've started the mempool monitor, let's add some simple verification rules
to demonstrate what they should look like. And, of course, feel free to add more (or all) of them!

### Basic transaction verification
Here's the full list of transaction verification rules: ['tx' verification rules](https://en.bitcoin.it/wiki/Protocol_rules#.22tx.22_messages).
Let's only verify that a transaction has correct number of inputs and outputs, that'll
be enough for a demo:
```go
// protocol/msg_tx.go
func (tx MsgTx) Verify() error {
    if len(tx.TxIn) == 0 || tx.TxInCount == 0 {
        return errInvalidTransaction
    }

    if len(tx.TxOut) == 0 || tx.TxOutCount == 0 {
        return errInvalidTransaction
    }

    return nil
}
```
Now, we can verify transactions before adding them to the mempool:
```go
// node/cmd_tx.go
func (no Node) handleTx(header *protocol.MessageHeader, conn io.ReadWriter) error {
    ...
    if err := tx.Verify(); err != nil {
        return fmt.Errorf("rejected invalid transaction %x", hash)
    }

    no.mempool.NewTxCh <- tx
    ...
}
```

### Basic block verification
For blocks verification we'll do a more interesting thing: let's check if block hash is
correct, i.e. it matches the difficulty target.

The difficulty target is a 32 byte sequence that contains a number that's used as a
threshold. Miners need to find such block hash that's less than this number, by
manipulating `Nonce` field. The more hashpower in the network, the lower the threshold
and the more difficult it is to find new blocks. The `Bits` field stores
difficulty target, and we need to unpack it before we can compare it with block hash.

```go
// protocol/msg_block.go
func (blck MsgBlock) unpackBits() []byte {
    bits := make([]byte, len(blck.Bits))
    copy(bits, blck.Bits[:])
    sort.SliceStable(bits, func(i, j int) bool { return true })

    target := make([]byte, 32)
    i := 32 - bits[0]
    target[i] = bits[1]
    target[i+1] = bits[2]
    target[i+2] = bits[3]

    return target
}
```
First three lines allow us to reverse the content of `Bits` field without modifying the
actual field value. Again, we need this because Bitcoin uses little-endian order for storage, and we want big-endian order here.

First byte of `Bits` is the exponent. In other words, it's the number of digits in the
threshold. Since block hash is a 32 byte sequence, we use 32 byte target that has `n`
zero-bytes in the beginning, where `n = 32 - bits[0]`. The lower the threshold, the
smaller the exponent, thus there's a gap. The rest three bytes of `Bits` are the first
three bytes of the threshold number. The rest bytes are zeros.

Let's look at a real block:
[614 135](https://blockstream.info/block/0000000000000000001138a163e7747a3c3bbb92f10607969baf481091e709c1). Click 'Details'
button to see the block's `Bits` field value: `0x17130c78`.

1. The byte sequence is already big-endian, we don't need to revert it.
1. `17` is the exponent, which is 23 in decimal system. There are 23 digits in the number.
1. `130c78` are the mantissa, or the first three bytes of the 23 byte sequence.
1. Let's build the threshold:
    ```
    00 00 00 00 00 00 00 00 00 13 0c 78 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    ```
1. Now let's see if the block hash is less than this threshold (T is threshold, H is block hash):
    ```
    T: 00 00 00 00 00 00 00 00 00 13 0c 78 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    H: 00 00 00 00 00 00 00 00 00 11 38 a1 63 e7 74 7a 3c 3b bb 92 f1 06 07 96 9b af 48 10 91 e7 09 c1
    ```
1. It definitely is! So, this is a valid block.

Hopefully, this is clear. I tried to explain this in simple words, if you want to get
a more comprehensive explanation, please refer to
['Target nBits' section of Bitcoin Developer Reference](https://bitcoin.org/en/developer-reference#target-nbits).


Now, we need to calculate block hash:
```go
// protocol/msg_block.go
func (blck MsgBlock) Hash() ([]byte, error) {
    raw, err := blck.MarshalHeader()

    hash := sha256.Sum256(raw)
    hash = sha256.Sum256(hash[:])
    blockHash := hash[:]

    sort.SliceStable(blockHash, func(i, j int) bool { return true })

    return blockHash, nil
}
```

As I said above, first 6 fields of `MsgBlock` form block header, and it's this header
that we need to hash to get block hash. `MarshalHeader` serializes these 6 fields (I omitted
its code for brevity). And again, we need to reverse bytes in the hash.

Finally, the block verification function:
```go
// protocol/msg_block.go
func (blck MsgBlock) Verify() error {
    target := blck.unpackBits()

    hash, err := blck.Hash()

    targetNum := big.NewInt(0).SetBytes(target)
    hashNum := big.NewInt(0).SetBytes(hash)

    // Block hash must be <= target threshold
    if hashNum.Cmp(targetNum) > 0 {
        return errInvalidBlockHash
    }

    return nil
}
```
It basically does what we discussed above: it gets difficulty target from `Bits` field,
calculates block hash, and checks if the hash is less or equal to the target.

We can now verify blocks before processing them:
```go
// node/cmd_block.go
func (no Node) handleBlock(header *protocol.MessageHeader, conn io.ReadWriter) error {
    ...
    if err := block.Verify(); err != nil {
        return fmt.Errorf("rejected invalid block %x", hash)
    }

    no.mempool.NewBlockCh <- block
    ...
}
```

## Conclusion
That's it for today! Again, this was a very long post and I hope you learned something
new about Bitcoin from it. See you in next posts where we'll continue building our
SPV-node. 😉

## Links
1. Full code of this part: [Jeiwan/tinybit/part_4](https://github.com/Jeiwan/tinybit/tree/part_4)
1. Changes since the previous part: [part3...part4](https://github.com/Jeiwan/tinybit/compare/part_3...part_4#files)
1. ['tx' verification rules](https://en.bitcoin.it/wiki/Protocol_rules#.22tx.22_messages)
1. ['block' verification rules](https://en.bitcoin.it/wiki/Protocol_rules#.22block.22_messages)
1. ['Target nBits' in Bitcoin Developer Reference](https://bitcoin.org/en/developer-reference#target-nbits)