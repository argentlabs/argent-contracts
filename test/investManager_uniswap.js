const etherlime = require('etherlime');
const Wallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const UniswapFactory = require("../contracts/test/uniswap/UniswapFactory");
const UniswapExchange = require("../contracts/test/uniswap/UniswapExchange");
const UniswapProvider = require("../build/UniswapProvider");
const GuardianStorage = require("../build/GuardianStorage");
const InvestManager = require("../build/InvestManager");
const ERC20 = require("../build/TestERC20");
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const TestManager = require("../utils/test-manager");
const { parseEther, formatBytes32String, bigNumberify } = require('ethers').utils;

describe("Invest Manager with Uniswap", function () {
    this.timeout(1000000);

    const manager = new TestManager(accounts, 'ganache');

    let infrastructure = accounts[0].signer;
    let owner = accounts[1].signer;

    let wallet, uniswapFactory, uniswapProvider, investManager, token;

    before(async () => {
        deployer = manager.newDeployer();
        // deploy Uniswap contracts
        uniswapFactory = await deployer.deploy(UniswapFactory);
        const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
        await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress); 
        // deploy Argent contracts
        uniswapProvider = await deployer.deploy(UniswapProvider);
        const registry = await deployer.deploy(ModuleRegistry);
        const guardianStorage = await deployer.deploy(GuardianStorage);
        investManager = await deployer.deploy(InvestManager, {}, registry.contractAddress, guardianStorage.contractAddress);
        await investManager.addProvider(uniswapProvider.contractAddress, [uniswapFactory.contractAddress]);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [investManager.contractAddress]);
        token = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000, 18); 
        await infrastructure.sendTransaction({ to: wallet.contractAddress, value: parseEther('1') });
    });

    async function testCreatePool(initialEthLiquidity, initialTokenPrice) {
        let initialTokenAmount = initialEthLiquidity.mul(initialTokenPrice);
        await uniswapFactory.from(infrastructure).createExchange(token.contractAddress); 
        const exchangeAddress = await uniswapFactory.getExchange(token.contractAddress); 
        const liquidityPool = await etherlime.ContractAt(UniswapExchange, exchangeAddress);
        await token.from(infrastructure).approve(liquidityPool.contractAddress, initialTokenAmount); 
        const currentBlock = await manager.getCurrentBlock(); 
        const timestamp = await manager.getTimestamp(currentBlock); 
        await liquidityPool.from(infrastructure).addLiquidity(1, initialTokenAmount, timestamp + 300, {value: initialEthLiquidity, gasLimit: 150000});
        const totalSupply = await liquidityPool.totalSupply();  
        const shares = await liquidityPool.balanceOf(infrastructure.address); 
        assert.isTrue(totalSupply.eq(initialEthLiquidity));
        assert.isTrue(shares.eq(totalSupply));
        return liquidityPool;
    };

    async function testAddInvestment(initialEthLiquidity, initialTokenPrice, amount, relay = false) {
        
        await token.from(infrastructure).transfer(wallet.contractAddress, amount);
        
        let ethBefore = await deployer.provider.getBalance(wallet.contractAddress);
        let tokenBefore = await token.balanceOf(wallet.contractAddress);
        let pool = await testCreatePool(initialEthLiquidity, initialTokenPrice);
        
        let txReceipt;
        const params = [wallet.contractAddress, uniswapProvider.contractAddress, token.contractAddress, amount, 0];
        if(relay) {
            txReceipt = await manager.relay(investManager, 'addInvestment', params, wallet, [owner]);
        }
        else {
            const tx = await investManager.from(owner).addInvestment(...params, {gasLimit: 300000});
            txReceipt = await investManager.verboseWaitForTransaction(tx);
        } 
        assert.isTrue(await utils.hasEvent(txReceipt, investManager, "InvestmentAdded"), "should have generated InvestmentAdded event"); 
        
        let shares = await pool.balanceOf(wallet.contractAddress);
        let ethAfter = await deployer.provider.getBalance(wallet.contractAddress);
        let tokenAfter = await token.balanceOf(wallet.contractAddress); 

        assert.isTrue(shares.gt(0), "should have received shares");
        assert.isTrue(tokenAfter - tokenBefore.sub(amount) <= initialTokenPrice, "Should have invested the correct amount of tokens");
        assert.isTrue(ethAfter - ethBefore.sub(amount.div(initialTokenPrice)) <= initialTokenPrice, "Should have taken the correct amount of ETH");

        return [pool, shares];
    };

    async function testRemoveInvestment(initialEthLiquidity, initialTokenPrice, percentToAdd, percentToremove, relay = false) {
        let result = await testAddInvestment(initialEthLiquidity, initialTokenPrice, initialEthLiquidity.mul(percentToAdd).div(100), 0);
        let sharesBefore = result[1]; 

        let txReceipt;
        const params = [wallet.contractAddress, uniswapProvider.contractAddress, [ETH_TOKEN, token.contractAddress], percentToremove *100];
        if(relay) {
            txReceipt = await manager.relay(investManager, 'removeInvestment', params, wallet, [owner]);
        }
        else {
            const tx = await investManager.from(owner).removeInvestment(...params, {gasLimit: 300000});
            txReceipt = await investManager.verboseWaitForTransaction(tx);
        }

        let logs = utils.parseLogs(txReceipt, investManager, "InvestmentRemoved"); 
        let sharesAfter = await result[0].balanceOf(wallet.contractAddress);

        assert.isTrue(sharesAfter.eq(sharesBefore.sub(sharesBefore.mul(percentToremove).div(100))), "should have sold the correct amount of shares");
    }

    describe("Basic framework", () => {
        it('should create a liquidity pool with the correct supply', async () => {
            await testCreatePool(ethers.utils.bigNumberify('10000000000000000'), 2);
        });

        it('should fail to add investment when the provider is unknown', async () => {
            await testCreatePool(ethers.utils.bigNumberify('10000000000000000'), 2);
            await assert.revert(investManager.from(owner).addInvestment(
                wallet.contractAddress, 
                uniswapFactory.contractAddress,
                token.contractAddress, 
                20000000, 
                0,
                {gasLimit: 300000}
            ),"should throw when the provider is unknown");
        });

        it('should fail to remove investment when the provider is unknown', async () => {
            let initialEthLiquidity = ethers.utils.bigNumberify('10000000000000000');
            await testAddInvestment(initialEthLiquidity, 2, initialEthLiquidity.div(1000000), initialEthLiquidity.div(2000000));
            await assert.revert(investManager.from(owner).removeInvestment(
                wallet.contractAddress,
                uniswapFactory.contractAddress,
                [ETH_TOKEN, token.contractAddress],
                5000, 
                {gasLimit: 100000}
            ), "should throw when the provider is unknown");
        });
    });

    describe("Add investment", () => {
        it('should invest when the user has enough tokens and ETH', async () => {
            await testAddInvestment(parseEther('1'), 2, parseEther('0.02'), 0);
        });

        it('should invest when the user has enough tokens and ETH', async () => {
            await testAddInvestment(parseEther('1'), 3, parseEther('0.02'), 0);
        });

        it('should invest when the user has enough tokens and ETH', async () => {
            await testAddInvestment(parseEther('1'), 4, parseEther('0.02'), 0);
        });

        it('should invest when the user has enough tokens and ETH', async () => {
            await testAddInvestment(parseEther('1'), 11, parseEther('0.02'), 0);
        });

        it('should invest when the user has enough tokens and ETH', async () => {
            await testAddInvestment(parseEther('1'), 27, parseEther('0.02'), 0);
        });

        it('should add liquidity to the pool whith ETH only when the pool is large (100MX)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 100000000, 0);
        });

        it('should add liquidity to the pool whith ETH and some tokens when the pool is small (100X)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000'), 2, 100000000, 100000000);
        });

        it('should add liquidity to the pool whith ETH and some tokens when the pool is large (100MX)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 100000000, 100000000);
        });

        it('should add liquidity to the pool whith token only when the pool is small (100X)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000'), 2, 0, 20000000);
        });

        it('should add liquidity to the pool whith token only when the pool is large (100X)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 0, 20000000);
        });

        it('should add liquidity to the pool whith token and some ETH when the pool is small (100X)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000'), 2, 5000000, 20000000);
        });

        it('should add liquidity to the pool whith token and some ETH when the pool is large (100MX)', async () => {
            await testAddInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 5000000, 20000000);
        });
    });

    describe("Add investment with random parameters", () => {
        for(i = 0; i < 10; i++) {
            it(`should invest liquidity ${tokenPrice} `, async () => {
                let pool = parseEther('0.1').mul(Math.floor(Math.random() * 10) + 1); 
                let tokenPrice = Math.floor(Math.random() * 100) + 1;
                let amount = pool.div(1000).mul(Math.floor(Math.random() * 10) + 1).mul(tokenPrice);
                await testAddInvestment(bigNumberify(pool), tokenPrice, amount);
            });
        }

        for(i = 0; i < 20; i++) {
            it('should add liquidity to the pool whith random token, random ETH and random liquidity (relayed)', async () => {
                let pool = Math.floor(Math.random() * 1000000000000000) + 1000000000; 
                let tokenPrice = Math.floor(Math.random() * 10) + 1;
                let eth = Math.floor(Math.random() * 10000000) + 1;
                let token = (Math.floor(Math.random() * 10000000) + 1) * tokenPrice;
                await testAddInvestment(ethers.utils.bigNumberify(pool), tokenPrice, eth, token, true);
            });
        }
    });

    describe("Remove investment", () => {
        it('should remove 100% the user shares from the liquidity pool', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 100);
        });

        it('should remove 50% the user shares from the liquidity pool', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 50);
        });

        it('should remove 10% the user shares from the liquidity pool', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 10);
        });

        it('should remove 1% the user shares from the liquidity pool', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 1);
        });

        it('should remove 100% the user shares from the liquidity pool (relayed)', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 100, true);
        });

        it('should remove 50% the user shares from the liquidity pool (relayed)', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 50, true);
        });

        it('should remove 10% the user shares from the liquidity pool (relayed)', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 10, true);
        });

        it('should remove 1% the user shares from the liquidity pool (relayed)', async () => {
            await testRemoveInvestment(ethers.utils.bigNumberify('10000000000000000'), 2, 1, 1, true);
        });
    });

});