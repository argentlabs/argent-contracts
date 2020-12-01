# Audit report

## Argent Protocol - module for management of NFT assets

## Authors

Adam Kolar

Nick Munoz-McDonald

## Files

- https://github.com/argentlabs/argent-contracts/blob/c17d3dff9ea194d16e4956c6795efa20df18e475/contracts/modules/NftTransfer.sol

### 1. NftTransfer module can be used to transfer erc20 assets

transferFrom(address,address,uint256) function is not exclusive to ERC721 interface and can be present on other types of contracts as well, most importantly on ERC20 contracts. This means the NftTransfer can be used to call ERC20 contracts too, while this doesn't break any security assumption right now, it is a side effect that should be documented and kept in mind. Alternatively, there could be a check that filters out ERC20 contracts before calling, for example using a call to totalSupply()

#### status 08/05/2019 - fixed

fixed in https://github.com/argentlabs/argent-contracts/blob/790729c7fa295934f750094abb13062b69c3379f/contracts/modules/NftTransfer.sol through addition of isERC721 method that implements checks to verify that a particular contract is in fact an ERC721 contract.
