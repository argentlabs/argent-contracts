const ethers = require("ethers");
const { ETH_TOKEN } = require("./utilities.js");
const utils = require("./utilities.js");

class RelayManager {
  setRelayerManager(relayerManager) {
    this.relayerManager = relayerManager;
  }

  // Relays without refund by default, unless the gasPrice is explicitely set to be >0
  async relay(_module, _method, _params, _wallet, _signers,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero) {
    const relayerAccount = await utils.getAccount(9);
    const nonce = await utils.getNonceForRelay();

    const methodData = _module.contract.methods[_method](..._params).encodeABI();
    const chainId = await utils.getChainId();
    const _gasLimit = 2000000;

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
    console.log("gasEstimate", gasEstimate);

    const gas = _gasLimit * 1.1;
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

    console.log("gasUsed    ", tx.receipt.gasUsed);

    if (gasEstimate < tx.receipt.gasUsed) {
      console.log("INSUFFICIENT GAS ESTIMATED");
    }
    return tx.receipt;
  }
}

module.exports = RelayManager;
