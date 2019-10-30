# Argent Wallet Smart Contracts

The Argent wallet is an Ethereum Smart Contract based mobile wallet. The wallet's user keeps an Ethereum account (Externally Owned Account) secretly on his mobile device. This account is set as the owner of the Smart Contract. User's funds (ETH and ERC20 tokens) are stored on the Smart Contract. With that model, logic can be added to the wallet to improve both the user experience and the wallet security. For instance, the wallet is guarded, recoverable, lockable, protected by a daily limit and upgradable.

See full specifications [here](specifications/specifications.pdf)

## Install

Install requirements with npm:
```
npm install
```

Install etherlime:
```
npm install etherlime@2.2.4
```

## Compile

Compile the contracts:
```
npx etherlime compile --runs=200
```

## Test

Launch ganache:
```
npx etherlime ganache --gasLimit=10700000 -e 10000
```

Run the tests:
```
npx etherlime test --skip-compilation
```

## License

Released under [GPL-3.0](LICENSE)
