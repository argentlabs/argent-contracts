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
const LimitStorage = artifacts.require("LimitStorage");
const TransactionManager = artifacts.require("TransactionManagerDL");

const ERC20 = artifacts.require("TestERC20");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;

const RelayManager = require("../utils/relay-manager");
const { assert } = require("chai");

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
    let limitStorage;
    let transactionManager;
    let wallet;
    let walletImplementation;
    let erc20;

    before(async () => {
        registry = await Registry.new();

        lockStorage = await LockStorage.new();
        guardianStorage = await GuardianStorage.new();
        transferStorage = await TransferStorage.new();
        limitStorage = await LimitStorage.new();

        transactionManager = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            limitStorage.address,
            ZERO_ADDRESS,
            SECURITY_PERIOD);
      
        await registry.registerModule(transactionManager.address, ethers.utils.formatBytes32String("TransactionManager"));
    
        walletImplementation = await BaseWallet.new();
    
        await manager.setRelayerManager(transactionManager);    
    });

    beforeEach(async () => {
        const proxy = await Proxy.new(walletImplementation.address);
        wallet = await BaseWallet.at(proxy.address);
        await wallet.init(owner, [transactionManager.address]);
    
        const decimals = 12; // number of decimal for TOKN contract
        erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await wallet.send(new BN("1000000000000000000"));
    });

    async function encodeTransaction(to, value, data, isSpenderInData = false) {
        return {to, value, data, isSpenderInData};
    }

    describe("transfer ETH with daily limit", () => {
        beforeEach(async () => {
            await manager.relay(transactionManager, "changeLimit", [wallet.address, 4000000], wallet, [owner]);
            await utils.increaseTime(SECURITY_PERIOD + 1);
            const limit = await transactionManager.getCurrentLimit(wallet.address);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });

        it("should send ETH under the limit", async () => {
            let transaction = await encodeTransaction(recipient, 10, ZERO_BYTES32);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithDailyLimit",
                [wallet.address, [transaction]],
                wallet,
                [owner],
                1,
                ETH_TOKEN,
                recipient);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");

            txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithDailyLimit",
                [wallet.address, [transaction]],
                wallet,
                [owner],
                1,
                ETH_TOKEN,
                recipient);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");
            console.log("Gas for ETH transfer: " + txReceipt.gasUsed);
        });

        it("should fail to send ETH above the limit", async () => {
            let transaction = await encodeTransaction(recipient, 5000000, ZERO_BYTES32);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithDailyLimit",
                [wallet.address, [transaction]],
                wallet,
                [owner],
                1,
                ETH_TOKEN,
                recipient);
            let { success, error } = await utils.parseRelayReceipt(txReceipt);
            assert.isFalse(success, "call should have failed");
            assert.equal(error, "TM: above daily limit");
        });
    });
   
});