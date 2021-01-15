/* global artifacts */
const BN = require("bn.js");
const ethers = require("ethers");
const { ETH_TOKEN } = require("./utilities.js");
const utils = require("./utilities.js");

const ITokenPriceRegistry = artifacts.require("ITokenPriceRegistry");
const IWallet = artifacts.require("IWallet");

class RelayManager {
  async setRelayerManager(relayerManager) {
    this.relayerManager = relayerManager;
  }

  // Relays without refund by default, unless the gasPrice is explicitely set to be >0
  async relay(_module, _method, _params, _wallet, _signers,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero) {
    const relayerAccount = await utils.getAccount(9);
    const nonce = await utils.getNonceForRelay();
    const chainId = await utils.getChainId();
    const methodData = _module.contract.methods[_method](..._params).encodeABI();

    const gasLimit = await this.getGasLimitRefund(_module, _method, _params, _wallet, _signers, _gasPrice);
    // Uncomment when debugging gas limits
    // await this.debugGasLimits(_module, _method, _params, _wallet, _signers);

    // When the refund is in token (not ETH), calculate the amount needed for refund
    let gasPrice = _gasPrice;
    if (_refundToken !== ETH_TOKEN) {
      const tokenPriceRegistryAddress = await this.relayerManager.tokenPriceRegistry();
      const tokenPriceRegistry = await ITokenPriceRegistry.at(tokenPriceRegistryAddress);
      const tokenPrice = await tokenPriceRegistry.getTokenPrice(_refundToken);

      // How many tokens to pay per unit of gas spent
      // refundCost = gasLimit * gasPrice
      // tokenAmount = refundCost * 10^18 / tokenPrice
      gasPrice = new BN(10).pow(new BN(18))
        .muln(_gasPrice)
        .div(tokenPrice)
        .toNumber();
    }

    const signatures = await utils.signOffchain(
      _signers,
      _wallet.address,
      _wallet.address,
      0,
      methodData,
      chainId,
      nonce,
      gasPrice,
      gasLimit,
      _refundToken,
      _refundAddress,
    );

    const executeData = this.relayerManager.contract.methods.execute(
      _module.address,
      methodData,
      nonce,
      signatures,
      gasPrice,
      gasLimit,
      _refundToken,
      _refundAddress).encodeABI();

    // Get the number of zero and non-zero bytes in the relayer.execute calldata
    const nonZerosString = executeData.toString().slice(2).replace(/00(?=(..)*$)/g, "");
    const nonZeros = nonZerosString.length;
    const zeros = executeData.length - nonZeros;

    /* Calculation used by the back end to relay transactions
      gasLimit =
      + 21k (base transaction)
      + 16 * non-empty calldata bytes
      + 4 * empty calldata bytes
      + 50k buffer
    */
    const gas = gasLimit + 21000 + nonZeros * 16 + zeros * 4 + 50000;

    const tx = await _wallet.execute(
      _module.address,
      methodData,
      nonce,
      signatures,
      gasPrice,
      gasLimit,
      _refundToken,
      _refundAddress,
      { gas, gasPrice, from: relayerAccount },
    );

    // console.log("gasLimit", gasLimit);
    // console.log("gas sent", gas);
    console.log("gas used", tx.receipt.gasUsed);
    // console.log("ratio", gasLimit / tx.receipt.gasUsed);

    return tx.receipt;
  }

  /* Returns the gas limit to use as gasLimit parameter in execute function
    + 5200  (isFeatureAuthorisedInVersionManager check)
    + 0 / 1000 / 4800 based on which contract implements getRequiredSignatures()
    + 2052 (getSignHash call)
    + 6200 / 22200 (checkAndUpdateUniqueness call based on which nonce strategy is used
      Only in tests we add 15k provision for the first setting of nonce on wallet
    + 10000 * number of signatures (validateSignatures call, should best be estimated but this is also close enough)
    + Function call estimate
    + 40000 / 30000 refund cost for 1 signatures and >1 signatures respectively

    Ignoring multiplication and comparison as that is <10 gas per operation
  */
  async getGasLimitRefund(_module, _method, _params, _wallet, _signers, _gasPrice) {
    let requiredSigsGas = 0;
    const { contractName } = _module.constructor;
    if (contractName === "ApprovedTransfer" || contractName === "RecoveryManager") {
      requiredSigsGas = 4800;
    } else if (contractName === "GuardianManager") {
      requiredSigsGas = 1000;
    }

    // Estimate cost of checkAndUpdateUniqueness call
    let nonceCheckGas = 0;
    if (_signers.length === 1) {
      nonceCheckGas = 6200;
      // Most calls here are the first for wallet so default to 20K gas extra for a storage slot update
      // We could check if the wallet nonce is empty before we add this
      nonceCheckGas += 15000;
    } else if (_signers.length > 1) {
      nonceCheckGas = 22200;
    }

    let gasEstimateFeatureCall = 0;
    try {
      gasEstimateFeatureCall = await _module.contract.methods[_method](..._params).estimateGas({ from: this.relayerManager.address });
      gasEstimateFeatureCall -= 21000;
    } catch (err) { // eslint-disable-line no-empty
    } finally {
      // When we can't estimate the inner module call correctly, set this to some large number
      // This only happens for the following tests atm:
      // approvedTransfer should revert when target contract is an authorised module
      // simpleUpgrader should not upgrade to 0 module (relayed tx)
      // nftTransfer should allow safe NFT transfer from wallet1 to wallet2 (relayed)
      if (gasEstimateFeatureCall <= 0) {
        gasEstimateFeatureCall = 140000;
      }
    }

    let refundGas = 0;
    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    // const requiredSignatures = await _module.getRequiredSignatures(_wallet.address, methodData);

    // // Relayer only refund when gasPrice > 0 and the owner is signing
    // if (_gasPrice > 0 && requiredSignatures[1].toNumber() === 1) {
    //   if (_signers.length > 1) {
    //     refundGas = 30000;
    //   } else {
         refundGas = 40000;
    //   }

      // We can achieve better overall estimate if instead of adding a 50K buffer in gas calculation for relayer.execute
      // we add token transfer cost selectively for token refunds.
      // In tests we are using a simple ERC20 transfer cost, however this varies by supported token, e.g. ZRX, BAT, DAI, USDC, or USDT
      // if (_refundToken !== ETH_TOKEN) {
      //   refundGas += 30000;
      // }
    // }

    // gasLimit = 5200 + [0,1000,4800] + 2052 + nonceCheckGas + (10000 * _signers.length) + gasEstimateFeatureCall + [40000,30000]
    const gasLimit = 7252 + requiredSigsGas + nonceCheckGas + (10000 * _signers.length) + gasEstimateFeatureCall + refundGas;
    // [32452, 33452, 43250] + (10000 * _signers.length) + gasEstimateFeatureCall
    return gasLimit;
  }

  async debugGasLimits(_module, _method, _params, _wallet, _signers) {
    let requiredSigsGas = 0;
    // Get the owner signature requirements
    const module = await IModule.at(_module.address);
    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    requiredSigsGas = await module.getRequiredSignatures.estimateGas(_wallet.address, methodData);
    requiredSigsGas -= 21000;

    let ownerSigner = 0;
    let eoaSigners = 0;
    let contractSigners = 0;
    const walletOwner = await _wallet.owner();

    for (let index = 0; index < _signers.length; index += 1) {
      const signer = _signers[index];
      const isGuardian = await IWallet(_wallet.address).isGuardian(signer);
      if (signer === walletOwner) {
        ownerSigner += 1;
      } else if (isGuardian) {
        eoaSigners += 1;
      } else {
        // For simplicity, assume if it's not the owner or an EOA guardian then it's a smart contract guardian.
        contractSigners += 1;
      }
    }

    console.log("method", _method);
    console.log("number of signers", _signers.length);
    console.log("ownerSigner", ownerSigner);
    console.log("eoaSigners", eoaSigners);
    console.log("contractSigners", contractSigners);

    console.log("requiredSigsGas", requiredSigsGas);
  }
}

module.exports = RelayManager;
