---
title: "Uniswap V3 Development Book is Out!"
date: 2022-10-11T00:00:00+00:00
---

<p align="center">
<img src="https://uniswapv3book.com/images/book.jpg" alt="Uniswap V3 Development Book cover" width="480"/>
</p>

Today I'd like to announce the project I'd been working on for several months: [Uniswap V3 Development Book](https://uniswapv3book.com/) 🥳

This book is a continuation of my series on [Uniswap V1](https://jeiwan.net/posts/programming-defi-uniswap-1/) and [Uniswap V2](https://jeiwan.net/posts/programming-defi-uniswapv2-1/).
Let me tell you more about the book and why it is a great resource for learning advanced Solidity development.

## What's Inside

The book will guide you through building of a Uniswap V3 clone from scratch. We'll start with an empty [Foundry](https://github.com/foundry-rs/foundry)
project and will build a fully functioning Uniswap V3 clone in discrete steps. Uniswap V3 is a big project packed with
many bigger and smaller mechanics and algorithms. So, to make our journey lighter, we'll follow the Minimum Viable Product
principle: at each step, we'll focus only on one part of the Uniswap V3 implementation.

The book is split into multiple milestones:
1. in [Milestone 0](https://uniswapv3book.com/docs/introduction/introduction-to-markets/), you'll learn about market
makers, markets, and how decentralized exchanges (DEX) work in general;
1. in [Milestone 1](https://uniswapv3book.com/docs/milestone_1/introduction/), you'll make a simple DEX that's capable of
swapping tokens in one direction with pre-defined prices and amounts;
1. in [Milestone 2](https://uniswapv3book.com/docs/milestone_2/introduction/), we'll evolve our DEX implementation to
support swaps in both directions (selling and buying) and we'll start implementing mathematical calculations in Solidity;
1. [Milestone 3](https://uniswapv3book.com/docs/milestone_3/introduction/) will, probably, be the hardest part of the book:
in this milestone, we'll implement liquidity management and swaps over multiple liquidity positions–the most innovational
part of the Uniswap V3 design;
1. in [Milestone 4](https://uniswapv3book.com/docs/milestone_4/introduction/), we'll go beyond one Uniswap pool and implement
chained swaps, i.e. swaps between two tokens that don't have a common pool;
1. in [Milestone 5](https://uniswapv3book.com/docs/milestone_5/introduction/), we'll finish the implementation of our
Uniswap V3 clone by introducing swap fees and a price oracle;
1. in [Milestone 6](https://uniswapv3book.com/docs/milestone_6/introduction/), we'll see how Uniswap V3 can be extended
with third-party contracts to turn liquidity positions into NFT tokens.

But that's not all! Along the way, we'll build a front-end application in [React](https://reactjs.org/) that will imitate
[that of Uniswap](https://app.uniswap.org/) and will allow to perform swaps and provide/remove liquidity. While this front-end
application won't be our primary focus in the book (I'm a bad front-end developer 🙈), it'll show you how to build such
an app and how to integrate it with smart contracts that you built.

![Uniswap V3 Clone UI](https://github.com/Jeiwan/uniswapv3-book/raw/main/screenshot.png)

But that's also not all!

**Math!!** There will be a lot of math! [Some](https://uniswapv3book.com/docs/introduction/constant-function-market-maker/)
[chapters](https://uniswapv3book.com/docs/introduction/uniswap-v3/) [are packed](https://uniswapv3book.com/docs/milestone_1/calculating-liquidity/)
with mathematical formulas, but don't be scared–as soon as you get the core mathematical concepts of constant-function
market makers, the math of Uniswap V2 and V3 will make absolute sense. In case math is not something you feel confident
with, [Algebra 1](https://www.khanacademy.org/math/algebra) and [Algebra 2](https://www.khanacademy.org/math/algebra2)
courses on Khan Academy are more than enough to understand the math of Uniswap.

## Why Uniswap?

Uniswap is a unique project. It's one of the first DeFi (Decentralized Finance) projects that went from [zero to one](https://www.quora.com/What-does-the-term-zero-to-one-actually-mean):
1. it was one of the first decentralized exchanges;
1. its developers managed to find a simple and elegant solution (basically, the `x * y = k` equation);
1. it kicked off, gained traction, and became a reference DEX implementation that gave birth to endless clones.

While many smart contract developers are fond of Uniswap V2 due to its simplicity and elegancy, Uniswap V3 is seemed like
a bloated project with complex functionality. This is not true! And you'll see this 😁

Uniswap V3 is definitely the next step of smart contracts development. While its business logic is entirely based on Uniswap
V2 (which is just an implementation of the `x * y = k` formula), it pushes DEX development forward by using derived math
formulas and adding a *thick* layer of engineering on top of them. It's this extra layer of engineering that's seemed
complex by many developers. But you, a reader of this book, will see that this is not true and Uniswap V3 is not so
hard.

Finally, why I personally think Uniswap V3 is a great educational resource is that you do want to learn from complex
projects. As smart contract development evolves and projects are getting more advanced, you don't want to stick with simpler
projects and should *embrace the complexity*–this will pay off and you'll become a better developer. Uniswap V3 is a great
example of a complex project that's based on more-or-less simple ideas and that's been running in production for several
years and that has become [one of the biggest DeFi projects](https://defillama.com/)–this is the kind of projects you want to
strive to build as a smart contracts developer.

## Who is This Book For?

This book is not for beginners. I won't teach you Solidity. In fact, after reading a half of this book, you'll see that
Solidity is not a hard language and that the hardest part of smart contracts development is not Solidity but business logic
and state management. So, this book is for those who knows Solidity or who can pick it up while reading the book.

If decentralized exchanges and constant-function market makers is something new to you, reading [my series on Uniswap V2 development](https://jeiwan.net/posts/programming-defi-uniswapv2-1/)
will help you a lot. As I mentioned above, Uniswap V3 is entirely based on V2. This is why understanding Uniswap V2 will
make you journey through the book much easier, and it will also make your understanding of the V3 mechanics much deeper.

[**Enjoy Your Journey!**](https://uniswapv3book.com/)