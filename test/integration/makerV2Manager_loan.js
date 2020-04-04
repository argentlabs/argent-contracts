// How to run this test file:
// 1. add your private key (KOVAN_PRIV_KEY) and Infura API key (INFURA_KEY) to .env
// --- TO TEST ON KOVAN: ----
// 2. npx etherlime test test/makerV2Manager_loan.js --skip-compilation --network kovan
// --- TO TEST ON KOVAN-FORK: ----
// 2. npm run kovan-fork
// 3. npx etherlime test test/makerV2Manager_loan.js --skip-compilation --network kovan-fork

const ethers = require("ethers");
const TestManager = require("../../utils/test-manager");
const DeployManager = require("../../utils/deploy-manager.js");
const MultisigExecutor = require("../../utils/multisigexecutor.js");

const MultiSig = require("../../build/MultiSigWallet");
const UniswapFactory = require("../../lib/uniswap/UniswapFactory");
const UniswapExchange = require("../../lib/uniswap/UniswapExchange");
const Join = require("../../build/JoinLike");
const Vat = require("../../build/VatLike");
const FaucetUser = require("../../build/FaucetUser");
const CdpManager = require("../../build/TestCdpManager");
const MakerV1Manager = require("../../build/MakerManager");
const MakerV2Manager = require("../../build/MakerV2Manager");
const UpgradedMakerV2Manager = require("../../build/TestUpgradedMakerV2Manager");
const TransferManager = require("../../build/TransferManager");
const MakerRegistry = require("../../build/MakerRegistry");
const ModuleRegistry = require("../../build/ModuleRegistry");
const ScdMcdMigration = require("../../build/ScdMcdMigration");
const Wallet = require("../../build/BaseWallet");
const DSToken = require("../../build/DSToken");

const { parseEther, bigNumberify, formatBytes32String } = ethers.utils;
const { HashZero } = ethers.constants;
const { bigNumToBytes32 } = require("../../utils/utilities.js");

const DEFAULT_NETWORK = "kovan-fork"; // also works on kovan (faster, but uses real KETH)
const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const RAY = bigNumberify("1000000000000000000000000000"); // 10**27

describe("Test MakerV2 Vaults", function () {
  this.timeout(1000000);

  if (!process.argv.join(" ").includes(__filename.slice(__dirname.length + 1))) {
    // We do not want to run this file as part of the complete test suite.
    // This is because this test file can currently only be run on kovan or kovan-fork
    // (using the --fork option of ganache-cli) whereas other test files are run using ganache
    return;
  }

  let network;
  let testManager;
  let transferManager;
  let migration;
  let makerV1;
  let makerV2;
  let daiJoin;
  let daiToken;
  let saiJoin;
  let saiToken;
  let wethJoin;
  let wethToken;
  let batJoin;
  let batToken;
  let daiExchange;
  let wallet;
  let walletAddress;
  let owner;
  let makerRegistry;
  let lastLoanId;
  let config;
  let deployer;

  before(async () => {
    const idx = process.argv.indexOf("--network");
    network = idx > -1 ? process.argv[idx + 1] : DEFAULT_NETWORK;
    if (!network.includes("kovan")) throw new Error("--network must be 'kovan' or 'kovan-fork'");

    const deployManager = new DeployManager(network);
    await deployManager.setup();
    const { configurator } = deployManager;
    deployer = deployManager.deployer;
    testManager = new TestManager([...Array(10)].map(() => deployer), network, deployer);
    owner = deployer.signer;
    config = configurator.config;

    migration = await deployer.wrapDeployedContract(ScdMcdMigration, config.defi.maker.migration);
    daiJoin = await deployer.wrapDeployedContract(Join, await migration.daiJoin());
    daiToken = await deployer.wrapDeployedContract(DSToken, await daiJoin.dai());
    saiJoin = await deployer.wrapDeployedContract(Join, await migration.saiJoin());
    saiToken = await deployer.wrapDeployedContract(DSToken, await saiJoin.gem());
    wethJoin = await deployer.wrapDeployedContract(Join, await migration.wethJoin());
    wethToken = await deployer.wrapDeployedContract(DSToken, await wethJoin.gem());
    batJoin = await deployer.wrapDeployedContract(Join, config.defi.maker.batJoin);
    batToken = await deployer.wrapDeployedContract(DSToken, await batJoin.gem());

    const uniswapFactory = await deployer.wrapDeployedContract(UniswapFactory, config.defi.uniswap.factory);
    daiExchange = await deployer.wrapDeployedContract(UniswapExchange, await uniswapFactory.getExchange(daiToken.contractAddress));

    makerRegistry = await deployer.deploy(MakerRegistry);
    await (await makerRegistry.addCollateral(wethJoin.contractAddress)).wait();

    makerV2 = await deployer.deploy(
      MakerV2Manager,
      {},
      config.contracts.ModuleRegistry,
      config.modules.GuardianStorage,
      config.defi.maker.migration,
      config.defi.maker.pot,
      config.defi.maker.jug,
      makerRegistry.contractAddress,
      config.defi.uniswap.factory,
      { gasLimit: 8000000 },
    );
    transferManager = await deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
    makerV1 = await deployer.wrapDeployedContract(MakerV1Manager, config.modules.MakerManager);
  });

  beforeEach(async () => {
    lastLoanId = null;
    wallet = await deployer.deploy(Wallet);
    await wallet.verboseWaitForTransaction(await wallet.init(owner.address, [
      config.modules.MakerManager, // MakerV1
      makerV2.contractAddress,
      transferManager.contractAddress,
    ]));
    walletAddress = wallet.contractAddress;
    await (await owner.sendTransaction({ to: walletAddress, value: parseEther("0.3") })).wait();
  });

  async function cleanup() {
    if (lastLoanId) {
      await (await makerV2.closeLoan(walletAddress, lastLoanId, { gasLimit: 4500000 })).wait();
    }


    const ethBalance = await deployer.provider.getBalance(walletAddress);
    const daiBalance = await daiToken.balanceOf(walletAddress);
    await (await transferManager.transferToken(walletAddress, ETH_TOKEN, owner.address, ethBalance, HashZero, { gasLimit: 2000000 })).wait();
    await (await transferManager.transferToken(
      walletAddress,
      daiToken.contractAddress,
      owner.address,
      daiBalance,
      HashZero,
      { gasLimit: 2000000 },
    )).wait();
    const afterDAI = await daiToken.balanceOf(owner.address);
    if (afterDAI.gt(0)) {
      await (await daiToken.approve(daiExchange.contractAddress, afterDAI)).wait();
      const currentBlock = await testManager.getCurrentBlock();
      const timestamp = await testManager.getTimestamp(currentBlock);
      await (await daiExchange.tokenToEthSwapInput(afterDAI, 1, timestamp + 24 * 3600, { gasLimit: 3000000 })).wait();
    }
  }

  afterEach(async () => {
    await cleanup();
  });

  describe("Loan", () => {
    async function getTestAmounts(tokenAddress) {
      const tokenAddress_ = (tokenAddress === ETH_TOKEN) ? wethToken.contractAddress : tokenAddress;
      const { ilk } = await makerRegistry.collaterals(tokenAddress_);
      const vat = await deployer.wrapDeployedContract(Vat, await daiJoin.vat());
      const { spot, dust } = await vat.ilks(ilk);
      const daiAmount = dust.div(RAY);
      const collateralAmount = dust.div(spot).mul(12).div(10);
      return { daiAmount, collateralAmount };
    }

    async function testOpenLoan({
      collateralAmount, daiAmount, relayed, collateral = { contractAddress: ETH_TOKEN },
    }) {
      const beforeCollateral = (collateral.contractAddress === ETH_TOKEN)
        ? await deployer.provider.getBalance(walletAddress)
        : await collateral.balanceOf(walletAddress);

      const beforeDAI = await daiToken.balanceOf(walletAddress);
      const beforeDAISupply = await daiToken.totalSupply();

      const method = "openLoan";
      const params = [walletAddress, collateral.contractAddress, collateralAmount, daiToken.contractAddress, daiAmount];
      let txR;
      if (relayed) {
        txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        txR = await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 2000000 }));
      }
      lastLoanId = txR.events.find((e) => e.event === "LoanOpened").args._loanId;
      assert.isDefined(lastLoanId, "Loan ID should be defined");

      const afterCollateral = (collateral.contractAddress === ETH_TOKEN)
        ? await deployer.provider.getBalance(walletAddress)
        : await collateral.balanceOf(walletAddress);
      const afterDAI = await daiToken.balanceOf(walletAddress);
      const afterDAISupply = await daiToken.totalSupply();

      assert.equal(
        beforeCollateral.sub(afterCollateral).toString(),
        collateralAmount.toString(),
        `wallet should have ${collateralAmount} less collateral (relayed: ${relayed})`,
      );
      assert.equal(
        afterDAI.sub(beforeDAI).toString(),
        daiAmount.toString(),
        `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`,
      );
      assert.equal(
        afterDAISupply.sub(beforeDAISupply).toString(),
        daiAmount.toString(),
        `${daiAmount} DAI should have been minted (relayed: ${relayed})`,
      );

      return lastLoanId;
    }

    describe("Open Loan", () => {
      let daiAmount; let
        collateralAmount;
      before(async () => {
        const testAmounts = await getTestAmounts(ETH_TOKEN);
        daiAmount = testAmounts.daiAmount;
        collateralAmount = testAmounts.collateralAmount;
      });

      it("should open a Loan (blockchain tx)", async () => {
        await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      });

      it("should open a Loan (relayed tx)", async () => {
        await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      });

      it("should open>close>reopen a Loan (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
        await (await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000 })).wait();
        await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      });

      it("should open>close>reopen a Loan (relayed tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
        await (await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000 })).wait();
        await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      });
    });

    async function testChangeCollateral({
      loanId, collateralAmount, add, relayed, collateral = { contractAddress: ETH_TOKEN }, makerV2Manager = makerV2,
    }) {
      const beforeCollateral = (collateral.contractAddress === ETH_TOKEN)
        ? await deployer.provider.getBalance(walletAddress)
        : await collateral.balanceOf(walletAddress);

      const method = add ? "addCollateral" : "removeCollateral";
      const params = [wallet.contractAddress, loanId, collateral.contractAddress, collateralAmount];
      if (relayed) {
        const txR = await testManager.relay(makerV2Manager, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2Manager.verboseWaitForTransaction(await makerV2Manager[method](...params, { gasLimit: 2000000 }));
      }

      const afterCollateral = (collateral.contractAddress === ETH_TOKEN)
        ? await deployer.provider.getBalance(walletAddress)
        : await collateral.balanceOf(walletAddress);

      const expectedCollateralChange = collateralAmount.mul(add ? -1 : 1).toString();
      assert.equal(
        afterCollateral.sub(beforeCollateral).toString(),
        expectedCollateralChange,
        `wallet collateral should have changed by ${expectedCollateralChange} (relayed: ${relayed})`,
      );
    }

    describe("Add/Remove Collateral", () => {
      let daiAmount; let
        collateralAmount;
      before(async () => {
        const testAmounts = await getTestAmounts(ETH_TOKEN);
        daiAmount = testAmounts.daiAmount;
        collateralAmount = testAmounts.collateralAmount;
      });
      it("should add collateral (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
        await testChangeCollateral({
          loanId, collateralAmount: parseEther("0.010"), add: true, relayed: false,
        });
      });
      it("should add collateral (relayed tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
        await testChangeCollateral({
          loanId, collateralAmount: parseEther("0.010"), add: true, relayed: true,
        });
      });
      it("should remove collateral (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
        await testChangeCollateral({
          loanId, collateralAmount: parseEther("0.010"), add: false, relayed: false,
        });
      });
      it("should remove collateral (relayed tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
        await testChangeCollateral({
          loanId, collateralAmount: parseEther("0.010"), add: false, relayed: true,
        });
      });
    });

    async function testChangeDebt({
      loanId, daiAmount, add, relayed,
    }) {
      const beforeDAI = await daiToken.balanceOf(wallet.contractAddress);
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      const method = add ? "addDebt" : "removeDebt";
      const params = [wallet.contractAddress, loanId, daiToken.contractAddress, daiAmount];
      if (relayed) {
        const txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 2000000 }));
      }
      const afterDAI = await daiToken.balanceOf(wallet.contractAddress);
      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);
      if (add) {
        assert.equal(
          afterDAI.sub(beforeDAI).toString(),
          daiAmount.toString(),
          `wallet DAI should have increased by ${daiAmount.toString()} (relayed: ${relayed})`,
        );
      } else {
        assert.isTrue(
          afterDAI.lt(beforeDAI) || afterETH.lt(beforeETH),
          `wallet DAI or ETH should have decreased (relayed: ${relayed})`,
        );
      }
    }

    describe("Increase Debt", () => {
      let daiAmount; let
        collateralAmount;
      before(async () => {
        const testAmounts = await getTestAmounts(ETH_TOKEN);
        daiAmount = testAmounts.daiAmount;
        collateralAmount = testAmounts.collateralAmount;
      });
      it("should increase debt (blockchain tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
        await testChangeDebt({
          loanId, daiAmount: parseEther("0.5"), add: true, relayed: false,
        });
      });
      it("should increase debt (relayed tx)", async () => {
        const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
        await testChangeDebt({
          loanId, daiAmount: parseEther("0.5"), add: true, relayed: true,
        });
      });
    });

    async function testRepayDebt({ useDai, relayed }) {
      const { collateralAmount, daiAmount: daiAmount_ } = await getTestAmounts(ETH_TOKEN);
      const daiAmount = daiAmount_.add(parseEther("0.3"));

      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
      if (!useDai) {
        // move the borrowed DAI from the wallet to the owner
        await (await transferManager.transferToken(
          walletAddress, daiToken.contractAddress, owner.address, daiAmount, HashZero, { gasLimit: 3000000 },
        )).wait();
        // give some ETH to the wallet to be used for repayment
        await (await owner.sendTransaction({ to: walletAddress, value: collateralAmount })).wait();
      }
      await testManager.increaseTime(3); // wait 3 seconds
      const beforeDAI = await daiToken.balanceOf(wallet.contractAddress);
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.2"), add: false, relayed,
      });
      const afterDAI = await daiToken.balanceOf(wallet.contractAddress);
      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

      if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.eq(beforeETH), "should have less DAI");
      else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.lt(beforeETH), "should have less ETH");

      // Send the borrowed DAI back to the wallet
      if (!useDai) await (await daiToken.transfer(walletAddress, daiAmount)).wait();
    }

    describe("Repay Debt", () => {
      it("should repay debt when paying fee in DAI (blockchain tx)", async () => {
        await testRepayDebt({ useDai: true, relayed: false });
      });
      it("should repay debt when paying fee in DAI (relayed tx)", async () => {
        await testRepayDebt({ useDai: true, relayed: true });
      });
      it("should repay debt when paying fee in ETH (blockchain tx)", async () => {
        await testRepayDebt({ useDai: false, relayed: false });
      });
      it("should repay debt when paying fee in ETH (relayed tx)", async () => {
        await testRepayDebt({ useDai: false, relayed: true });
      });
    });

    async function testCloseLoan({ useDai, relayed }) {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
      // give some ETH to the wallet to be used for repayment
      await (await owner.sendTransaction({ to: walletAddress, value: collateralAmount.mul(2) })).wait();
      if (!useDai) {
        // move the borrowed DAI from the wallet to the owner
        await (await transferManager.transferToken(
          walletAddress, daiToken.contractAddress, owner.address, daiAmount, HashZero, { gasLimit: 3000000 },
        )).wait();
      }
      await testManager.increaseTime(3); // wait 3 seconds
      const beforeDAI = await daiToken.balanceOf(wallet.contractAddress);
      const beforeETH = await deployer.provider.getBalance(wallet.contractAddress);
      const method = "closeLoan";
      const params = [wallet.contractAddress, loanId];
      if (relayed) {
        const txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2.verboseWaitForTransaction(await makerV2[method](...params, { gasLimit: 3000000 }));
      }
      lastLoanId = null;
      const afterDAI = await daiToken.balanceOf(wallet.contractAddress);
      const afterETH = await deployer.provider.getBalance(wallet.contractAddress);

      if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some DAI and some ETH");
      else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some ETH");

      // Send the borrowed DAI back to the wallet
      if (!useDai) await (await daiToken.transfer(walletAddress, daiAmount)).wait();
    }

    describe("Close Vaults", () => {
      it("should close a vault when paying fee in DAI + ETH (blockchain tx)", async () => {
        await testCloseLoan({ useDai: true, relayed: false });
      });
      it("should close a vault when paying fee in DAI + ETH (relayed tx)", async () => {
        await testCloseLoan({ useDai: true, relayed: true });
      });
      it("should close a vault when paying fee in ETH (blockchain tx)", async () => {
        await testCloseLoan({ useDai: false, relayed: false });
      });
      it("should close a vault when paying fee in ETH (relayed tx)", async () => {
        await testCloseLoan({ useDai: false, relayed: true });
      });
    });

    async function topupWalletToken(token, amount) {
      while ((await token.balanceOf(owner.address)).lt(amount)) {
        await deployer.deploy(
          FaucetUser,
          {},
          config.defi.maker.batFaucet,
          token.contractAddress,
        );
      }
      await (await token.transfer(walletAddress, amount)).wait();
    }

    describe("Adding new collateral token to registry", () => {
      it("should open a loan with a newly added collateral token", async () => {
        await (await makerRegistry.addCollateral(batJoin.contractAddress)).wait();
        const { daiAmount, collateralAmount } = await getTestAmounts(batToken.contractAddress);
        await topupWalletToken(batToken, collateralAmount);
        await testOpenLoan({
          collateralAmount, daiAmount, collateral: batToken, relayed: false,
        });
        await testManager.increaseTime(3); // wait 3 seconds
      });
    });

    describe("Acquiring a wallet's vault", () => {
      async function testAcquireVault({ relayed }) {
        // Create the vault with `owner` as owner
        const cdpManager = await deployer.wrapDeployedContract(CdpManager, await migration.cdpManager());
        const { ilk } = await makerRegistry.collaterals(wethToken.contractAddress);
        let txR = await (await cdpManager.open(ilk, owner.address)).wait();
        const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
        // Transfer the vault to the wallet
        await (await cdpManager.give(vaultId, walletAddress)).wait();
        // Transfer the vault to the module
        const loanId = bigNumToBytes32(vaultId);
        const method = "acquireLoan";
        const params = [walletAddress, loanId];
        if (relayed) {
          txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
          assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
        } else {
          await (await makerV2[method](...params, { gasLimit: 1000000 })).wait();
        }
        // Add some collateral and debt
        const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
        await testChangeCollateral({
          loanId, collateralAmount, add: true, relayed, makerV2,
        });
        await testChangeDebt({
          loanId, daiAmount, add: true, relayed,
        });
        // Make it so that afterEach can close the newly acquired vault
        lastLoanId = loanId;
      }

      it("should transfer a vault from a wallet to the module (blockchain tx)", async () => {
        await testAcquireVault({ relayed: false });
      });

      it("should transfer a vault from a wallet to the module (relayed tx)", async () => {
        await testAcquireVault({ relayed: true });
      });
    });

    describe("Migrating an SCD CDP to an MCD vault", () => {
      let walletAddressToMigrate; let
        oldCdpId;
      beforeEach(async () => {
        if (network === "kovan-fork") {
          // kovan-fork has a bug that prevents makerV1 from succesfully calling `saiTub.join(wad)`
          // => we use a kovan wallet with an existing CDP
          // the downside is that it can only be migrated once
          oldCdpId = "0x0000000000000000000000000000000000000000000000000000000000001d04";
          walletAddressToMigrate = "0xAB3f50Ff1e4a516ef494b9C226ef0a26065766df";
          const walletToMigrate = await deployer.wrapDeployedContract(Wallet, walletAddressToMigrate);
          if (!(await walletToMigrate.authorised(makerV2.contractAddress))) {
            // Register the MakerV2 module in the ModuleRegistry
            const moduleRegistry = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
            const multisig = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
            const multisigExecutor = new MultisigExecutor(multisig, owner, config.multisig.autosign);
            await multisigExecutor.executeCall(moduleRegistry, "registerModule", [makerV2.contractAddress, formatBytes32String("MakerV2Manager")]);
            // Add the MakerV2 module to the existing wallet
            await (await makerV1.addModule(walletAddressToMigrate, makerV2.contractAddress)).wait();
          }
        } else {
          const { daiAmount, collateralAmount } = await getTestAmounts(ETH_TOKEN);
          const params = [walletAddress, ETH_TOKEN, collateralAmount, saiToken.contractAddress, daiAmount];
          const txReceipt = await (await makerV1.openLoan(...params, { gasLimit: 2000000 })).wait();
          oldCdpId = txReceipt.events.find((e) => e.event === "LoanOpened").args._loanId;
          assert.isDefined(oldCdpId, "The old CDP ID should be defined");
          walletAddressToMigrate = walletAddress;
        }
      });

      async function testMigrateCdp({ relayed }) {
        // abort if oldCdpId no longer exists (it can only be migrated once on kovan-fork)
        if (!await makerV1.exists(oldCdpId, await makerV1.makerCdp())) return;

        const method = "migrateCdp";
        const params = [walletAddressToMigrate, oldCdpId];
        let txR;
        if (relayed) {
          txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddressToMigrate }, [owner]);
          assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
        } else {
          txR = await (await makerV2[method](...params, { gasLimit: 2000000 })).wait();
        }
        const loanId = txR.events.find((e) => e.event === "CdpMigrated").args._newVaultId;
        assert.isDefined(loanId, "The new vault ID should be defined");
      }

      it("should migrate a CDP (blockchain tx)", async () => {
        await testMigrateCdp({ relayed: false });
      });

      it("should migrate a CDP (relayed tx)", async () => {
        // Note that this test will be skipped on kovan-fork as the CDP used can only be migrated once
        await testMigrateCdp({ relayed: true });
      });
    });

    describe("Upgrade of MakerV2Manager", () => {
      let upgradedMakerV2; let daiAmount; let
        collateralAmount;
      before(async () => {
        // Generate test amounts
        const testAmounts = await getTestAmounts(ETH_TOKEN);
        daiAmount = testAmounts.daiAmount;
        collateralAmount = testAmounts.collateralAmount;

        // Deploy the upgraded MakerV2 module
        upgradedMakerV2 = await deployer.deploy(
          UpgradedMakerV2Manager,
          {},
          config.contracts.ModuleRegistry,
          config.modules.GuardianStorage,
          config.defi.maker.migration,
          config.defi.maker.pot,
          config.defi.maker.jug,
          makerRegistry.contractAddress,
          config.defi.uniswap.factory,
          makerV2.contractAddress,
          { gasLimit: 10700000 },
        );

        // Register the upgraded MakerV2 module in the ModuleRegistry
        const moduleRegistry = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
        const multisig = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
        const multisigExecutor = new MultisigExecutor(multisig, owner, config.multisig.autosign);
        await multisigExecutor.executeCall(
          moduleRegistry,
          "registerModule",
          [upgradedMakerV2.contractAddress, formatBytes32String("UpgradedMakerV2Manager")],
        );

        // Adding BAT to the registry of supported collateral tokens
        if (!(await makerRegistry.collaterals(batToken.contractAddress)).exists) {
          await (await makerRegistry.addCollateral(batJoin.contractAddress)).wait();
        }
      });

      async function testUpgradeModule({ relayed, withBatVault = false }) {
        // Open a WETH vault with the old MakerV2 module
        const loanId1 = await testOpenLoan({ collateralAmount, daiAmount, relayed });

        let loanId2;
        if (withBatVault) {
          // Open a BAT vault with the old MakerV2 module
          const batTestAmounts = await getTestAmounts(batToken.contractAddress);
          await topupWalletToken(batToken, batTestAmounts.collateralAmount.add(parseEther("0.01")));
          loanId2 = await testOpenLoan({
            collateralAmount: batTestAmounts.collateralAmount,
            daiAmount: batTestAmounts.daiAmount,
            collateral: batToken,
            relayed,
          });
        }

        // Add the upgraded module
        const method = "addModule";
        const params = [walletAddress, upgradedMakerV2.contractAddress];
        if (relayed) {
          const txR = await testManager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
          assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
        } else {
          await (await makerV2[method](...params, { gasLimit: 2000000 })).wait();
        }

        // Make sure that the vaults can be manipulated from the upgraded module
        await testChangeCollateral({
          loanId: loanId1,
          collateralAmount: parseEther("0.010"),
          add: true,
          relayed,
          makerV2Manager: upgradedMakerV2,
        });
        await (await upgradedMakerV2.closeLoan(walletAddress, loanId1, { gasLimit: 4500000 })).wait();

        if (withBatVault) {
          await testChangeCollateral({
            loanId: loanId2,
            collateralAmount: parseEther("0.010"),
            add: true,
            relayed,
            collateral: batToken,
            makerV2Manager: upgradedMakerV2,
          });
          await (await upgradedMakerV2.closeLoan(walletAddress, loanId2, { gasLimit: 4500000 })).wait();
        }

        // Prevent afterEach from closing the (already closed) last loan
        lastLoanId = null;
      }

      it("should move a vault after a module upgrade (blockchain tx)", async () => {
        await testUpgradeModule({ relayed: false });
      });

      it("should move a vault after a module upgrade (relayed tx)", async () => {
        await testUpgradeModule({ relayed: true });
      });

      it("should move 2 vaults after a module upgrade (blockchain tx)", async () => {
        await testUpgradeModule({ withBatVault: true, relayed: false });
      });

      it("should move 2 vaults after a module upgrade (relayed tx)", async () => {
        await testUpgradeModule({ withBatVault: true, relayed: true });
      });
    });
  });
});
