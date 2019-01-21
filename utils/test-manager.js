const etherlime = require('etherlime');
const ethers = require('ethers');
const { signOffchain } = require("./utilities.js");

class TestManager {
    constructor(accounts) {
        this.accounts = accounts;
        this.deployer = new etherlime.EtherlimeGanacheDeployer(accounts[0].secretKey);
        this.provider = this.deployer.provider;
    }

    newDeployer() {
        return new etherlime.EtherlimeGanacheDeployer(this.accounts[0].secretKey);
    }

    async getNonceForRelay() {
        let block = await this.provider.getBlockNumber();
        let timestamp = (new Date()).getTime();
        return '0x' + ethers.utils.hexZeroPad(ethers.utils.hexlify(block), 16).slice(2) + ethers.utils.hexZeroPad(ethers.utils.hexlify(timestamp), 16).slice(2);
    }

    async relay(_target, _method, _params, _wallet, _signers, _relayer = this.accounts[9].wallet, _estimate = false) {
        const nonce = await this.getNonceForRelay();
        const methodData = _target.contract.interface.functions[_method].encode(_params);
        const signatures = await signOffchain(_signers, _target.contractAddress, _wallet.contractAddress, 0, methodData, nonce, 0, 200000);
        if (_estimate === true) {
            const gasUsed = await _target.from(_relayer).estimate.execute(_wallet.contractAddress, methodData, nonce, signatures, 0, 200000);
            return gasUsed;
        }
        const tx = await _target.from(_relayer).execute(_wallet.contractAddress, methodData, nonce, signatures, 0, 200000); 
        const txReceipt = await _target.verboseWaitForTransaction(tx);
        return txReceipt;
    }

    async increaseTime(seconds) {
        await this.provider.send('evm_increaseTime', seconds);
	    await this.provider.send('evm_mine');
    }
}

module.exports = TestManager;