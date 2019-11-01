const Wallet = require('../build/BaseWallet');
const OldWallet = require('../build/LegacyBaseWallet');
const Module = require('../build/TestModule');
const OldTestModule = require('../build/OldTestModule');
const NewTestModule = require('../build/NewTestModule');
const Registry = require('../build/ModuleRegistry');

const TestManager = require("../utils/test-manager");

describe("Test BaseWallet", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;

    let wallet;
    let module1, module2, module3, oldModule, newModule;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        module1 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
        module2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 42);
        module3 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
        oldModule = await deployer.deploy(OldTestModule, {}, registry.contractAddress);
        newModule = await deployer.deploy(NewTestModule, {}, registry.contractAddress);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
    });

    describe("Old and New BaseWallets", () => {

        it("should create a wallet with the correct owner", async () => {
            let walletOwner = await wallet.owner();
            assert.equal(walletOwner, "0x0000000000000000000000000000000000000000", "owner should be null before init");
            await wallet.init(owner.address, [module1.contractAddress]);
            walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, "owner should be the owner after init");
        });

        it("should create a wallet with the correct modules", async () => {
            await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress]);
            let module1IsAuthorised = await wallet.authorised(module1.contractAddress);
            let module2IsAuthorised = await wallet.authorised(module2.contractAddress);
            let module3IsAuthorised = await wallet.authorised(module3.contractAddress);
            assert.equal(module1IsAuthorised, true, "module1 should be authorised");
            assert.equal(module2IsAuthorised, true, "module2 should be authorised");
            assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
        });

        it("should accept ETH", async () => {
            let before = await deployer.provider.getBalance(wallet.contractAddress);
            await nonowner.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
            let after = await deployer.provider.getBalance(wallet.contractAddress);
            assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
        });

        it("should delegate static calls to the modules", async () => {
            await wallet.init(owner.address, [module1.contractAddress]);
            let module1IsAuthorised = await wallet.authorised(module1.contractAddress);
            assert.equal(module1IsAuthorised, true, "module1 should be authorised");
            let walletAsModule = deployer.wrapDeployedContract(Module, wallet.contractAddress);
            let boolVal = await walletAsModule.contract.getBoolean();
            let uintVal = await walletAsModule.contract.getUint();
            let addressVal = await walletAsModule.contract.getAddress(nonowner.address);
            assert.equal(boolVal, true, "should have the correct bool");
            assert.equal(uintVal, 42, "should have the correct uint");
            assert.equal(addressVal, nonowner.address, "should have the address");
        });

    })

    describe("New BaseWallet", () => {
        it("should work with old modules", async () => {
            await wallet.init(owner.address, [oldModule.contractAddress]);
            await oldModule.callDapp(wallet.contractAddress, { gasLimit: 500000 });
            await oldModule.callDapp2(wallet.contractAddress, { gasLimit: 500000 });
        })
        it("should work with new modules", async () => {
            await wallet.init(owner.address, [newModule.contractAddress]);
            await newModule.callDapp(wallet.contractAddress);
            await newModule.callDapp2(wallet.contractAddress, 2, true);
        })
        it("should bubble the reason message up when reverting", async () => {
            await wallet.init(owner.address, [newModule.contractAddress]);
            const reason = "I'm hereby reverting this transaction using a reason message that is longer than 32 bytes!"
            try {
                await newModule.fail(wallet.contractAddress, reason);
            } catch (e) {
                assert.isTrue(await manager.isRevertReason(e, reason), "invalid reason message");
            }

        })
    });

    describe("Old BaseWallet", () => {
        it("should work with new modules", async () => {
            const oldWallet = await deployer.deploy(OldWallet);
            await oldWallet.init(owner.address, [oldModule.contractAddress, newModule.contractAddress]);
            await newModule.callDapp(oldWallet.contractAddress);
            await newModule.callDapp2(oldWallet.contractAddress, 2, false);
            await assert.revert(newModule.fail(oldWallet.contractAddress, "just because"))
        })
    });

});