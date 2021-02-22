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
const Upgrader = artifacts.require("SimpleUpgrader");

const ERC20 = artifacts.require("TestERC20");
const WETH = artifacts.require("WETH9");
const TestContract = artifacts.require("TestContract");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;

const RelayManager = require("../utils/relay-manager");

contract("TransactionManager", (accounts) => {
    const manager = new RelayManager();

    const infrastructure = accounts[0];
    const owner = accounts[1];
    const recipient = accounts[4];
  
    let registry;

    let lockStorage;
    let transferStorage;
    let guardianStorage;
    let transactionManager;
    let upgrader;
    let newTransactionManager;
    let wallet;
    let walletImplementation;
    let erc20;
    let weth;

    before(async () => {
        weth = await WETH.new();
        registry = await Registry.new();

        lockStorage = await LockStorage.new();
        guardianStorage = await GuardianStorage.new();
        transferStorage = await TransferStorage.new();

        transactionManager = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            SECURITY_PERIOD,
            weth.address);

        transactionManager2 = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            SECURITY_PERIOD + 1,
            weth.address);

        transactionManager3 = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            SECURITY_PERIOD + 1,
            weth.address);

        upgrader1 = await Upgrader.new(
            registry.address,
            [transactionManager2.address],
            [transactionManager.address]);

        upgrader2 = await Upgrader.new(
            registry.address,
            [transactionManager2.address, transactionManager3.address],
            [transactionManager.address]);
      
        await registry.registerModule(transactionManager.address, ethers.utils.formatBytes32String("TransactionManager"));
        await registry.registerModule(transactionManager2.address, ethers.utils.formatBytes32String("NewTransactionManager"));
        await registry.registerModule(transactionManager3.address, ethers.utils.formatBytes32String("NewTransactionManager"));
        await registry.registerModule(upgrader1.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerUpgrader(upgrader1.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerModule(upgrader2.address, ethers.utils.formatBytes32String("Upgrader"));
        await registry.registerUpgrader(upgrader2.address, ethers.utils.formatBytes32String("Upgrader"));
    
        walletImplementation = await BaseWallet.new();
    
        await manager.setRelayerManager(transactionManager);    
    });

    beforeEach(async () => {
        const proxy = await Proxy.new(walletImplementation.address);
        wallet = await BaseWallet.at(proxy.address);
        await wallet.init(owner, [transactionManager.address]);

        await wallet.send(new BN("1000000000000000000"));
    });

    describe("upgrader modules", () => {

        beforeEach(async () => {
            // set the nonce to 1
            await transactionManager.addToWhitelist(wallet.address, recipient, { from: owner });
            await utils.increaseTime(3);
            isTrusted = await transactionManager.isWhitelisted(wallet.address, recipient);
            assert.isTrue(isTrusted, "should be trusted after the security period");
            let txReceipt = await manager.relay(
                transactionManager,
                "transferTokenWithWithelist",
                [wallet.address, ETH_TOKEN, recipient, 10, ZERO_BYTES32],
                wallet,
                [owner]);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");
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

        it("should remove 1 and add 2 modules", async () => {
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
            isAuthorised = await wallet.authorised(transactionManager3.address);
            assert.equal(isAuthorised, false, "new module should be authorised");
            console.log("GAS for upgrade: " + txReceipt.gasUsed);
        });
    });
});