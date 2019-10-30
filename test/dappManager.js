const DappManager = require("../build/DappManager");
const DappStorage = require("../build/DappStorage");
const Wallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const DappRegistry = require("../build/DappRegistry");
const GuardianStorage = require("../build/GuardianStorage");
const TestContract = require('../build/TestContract');

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 10;
const SECURITY_WINDOW = 10;

describe("DappManager", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let dapp = accounts[2].signer;
    let nondapp = accounts[3].signer;
    let nonowner = accounts[4].signer;
    let recipient = accounts[5].signer;

    let wallet, dappRegistry, dappManager;


    beforeEach(async () => {
        deployer = manager.newDeployer();
        const moduleRegistry = await deployer.deploy(ModuleRegistry);
        dappRegistry = await deployer.deploy(DappRegistry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        const dappStorage = await deployer.deploy(DappStorage);
        dappManager = await deployer.deploy(DappManager, {},
            moduleRegistry.contractAddress,
            dappRegistry.contractAddress,
            dappStorage.contractAddress,
            guardianStorage.contractAddress,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            ETH_LIMIT
        );
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [dappManager.contractAddress]);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
    });

    describe("Authorize Dapp", () => {
        describe("Management of dapp limit", () => {

            const dappLimit = ETH_LIMIT - 100;

            it('should let the owner set the dapp limit (relayed transaction)', async () => {
                const txReceipt = await manager.relay(dappManager, "changeLimit", [wallet.contractAddress, dappLimit], wallet, [owner]);
                const success = parseRelayReceipt(txReceipt);
                assert.isOk(success, 'setLimit should have succeeded');
                await manager.increaseTime(SECURITY_PERIOD + 1);
                const limit = await dappManager.getCurrentLimit(wallet.contractAddress);
                assert.equal(limit.toNumber(), dappLimit, "dapp limit should be the one set");
            });
            it('should let the owner set the dapp limit (blockchain transaction)', async () => {
                await dappManager.from(owner).changeLimit(wallet.contractAddress, dappLimit);
                await manager.increaseTime(SECURITY_PERIOD + 1);
                const limit = await dappManager.getCurrentLimit(wallet.contractAddress);
                assert.equal(limit.toNumber(), dappLimit, "dapp limit should be the one set");
            });
            it('should not let a non owner set the dapp limit (relayed transaction)', async () => {
                let txReceipt = await manager.relay(dappManager, "changeLimit", [wallet.contractAddress, dappLimit], wallet, [nonowner]);
                const success = parseRelayReceipt(txReceipt);
                assert.isNotOk(success, "non-owner changing the limit should throw");
                const limit = await dappManager.getCurrentLimit(wallet.contractAddress);
                assert.equal(limit.toNumber(), ETH_LIMIT, "dapp limit should be zero");
            });
            it('should not let a non owner set the dapp limit (blockchain transaction)', async () => {
                await assert.revert(dappManager.from(nonowner).changeLimit(wallet.contractAddress, dappLimit), "non-owner changing the limit should throw");
                const limit = await dappManager.getCurrentLimit(wallet.contractAddress);
                assert.equal(limit.toNumber(), ETH_LIMIT, "dapp limit should be zero");
            });
        });
    });

    describe("Dapp Transfers", () => {

        const dappLimit = ETH_LIMIT - 100;

        beforeEach(async () => {
            await manager.relay(dappManager, "changeLimit", [wallet.contractAddress, dappLimit], wallet, [owner]);
            await manager.increaseTime(SECURITY_PERIOD + 1);
        });

        describe("Authorized Dapp", () => {
            describe("Calling Third party contracts", () => {

                const targetState = 2;
                let registeredContract, dataToTransfer, setStateSignature;

                beforeEach(async () => {
                    registeredContract = await deployer.deploy(TestContract);
                    dataToTransfer = registeredContract.contract.interface.functions['setState'].encode([targetState]);
                    setStateSignature = registeredContract.contract.interface.functions['setState'].sighash;
                    assert.equal(await registeredContract.state(), 0, "initial contract state should be 0");
                    await dappRegistry.register(registeredContract.contractAddress, [setStateSignature]);
                });

                it('should allow immediate authorisation of a dapp [key, contract, method] when the contract is registered', async () => {
                    await manager.relay(dappManager, 'authorizeCall', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, [setStateSignature]], wallet, [owner]);
                    let isauthorised = await dappManager.isAuthorizedCall(wallet.contractAddress, dapp.address, registeredContract.contractAddress, dataToTransfer);
                    assert.equal(isauthorised, true, 'dapp should be authorised immediately');
                });
                it('should delay the authorisation of a dapp [key, contract, method] when the contract is not registered', async () => {
                    let unregisteredContract = await deployer.deploy(TestContract);
                    await manager.relay(dappManager, 'authorizeCall', [wallet.contractAddress, dapp.address, unregisteredContract.contractAddress, [setStateSignature]], wallet, [owner]);
                    let isauthorised = await dappManager.isAuthorizedCall(wallet.contractAddress, dapp.address, unregisteredContract.contractAddress, dataToTransfer);
                    assert.equal(isauthorised, false, 'dapp should not be authorised immediately');
                    await manager.increaseTime(SECURITY_PERIOD + 1);
                    await dappManager.confirmAuthorizeCall(wallet.contractAddress, dapp.address, unregisteredContract.contractAddress, [setStateSignature]);
                    isauthorised = await dappManager.isAuthorizedCall(wallet.contractAddress, dapp.address, unregisteredContract.contractAddress, dataToTransfer);
                    assert.equal(isauthorised, true, 'dapp should be authorised after confirmation');
                });
                it('should allow authorized dapp to call an authorized method of an external contract when no ETH is transfered (relayed transaction)', async () => {
                    const amount = 0;
                    await manager.relay(dappManager, 'authorizeCall', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, [setStateSignature]], wallet, [owner]);
                    await manager.relay(dappManager, 'callContract', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, amount, dataToTransfer], wallet, [dapp]);
                    assert.equal(await registeredContract.state(), targetState, 'the state of the external contract should have been changed');
                });
                it('should not allow authorized dapp to call an non-authorized method of an external contract even when under the limit (relayed transaction)', async () => {
                    const amount = 0;
                    let txReceipt = await manager.relay(dappManager, 'callContract', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, amount, dataToTransfer], wallet, [dapp]);
                    const success = parseRelayReceipt(txReceipt);
                    assert.isNotOk(success, 'callContract should not have succeeded');
                    assert.equal(await registeredContract.state(), 0, 'the state of the external contract should not have been changed');
                });
                it('should allow authorized dapp to call an authorized payable external function under the limit (relayed transaction)', async () => {
                    const amount = dappLimit - 100;
                    const before = await deployer.provider.getBalance(registeredContract.contractAddress);
                    await manager.relay(dappManager, 'authorizeCall', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, [setStateSignature]], wallet, [owner]);
                    await manager.relay(dappManager, 'callContract', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, amount, dataToTransfer], wallet, [dapp]);
                    assert.equal(await registeredContract.state(), targetState, 'the state of the external contract should have been changed');
                    const after = await deployer.provider.getBalance(registeredContract.contractAddress);
                    assert.equal(after.sub(before), amount, 'the external contract should have received the ether transfered');
                });
                it('should not allow authorized dapp to call an authorized payable external function above the limit (relayed transaction)', async () => {
                    const amount = dappLimit + 50;
                    const before = await deployer.provider.getBalance(registeredContract.contractAddress);
                    const txReceipt = await manager.relay(dappManager, 'callContract', [wallet.contractAddress, dapp.address, registeredContract.contractAddress, amount, dataToTransfer], wallet, [dapp]);
                    const success = parseRelayReceipt(txReceipt);
                    assert.isNotOk(success, 'callContract should not have succeeded');
                    assert.equal(await registeredContract.state(), 0, 'the state of the external contract should not have been changed');
                    const after = await deployer.provider.getBalance(registeredContract.contractAddress);
                    assert.equal(after.sub(before), 0, 'the external contract should not have received the ether transfered');
                });
                it('should not allow authorized dapp to call arbitrary module methods (relayed transaction)', async () => {
                    // evil dapp will try to increase the dapp limit
                    const data = dappManager.contract.interface.functions['changeLimit'].encode([wallet.contractAddress, dappLimit + 10]);
                    const txReceipt = await manager.relay(dappManager, 'callContract', [wallet.contractAddress, dapp.address, dappManager.contractAddress, 0, data], wallet, [dapp]);
                    const success = parseRelayReceipt(txReceipt);
                    assert.isNotOk(success, 'callContract should not have succeeded');
                    const limit = await dappManager.getCurrentLimit(wallet.contractAddress);
                    assert.equal(limit.toNumber(), dappLimit, "dapp limit should not have been changed");
                });
            });
        });
        describe("Unauthorized Dapp", () => {

            const dataToTransfer = ethers.constants.HashZero;
            const amount = dappLimit - 100;

            it('should not allow unauthorized dapp to do ETH transfer (relayed transaction)', async () => {
                const before = await deployer.provider.getBalance(recipient.address);
                const txReceipt = await manager.relay(dappManager, 'callContract', [wallet.contractAddress, nondapp.address, recipient.address, amount, dataToTransfer], wallet, [nondapp]);
                const success = parseRelayReceipt(txReceipt);
                assert.isNotOk(success, 'callContract should not have succeeded')
                const after = await deployer.provider.getBalance(recipient.address);
                assert.equal(after.sub(before).toNumber(), 0, 'should not have transfered funds');
            });
            it('should not allow unauthorized dapp to do ETH transfer (blockchain transaction)', async () => {
                const before = await deployer.provider.getBalance(recipient.address);
                // passing nondapp as the dapp contractAddress
                await assert.revert(dappManager.from(nondapp).callContract(wallet.contractAddress, nondapp.address, recipient.address, amount, dataToTransfer), "callContract() should throw");
                // passing dapp as the dapp contractAddress
                await assert.revert(dappManager.from(nondapp).callContract(wallet.contractAddress, dapp.address, recipient.address, amount, dataToTransfer), "callContract() should throw");
                let after = await deployer.provider.getBalance(recipient.address);
                assert.equal(after.sub(before).toNumber(), 0, 'should not have transfered funds');
            });
        });
    });
});