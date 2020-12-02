const ethers = require("ethers");
const { ETH_TOKEN } = require("./utilities.js");
const utils = require("./utilities.js");

class RelayManager {
  setRelayerManager(relayerManager) {
    this.relayerManager = relayerManager;
  }

  async relay(_module, _method, _params, _wallet, _signers,
    _relayerAccount,
    _estimate = false,
    _gasLimit = 1,
    _nonce,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero) {
    const relayerAccount = _relayerAccount || await utils.getAccount(9);
    const nonce = _nonce || await utils.getNonceForRelay();
    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    const chainId = await utils.getChainId();
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

    const gasEstimate = await this.relayerManager.execute.estimateGas(
      _wallet.address,
      _module.address,
      methodData,
      nonce,
      signatures,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
      { gasPrice: _gasPrice },
    );

    console.log("method", _method);
    console.log("gasEstimate", gasEstimate.toString());

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
      { gas: gasEstimate, gasPrice: _gasPrice, from: relayerAccount },
    );
    console.log("gasUsed    ", tx.receipt.gasUsed.toString());

    return tx.receipt;
  }
}

module.exports = RelayManager;
