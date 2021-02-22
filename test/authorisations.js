/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const TransactionManager = artifacts.require("TransactionManager");
const Authoriser = artifacts.require("DappAuthoriser");

const ERC20 = artifacts.require("TestERC20");
const WETH = artifacts.require("WETH9");
const TestContract = artifacts.require("TestContract");
const Filter = artifacts.require("TestFilter");

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
  
    let registry;
    let lockStorage;
    let transferStorage;
    let guardianStorage;
    let transactionManager;
    let wallet;
    let walletImplementation;
    let erc20;
    let filter;
    let authoriser;
    let contract;

    before(async () => {
        registry = await Registry.new();
        
        filter = await Filter.new();
        authoriser = await Authoriser.new();

        lockStorage = await LockStorage.new();
        guardianStorage = await GuardianStorage.new();
        transferStorage = await TransferStorage.new();

        transactionManager = await TransactionManager.new(
            registry.address,
            lockStorage.address,
            guardianStorage.address,
            transferStorage.address,
            authoriser.address,
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
        const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19
    
        erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await wallet.send(new BN("1000000000000000000"));

        contract = await TestContract.new();
        assert.equal(await contract.state(), 0, "initial contract state should be 0");

        await authoriser.addAuthorisation(contract.address, filter.address);
        await authoriser.addAuthorisation(recipient, ZERO_ADDRESS);
    });

    async function encodeTransaction(to, value, data) {
        return web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'bytes'],
          [to, value, data]
        );
      }

    describe("call authorised contract", () => {

        it("should send ETH to authorised address", async () => {
            let transaction = await encodeTransaction(recipient, 100, ZERO_BYTES32);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithWhitelist",
                [wallet.address, [transaction], [false]],
                wallet,
                [owner],
                10,
                ETH_TOKEN,
                recipient);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "call failed");
        });

        it("should call authorised contract when filter pass", async () => {
            const data = contract.contract.methods.setState(4).encodeABI();
            let transaction = await encodeTransaction(contract.address, 0, data);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithWhitelist",
                [wallet.address, [transaction], [false]],
                wallet,
                [owner],
                10,
                ETH_TOKEN,
                recipient);
            success = await utils.parseRelayReceipt(txReceipt).success;
            assert.isTrue(success, "call failed");
            assert.equal(await contract.state(), 4, "contract state should be 4");
        });

        it("should block call to authorised contract when filter doesn't pass", async () => {
            const data = contract.contract.methods.setState(5).encodeABI();
            let transaction = await encodeTransaction(contract.address, 0, data);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithWhitelist",
                [wallet.address, [transaction], [false]],
                wallet,
                [owner],
                10,
                ETH_TOKEN,
                recipient);
            let { success, error } = await utils.parseRelayReceipt(txReceipt);
            assert.isFalse(success, "call should have failed");
            assert.equal(error, "TM: transaction not authorised");
        });
    });

    describe("approve token and call authorised contract", () => {

        it("should call authorised contract when filter pass", async () => {
            const transactions = [];

            let data = erc20.contract.methods.approve(contract.address, 100).encodeABI();
            let transaction = await encodeTransaction(erc20.address, 0, data);
            transactions.push(transaction);

            data = contract.contract.methods.setStateAndPayToken(4, erc20.address, 100).encodeABI();
            transaction = await encodeTransaction(contract.address, 0, data);
            transactions.push(transaction);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithWhitelist",
                [wallet.address, transactions, [true, false]],
                wallet,
                [owner],
                10,
                ETH_TOKEN,
                recipient);
            success = await utils.parseRelayReceipt(txReceipt).success; 
            assert.isTrue(success, "call failed");
            assert.equal(await contract.state(), 4, "contract state should be 4");
        });

        it("should block call to authorised contract when filter doesn't pass", async () => {
            const transactions = [];

            let data = erc20.contract.methods.approve(contract.address, 100).encodeABI();
            let transaction = await encodeTransaction(erc20.address, 0, data);
            transactions.push(transaction);

            data = contract.contract.methods.setStateAndPayToken(5, erc20.address, 100).encodeABI();
            transaction = await encodeTransaction(contract.address, 0, data);
            transactions.push(transaction);

            let txReceipt = await manager.relay(
                transactionManager,
                "multiCallWithWhitelist",
                [wallet.address, transactions, [true, false]],
                wallet,
                [owner],
                10,
                ETH_TOKEN,
                recipient);
            let { success, error } = await utils.parseRelayReceipt(txReceipt);
            assert.isFalse(success, "call should have failed");
            assert.equal(error, "TM: transaction not authorised");
        });
    });
});