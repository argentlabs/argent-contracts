// Usage: truffle exec ./scripts/benchmark.js --network ganache

const BaseWallet = require('../build/BaseWallet');
const Proxy = require('../build/Proxy');
const ModuleRegistry = require('../build/ModuleRegistry');
const DappRegistry = require('../build/DappRegistry');
const MultiSig = require('../build/MultiSigWallet');
const ENS = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const TokenPriceProvider = require("../build/TokenPriceProvider");

const GuardianManager = require('../build/GuardianManager');
const TokenExchanger = require('../build/TokenExchanger');
const LockManager = require('../build/LockManager');
const RecoveryManager = require('../build/RecoveryManager');
const ApprovedTransfer = require('../build/ApprovedTransfer');
const TransferManager = require('../build/TransferManager');
const NftTransfer = require('../build/NftTransfer');
const MakerManager = require('../build/MakerManager');
const CompoundManager = require('../build/CompoundManager');
const UniswapManager = require('../build/UniswapManager');
const MakerV2Manager = require('../build/MakerV2Manager');

const ethers = require('ethers');
const Table = require('cli-table2');
const tinyreq = require('tinyreq');

const DeployManager = require('../utils/deploy-manager');
const TestManager = require('../utils/test-manager');
const MultisigExecutor = require('../utils/multisigexecutor.js');

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";


class Benchmark {
    constructor(network) {
        this.network = network;
        this._logger = new Logger();
    }

    /////////////////////
    ////// setup ////////
    /////////////////////

    async setup() {
        const manager = new DeployManager(this.network);
        await manager.setup();

        const configurator = manager.configurator;

        this.deployer = manager.deployer;
        this.deploymentWallet = this.deployer.signer;
        const config = configurator.config;

        this.accounts = await this.deployer.provider.listAccounts();
        this.signers = this.accounts.map(account => this.deployer.provider.getSigner(account));
        this.config = config;

        this.testManager = new TestManager(this.accounts);

        this.GuardianManagerWrapper = await this.deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
        this.LockManagerWrapper = await this.deployer.wrapDeployedContract(LockManager, config.modules.LockManager);
        this.RecoveryManagerWrapper = await this.deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
        this.ApprovedTransferWrapper = await this.deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
        this.TransferManagerWrapper = await this.deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
        this.TokenExchangerWrapper = await this.deployer.wrapDeployedContract(TokenExchanger, config.modules.TokenExchanger);
        this.NftTransferWrapper = await this.deployer.wrapDeployedContract(NftTransfer, config.modules.NftTransfer);
        this.MakerManagerWrapper = await this.deployer.wrapDeployedContract(MakerManager, config.modules.MakerManager);
        this.CompoundManagerWrapper = await this.deployer.wrapDeployedContract(CompoundManager, config.modules.CompoundManager);
        this.UniswapManagerWrapper = await this.deployer.wrapDeployedContract(UniswapManager, config.modules.UniswapManager);
        this.MakerV2ManagerWrapper = await this.deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);

        this.ModuleRegistryWrapper = await this.deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
        this.DappRegistryWrapper = await this.deployer.wrapDeployedContract(DappRegistry, config.contracts.DappRegistry);
        this.MultiSigWrapper = await this.deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
        this.WalletFactoryWrapper = await this.deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
        this.BaseWalletWrapper = await this.deployer.wrapDeployedContract(BaseWallet, config.contracts.BaseWallet);

        this.multisigExecutor = new MultisigExecutor(this.MultiSigWrapper, this.signers[0], true);
    }

    async setupWallet() {
        this.oneModule = [this.GuardianManagerWrapper.contractAddress];
        this.twoModules = [this.GuardianManagerWrapper.contractAddress, this.LockManagerWrapper.contractAddress];
        this.threeModules = [this.GuardianManagerWrapper.contractAddress, this.LockManagerWrapper.contractAddress, this.RecoveryManagerWrapper.contractAddress];
        this.allModules = [
            this.GuardianManagerWrapper.contractAddress,
            this.LockManagerWrapper.contractAddress,
            this.RecoveryManagerWrapper.contractAddress,
            this.ApprovedTransferWrapper.contractAddress,
            this.TransferManagerWrapper.contractAddress,
            this.TokenExchangerWrapper.contractAddress,
            this.NftTransferWrapper.contractAddress,
            this.MakerManagerWrapper.contractAddress,
            this.CompoundManagerWrapper.contractAddress,
            this.UniswapManagerWrapper.contractAddress,
            this.MakerV2ManagerWrapper.contractAddress
        ];

        const proxy = await this.deployer.deploy(Proxy, {}, this.BaseWalletWrapper.contractAddress);
        this.wallet = this.deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
        this.walletAddress = this.wallet.contractAddress;
        await this.wallet.init(this.accounts[0], this.allModules, { gasLimit: 1000000 });
        await this.deploymentWallet.sendTransaction({
            to: this.walletAddress,
            value: ethers.utils.parseEther('1.0')
        });
    }

    /////////////////////
    ///// use cases /////
    /////////////////////

    async estimateCreateWalletWithoutENSOneModule() { 
        const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(this.accounts[4], this.oneModule, "");
        this._logger.addItem("Create a wallet without ENS (1 module)", gasUsed);
    }

    async estimateCreateWalletWithoutENSTwoModules() {
        const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(this.accounts[4], this.twoModules, "");
        this._logger.addItem("Create a wallet without ENS (2 module)", gasUsed);
    }

    async estimateCreateWalletWithoutENSThreeModules() {
        const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(this.accounts[4], this.threeModules, "");
        this._logger.addItem("Create a wallet without ENS (3 module)", gasUsed);
    }

    async estimateCreateWalletWithoutENSAllModules() {
        const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(this.accounts[4], this.allModules, "");
        this._logger.addItem("Create a wallet without ENS (all modules)", gasUsed);
    }

    async estimateCreateWalletWithENS() {
        const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(this.accounts[4], this.allModules, "helloworld");
        this._logger.addItem("Create a wallet with ENS (all modules)", gasUsed);
    }

    async estimateAddFirstGuardianDirect() {
        const gasUsed = await this.GuardianManagerWrapper.estimate.addGuardian(this.walletAddress, this.accounts[1]);
        this._logger.addItem("Add first guardian (direct)", gasUsed);
    }

    async estimateAddSecondGuardianDirect() {
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);

        let gasUsed = await this.GuardianManagerWrapper.estimate.addGuardian(this.walletAddress, this.accounts[2]);
        this._logger.addItem("Request add second guardian (direct)", gasUsed);

        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[2]);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

        gasUsed = await this.GuardianManagerWrapper.estimate.confirmGuardianAddition(this.walletAddress, this.accounts[2]);
        this._logger.addItem("Confirm add second guardian (direct)", gasUsed);
    }

    async estimateRevokeGuardianDirect() {
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);

        let gasUsed = await this.GuardianManagerWrapper.estimate.revokeGuardian(this.walletAddress, this.accounts[1]);
        this._logger.addItem("Request revoke guardian (direct)", gasUsed);

        await this.GuardianManagerWrapper.revokeGuardian(this.walletAddress, this.accounts[1]);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

        gasUsed = await this.GuardianManagerWrapper.estimate.confirmGuardianRevokation(this.walletAddress, this.accounts[1]);
        this._logger.addItem("Confirm revoke guardian (direct)", gasUsed);
    }

    async estimateAddGuardianRelayed() {

        const gasUsed = await this.relayEstimate(this.GuardianManagerWrapper, "addGuardian", [this.walletAddress, this.accounts[1]], this.wallet, [this.signers[0]]);
        this._logger.addItem("Add a guardian (relayed)", gasUsed);
    };

    async estimateRevokeGuardianRelayed() {
        // add guardian
        await this.relay(this.GuardianManagerWrapper, "addGuardian", [this.walletAddress, this.accounts[1]], this.wallet, [this.signers[0]]);

        // estimate revoke guardian
        const gasUsed = await this.relayEstimate(this.GuardianManagerWrapper, "revokeGuardian", [this.walletAddress, this.accounts[1]], this.wallet, [this.signers[0]]);
        this._logger.addItem("Revoke a guardian (relayed)", gasUsed);
    }

    async estimateLockWalletDirect() {
        // add guardian
        let guardian = this.accounts[1];
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, guardian);

        // estimate lock wallet
        const gasUsed = await this.LockManagerWrapper.from(guardian).estimate.lock(this.walletAddress);
        this._logger.addItem("Lock wallet (direct)", gasUsed);
    }

    async estimateUnlockWalletDirect() {
        // add guardian
        let guardian = this.accounts[1];
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, guardian);

        // lock wallet
        await this.LockManagerWrapper.from(guardian).lock(this.walletAddress);

        // estimate unlock wallet
        const gasUsed = await this.LockManagerWrapper.from(guardian).estimate.unlock(this.walletAddress);
        this._logger.addItem("Unlock wallet (direct)", gasUsed);
    }

    async estimateLockWalletRelayed() {
        // add guardian
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);

        // estimate lock wallet
        const gasUsed = await this.relayEstimate(this.LockManagerWrapper, "lock", [this.walletAddress], this.wallet, [this.signers[1]]);
        this._logger.addItem("Lock wallet (relayed)", gasUsed);
    }

    async estimateUnlockWalletRelayed() {
        // add guardian
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);

        // lock wallet
        await this.relay(this.LockManagerWrapper, "lock", [this.walletAddress], this.wallet, [this.signers[1]]);

        // estimate unlock wallet
        const gasUsed = await this.relayEstimate(this.LockManagerWrapper, "unlock", [this.walletAddress], this.wallet, [this.signers[1]]);
        this._logger.addItem("Unlock wallet (relayed)", gasUsed);
    }

    async estimateExecuteRecovery() {
        // add guardians
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[2]);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);
        await this.GuardianManagerWrapper.confirmGuardianAddition(this.walletAddress, this.accounts[2]);

        // estimate execute recovery
        const recoveryAddress = this.accounts[3];
        const signers = [this.signers[2], this.signers[1]]; // manually inversed the signers to get them ordered
        const gasUsed = await this.relayEstimate(this.RecoveryManagerWrapper, "executeRecovery", [this.walletAddress, recoveryAddress], this.wallet, signers);
        this._logger.addItem("Execute recovery", gasUsed);
    }

    async estimateChangeLimitDirect() {
        const gasUsed = await this.TransferManagerWrapper.estimate.changeLimit(this.walletAddress, 4000000);
        this._logger.addItem("Change limit (direct)", gasUsed);
    }

    async estimateChangeLimitRelayed() {
        const gasUsed = await this.relayEstimate(this.TransferManagerWrapper, "changeLimit", [this.walletAddress, 67000000], this.wallet, [this.signers[0]]);
        this._logger.addItem("Change limit (relayed)", gasUsed);
    }

    async estimateETHTransferNoLimitDirect() {
        // disable limit
        await this.TransferManagerWrapper.disableLimit(this.walletAddress);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

        // transfer
        const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[1], 1000000, "0x");
        this._logger.addItem("ETH transfer, limit disabled (direct)", gasUsed);
    }

    async estimateTransferNoLimitRelayed() {
        // disable limit
        await this.TransferManagerWrapper.disableLimit(this.walletAddress);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

        // transfer
        const gasUsed = await this.relayEstimate(this.TransferManagerWrapper, "transferToken", [this.walletAddress, ETH_TOKEN, this.accounts[1], 1000000, "0x"], this.wallet, [this.signers[0]]);
        this._logger.addItem("ETH transfer, limit disabled (relayed)", gasUsed);
    }

    async estimateETHSmallTransferDirect() {
        await this.TransferManagerWrapper.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[5], 200, "0x");
        const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[5], 200, "0x");
        this._logger.addItem("ETH small transfer (direct)", gasUsed);
    }

    async estimateSmallTransferRelayed() {
        const gasUsed = await this.relayEstimate(this.TransferManagerWrapper, "transferToken", [this.walletAddress, ETH_TOKEN, this.accounts[1], 1000, "0x"], this.wallet, [this.signers[0]])
        this._logger.addItem("ETH small transfer (relayed)", gasUsed);
    }

    async estimateETHTransferToWhitelistedAccountDirect() {
        await this.TransferManagerWrapper.addToWhitelist(this.walletAddress, this.accounts[3]);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

        const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x");
        this._logger.addItem("ETH transfer to whitelisted account (direct)", gasUsed);
    }

    async estimateTransferToWhitelistedAccountRelayed() {
        await this.TransferManagerWrapper.addToWhitelist(this.walletAddress, this.accounts[3]);
        await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

        const gasUsed = await this.relayEstimate(this.TransferManagerWrapper, "transferToken", [this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x"], this.wallet, [this.signers[0]])
        this._logger.addItem("ETH transfer to whitelisted account (relayed)", gasUsed);
    }

    async estimateETHLargeTransferToUntrustedAccount() {
        const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[2], 2000000, "0x");
        this._logger.addItem("ETH large transfer to untrusted account", gasUsed);
    }

    // async estimateExecuteETHLargeTransferToUntrustedAccount() {
    //     const tx = await this.TokenTransferWrapper.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[2], 2000000, "0x");
    //     const result = await this.TokenTransferWrapper.verboseWaitForTransaction(tx, '');
    //     const block = result.blockNumber;
    //     console.log(block);

    //     await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow/2);
    //     const gasUsed = await this.TokenTransferWrapper.estimate.executePendingTransfer(this.walletAddress, ETH_TOKEN, this.accounts[2], 2000000, "0x", block);
    //     this._logger.addItem("Execute ETH large transfer to untrusted account", gasUsed);
    // }

    async estimateLargeTransferApprovalByOneGuardian() {
        // add guardian
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);

        // estimate approve large transfer
        const gasUsed = await this.relayEstimate(this.ApprovedTransferWrapper, "transferToken", [this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x"], this.wallet, [this.signers[0], this.signers[1]])
        this._logger.addItem("ETH large transfer approval by one guardian", gasUsed);
    }

    async estimateLargeTransferApprovalByTwoGuardians() {
        // add 3 guardians
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[2]);
        await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[3]);

        await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

        await this.GuardianManagerWrapper.confirmGuardianAddition(this.walletAddress, this.accounts[2]);
        await this.GuardianManagerWrapper.confirmGuardianAddition(this.walletAddress, this.accounts[3]);

        // estimate approve large transfer
        const signers = [this.signers[0], this.signers[2], this.signers[1]]; // manually inversed the signers to get them ordered
        const gasUsed = await this.relayEstimate(this.ApprovedTransferWrapper, "transferToken", [this.walletAddress, ETH_TOKEN, this.accounts[5], 2000000, "0x"], this.wallet, signers)
        this._logger.addItem("ETH large transfer approval by two guardians", gasUsed);
    }

    /////////////////////
    ////// utils ////////
    /////////////////////

    async relay(target, method, params, wallet, signers, estimate = false) {
        const result = await this.testManager.relay(target, method, params, wallet, signers, this.accounts[9], estimate);
        return result
    }

    async relayEstimate(target, method, params, wallet, signers) {
        const result = await this.relay(target, method, params, wallet, signers, true);
        return result
    }

    getAllEstimateMethods() {
        var props = [];
        var obj = this;

        do {
            props = props.concat(Object.getOwnPropertyNames(obj));
        } while (obj = Object.getPrototypeOf(obj));

        return props.filter(prop => prop.startsWith("estimate"));
    }

    async output() {
        await this._logger.loadData();
        return this._logger.output();
    }
}

class Logger {
    constructor() {
        this._items = [];
    }

    async loadData() {
        let coinmarketcap = await tinyreq({ url: "https://api.coinmarketcap.com/v2/ticker/1027/" });
        try {
            this._ethusd = JSON.parse(coinmarketcap).data.quotes.USD.price;
        } catch (error) {
            this._ethusd = "500";
        }

        let etherchain = await tinyreq({ url: "https://www.etherchain.org/api/gasPriceOracle" });
        try {
            this._gas_price = JSON.parse(etherchain);
        } catch (error) {
            this._gas_price = JSON.parse('{"safeLow":"3","standard":"5","fast":"10","fastest":"10"}');
        }


    }

    addItem(key, value) {
        this._items.push({ key: key, value: value });
    }

    output() {
        var colWidths = [75, 15];
        var head = [`Task [1 ETH = ${this._ethusd} USD]`, "Gas"];
        for (var speed in this._gas_price) {
            let gasPrice = parseInt(this._gas_price[speed]);
            head.push(`${speed} (${gasPrice} gwei)`);
            colWidths.push(20);
        }
        const style = { head: [], border: [] };

        var table = new Table({ head: head, colWidths: colWidths, style: style });

        this._items.forEach(item => {
            var row = [item.key, item.value.toLocaleString()];
            for (var speed in this._gas_price) {
                let gasPrice = parseInt(this._gas_price[speed]);
                let price = item.value * gasPrice * 0.000000001 * parseInt(this._ethusd);
                row.push(price.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
            }
            table.push(row);
        });
        return table.toString();
    }

}

const deploy = async (network, secret) => {

    let benchmark = new Benchmark(network);
    await benchmark.setup(); 

    var methods = benchmark.getAllEstimateMethods();
    let argv_methods = process.argv.filter(x => x.startsWith("estimate"));
    if (argv_methods.length > 0) {
        methods = methods.filter(method => argv_methods.indexOf(method) >= 0);
    }

    for (let index = 0; index < methods.length; index++) {
        const method = methods[index];
        console.log(`Running ${method}...`);
        await benchmark.setupWallet();
        await benchmark[method]();
    }

    const output = await benchmark.output();
    console.log(output);

    //     await fs.writeFileSync(OUTPUT_FILE, output);
}

module.exports = {
    deploy
};