---
title: "Programming the Bitcoin Network, Part 2"
date: 2019-11-17T15:29:48+07:00
tags: [Golang, Blockchain, Bitcoin]
---

Previous part: [here](https://jeiwan.net/posts/programming-bitcoin-network/)

> DISCLAIMER. In these blog posts I describe only significant changes I made to the code
since the last part. There are also insignificant refactorings and improvements I make
along the way and don't explain them here for brevity. Please, check these links to
see all the changes:

> *Full code of this part: [Jeiwan/tinybit/part_2](https://github.com/Jeiwan/tinybit/tree/part_2)*

> *Changes since the previous part: [part1...part2](https://github.com/Jeiwan/tinybit/compare/part_1...part_2#files)*


## Introduction

So far, we built a very basic Bitcoin node that connects to the network and sends `version` message.
Before adding new feature and messages, we need to ensure that messages serialization is solid and will work for any of the new messages we'll add soon.

Also, to be able to process messages coming from other nodes in the network we need to implement messages deserialization.
Deserialization is opposite to serialization: we receive byte sequences from other nodes and decode them to data structures.
However, deserialization will be slightly different because bytes are sent over a TCP connection and TCP connections are stream.

At the end of this post, we'll implement `verack` message to ensure everything works and adding new messages is as easy as creating a Golang structure.

Let's begin!


## Improving Messages Serialization
This is how we're serializing messages at this stage:
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
I.e. we're implementing serialization per each message.
But the key point is that serialization is type-based, not message-based.
It's types that has unique (identical for most of them though) serialization methods, not structures.

Eventually, we'll have more messages than types, and since messages consist of types, it makes no sense implementing message-base serialization.
Instead, we should implement a more general way of serialization, so every new message we'll add in the future is automatically supported and doesn't require a `Serialize` method
(unless it contains types that we haven't implemented serialization for yet or unless it requires unique serialization method, like the IPv4 type).

What do we want to have?

Golang provides interfaces, functions, and method for common encoding/serialization algorithms.
So, it makes pretty much sense to not invent a wheel and just follow these practices.

The most known and used encoding library provided by Golang is `encoding/json`.
It provides two ways of data encoding and decoding:

1. Streaming one, which is implemented by a pair of `Decoder`/`Encoder` structs that implement `Decode`/`Ecode` methods, which allow to decode raw data from input stream and write encoded data to output stream.
1. Non-streaming one, which is implemented by well-known `Marshaler`/`Unmarshaler` interfaces, `MarshalJSON`/`UnmarshalJSON` methods, and `Marshal`/`Unmarshal` functions.
I'm sure you're already familiar with them.

This approach is clean and straightforward, so let's also use it.

For serialization, we'll implement the non-streaming approach because, before starting serializing, we already have all the data we need.

For deserialization, we'll implement the streaming approach because the node will be reading serialized messages from a TCP connection, which is a stream.

### binary.Marshal
Create `binary` subfolder and `marshaler.go` in it:
```go
// binary/marshaler.go
func Marshal(v interface{}) ([]byte, error) {
    	var buf bytes.Buffer
```
1. We're using the same function signature as in `json.Marshal`.
2. `buf` will contain encoded data.

```go
	switch val := v.(type) {
	case uint8, int32, uint32, int64, uint64, bool:
		if err := binary.Write(&buf, binary.LittleEndian, val); err != nil {
			return nil, err
		}
```
Basically, the only thing the function does is checking the type of `v` and choosing appropriate encoding algorithm.
Here, we're using `binary.Write` (from the standard `encoding/binary` package) to encoding integers and boolean types.

```go
	case uint16:
		if err := binary.Write(&buf, binary.BigEndian, val); err != nil {
			return nil, err
		}
```
Next, we're encoding port number.
Port number is always stored as `uint16` type and is always encoded using big-endian bytes order (unlike the integers above).

```go
	// const (
	//      commandLength          = 12
	//      magicAndChecksumLength = 4
	// )
	case [magicAndChecksumLength]byte:
		if _, err := buf.Write(val[:]); err != nil {
			return nil, err
		}

	case [commandLength]byte:
		if _, err := buf.Write(val[:]); err != nil {
			return nil, err
		}

	case []byte:
		if _, err := buf.Write(val); err != nil {
			return nil, err
		}
```
Next, we're encoding magic bytes, checksum, command, and bytes slice.
All arrays and byte slices are serialized identically: bytes are written to the buffer directly, there's no need to encode them additionally.

```go
	case string:
		if _, err := buf.Write([]byte(val)); err != nil {
			return nil, err
        }
```
Strings are converted to bytes slices and are written to the buffer directly.

```go
	case Marshaler:
		b, err := val.MarshalBinary()
		if err != nil {
			return nil, err
		}

		if _, err := buf.Write(b); err != nil {
			return nil, err
        }
```
Here's an interesting part: if the type implements `Marshaler` interface, call `MarshalBinary` method to serialize it.
We discussed this earlier: we need custom serialization algorithms for some types.
And `Marshaler` interface is as simple as:
```go
type Marshaler interface {
	MarshalBinary() ([]byte, error)
}
```

Final part of `Marshal` function:
```go
	default:
		if reflect.ValueOf(v).Kind() == reflect.Struct {
			b, err := marshalStruct(v)
			if err != nil {
				return nil, err
			}

			if _, err := buf.Write(b); err != nil {
				return nil, err
			}

			break
		}

		return nil, fmt.Errorf("unsupported type %s", reflect.TypeOf(v).String())
	}

	return buf.Bytes(), nil
}
```
Since `struct` is not a type, we need to use a more advanced way to checks if `v` is a structure.
Standard `reflect` package really helps here.

Ho do we serialize structs?
Well, structures are collections of fields, so we need to iterate over all fields, serialize each of them separately, and concatenates the result.
This can be done in a nice and small function:
```go
func marshalStruct(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	vv := reflect.ValueOf(v)

	for i := 0; i < vv.NumField(); i++ {
		s, err := Marshal(reflect.Indirect(vv.Field(i)).Interface())
		if err != nil {
			f := reflect.TypeOf(v).Field(i).Name
			return nil, fmt.Errorf("failed to marshal field %s: %v", f, err)
		}

		if _, err := buf.Write(s); err != nil {
			return nil, err
		}
	}

	return buf.Bytes(), nil
}
```
Again, we're using `reflect` package to get the number of fields in a struct and get each field separately.
Passing a struct to `reflect.ValueOf` will return the struct itself but as a `reflect.Value` type, which we can reflect on. 😉

That's it for serialization! Now, we don't need `Serialize` methods anymore on `Message` and `MsgVersion` types.
They can be removed.
Also, `ToIPv6` method of `IPv4` struct now should be changed to `MarshalBinary() ([]byte, error)` – this is now a custom implementation of `binary.Marshaler`.

Now, we can use `binary.Marshal` to serialize messages:
```go
msg, err := protocol.NewMessage("version", network, version)
msgSerialized, err := binary.Marshal(msg)
```

## Implementing Deserialization
Currently, our node can receive messages from other nodes but it cannot decode them.
It just prints out raw bytes.
But a real node has to know what messages it receives, validate them, and handle them.
To achieve this we need to implement messages deserialization, i.e. reading of raw bytes from a TCP connection (already implemented) and converting them to message structures.

Deserialization is opposite to serialization: we take a bytes sequence and convert it to a structure by:

1. splitting it into pieces (one piece per struct field),
1. decoding (where necessary),
1. and assigning decoded values to struct fields.

This implies that **we must have full message** before deserializing it.
But there's a problem: **TCP connections are streams**.
When reading from a TCP connection, there is just a continuous sequence of bytes, TCP doesn't support splitting of this sequence into separate messages.
If a node sends us multiple messages at the same time, we'll receive them as one long sequence of bytes.
But we need to get something complete and discrete before starting deserialization.

This is where proper network protocol design comes into play.

Let's take a look at `Message` struct:
```go
type Message struct {
	Magic    [magicLength]byte
	Command  [commandLength]byte
	Length   uint32
	Checksum [checksumLength]byte
	Payload  []byte
}
```
As you already know, this structure is used to wrap any message.
So, basically, this structure is a message header that contains meta information about the message.

> Pretty much similar to &lt;head&gt; and &lt;body&gt; HTML tags.

Also, as you can see, all the fields (besides `Payload`) have fixed size.
This means, that when our node receives something from a TCP connection, **we should expect a message header**.
If it's not a message header, then we don't know what it is and we don't support it.
And since message header has fixed size, we can read exactly `MsgHeaderLength` bytes from a TCP connection!

After our node has received, deserialized, and validated a message header, it knows:

1. What network this message is for.
1. What command it is.
1. What's the length of the message payload.

And since our node knows the length of message payload, it can start reading and decoding it!

Let's implement this!

### binary.Decoder
First, let's define `Decoder`:
```go
type Decoder struct {
	r io.Reader
}
```
`Decoder` does only one thing: it reads and decodes data from a stream (`io.Reader`).
It implements only one method: `Decode`, which is basically a function that:

1. Takes a pointer to a value of any supported type.
1. Checks the type of the pointer.
1. Reads proper number of bytes from the stream.
1. Properly decodes the bytes.
1. Saves the decoded value at the passed pointer.

Here's what it looks like:
```go
func (d Decoder) Decode(v interface{}) error {
	switch val := v.(type) {
	case *bool:
		if err := d.decodeBool(val); err != nil {
			return err
		}
```
And `decodeBool` is:
```go
func (d Decoder) decodeBool(out *bool) error {
	lr := io.LimitReader(d.r, 1)

	if err := binary.Read(lr, binary.LittleEndian, out); err != nil {
		return err
	}

	return nil
}
```
I use `io.LimitReader` here to read just a fixed amount of bytes from the connection.
In this particular case, only one byte is read, because `bool` type occupies only one byte.
Then, `binary.Read` (from the standard `encoding/binary` package) is used to read a byte, deserialize it, and put at the pointer passed as the function argument.

The same approach is applied to all other integer types.
There are only two differences:

1. Amount of bytes read (1 for `uint8`, 2 for `uint16`, etc.).
2. Order of bytes (big-endian of all integers except `uint16`, which uses little-endian order).

Now, let's move to byte arrays:
```go
	case *[magicAndChecksumLength]byte:
		err := d.decodeArray(magicAndChecksumLength, val)
		if err != nil {
			return err
		}

	case *[commandLength]byte:
		err := d.decodeArray(commandLength, val)
		if err != nil {
			return err
		}
```
And:
```go
func (d Decoder) decodeArray(len int64, out []byte) error {
	if _, err := io.LimitReader(d.r, len).Read(out); err != nil {
		return err
	}

	return nil
}
```
Decoding byte arrays is simple: we just need to read a bytes sequence of specific length and put it at the pointer.
No need to decode them.

Notice that we can deserialize arrays, but we cannot have a general way of deserialization of slices.
There's no way to know the length of slice before getting the value of slice.
The same goes for strings.

But, as you remember, we're using a string to store user agent.
Thus, we need a way to have custom deserialization algorithms.
This can be done easily by use of `Unmarshaler` interface:
```go
type Unmarshaler interface {
	UnmarshalBinary(r io.Reader) error
}
```

Similarly to `Marshaler`, it describes only one method, which does only one thing: deserializes a custom data type.
Unlike `MarshalBinary()`, this method takes a stream as its only argument.

Now we can decode `Unmarshaler`:
```go
	case Unmarshaler:
		err := val.UnmarshalBinary(d.r)
		if err != nil {
			return err
		}
```

Now, the final part: structs.
```go
	default:
		if reflect.ValueOf(v).Kind() == reflect.Ptr &&
			reflect.ValueOf(v).Elem().Kind() == reflect.Struct {
			if err := d.decodeStruct(v); err != nil {
				return err
			}
			break
		}

		return fmt.Errorf("unsupported type %s", reflect.TypeOf(v).String())
	}

	return nil
}
```
Pretty similar to what we did in serialization.
But here we're checking if this is a pointer to a struct, not simply a struct.
This is because `Decode` method must always receive a pointer as its only argument.

`decodeStruct` also looks familiar:
```go
func (d Decoder) decodeStruct(v interface{}) error {
	val := reflect.Indirect(reflect.ValueOf(v))

	for i := 0; i < val.NumField(); i++ {
		if err := d.Decode(val.Field(i).Addr().Interface()); err != nil {
			return err
		}

	}

	return nil
}
```
First, we need to get the value of the struct by its pointer.
`ValueOf(v)` returns a pointer to the struct, and `reflect.Indirect()` returns the value that the pointer points to, which is the actual struct.
Then, we iterate over struct's fields and decode each of them separately.
And this time we're calling `Addr()` on the field to get a pointer to it.

### Handling 'version' message

Alright, we have everything we need to start deserializing and handling messages.
Let's review how our node processes messages:

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
We use a buffer with the length of 256 bytes to read all incoming data to.
The length is arbitrary, I chose the number so that 'version' message fits.
If we want to correctly receive, deserialize, and handle message, we have to use a different size since Bitcoin messages have dynamic length.
Our node also must be able to correctly decode messages of any length.

Luckily, we already have everything we need.

First, the buffer length. As we already discussed, every message has a header of fixed size.
If we want to read a message, we have to read its header first.
This means, that the buffer size should be equal to the size of the message header!

```go
// MsgHeaderLength = magicLength + commandLength + checksumLength + 4
// 4 - payload length value
tmp := make([]byte, protocol.MsgHeaderLength)
```

Now, after receiving a message header, we can try to deserialize it.
Before doing this though, we have to split `Message` structure into two structures:

1. `MessageHeader`, which will include all the fields of `Message` except `Payload`.
1. `Message`, which will embed `MessageHeader` and include `Payload` field.

Like so:
```go
type MessageHeader struct {
	Magic    [magicLength]byte
	Command  [commandLength]byte
	Length   uint32
	Checksum [checksumLength]byte
}

type Message struct {
	MessageHeader
	Payload []byte
}
```

Now, we can try to deserialize the header:
```go
var msgHeader protocol.MessageHeader
if err := binary.NewDecoder(bytes.NewReader(tmp[:n])).Decode(&msgHeader); err != nil {
	logrus.Errorf("invalid header: %+v", err)
	continue
}
```
If header decoding fails, the node will just continue reading from the connection.

After the header was decoded, we must validate it.
As of now, we'll just validate magic and command:
```go
func (mh MessageHeader) Validate() error {
	if !mh.HasValidMagic() {
		return fmt.Errorf("invalid magic: %x", mh.Magic)
	}

	if !mh.HasValidCommand() {
		return fmt.Errorf("invalid command: %+v", mh.CommandString())
	}

	return nil
}

func (mh MessageHeader) HasValidCommand() bool {
	_, ok := commands[mh.CommandString()]
	return ok
}

func (mh MessageHeader) HasValidMagic() bool {
	switch mh.Magic {
	case MagicMainnet, MagicSimnet:
		return true
	}

	return false
}
```

If the header is correct, we can start handling the command:
```go
switch msgHeader.CommandString() {
case "version":
	if err := handleVersion(&msgHeader, conn); err != nil {
		logrus.Errorf("failed to handle 'version': %+v", err)
		continue
	}
}
```

Different handlers will use different message structures to decode messages, that's why, at this stage, we're only decoding the header.

As you remember, this whole procedure of versions exchanging is called "version handshake".
Its purpose is to let nodes know about each other and about their software and its version.
After nodes have exchanged versions, they save each other to theirs peers lists.
But as of now, we're not going to do this.
Instead, we'll just send a 'verack` message, which confirms that our node has received 'version' messages from the other node.

First, our node has to decode message payload:
```go
func handleVersion(header *protocol.MessageHeader, conn io.ReadWriter) error {
	var version protocol.MsgVersion

	lr := io.LimitReader(conn, int64(header.Length))
	if err := binary.NewDecoder(lr).Decode(&version); err != nil {
		return err
	}
```
Here we're decoding payload, which has type `[]byte`, as you remember.
And we do can decode it because the header has `Length` field, which specifies the amount of bytes we need to read.

> Here, we would also need to validate the payload and, if its correct, save the other node to our list of peers.
But we won't do this for now (this blog post is already long enough 😉).

Next, we'll send a 'verack' message in reply:
```go
	verack, err := protocol.NewVerackMsg("simnet")
	if err != nil {
		return err
	}

	msg, err := binary.Marshal(verack)
	if err != nil {
		return err
	}

	if _, err := conn.Write(msg); err != nil {
		return err
	}

	return nil
}
```

'verack' is just a message with empty payload:
```go
func NewVerackMsg(network string) (*Message, error) {
	magic, ok := Networks[network]
	if !ok {
		return nil, fmt.Errorf("unsupported network '%s'", network)
	}

	head := MessageHeader{
		Magic:    magic,
		Command:  newCommand("verack"),
		Length:   0,
		Checksum: checksum([]byte{}),
	}

	msg := Message{
		MessageHeader: head,
		Payload:       []byte{},
	}

	return &msg, nil
}
```

Let's see what's in the logs of the other node:
```
[DBG] PEER: Received verack from 127.0.0.1:63449 (inbound)
[DBG] SRVR: New peer 127.0.0.1:63449 (inbound)
```

Good!
It has received our 'verack' message and added as to its peers list!

That's it for today!
If you missed something, please check the full code [here](https://github.com/Jeiwan/tinybit/tree/part_2).

## Conclusion
Ooph!
It took longer this time. But have layed out a solid foundation that'll let concentrate on messages handling without caring about messages encoding/decoding (there will be bugs – remember this tweet 😉).

In the next part, we'll make a list of peers and start saving nodes in it.
Also, we're already very close to start implementing blockchain synchronization.
So maybe next time we'll manage to get blocks from the network and save them to a DB.

See you!

### Links

1. Full code of this part: [Jeiwan/tinybit/part_2](https://github.com/Jeiwan/tinybit/tree/part_2)
1. Changes since the previous part: [part1...part2](https://github.com/Jeiwan/tinybit/compare/part_1...part_2#files)



**If you have any ideas how to improve the code, please [submit an issue](https://github.com/Jeiwan/tinybit/issues)!**