const etherlime = require('etherlime-lib');
const ethers = require('ethers');
const ps = require('ps-node');
const hdkey = require('ethereumjs-wallet/hdkey')
const bip39 = require("bip39");
const { signOffchain } = require("./utilities.js");

const APIKEY = "41c41ec78ad0435982708754d5e8cc24";

const USE_ETHERLIME_GANACHE_MNEMONIC = true;

// this is the same mnemonic as that used by ganache-cli --deterministic
// this mnemonic will not be used if `USE_ETHERLIME_GANACHE_MNEMONIC` is set to `true`
const MNEMONIC = "myth like bonus scare over problem client lizard pioneer submit female collect";

class TestManager {
    constructor(_accounts = null, network = 'ganache') {
        this.network = network;
        this.accounts = _accounts || this.loadAccounts();
        global.accounts = this.accounts;
        this.deployer = this.newDeployer();
        this.provider = this.deployer.provider;
    }

    loadAccounts() {
        if (USE_ETHERLIME_GANACHE_MNEMONIC) return global.accounts;

        // ignore (global) accounts loaded from cli-commands/ganache/setup.json
        // and instead generate accounts matching those used by ganache-cli in determistic mode
        const hdWallet = hdkey.fromMasterSeed(bip39.mnemonicToSeedSync(MNEMONIC));
        const localNodeProvider = new ethers.providers.JsonRpcProvider(`http://localhost:8545`)
        accounts = []
        for (let i = 0; i < 10; i++) {
            const privKey = hdWallet.derivePath(`m/44'/60'/0'/0/${i}`).getWallet().getPrivateKeyString();
            accounts.push({
                secretKey: privKey,
                signer: new ethers.Wallet(privKey, localNodeProvider)
            });
        }
        return accounts;
    }

    newDeployer() {
        if (this.network === 'ropsten') {
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

    async relay(_target, _method, _params, _wallet, _signers, _relayer = this.accounts[9].signer, _estimate = false, _gasLimit = 700000) {
        const nonce = await this.getNonceForRelay();
        const methodData = _target.contract.interface.functions[_method].encode(_params);
        const signatures = await signOffchain(_signers, _target.contractAddress, _wallet.contractAddress, 0, methodData, nonce, 0, _gasLimit);
        if (_estimate === true) {
            const gasUsed = await _target.from(_relayer).estimate.execute(_wallet.contractAddress, methodData, nonce, signatures, 0, _gasLimit);
            return gasUsed;
        }
        const tx = await _target.from(_relayer).execute(_wallet.contractAddress, methodData, nonce, signatures, 0, _gasLimit, { gasLimit: _gasLimit });
        const txReceipt = await _target.verboseWaitForTransaction(tx);
        return txReceipt;
    }

    async increaseTime(seconds) {
        await this.provider.send('evm_increaseTime', seconds);
        await this.provider.send('evm_mine');
    }

    async runningEtherlimeGanache() {
        return new Promise((res, _) => {
            ps.lookup({
                command: 'node',
                psargs: 'ux',
                arguments: 'ganache'
            }, (err, processes) => {
                const runningEthGanache = !err && processes.reduce((etherlimeGanacheFound, p) =>
                    etherlimeGanacheFound || (p.command + p.arguments.join('-')).includes('etherlime-ganache'),
                    false)
                return res(runningEthGanache);
            });
        })
    }

    async isRevertReason(error, reason) {
        const runningEthGanache = await this.runningEtherlimeGanache();
                // by default, we match the error with a generic "revert" keyword
                // but if we are running etherlime ganache (and not e.g. ganache-cli), 
                    // we can match the error with the exact reason message
        const expectedReason = runningEthGanache ? reason : "revert";
        return (error.message || error.toString()).includes(expectedReason);
    }
}

module.exports = TestManager;