const etherlime = require('etherlime');
const ethers = require('ethers');
const { signOffchain } = require("./utilities.js");

const APIKEY = "41c41ec78ad0435982708754d5e8cc24";

class TestManager {
    constructor(accounts, network) {
        this.network = network;
        this.accounts = accounts;
        this.deployer = this.newDeployer();
        this.provider = this.deployer.provider;
    }

    newDeployer() {
        if(this.network === 'ropsten') {
            const defaultConfigs = {
                gasPrice: 20000000000,
                gasLimit: 4700000,
                chainId: 3
            }
            return new etherlime.InfuraPrivateKeyDeployer(this.accounts[0].signer.privateKey, 'ropsten', APIKEY, defaultConfigs);
        }
        return new etherlime.EtherlimeGanacheDeployer(this.accounts[0].secretKey);
    }

    async getCurrentBlock() {
        let block = await this.provider.getBlockNumber();
        return block;
    }

    async getTimestamp(blockNumber) {
        let block = await this.provider.getBlock(blockNumber); 
        return block.timestamp;
    }

    async getNonceForRelay() {
        let block = await this.provider.getBlockNumber();
        let timestamp = (new Date()).getTime();
        return '0x' + ethers.utils.hexZeroPad(ethers.utils.hexlify(block), 16).slice(2) + ethers.utils.hexZeroPad(ethers.utils.hexlify(timestamp), 16).slice(2);
    }

    async relay(_target, _method, _params, _wallet, _signers, _relayer = this.accounts[9].signer, _estimate = false) {
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