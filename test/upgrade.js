/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const TruffleContract = require("@truffle/contract");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const TransactionManager = artifacts.require("TransactionManager");
const SecurityManager = artifacts.require("SecurityManager");
const Upgrader = artifacts.require("SimpleUpgrader");

const utils = require("../utils/utilities.js");
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 2;
const RECOVERY_PERIOD = 2;

const RelayManager = require("../utils/relay-manager");

contract("TransactionManager", (accounts) => {
    const manager = new RelayManager();

    const infrastructure = accounts[0];
    const owner = accounts[1];
    const recipient = accounts[4];
    const nonceInitialiser = accounts[5];
  
    let registry;

    let lockStorage;
    let transferStorage;
    let guardianStorage;
    let transactionManager;
    let transactionManager2;
    let securityManager;
    let securityManager2;

    let wallet;
    let walletImplementation;

    before(async () => {
        registry = await Registry.new();

        lockStorage = await LockStorage.new();
        guardianStorage = await GuardianStorage.new();
        transferStorage = await TransferStorage.new();

        transactionManager = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            ZERO_ADDRESS,
            SECURITY_PERIOD);

        securityManager = await SecurityManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            RECOVERY_PERIOD,
            LOCK_PERIOD,
            SECURITY_PERIOD,
            SECURITY_WINDOW);

        transactionManager2 = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            ZERO_ADDRESS,
            SECURITY_PERIOD);

        securityManager2 = await SecurityManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            RECOVERY_PERIOD,
            LOCK_PERIOD,
            SECURITY_PERIOD,
            SECURITY_WINDOW);

        upgrader1 = await Upgrader.new(
            registry.address,
            [transactionManager2.address],
            [transactionManager.address]);

        upgrader2 = await Upgrader.new(
            registry.address,
            [transactionManager2.address, securityManager2.address],
            [transactionManager.address, securityManager.address]);
      
        await registry.registerModule(transactionManager.address, ethers.utils.formatBytes32String("TransactionManager"));
        await registry.registerModule(securityManager.address, ethers.utils.formatBytes32String("SecurityManager"));
        await registry.registerModule(transactionManager2.address, ethers.utils.formatBytes32String("NewTransactionManager"));
        await registry.registerModule(securityManager2.address, ethers.utils.formatBytes32String("NewSecurityManager"));
        await registry.registerModule(upgrader1.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerUpgrader(upgrader1.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerModule(upgrader2.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerUpgrader(upgrader2.address, ethers.utils.formatBytes32String("Upgrader"));
    
        walletImplementation = await BaseWallet.new();
    
        await manager.setRelayerManager(transactionManager);    
    });

    async function encodeTransaction(to, value, data, isSpenderInData) {
        return {to, value, data, isSpenderInData};
    }

    async function whitelist(target) {
        await transactionManager.addToWhitelist(wallet.address, target, { from: owner });
        await utils.increaseTime(3);
        isTrusted = await transactionManager.isWhitelisted(wallet.address, target);
        assert.isTrue(isTrusted, "should be trusted after the security period");
    }

    async function initNonce() {
        // add to whitelist
        await whitelist(nonceInitialiser);
        // set the relayer nonce to > 0
        let transaction = await encodeTransaction(nonceInitialiser, 1, ZERO_BYTES32, false);
        let txReceipt = await manager.relay(
            transactionManager,
            "multiCall",
            [wallet.address, [transaction]],
            wallet,
            [owner]);
        success = await utils.parseRelayReceipt(txReceipt).success;
        assert.isTrue(success, "transfer failed");
        const nonce = await transactionManager.getNonce(wallet.address);
        assert.isTrue(nonce.gt(0), "nonce init failed");
    }

    beforeEach(async () => {
        const proxy = await Proxy.new(walletImplementation.address);
        wallet = await BaseWallet.at(proxy.address);
        await wallet.init(owner, [transactionManager.address]);
        await wallet.send(new BN("1000000000000000000"));
    });

    describe("upgrader modules", () => {

        beforeEach(async () => {
            await initNonce();
        });

        it("should remove 1 and add 1 module", async () => {
            let isAuthorised = await wallet.authorised(transactionManager2.address);
            assert.equal(isAuthorised, false, "new module should not be authorised");

            let txReceipt = await manager.relay(
                transactionManager,
                "addModule",
                [wallet.address, upgrader1.address],
                wallet,
                [owner]);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");
            isAuthorised = await wallet.authorised(transactionManager2.address);
            assert.equal(isAuthorised, false, "new module should be authorised");
            console.log("GAS for upgrade: " + txReceipt.gasUsed);
        });

        it("should remove 2 and add 2 modules", async () => {
            let isAuthorised = await wallet.authorised(transactionManager2.address);
            assert.equal(isAuthorised, false, "new module should not be authorised");

            let txReceipt = await manager.relay(
                transactionManager,
                "addModule",
                [wallet.address, upgrader2.address],
                wallet,
                [owner]);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");
            isAuthorised = await wallet.authorised(transactionManager2.address);
            assert.equal(isAuthorised, false, "new module should be authorised");
            isAuthorised = await wallet.authorised(securityManager2.address);
            assert.equal(isAuthorised, false, "new module should be authorised");
            console.log("GAS for upgrade: " + txReceipt.gasUsed);
        });
    });
});