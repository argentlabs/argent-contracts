const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const TransferStorage = require("../build/TransferStorage");
const GuardianStorage = require("../build/GuardianStorage");
const TransferModule = require("../build/TransferManager");
const OldTransferModule = require("../build/TokenTransfer");
const KyberNetwork = require("../build/KyberNetworkTest");
const TokenPriceProvider = require("../build/TokenPriceProviderTest");
const ERC20 = require("../build/TestERC20");

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const DECIMALS = 12; // number of decimal for TOKN contract
const KYBER_RATE = ethers.utils.bigNumberify(51 * 10**13); // 1 TOKN = 0.00051 ETH
const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");

describe("Test TransferManager", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;
    let nonowner = accounts[2].signer;
    let recipient = accounts[3].signer;

    let kyber, registry, priceProvider, transferStorage, guardianStorage, transferModule, previousTransferModule, wallet;

    before(async () => { 
        deployer = manager.newDeployer();
        registry = await deployer.deploy(Registry);
        kyber = await deployer.deploy(KyberNetwork);
        priceProvider = await deployer.deploy(TokenPriceProvider, {}, kyber.contractAddress);
        transferStorage = await deployer.deploy(TransferStorage);
        guardianStorage = await deployer.deploy(GuardianStorage);
        previousTransferModule = await deployer.deploy(OldTransferModule, {},
            registry.contractAddress,
            transferStorage.contractAddress,
            guardianStorage.contractAddress,
            priceProvider.contractAddress,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            ETH_LIMIT
        );
        transferModule = await deployer.deploy(TransferModule, {},
            registry.contractAddress,
            transferStorage.contractAddress,
            guardianStorage.contractAddress,
            priceProvider.contractAddress,
            SECURITY_PERIOD,
            SECURITY_WINDOW,
            ETH_LIMIT,
            previousTransferModule.contractAddress
        );
        await registry.registerModule(transferModule.contractAddress, ethers.utils.formatBytes32String("TransferModule"));
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet); 
        await wallet.init(owner.address, [transferModule.contractAddress]);
        erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
        await kyber.addToken(erc20.contractAddress, KYBER_RATE, DECIMALS);
        await priceProvider.syncPrice(erc20.contractAddress);
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.utils.bigNumberify('1000000000000000000') });
    });

    describe("Managing limit and whitelist ", () => {
        it('should migrate the limit for existing wallets', async () => {
            // create wallet with previous module and funds
            let existingWallet = await deployer.deploy(Wallet); 
            await existingWallet.init(owner.address, [previousTransferModule.contractAddress]);
            await infrastructure.sendTransaction({ to: existingWallet.contractAddress, value: ethers.utils.bigNumberify('100000000') });
            // change the limit
            await previousTransferModule.from(owner).changeLimit(existingWallet.contractAddress, 4000000);
            await manager.increaseTime(3);
            let limit = await previousTransferModule.getCurrentLimit(existingWallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
            // transfer some funds
            await previousTransferModule.from(owner).transferToken(existingWallet.contractAddress, ETH_TOKEN, recipient.address, 1000000, ZERO_BYTES32);
            // add new module
            await previousTransferModule.from(owner).addModule(existingWallet.contractAddress, transferModule.contractAddress);
            // check result
            limit = await transferModule.getCurrentLimit(existingWallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should have been migrated");
            let unspent = await transferModule.getDailyUnspent(existingWallet.contractAddress);
            assert.equal(unspent[0].toNumber(), 4000000 - 1000000, 'unspent should have been migrated');
        });
        it('should set the default limit for new wallets', async () => {
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
        });
        it('should only change the limit after the security period', async () => {
            await transferModule.from(owner).changeLimit(wallet.contractAddress, 4000000);
            let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should change the limit via relayed transaction', async () =>  {
            await manager.relay(transferModule, 'changeLimit', [wallet.contractAddress, 4000000], wallet, [owner]);
            await manager.increaseTime(3);
            limit = await transferModule.getCurrentLimit(wallet.contractAddress);
            assert.equal(limit.toNumber(), 4000000, "limit should be changed");
        });
        it('should add/remove an account to/from the whitelist', async () =>  {
            await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
            let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted,false, "should not be trusted during the security period");
            await manager.increaseTime(3);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted,true, "should be trusted after the security period");
            await transferModule.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
            isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
            assert.equal(isTrusted,false, "should no removed from whitemist immediately");
        });
    });

    describe("Small token transfers", () => {

        async function smallTransfer({ token, signer = owner, to, amount, relayed = false }) {
            let fundsBefore = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
            const params = [wallet.contractAddress, token == ETH_TOKEN ? ETH_TOKEN : token.contractAddress, to.address, amount, ZERO_BYTES32];
            let txReceipt;
            if (relayed) {
                txReceipt = await manager.relay(transferModule, 'transferToken', params, wallet, [signer]);
            } else {
                const tx = await transferModule.from(signer).transferToken(...params);
                txReceipt = await transferModule.verboseWaitForTransaction(tx);
            }
            let fundsAfter = (token == ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
            let unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, 'should have transfered amount');
            let ethValue = (token == ETH_TOKEN ? amount : (await priceProvider.getEtherValue(amount, token.contractAddress)).toNumber());
            assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, 'should have updated the daily spent in ETH');
            return txReceipt;
        }

        it('should let the owner send ETH', async () => {
            await smallTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
        });
        it('should let the owner send ETH (relayed)', async () => {
            await smallTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000, relayed: true });
        });
        it('should let the owner send ERC20', async () => {
            await smallTransfer({ token: erc20, to: recipient, amount: 10 });
        });
        it('should let the owner send ERC20 (relayed)', async () => {
            await smallTransfer({ token: erc20, to: recipient, amount: 10, relayed: true });
        });
        it('should only let the owner send ETH', async () => {
            try {
                await smallTransfer({ token: ETH_TOKEN, signer: nonowner, to: recipient, amount: 10000 });
            } catch (error) {
                assert.ok(error.message.includes("must be an owner"));
            }
        });
        it('should calculate the daily unspent when the owner send ETH', async () => {
            let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'unspent should be the limit at the beginning of a period');
            await smallTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
            unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT - 10000, 'should be the limit minuss the transfer');
        });
        it('should calculate the daily unspent in ETH when the owner send ERC20', async () => {
            let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT, 'unspent should be the limit at the beginning of a period');
            await smallTransfer({ token: erc20, to: recipient, amount: 10 });
            unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
            let ethValue = await priceProvider.getEtherValue(10, erc20.contractAddress);
            assert.equal(unspent[0].toNumber(), ETH_LIMIT - ethValue.toNumber(), 'should be the limit minuss the transfer');
        });
    });



    // describe("Large ETH transfers ", () => {
    //     it('should create and execute a pending transfers', async () => {
    //         let amountToTransfer = ETH_LIMIT + 10000;
    //         let before = await deployer.provider.getBalance(recipient.address);
    //         let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let receipt = await transferModule.verboseWaitForTransaction(tx);
    //         let after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
    //         let block = receipt.blockNumber;
    //         let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
    //         let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
    //         await manager.increaseTime(3);
    //         await transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block);
    //         after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
    //     });
    //     it('should prevent the execution of pending transfers outside the confirmation window', async () => {
    //         let amountToTransfer = ETH_LIMIT + 10000;
    //         let before = await deployer.provider.getBalance(recipient.address);
    //         let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let receipt = await transferModule.verboseWaitForTransaction(tx);
    //         let after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
    //         let block = receipt.blockNumber;
    //         let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
    //         let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
    //         // before period
    //         await assert.revert(transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block), "confirmation before the security window should throw");
    //         await manager.increaseTime(5);
    //         // after period
    //         await assert.revert(transferModule.executePendingTransfer(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block), "confirmation after the security window should throw");
    //     });
    //     it('should cancel an existing pending transfer', async () => {
    //         let amountToTransfer = ETH_LIMIT + 10000;
    //         let before = await deployer.provider.getBalance(recipient.address);
    //         let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let receipt = await transferModule.verboseWaitForTransaction(tx);
    //         let after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
    //         let block = receipt.blockNumber;
    //         let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
    //         let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
    //         await manager.increaseTime(1);
    //         await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
    //         executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter, 0, 'should have cancelled the pending transfer');
    //     });
    //     it('should send immediately to a whitelisted address', async () =>  {
    //         let amountToTransfer = ETH_LIMIT + 10000;
    //         await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
    //         await manager.increaseTime(3);
    //         let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
    //         assert.equal(isTrusted,true, "should be trusted");
    //         let before = await deployer.provider.getBalance(recipient.address);
    //         await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
    //     });
    //     it('should execute a pending transfers using relayed transaction', async () => {
    //         let amountToTransfer = ETH_LIMIT + 10000;
    //         let before = await deployer.provider.getBalance(recipient.address);
    //         let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let receipt = await transferModule.verboseWaitForTransaction(tx);
    //         let block = receipt.blockNumber;
    //         let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
    //         let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
    //         await manager.increaseTime(3);
    //         await manager.relay(transferModule, 'executePendingTransfer' ,[wallet.contractAddress, ETH_TOKEN, recipient.address, amountToTransfer, ZERO_BYTES32, block], wallet, []);
    //         let after = await deployer.provider.getBalance(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
    //     });
    // });

    // describe("Large ERC20 transfers ", () => {
    //     it('should create and execute an ERC20 pending transfers', async () => {
    //         let amountToTransfer = 10000;
    //         let before = await erc20.balanceOf(recipient.address);
    //         let tx = await transferModule.from(owner).transferToken(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32);
    //         let receipt = await transferModule.verboseWaitForTransaction(tx);
    //         let after = await erc20.balanceOf(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), 0, 'should not have executed the transfer');
    //         let block = receipt.blockNumber;
    //         let id = ethers.utils.solidityKeccak256(['address', 'address', 'uint256', 'bytes', 'uint256'], [erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32, block]);
    //         let executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
    //         assert.equal(executeAfter > 0, true, 'should have created a pending transfer');
    //         await manager.increaseTime(3);
    //         await transferModule.executePendingTransfer(wallet.contractAddress, erc20.contractAddress, recipient.address, amountToTransfer, ZERO_BYTES32, block);
    //         after = await erc20.balanceOf(recipient.address);
    //         assert.equal(after.sub(before).toNumber(), amountToTransfer, 'should have executed the transfer');
    //     });
    // });
});