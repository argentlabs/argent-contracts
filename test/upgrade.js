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
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("AuthoriserRegistry");
const Upgrader = artifacts.require("SimpleUpgrader");

const utils = require("../utils/utilities.js");
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("TransactionManager", (accounts) => {
    const manager = new RelayManager();

    const infrastructure = accounts[0];
    const owner = accounts[1];
    const recipient = accounts[4];
    const nonceInitialiser = accounts[5];
    const relayer = accounts[9];
  
    let registry;

    let lockStorage;
    let transferStorage;
    let guardianStorage;
    let module;
    let newMdoule;

    let wallet;
    let walletImplementation;

    before(async () => {
        registry = await Registry.new();

        lockStorage = await LockStorage.new();
        guardianStorage = await GuardianStorage.new();
        transferStorage = await TransferStorage.new();

        authoriser = await Authoriser.new();

        module = await ArgentModule.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            authoriser.address,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            LOCK_PERIOD,
            RECOVERY_PERIOD);

        newModule = await ArgentModule.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            authoriser.address,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            LOCK_PERIOD,
            RECOVERY_PERIOD);

        upgrader1 = await Upgrader.new(
            registry.address,
            [newModule.address],
            [module.address]);
      
        await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentMdoule"));
        await registry.registerModule(newModule.address, ethers.utils.formatBytes32String("NewArgentModule"));
        await registry.registerModule(upgrader1.address, ethers.utils.formatBytes32String("Upgrader"));

        await authoriser.addAuthorisation(relayer, ZERO_ADDRESS); 
    
        walletImplementation = await BaseWallet.new();
    
        await manager.setRelayerManager(module);    
    });

    async function encodeTransaction(to, value, data, isSpenderInData) {
        return {to, value, data, isSpenderInData};
    }

    async function whitelist(target) {
        await module.addToWhitelist(wallet.address, target, { from: owner });
        await utils.increaseTime(3);
        isTrusted = await module.isWhitelisted(wallet.address, target);
        assert.isTrue(isTrusted, "should be trusted after the security period");
    }

    async function initNonce() {
        // add to whitelist
        await whitelist(nonceInitialiser);
        // set the relayer nonce to > 0
        let transaction = await encodeTransaction(nonceInitialiser, 1, ZERO_BYTES32, false);
        let txReceipt = await manager.relay(
            module,
            "multiCall",
            [wallet.address, [transaction]],
            wallet,
            [owner]);
        success = await utils.parseRelayReceipt(txReceipt).success;
        assert.isTrue(success, "transfer failed");
        const nonce = await module.getNonce(wallet.address);
        assert.isTrue(nonce.gt(0), "nonce init failed");
    }

    beforeEach(async () => {
        const proxy = await Proxy.new(walletImplementation.address);
        wallet = await BaseWallet.at(proxy.address);
        await wallet.init(owner, [module.address]);
        await wallet.send(new BN("1000000000000000000"));
    });

    describe("upgrader modules", () => {

        beforeEach(async () => {
            await initNonce();
        });

        it("should remove 1 and add 1 module", async () => {
            let isAuthorised = await wallet.authorised(newModule.address);
            assert.equal(isAuthorised, false, "new module should not be authorised");

            let txReceipt = await manager.relay(
                module,
                "addModule",
                [wallet.address, upgrader1.address],
                wallet,
                [owner]);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "transfer failed");
            isAuthorised = await wallet.authorised(newModule.address);
            assert.equal(isAuthorised, false, "new module should be authorised");
            console.log("GAS for upgrade: " + txReceipt.gasUsed);
        });
    });
});