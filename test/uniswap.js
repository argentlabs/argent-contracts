const etherlime = require('etherlime');
const Wallet = require("../build/BaseWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const UniswapFactory = require("../contracts/test/compiled/UniswapFactory");
const UniswapExchange = require("../contracts/test/compiled/UniswapExchange");
const GuardianStorage = require("../build/GuardianStorage");
const UniswapManager = require("../build/UniswapManager");
const ERC20 = require("../build/TestERC20");

const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const PRIVKEY = "0x2715304eb500d6b131ba5de64e3ac1ff50c3bc256c3d3584a1c40f9240941502";
const ADDRESS = "0xE466bC93eF22b047aBB71F21cE24D21c9d8299DC";

const TestManager = require("../utils/test-manager");
//const accounts = [{signer: new ethers.Wallet(PRIVKEY)}];

describe("Test Uniswap", function () {
    this.timeout(1000000);

    const manager = new TestManager(accounts, 'ganache');

    let infrastructure = accounts[0].signer;
    let owner = accounts[0].signer;

    let wallet, uniswapFactory, uniswapManager;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(ModuleRegistry);
        uniswapFactory = await deployer.deploy(UniswapFactory);
        const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
        await uniswapFactory.initializeFactory(uniswapTemplateExchange.contractAddress); 
        const guardianStorage = await deployer.deploy(GuardianStorage);
        uniswapManager = await deployer.deploy(UniswapManager, {}, registry.contractAddress, guardianStorage.contractAddress, uniswapFactory.contractAddress);
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [uniswapManager.contractAddress]);
    });

    describe("Add liquidity ", () => {

        async function createPool(ethAmount, tokenAmount) {
            erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address], 1000, 18); 
            await uniswapFactory.from(infrastructure).createExchange(erc20.contractAddress); 
            const exchangeAddress = await uniswapFactory.getExchange(erc20.contractAddress); 
            const liquidityPool = await etherlime.ContractAt(UniswapExchange, exchangeAddress); console.log("uniswap Exchange", liquidityPool.contractAddress);
            await erc20.from(infrastructure).approve(liquidityPool.contractAddress, tokenAmount); 

            // Chack that the pool is correctly setup
            const balanceETH = await deployer.provider.getBalance(infrastructure.address); 
            const balanceERC20 = await erc20.balanceOf(infrastructure.address); 
            const liquidityToken = await liquidityPool.tokenAddress(); 
            const liquidityFactory = await liquidityPool.factoryAddress(); 
            const exchangeFromFactory = await uniswapFactory.getExchange(liquidityToken); 
            const totalSupply = await liquidityPool.totalSupply();  
            const approved = await erc20.allowance(infrastructure.address, liquidityPool.contractAddress);
            console.log("sender balance ETH", balanceETH.toString());
            console.log("sender balance ERC20", balanceERC20.toString());
            console.log("token reference in exchange", liquidityToken);
            console.log("factory reference in exchange", liquidityFactory);
            console.log("exchange reference in factory", exchangeFromFactory);
            console.log("exchange total Supply", totalSupply.toString());
            console.log("ERC20 allowance for exchange", approved.toString());
            assert.isTrue(totalSupply == 0, "liquidity should be zero");
            assert.isTrue(balanceETH.gt(ethAmount), "insufficient ETH");
            assert.isTrue(balanceERC20.gt(tokenAmount), "insufficient ERC20");
            assert.isTrue(liquidityToken == erc20.contractAddress, "pool initilaised with wrong token");
            assert.isTrue(liquidityFactory == uniswapFactory.contractAddress, "pool initialised with wrong factory");
            assert.isTrue(exchangeFromFactory == liquidityPool.contractAddress, "wrong exchange for token");
            assert.isTrue(approved == tokenAmount, "approval failed");
            
            const currentBlock = await manager.getCurrentBlock(); console.log("currentBlock", currentBlock);
            await liquidityPool.from(infrastructure).addLiquidity(0, tokenAmount, currentBlock + 3000, {value: ethAmount});
            return liquidityPool;
        }
        it('should create a liquidity pool with an initial liquidity', async () => {
            const pool = await createPool(200000000000, 200000000000);
        });
    });

});