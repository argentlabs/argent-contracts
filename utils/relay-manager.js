const ethers = require("ethers");
const { signOffchain, ETH_TOKEN, getNonceForRelay, getNetworkId, getAccount } = require("./utilities.js");

class RelayManager {
  setRelayerManager(relayerManager) {
    this.relayerManager = relayerManager;
  }

  async relay(_module, _method, _params, _wallet, _signers,
    _relayerAccount,
    _estimate = false,
    _gasLimit = 2000000,
    _nonce,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero,
    _gasLimitRelay = (_gasLimit * 1.1)) {
    const relayerAccount = _relayerAccount || await getAccount(9);
    const nonce = _nonce || await getNonceForRelay();
    const methodData = _module.contract.methods[_method](_params).encodeABI();
    const networkId = await getNetworkId();
    const signatures = await signOffchain(
      _signers,
      this.relayerManager.address,
      _module.address,
      0,
      methodData,
      networkId,
      nonce,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
    );
    if (_estimate === true) {
      const gasUsed = await this.relayerManager.estimate.execute(
        _wallet.address,
        _module.address,
        methodData,
        nonce,
        signatures,
        _gasPrice,
        _gasLimit,
        _refundToken,
        _refundAddress,
        { gasLimit: _gasLimitRelay, gasPrice: _gasPrice },
      );
      return gasUsed;
    }
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
      { gasLimit: _gasLimitRelay, gasPrice: _gasPrice, from: relayerAccount },
    );
    const txReceipt = await _module.verboseWaitForTransaction(tx);
    return txReceipt;
  }
}

module.exports = RelayManager;
