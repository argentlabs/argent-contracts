# Argent Wallet Smart Contracts

The Argent wallet is an Ethereum Smart Contract based mobile wallet. The wallet's user keeps an Ethereum account (Externally Owned Account) secretly on his mobile device. This account is set as the owner of the Smart Contract. User's funds (ETH and ERC20 tokens) are stored on the Smart Contract. With that model, logic can be added to the wallet to improve both the user experience and the wallet security. For instance, the wallet is guarded, recoverable, lockable, and upgradable.

See full specifications [here](specifications/specifications.pdf)

## Install

Ensure the correct node version is installed:
```
nvm install `cat .nvmrc`
```

Before installing, checkout the `argent-trustlists` repo in the same folder as `argent-contracts`. This way it will be easier to develop on both repos simultaneously.
```
git clone https://github.com/argentlabs/argent-trustlists.git ../argent-trustlists
```

Install requirements with npm:
```
npm install
```

## Compile

Compile whole project
```
npm run cc
```

Compile only external contracts:
```
npm run compile:lib
```

Compile only contracts:
```
npm run compile
```

Compile only test contracts:
```
npm run compile:test
```

Copy the precompiled artefacts to the build directory:
```
npm run provision:lib:artefacts
```


## Test

Add a `.env` file in the root of the directory with the `INFURA_KEY` property set to your Infura API key.

Launch ganache:
```
npm run ganache
```

Run the tests:
```
npm run test
```

To run coverage testing:
```
npm run test:coverage
```
You need to not have `ganache` running with this as it uses own instance. 

## License

Released under [GPL-3.0](LICENSE)
