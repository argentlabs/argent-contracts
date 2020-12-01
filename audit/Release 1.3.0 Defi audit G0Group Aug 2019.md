# Audit report
## Argent Protocol - decentralised finance extension

## Authors

Adam Kolar

Nick Munoz-McDonald

## Files

### Phase 1

Files that have been originally part of the audit

https://github.com/argentlabs/argent-contracts/commit/9ba5a6ce954c45b6b9790ff792291888bea75e44

- contracts/defi/Invest.sol [I]
- contracts/defi/Leverage.sol [I]
- contracts/defi/Loan.sol [I]
- contracts/defi/utils/CompoundRegistry.sol

- contracts/defi/provider/CompoundV2Provider.sol
- contracts/defi/provider/MakerProvider.sol
- contracts/defi/provider/UniswapProvider.sol
- contracts/modules/InvestManager.sol
- contracts/modules/LeverageManager.sol
- contracts/modules/LoanManager.sol
- contracts/modules/common/ProviderModule.sol 

### Phase 2

After substantial changes due to audit findings some previous files have been removed and following files have been added:

https://github.com/argentlabs/argent-contracts/commit/9ba5a6ce954c45b6b9790ff792291888bea75e44

- contracts/modules/MakerManager.sol
- contracts/modules/UniswapManager.sol
- contracts/modules/CompoundManager.sol

## Issues

### 1. LoanManager functions are not protected

#### type: security / severity: critical

`LoanManager` external functions lack onlyWalletOwner modifier that protects them from being called by anyone.

#### status 08/05/2019 - fixed

fixed in: https://github.com/argentlabs/argent-contracts/commit/07ad4a8969fca918b8b5b191dcfbf4577c484097

### 2. Owner of ProviderModule has unprecedented power to control user wallets

#### type: centralisation / severity: high

Before `ProviderModule` has been introduced, behavior of all modules has been unchangeble and therefore predictable by users. The combination of `delegatecall` and its target being configurable by an owner address in case of `ProviderModule` makes its behavior completely unpredictable and gives the owner of the module de facto complete control of wallets using the `ProviderModule`.

#### status 08/05/2019 - fixed

Issue no longer present in https://github.com/argentlabs/argent-contracts/commit/a4bd3db291b006f6ce19847ed371f32b828fedf2, the whole system was reingeneered to no longer rely on `delegatecall`.

### 3. No obivous benefit to calling view functions through ProviderModule

#### type: efficiency / severity: low

In case of view functions of `ProviderModule` there seems to be no benefit to calling them through provider module and there's a downside of increased gas usage.

#### status 08/05/2019 - fixed

Issue no longer present in https://github.com/argentlabs/argent-contracts/commit/a4bd3db291b006f6ce19847ed371f32b828fedf2, the whole `ProviderModule` contract has been removed from the system.

## Issues found in Phase 2

### 4. Underflow in UniswapManager

#### type: unexpected behavior / severity: low

Possible underflow in UniswapManager on line 159, not exploitable in the current state of the system.

#### status 08/06/2019 - discussed, fixed

Fixed in https://github.com/argentlabs/argent-contracts/commit/1c6c5c9e5ad6bc726919d0b0f4315b1fcbda2ba8 by adding `require(_amount > 0, "Uniswap: can't add 0 liquidity");` in L145 of `UniswapManager.sol`. Responses leading to this fix are below.

#### client's response

if `_amount`  is `0` then the call to `addLiquidity()` on `L162` will revert because it requires `_amount > 0` so I don't think we could underflow on `L159`.

#### our response

That's correct, but we still argue that it's a bad practice to rely on a third party contract to protect your contract against underflow, even if the address is hardcoded.

### 5. Unnecessary storing of constant as state variables / unnecessary passing of constants as function arguments

#### type: efficiency / severity: low

- UniswapManager.sol:L83, L103 / it seems that passing the factory in an argument is not necessary, since the called functions can access the state variable directly
- MakerManager.sol:L395,L443 / `_uniswapFactory` again seems like a redundant argument
Also all internal functions in MakerManager.sol that receive `_makerCdp` as an argument could access it directly. It is true that in some cases where the storage variable is reused across functions passing it as an argument might save storage reads, but maybe the best solution would be to use constants that are set on deployment instead of storage variables.

#### status 08/05/2019 - discussed, partially fixed

In UniswapManager the issue is no longer present in https://github.com/argentlabs/argent-contracts/commit/dc4d381c63cf535f8788211a42e7a4175145509b, in MakerManager the code has been left unchanged to correctly reflect deployed version, see response below:

#### client's response

We've addressed your comments for the UniswapManager. We did not change MakerManager as it has already been deployed.
