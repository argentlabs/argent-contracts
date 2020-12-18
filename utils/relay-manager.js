/* global artifacts */
const BN = require("bn.js");
const ethers = require("ethers");
const { ETH_TOKEN } = require("./utilities.js");
const utils = require("./utilities.js");

const ITokenPriceRegistry = artifacts.require("ITokenPriceRegistry");
const IGuardianStorage = artifacts.require("IGuardianStorage");
const IFeature = artifacts.require("IFeature");

class RelayManager {
  async setRelayerManager(relayerManager) {
    this.relayerManager = relayerManager;

    const guardianStorageAddress = await relayerManager.guardianStorage();
    this.guardianStorage = await IGuardianStorage.at(guardianStorageAddress);
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

    const gasLimit = await this.getGasLimitRefund(_module, _method, _params, _wallet, _signers, _gasPrice, _refundToken);
    // Uncomment when debugging gas limits
    // await this.debugGasLimits(_module, _method, _params, _wallet, _signers);

    // When the refund is in token (not ETH), calculate the amount needed for refund
    let _gasLimit = gasLimit;
    if (_refundToken !== ETH_TOKEN) {
      const tokenPriceRegistryAddress = await this.relayerManager.tokenPriceRegistry();
      const tokenPriceRegistry = await ITokenPriceRegistry.at(tokenPriceRegistryAddress);

      const tokenPrice = await tokenPriceRegistry.getTokenPrice(_refundToken);
      const refundCost = new BN(gasLimit).muln(_gasPrice);
      // tokenAmount = refundCost * 10^18 / tokenPrice
      const tokenAmount = new BN(10).pow(new BN(18)).mul(refundCost).div(tokenPrice);
      _gasLimit = tokenAmount.toNumber();
    }

    const signatures = await utils.signOffchain(
      _signers,
      this.relayerManager.address,
      _module.address,
      0,
      methodData,
      chainId,
      nonce,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
    );

    const executeData = this.relayerManager.contract.methods.execute(
      _wallet.address,
      _module.address,
      methodData,
      nonce,
      signatures,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress).encodeABI();

    // Get the number of zero and non-zero bytes in the relayer.execute calldata
    const nonZerosString = executeData.toString().slice(2).replace(/0/g, "");
    const nonZeros = nonZerosString.length;
    const zeros = executeData.length - nonZeros;

    /* Calculation used by the back end to relay transactions
      gasLimit =
      + 21k (base transaction)
      + 16 * non-empty calldata bytes
      + 4 * empty calldata bytes
    */
    const gas = gasLimit + 21000 + nonZeros * 16 + zeros * 4 + 50000;

    const tx = await this.relayerManager.execute(
      _wallet.address,
      _module.address,
      methodData,
      nonce,
      signatures,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
      { gas, gasPrice: _gasPrice, from: relayerAccount },
    );

    console.log("gasLimit", gasLimit);
    console.log("_gasLimit", _gasLimit);
    console.log("gas sent", gas);
    console.log("gas used", tx.receipt.gasUsed);
    console.log("ratio", _gasLimit / tx.receipt.gasUsed);

    return tx.receipt;
  }

  /* Returns the gas limit to use as gasLimit parameter in execute function
    + 1856  (isFeatureAuthorisedInVersionManager check)
    + 0 / 1000 / 4800 based on which contract implements getRequiredSignatures()
    + 2052 (getSignHash call)
    + 45144 (checkAndUpdateUniqueness call)
    + 10000 * number of signatures (validateSignatures call, should best be estimated but this is also close enough)
    + Function call estimate
    + 40000 / 30000 refund cost for 1 signatures and >1 signatures respectively

    Ignoring multiplication and comparisson as that is <10 gas per operation
  */
  async getGasLimitRefund(_module, _method, _params, _wallet, _signers, _gasPrice, _refundToken) {
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
    } else if (_signers.length > 1) {
      nonceCheckGas = 22200;
    }

    let gasEstimateFeatureCall = 0;
    try {
      gasEstimateFeatureCall = await _module.contract.methods[_method](..._params).estimateGas({ from: this.relayerManager.address });
      gasEstimateFeatureCall -= 21000;
    } catch (err) { // eslint-disable-line no-empty
    } finally {
      // When we can't estimate the inner feature call correctly, set this to some large number
      // This only happens for the following tests atm:
      // approvedTransfer should revert when target contract is an authorised module
      // simpleUpgrader should not upgrade to 0 module (relayed tx)
      // nftTransfer should allow safe NFT transfer from wallet1 to wallet2 (relayed)
      if (gasEstimateFeatureCall <= 0) {
        gasEstimateFeatureCall = 90000;
      }
    }

    let refundGas = 0;
    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    const requiredSignatures = await _module.getRequiredSignatures(_wallet.address, methodData);

    if (_gasPrice > 0 && requiredSignatures[1].toNumber() === 1) {
      if (_signers.length > 1) {
        refundGas = 30000;
      } else {
        refundGas = 40000;
      }

      // If the refund is with a token, add transfer cost.
      // We are using a simple ERC20 transfer cost, however this varies by supported token, e.g. ZRX, BAT, REP, DAI, USDC, or USDT
      if (_refundToken !== ETH_TOKEN) {
        refundGas += 30000;
      }
    }

    // gasLimit = 1856 + [0,1000,4800] + 2052 + nonceCheckGas + (10000 * _signers.length) + gasEstimateFeatureCall + [40000,30000]
    const gasLimit = 3908 + requiredSigsGas + nonceCheckGas + (10000 * _signers.length) + gasEstimateFeatureCall + refundGas;
    // [50108, 51108, 60908] + (10000 * _signers.length) + gasEstimateFeatureCall
    return gasLimit;
  }

  async debugGasLimits(_module, _method, _params, _wallet, _signers) {
    let requiredSigsGas = 0;
    // Get the owner signature requirements
    const feature = await IFeature.at(_module.address);
    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    requiredSigsGas = await feature.getRequiredSignatures.estimateGas(_wallet.address, methodData);
    requiredSigsGas -= 21000;

    let ownerSigner = 0;
    let eoaSigners = 0;
    let contractSigners = 0;
    const walletOwner = await _wallet.owner();

    for (let index = 0; index < _signers.length; index += 1) {
      const signer = _signers[index];
      const isGuardian = await this.guardianStorage.isGuardian(_wallet.address, signer);
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
