/* global artifacts */
const ethers = require("ethers");
const { ETH_TOKEN } = require("./utilities.js");
const utils = require("./utilities.js");

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

    const gasLimit = await this.getGasLimitRefund(_module, _method, _params, _signers);
    // Uncomment when debugging gas limits
    // await this.debugGasLimits(_module, _method, _params, _wallet, _signers);

    const signatures = await utils.signOffchain(
      _signers,
      this.relayerManager.address,
      _module.address,
      0,
      methodData,
      chainId,
      nonce,
      _gasPrice,
      gasLimit,
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
      gasLimit,
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
    const gas = gasLimit + 21000 + nonZeros * 16 + zeros * 4;

    const tx = await this.relayerManager.execute(
      _wallet.address,
      _module.address,
      methodData,
      nonce,
      signatures,
      _gasPrice,
      gasLimit,
      _refundToken,
      _refundAddress,
      { gas, gasPrice: _gasPrice, from: relayerAccount },
    );

    console.log("gasLimit", gasLimit);
    console.log("gas sent", gas);
    console.log("gas used", tx.receipt.gasUsed);
    console.log("ratio", gas / tx.receipt.gasUsed);

    return tx.receipt;
  }

  /* Returns the gas limit to use as gasLimit parameter in execute function
    + 1500 (gasleft() check)
    + 1856  (isFeatureAuthorisedInVersionManager check)
    + 0 / 1000 / 5000 based on which contract implements getRequiredSignatures()
    + 2052 (getSignhash call)
    + 45144 (checkAndUpdateUniqueness call)
    + 9500 * number of signatures (validateSignatures call, should best be estimated but this is also close enough)
    + Function call estimate
    + 2131  (TransactionExecuted event log)

    Ignoring multiplication and comparisson as that is <10 gas per operation
  */
  async getGasLimitRefund(_module, _method, _params, _signers) {
    let requiredSigsGas = 0;
    const { contractName } = _module.constructor;
    if (contractName === "ApprovedTransfer" || contractName === "RecoveryManager") {
      requiredSigsGas = 5000;
    } else if (contractName === "GuardianManager") {
      requiredSigsGas = 1000;
    }

    let gasEstimateFeatureCall = 0;
    try {
      gasEstimateFeatureCall = await _module.contract.methods[_method](..._params).estimateGas({ from: this.relayerManager.address });
      gasEstimateFeatureCall -= 21000;
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

    const gasLimit = 1500 + 1856 + requiredSigsGas + 2052 + 45144 + (9500 * _signers.length) + gasEstimateFeatureCall + 2131;
    return gasLimit;
  }

  async debugGasLimits(_module, _method, _params, _wallet, _signers) {
    let requiredSigsGas = 0;
    try {
      // Get the owner signature requirements
      const feature = await IFeature.at(_module.address);
      const methodData = _module.contract.methods[_method](..._params).encodeABI();
      requiredSigsGas = await feature.getRequiredSignatures.estimateGas(_wallet.address, methodData);
      requiredSigsGas -= 21000;
    } catch (err) {
      console.log("ERROR", err);
    }

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
