const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const TransferStorage = require("../build/TransferStorage");
const GuardianStorage = require("../build/GuardianStorage");
const TransferModule = require("../build/TokenTransfer");
const KyberNetwork = require("../build/KyberNetworkTest");
const TokenPriceProvider = require("../build/TokenPriceProvider");
const ERC20 = require("../build/TestERC20");

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const DECIMALS = 12; // number of decimal for TOKN contract
const KYBER_RATE = ethers.utils.bigNumberify(51 * 10 ** 13); // 1 TOKN = 0.00051 ETH
const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");

describe("Test Token Transfer", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;
    let recipient = accounts[3].signer;

    let kyber, priceProvider, transferModule, wallet;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        kyber = await deployer.deploy(KyberNetwork);
        priceProvider = await deployer.deploy(TokenPriceProvider, {}, kyber.contractAddress);
        await priceProvider.addManager(infrastructure.address);
        const transferStorage = await deployer.deploy(TransferStorage);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        transferModule = await deployer.deploy(TransferModule, {},
            registry.contractAddress,
            transferStorage.contractAddress,
            guardianStorage.contractAddress,
            priceProvider.contractAddress,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            ETH_LIMIT
        );
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [transferModule.contractAddress]);
        erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await kyber.addToken(erc20.contractAddress, KYBER_RATE, DECIMALS);
        await priceProvider.from(infrastructure).syncPrice(erc20.contractAddress);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.utils.bigNumberify('1000000000000000000') });
    });

    describe("Managing limit and whitelist ", () => {
        it('should get the global limit', async () => {
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit, ETH_LIMIT, "limit should be ETH_LIMIT");
        });
        it('should only change the global limit after the security period', async () => {
            await transferModule.from(owner).changeLimit(wallet.contractAddress, 4000000);
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit, ETH_LIMIT, "limit should be ETH_LIMIT");
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should change the global limit via relayed transaction', async () => {
            await manager.relay(transferModule, 'changeLimit', [wallet.contractAddress, 4000000], wallet, [owner]);
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should add/remove an account to/from the whitelist', async () => {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
            let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, false, "should not be trusted during the security period");
            await manager.increaseTime(3);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, true, "should be trusted after the security period");
            await transferModule.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, false, "should no removed from whitemist immediately");
        });
    });
    describe("Small ETH transfers ", () => {
        it('should only allow ETH transfer from the owner', async () => {
            let amountToTransfer = 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered amount');
            await assert.revert(transferModule.from(nonowner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32), "non owner transfer should throw");
        });
        it('should allow ETH transfer from the owner via relayed transaction', async () => {
            let amountToTransfer = 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            await manager.relay(transferModule, 'transferToken', [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner]);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the amount');
        });
        it('should get the daily unspent', async () => {
            let amountToTransfer = 10000;
            let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'should be the limit at the beginning of a period');
            await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT - amountToTransfer, 'should be the limit miness the transfer');
        });
    });

    describe("Small ERC20 transfers ", () => {
        it('should allow ERC20 transfer from the owner', async () => {
            let amountToTransfer = 10;
            let before = await erc20.balanceOf(recipient.address);
            await transferModule.from(owner).transferToken(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered amount');
        });
        it('should allow ERC20 transfer from the owner via relayed transaction', async () => {
            let amountToTransfer = 10;
            let before = await erc20.balanceOf(recipient.address);
            await manager.relay(transferModule, 'transferToken', [wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32], wallet, [owner]);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have transfered the amount');
        });
        it('should get the daily unspent in ETH', async () => {
            let amountToTransfer = 10;
            let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'should be the limit at the beginning of a period');
            await transferModule.from(owner).transferToken(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32);
            unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            let ethValue = await priceProvider.getEtherValue(amountToTransfer, erc20.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT - ethValue.toNumber(), 'should be the limit miness the transfer');
        });
    });

    describe("Large ETH transfers ", () => {
        it('should create and execute a pending transfers', async () => {
            let amountToTransfer = ETH_LIMIT + 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let receipt = await transferModule.verboseWaitForTransaction(tx);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
            let block = receipt.blockNumber;
            let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
            let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
            await manager.increaseTime(3);
            await transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block);
            after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
        });
        it('should prevent the execution of pending transfers outside the confirmation window', async () => {
            let amountToTransfer = ETH_LIMIT + 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let receipt = await transferModule.verboseWaitForTransaction(tx);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
            let block = receipt.blockNumber;
            let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
            let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
            // before period
            await assert.revert(transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block), "confirmation before the security window should throw");
            await manager.increaseTime(5);
            // after period
            await assert.revert(transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block), "confirmation after the security window should throw");
        });
        it('should cancel an existing pending transfer', async () => {
            let amountToTransfer = ETH_LIMIT + 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let receipt = await transferModule.verboseWaitForTransaction(tx);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
            let block = receipt.blockNumber;
            let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
            let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
            await manager.increaseTime(1);
            await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
            executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter, 0, 'should have cancelled the pending transfer');
        });
        it('should send immediately to a whitelisted address', async () => {
            let amountToTransfer = ETH_LIMIT + 10000;
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
            await manager.increaseTime(3);
            let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted, true, "should be trusted");
            let before = await deployer.provider.getBalance(recipient.address);
            await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
        });
        it('should execute a pending transfers using relayed transaction', async () => {
            let amountToTransfer = ETH_LIMIT + 10000;
            let before = await deployer.provider.getBalance(recipient.address);
            let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
            let receipt = await transferModule.verboseWaitForTransaction(tx);
            let block = receipt.blockNumber;
            let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
            let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
            await manager.increaseTime(3);
            await manager.relay(transferModule, 'executePendingTransfer', [wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block], wallet, []);
            let after = await deployer.provider.getBalance(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
        });
    });

    describe("Large ERC20 transfers ", () => {
        it('should create and execute an ERC20 pending transfers', async () => {
            let amountToTransfer = 10000;
            let before = await erc20.balanceOf(recipient.address);
            let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32);
            let receipt = await transferModule.verboseWaitForTransaction(tx);
            let after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
            let block = receipt.blockNumber;
            let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
            let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
            assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
            await manager.increaseTime(3);
            await transferModule.executePendingTransfer(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32, block);
            after = await erc20.balanceOf(recipient.address);
            assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
        });
    });
});