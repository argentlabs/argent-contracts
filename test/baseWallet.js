const Wallet = require('../build/BaseWallet');
const Module = require('../build/TestModule');
const Registry = require('../build/ModuleRegistry');

const TestManager = require("../utils/test-manager");

describe("Test BaseWallet", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let owner = accounts[1].wallet;
    let nonowner = accounts[2].wallet;

    let wallet;
    let module1, module2, module3;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        module1 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
        module2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 42);
        module3 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
    });

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
});