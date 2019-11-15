// How to run this test file:
// 1. add your private key (KOVAN_PRIV_KEY) and Kovan Infura API key (KOVAN_INFURA_KEY) to .env
// --- TO TEST ON KOVAN: ----
// 2. npx etherlime test test/makerV2Manager_loan.js --skip-compilation --network kovan
// --- TO TEST ON KOVAN-FORK: ----
// 2. npm run kovan-fork
// 3. npx etherlime test test/makerV2Manager_loan.js --skip-compilation --network kovan-fork

const TestManager = require("../utils/test-manager");
const DeployManager = require('../utils/deploy-manager.js');

const MakerV2Manager = require('../build/MakerV2Manager');
const MakerRegistry = require('../build/MakerRegistry');
const ScdMcdMigration = require('../build/ScdMcdMigration');
const Wallet = require("../build/BaseWallet");
const DSToken = require('../build/DSToken');

const { parseEther, formatEther } = require('ethers').utils;

const DEFAULT_NETWORK = 'kovan-fork'; // also works on kovan (faster, but uses real KETH)
const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

describe("Test MakerV2 CDPs", function () {
    this.timeout(1000000);

    if (!process.argv.join(' ').includes(__filename.slice(__dirname.length + 1))) {
        // We do not want to run this file as part of the complete test suite.
        // This is because this test file can currently only be run on kovan or kovan-fork 
        // (using the --fork option of ganache-cli) whereas other test files are run using ganache
        return;
    }

    let testManager, makerV2, saiToken, daiToken, walletAddress, owner;

    before(async () => {
        let idx = process.argv.indexOf("--network");
        const network = idx > -1 ? process.argv[idx + 1] : DEFAULT_NETWORK;
        if (!network.includes("kovan")) throw new Error("--network must be 'kovan' or 'kovan-fork'")

        const deployManager = new DeployManager(network);
        await deployManager.setup();
        const configurator = deployManager.configurator;
        deployer = deployManager.deployer;
        testManager = new TestManager([...Array(10)].map(() => deployer), network);
        owner = deployer.signer;
        const config = configurator.config;

        const makerRegistry = await deployer.deploy(MakerRegistry);

        makerV2 = await deployer.deploy(
            MakerV2Manager,
            {},
            config.contracts.ModuleRegistry,
            config.modules.GuardianStorage,
            config.defi.maker.migration,
            config.defi.maker.pot,
            makerRegistry.contractAddress
        );
        const migration = await deployer.wrapDeployedContract(ScdMcdMigration, await makerV2.scdMcdMigration());
        await makerRegistry.addCollateral(await migration.wethJoin());

        saiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.saiToken());
        daiToken = await deployer.wrapDeployedContract(DSToken, await makerV2.daiToken());

        idx = process.argv.indexOf("--wallet");
        walletAddress = idx > -1 && process.argv[idx + 1];
        if (!walletAddress) { // create a new wallet
            wallet = await deployer.deploy(Wallet);
            await wallet.init(owner.address, [makerV2.contractAddress]);
            walletAddress = wallet.contractAddress;
        }
        await owner.sendTransaction({ to: walletAddress, value: parseEther('0.5') });
    });

    describe("Loan", () => {
        async function testOpenLoan({ ethAmount, daiAmount, relayed }) {
            const beforeETH = await deployer.provider.getBalance(walletAddress);
            const beforeDAI = await daiToken.balanceOf(walletAddress);
            const beforeDAISupply = await daiToken.totalSupply();

            const params = [walletAddress, ETH_TOKEN, ethAmount, daiToken.contractAddress, daiAmount];
            let txReceipt;
            if (relayed) {
                txReceipt = await testManager.relay(makerV2, 'openLoan', params, wallet, [owner]);
            } else {
                const tx = await makerV2.from(owner).openLoan(...params, { gasLimit: 2000000 });
                txReceipt = await makerV2.verboseWaitForTransaction(tx);
            }

            const loanId = txReceipt.events.find(e => e.event === 'LoanOpened').args._loanId;
            assert.isDefined(loanId, 'Loan ID should be defined')

            const afterETH = await deployer.provider.getBalance(walletAddress);
            const afterDAI = await daiToken.balanceOf(walletAddress);
            const afterDAISupply = await daiToken.totalSupply();

            assert.equal(beforeETH.sub(afterETH).toString(), ethAmount.toString(), `wallet should have ${ethAmount} less ETH (relayed: ${relayed})`);
            assert.equal(afterDAI.sub(beforeDAI).toString(), daiAmount.toString(), `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`);
            assert.equal(afterDAISupply.sub(beforeDAISupply).toString(), daiAmount.toString(), `${daiAmount} DAI should have been minted (relayed: ${relayed})`);

            return loanId;
        }

        describe("Open Loan", () => {
            it('should open a Loan (blockchain tx)', async () => {
                await testOpenLoan({ ethAmount: parseEther('0.25'), daiAmount: parseEther('20.0'), relayed: false })
            });
            it('should open a Loan (relayed tx)', async () => {
                await testOpenLoan({ ethAmount: parseEther('0.25'), daiAmount: parseEther('20.0'), relayed: true })
            });
        });


    })


});