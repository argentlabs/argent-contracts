/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");
const { deployMaker, deployUniswap, RAY, ETH_PER_DAI, ETH_PER_MKR } = require("../utils/defi-deployer");

const { formatBytes32String } = ethers.utils;
const { AddressZero } = ethers.constants;
const RelayManager = require("../utils/relay-manager");

const GemJoin = artifacts.require("GemJoin");
const Registry = artifacts.require("ModuleRegistry");
const MakerV2Manager = artifacts.require("MakerV2Manager");
const UpgradedMakerV2Manager = artifacts.require("TestUpgradedMakerV2Manager");
const MakerRegistry = artifacts.require("MakerRegistry");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const FakeWallet = artifacts.require("FakeWallet");
const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const TransferManager = artifacts.require("TransferManager");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");
const BadFeature = artifacts.require("TestFeature");

contract("MakerV2Loan", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const owner2 = accounts[2];

  let sai;
  let dai;
  let gov;
  let bat;
  let weth;
  let vat;
  let batJoin;
  let cdpManager;
  let pot;
  let jug;
  let migration;
  let transferManager;
  let guardianStorage;
  let lockStorage;
  let makerV2;
  let wallet;
  let walletImplementation;
  let walletAddress;
  let makerRegistry;
  let uniswapFactory;
  let relayerManager;
  let versionManager;

  before(async () => {
    // Deploy Maker
    const mk = await deployMaker(infrastructure);
    [sai, dai, gov, bat, weth, vat, batJoin, cdpManager, pot, jug, migration] = [
      mk.sai, mk.dai, mk.gov, mk.bat, mk.weth, mk.vat, mk.batJoin, mk.cdpManager, mk.pot, mk.jug, mk.migration,
    ];
    const { wethJoin } = mk;

    // Deploy Uniswap
    const uni = await deployUniswap(infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);
    uniswapFactory = uni.uniswapFactory;

    // Deploy MakerV2Manager
    const registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);

    makerRegistry = await MakerRegistry.new(vat.address);
    await makerRegistry.addCollateral(wethJoin.address);
    makerV2 = await MakerV2Manager.new(
      lockStorage.address,
      migration.address,
      pot.address,
      jug.address,
      makerRegistry.address,
      uniswapFactory.address,
      versionManager.address,
    );

    // Deploy TransferManager
    const transferStorage = await TransferStorage.new();
    const limitStorage = await LimitStorage.new();
    const tokenPriceRegistry = await TokenPriceRegistry.new();
    transferManager = await TransferManager.new(
      lockStorage.address,
      transferStorage.address,
      limitStorage.address,
      tokenPriceRegistry.address,
      versionManager.address,
      3600,
      3600,
      10000,
      AddressZero,
      AddressZero,
    );

    walletImplementation = await BaseWallet.new();

    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    await manager.setRelayerManager(relayerManager);

    await versionManager.addVersion([
      makerV2.address,
      transferManager.address,
      relayerManager.address,
    ], []);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
    walletAddress = wallet.address;
    await wallet.send(web3.utils.toWei("2.0"));
    await dai.mint(walletAddress, web3.utils.toWei("10"));
  });

  async function getTestAmounts(tokenAddress) {
    const tokenAddress_ = (tokenAddress === ETH_TOKEN) ? weth.address : tokenAddress;
    const { ilk } = await makerRegistry.collaterals(tokenAddress_);
    const { spot, dust } = await vat.ilks(ilk);
    const daiAmount = dust.div(RAY);
    const collateralAmount = dust.div(spot).muln(2);
    return { daiAmount, collateralAmount };
  }

  async function testOpenLoan({
    collateralAmount, daiAmount, relayed, collateral = { address: ETH_TOKEN },
  }) {
    const beforeCollateral = (collateral.address === ETH_TOKEN)
      ? await utils.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const beforeDAI = await dai.balanceOf(walletAddress);
    const beforeDAISupply = await dai.totalSupply();

    const params = [walletAddress, collateral.address, collateralAmount.toString(), dai.address, daiAmount.toString()];
    let txReceipt;
    if (relayed) {
      txReceipt = await manager.relay(makerV2, "openLoan", params, wallet, [owner]);
      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, "Relayed tx should succeed");
    } else {
      const tx = await makerV2.openLoan(...params, { gasLimit: 2000000, from: owner });
      txReceipt = tx.receipt;
    }
    const eventLoanOpened = await utils.getEvent(txReceipt, makerV2, "LoanOpened");
    const loanId = eventLoanOpened.args._loanId;
    assert.isDefined(loanId, "Loan ID should be defined");

    const afterCollateral = (collateral.address === ETH_TOKEN)
      ? await utils.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);
    const afterDAI = await dai.balanceOf(walletAddress);
    const afterDAISupply = await dai.totalSupply();

    // wallet should have ${collateralAmount} less collateral (relayed: ${relayed})
    expect(beforeCollateral.sub(afterCollateral)).to.eq.BN(collateralAmount);
    // wallet should have ${daiAmount} more DAI (relayed: ${relayed})
    expect(afterDAI.sub(beforeDAI)).to.eq.BN(daiAmount);
    // ${daiAmount} DAI should have been minted (relayed: ${relayed})
    expect(afterDAISupply.sub(beforeDAISupply)).to.eq.BN(daiAmount);

    return loanId;
  }

  describe("Open Loan", () => {
    let daiAmount;
    let collateralAmount;
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
      await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000, from: owner });
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
    });

    it("should open>close>reopen a Loan (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000, from: owner });
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
    });

    it("should not open a loan for the wrong debt token", async () => {
      await truffleAssert.reverts(
        makerV2.openLoan(walletAddress, ETH_TOKEN, collateralAmount, sai.address, daiAmount, { from: owner }),
        "MV2: debt token not DAI",
      );
    });

    it("should not open a loan for an unsupported collateral token", async () => {
      await truffleAssert.reverts(
        makerV2.openLoan(walletAddress, sai.address, collateralAmount, dai.address, daiAmount, { from: owner }),
        "MV2: unsupported collateral",
      );
    });
  });

  async function testChangeCollateral({
    loanId, collateralAmount, add, relayed, collateral = { address: ETH_TOKEN }, makerV2Manager = makerV2,
  }) {
    const beforeCollateral = (collateral.address === ETH_TOKEN)
      ? await utils.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const method = add ? "addCollateral" : "removeCollateral";
    const params = [wallet.address, loanId, collateral.address, collateralAmount.toString()];
    if (relayed) {
      const txR = await manager.relay(makerV2Manager, method, params, wallet, [owner]);
      const txExecutedEvent = await utils.getEvent(txR, relayerManager, "TransactionExecuted");
      assert.isTrue(txExecutedEvent.args.success, "Relayed tx should succeed");
    } else {
      await makerV2Manager[method](...params, { gasLimit: 2000000, from: owner });
    }

    const afterCollateral = (collateral.address === ETH_TOKEN)
      ? await utils.getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const x = add ? -1 : 1;
    const expectedCollateralChange = collateralAmount.mul(new BN(x));
    // wallet collateral should have changed by ${expectedCollateralChange} (relayed: ${relayed})
    expect(afterCollateral.sub(beforeCollateral)).to.eq.BN(expectedCollateralChange);
  }

  describe("Add/Remove Collateral", () => {
    let daiAmount;
    let collateralAmount;

    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should add collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: new BN(web3.utils.toWei("0.010")), add: true, relayed: false,
      });
    });

    it("should add collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: new BN(web3.utils.toWei("0.010")), add: true, relayed: true,
      });
    });

    it("should not add collateral for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [versionManager.address]);
      await truffleAssert.reverts(
        makerV2.addCollateral(wallet2.address, loanId, ETH_TOKEN, web3.utils.toWei("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });

    it("should remove collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: new BN(web3.utils.toWei("0.010")), add: false, relayed: false,
      });
    });

    it("should remove collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: new BN(web3.utils.toWei("0.010")), add: false, relayed: true,
      });
    });

    it("should not remove collateral with invalid collateral amount", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await truffleAssert.reverts(
        makerV2.removeCollateral(walletAddress, loanId, ETH_TOKEN, new BN(2).pow(new BN(255)), { from: owner }),
        "MV2: int overflow",
      );
    });

    it("should not remove collateral for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [versionManager.address]);
      await truffleAssert.reverts(
        makerV2.removeCollateral(wallet2.address, loanId, ETH_TOKEN, web3.utils.toWei("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testChangeDebt({
    loanId, daiAmount, add, relayed,
  }) {
    const beforeDAI = await dai.balanceOf(wallet.address);
    const beforeETH = await utils.getBalance(wallet.address);
    const method = add ? "addDebt" : "removeDebt";
    const params = [wallet.address, loanId, dai.address, daiAmount.toString()];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { address: walletAddress }, [owner]);
      const txExecutedEvent = await utils.getEvent(txR, relayerManager, "TransactionExecuted");
      assert.isTrue(txExecutedEvent.args.success, "Relayed tx should succeed");
    } else {
      await makerV2[method](...params, { gasLimit: 2000000, from: owner });
    }
    const afterDAI = await dai.balanceOf(wallet.address);
    const afterETH = await utils.getBalance(wallet.address);
    if (add) {
      // wallet DAI should have increased by ${daiAmount.toString()} (relayed: ${relayed})
      expect(afterDAI.sub(beforeDAI)).to.eq.BN(daiAmount);
    } else {
      assert.isTrue(
        afterDAI.lt(beforeDAI) || afterETH.lt(beforeETH),
        `wallet DAI or ETH should have decreased (relayed: ${relayed})`,
      );
    }
  }

  describe("Increase Debt", () => {
    let daiAmount;
    let collateralAmount;

    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should increase debt (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeDebt({
        loanId, daiAmount: web3.utils.toWei("0.5"), add: true, relayed: false,
      });
    });

    it("should increase debt (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeDebt({
        loanId, daiAmount: web3.utils.toWei("0.5"), add: true, relayed: true,
      });
    });

    it("should not increase debt for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [versionManager.address]);
      await truffleAssert.reverts(
        makerV2.addDebt(wallet2.address, loanId, ETH_TOKEN, web3.utils.toWei("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testRepayDebt({ relayed }) {
    const { collateralAmount, daiAmount: daiAmount_ } = await getTestAmounts(ETH_TOKEN);
    const daiAmount = daiAmount_.add(new BN(web3.utils.toWei("0.3")));

    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    await utils.increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.address);
    const beforeETH = await utils.getBalance(wallet.address);
    await testChangeDebt({
      loanId, daiAmount: web3.utils.toWei("0.2"), add: false, relayed,
    });

    const afterDAI = await dai.balanceOf(wallet.address);
    const afterETH = await utils.getBalance(wallet.address);

    assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.eq(beforeETH), "should have less DAI");
  }

  describe("Repay Debt", () => {
    it("should repay debt (blockchain tx)", async () => {
      await testRepayDebt({ relayed: false });
    });

    it("should repay debt (relayed tx)", async () => {
      await testRepayDebt({ relayed: true });
    });

    it("should not repay debt when only dust left", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await truffleAssert.reverts(
        makerV2.removeDebt(walletAddress, loanId, dai.address, daiAmount.subn(1), { from: owner }),
        "MV2: repay less or full",
      );
    });

    it("should not repay debt for the wrong loan owner", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [versionManager.address]);
      await truffleAssert.reverts(
        makerV2.removeDebt(wallet2.address, loanId, ETH_TOKEN, web3.utils.toWei("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testCloseLoan({ relayed }) {
    const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    // give some ETH to the wallet to be used for repayment
    await wallet.send(collateralAmount.muln(2), { from: owner });
    await utils.increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.address);
    const method = "closeLoan";
    const params = [wallet.address, loanId];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { address: walletAddress }, [owner]);
      const txExecutedEvent = await utils.getEvent(txR, relayerManager, "TransactionExecuted");
      assert.isTrue(txExecutedEvent.args.success, "Relayed tx should succeed");
    } else {
      await makerV2[method](...params, { gasLimit: 3000000, from: owner });
    }
    const afterDAI = await dai.balanceOf(wallet.address);
    // should have spent some DAI
    expect(afterDAI).to.be.lt.BN(beforeDAI);
  }

  describe("Close Vaults", () => {
    it("should close a vault (blockchain tx)", async () => {
      await testCloseLoan({ relayed: false });
    });

    it("should close a vault (relayed tx)", async () => {
      await testCloseLoan({ relayed: true });
    });

    it("should not close a vault for the wrong loan owner", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [versionManager.address]);
      await truffleAssert.reverts(
        makerV2.closeLoan(wallet2.address, loanId, { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  describe("MakerRegistry", () => {
    it("should add a new collateral token", async () => {
      const numCollateralBefore = (await makerRegistry.getCollateralTokens()).length;
      await makerRegistry.addCollateral(batJoin.address);
      const numCollateralAfter = (await makerRegistry.getCollateralTokens()).length;
      assert.equal(numCollateralAfter, numCollateralBefore + 1, "A new collateral should have been added");
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should open a loan with a newly added collateral token", async () => {
      await makerRegistry.addCollateral(batJoin.address);
      const { daiAmount, collateralAmount } = await getTestAmounts(bat.address);
      await bat.mint(walletAddress, collateralAmount);
      await testOpenLoan({
        collateralAmount, daiAmount, collateral: bat, relayed: false,
      });
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should not add a collateral when Join is not in the Vat", async () => {
      const badJoin = await GemJoin.new(vat.address, formatBytes32String("BAD"), bat.address);
      await truffleAssert.reverts(makerRegistry.addCollateral(badJoin.address), "MR: _joinAdapter not authorised in vat");
    });

    it("should not add a duplicate collateral", async () => {
      await makerRegistry.addCollateral(batJoin.address);
      await truffleAssert.reverts(makerRegistry.addCollateral(batJoin.address), "MR: collateral already added");
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should remove a collateral", async () => {
      const numCollateralBefore = (await makerRegistry.getCollateralTokens()).length;
      await makerRegistry.addCollateral(batJoin.address);
      await makerRegistry.removeCollateral(bat.address);
      const numCollateralAfter = (await makerRegistry.getCollateralTokens()).length;
      assert.equal(numCollateralAfter, numCollateralBefore, "The added collateral should have been removed");
    });

    it("should not remove a non-existing collateral", async () => {
      await truffleAssert.reverts(makerRegistry.removeCollateral(bat.address), "MR: collateral does not exist");
    });
  });

  describe("Acquiring a wallet's vault", () => {
    async function testAcquireVault({ relayed }) {
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const tx = await cdpManager.open(ilk, owner, { from: owner });
      const txNewCdpEvent = await utils.getEvent(tx.receipt, cdpManager, "NewCdp");
      const vaultId = txNewCdpEvent.args.cdp;
      // Transfer the vault to the wallet
      await cdpManager.give(vaultId, walletAddress, { from: owner });
      // Transfer the vault to the feature
      const loanId = utils.numberToBytes32(vaultId);

      const method = "acquireLoan";
      const params = [walletAddress, loanId];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(makerV2, method, params, { address: walletAddress }, [owner]);
        const { success } = await utils.parseRelayReceipt(txReceipt);
        assert.isTrue(success, "Relayed tx should succeed");
      } else {
        const tx1 = await makerV2[method](...params, { gasLimit: 1000000, from: owner });
        txReceipt = tx1.receipt;
      }
      await utils.hasEvent(txReceipt, makerV2, "LoanAcquired");

      // The loanId held by the MakerV2Manager will be different from the transferred vault id, in case the latter was merged into an existing vault
      const featureLoanId = await makerV2.loanIds(walletAddress, ilk);
      // Add some collateral and debt
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);

      await testChangeCollateral({
        loanId: featureLoanId, collateralAmount, add: true, relayed, makerV2,
      });
      await testChangeDebt({
        loanId: featureLoanId, daiAmount, add: true, relayed,
      });
    }

    it("should transfer a vault from a wallet to the feature (blockchain tx)", async () => {
      await testAcquireVault({ relayed: false });
    });

    it("should transfer a vault from a wallet to the feature (relayed tx)", async () => {
      await testAcquireVault({ relayed: true });
    });

    it("should not transfer a vault that is not owned by the wallet", async () => {
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const tx = await cdpManager.open(ilk, owner, { from: owner });
      const txNewCdpEvent = await utils.getEvent(tx.receipt, cdpManager, "NewCdp");
      const vaultId = txNewCdpEvent.args.cdp;
      const loanId = utils.numberToBytes32(vaultId);
      // We are NOT transferring the vault from the owner to the wallet
      await truffleAssert.reverts(
        makerV2.acquireLoan(walletAddress, loanId, { from: owner }), "MV2: wrong vault owner",
      );
    });

    it("should not transfer a vault that is not given to the feature", async () => {
      // Deploy a fake wallet
      const fakeWallet = await FakeWallet.new(false, AddressZero, 0, "0x00");
      await fakeWallet.init(owner, [versionManager.address]);
      const lastVersion = await versionManager.lastVersion();
      await versionManager.upgradeWallet(fakeWallet.address, lastVersion.toString(), { from: owner });
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const tx = await cdpManager.open(ilk, owner, { from: owner });
      const txNewCdpEvent = await utils.getEvent(tx.receipt, cdpManager, "NewCdp");
      const vaultId = txNewCdpEvent.args.cdp;
      const loanId = utils.numberToBytes32(vaultId);

      // Transfer the vault to the fake wallet
      await cdpManager.give(vaultId, fakeWallet.address, { from: owner });

      await truffleAssert.reverts(
        makerV2.acquireLoan(fakeWallet.address, loanId, { from: owner }), "MV2: failed give",
      );
    });

    it("should transfer (merge) a vault when already holding a vault in the feature (blockchain tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testAcquireVault({ relayed: false });
    });

    it("should transfer (merge) a vault when already holding a vault in the feature (relayed tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testAcquireVault({ relayed: true });
    });

    it("should not allow reentrancy in acquireLoan", async () => {
      // Deploy a fake wallet capable of reentrancy
      const acquireLoanCallData = makerV2.contract.methods.acquireLoan(AddressZero, utils.numberToBytes32(0)).encodeABI();
      const fakeWallet = await FakeWallet.new(true, makerV2.address, 0, acquireLoanCallData);
      await fakeWallet.init(owner, [versionManager.address]);
      const lastVersion = await versionManager.lastVersion();
      await versionManager.upgradeWallet(fakeWallet.address, lastVersion.toString(), { from: owner });
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const tx = await cdpManager.open(ilk, owner, { from: owner });
      const txNewCdpEvent = await utils.getEvent(tx.receipt, cdpManager, "NewCdp");
      const vaultId = txNewCdpEvent.args.cdp;
      const loanId = utils.numberToBytes32(vaultId);
      // Transfer the vault to the fake wallet
      await cdpManager.give(vaultId, fakeWallet.address, { from: owner });
      await truffleAssert.reverts(
        makerV2.acquireLoan(fakeWallet.address, loanId, { from: owner }), "MV2: reentrant call",
      );
    });
  });

  describe("Upgrade of MakerV2Manager", () => {
    let upgradedMakerV2;
    let daiAmount;
    let collateralAmount;

    beforeEach(async () => {
      // Generate test amounts
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;

      // Deploy and register the upgraded MakerV2 feature
      upgradedMakerV2 = await UpgradedMakerV2Manager.new(
        lockStorage.address,
        migration.address,
        pot.address,
        jug.address,
        makerRegistry.address,
        uniswapFactory.address,
        makerV2.address,
        versionManager.address
      );

      // Adding BAT to the registry of supported collateral tokens
      if (!(await makerRegistry.collaterals(bat.address)).exists) {
        await makerRegistry.addCollateral(batJoin.address);
      }
    });

    async function testUpgradeModule({ relayed, withBatVault = false }) {
      // Open a WETH vault with the old MakerV2 feature
      const loanId1 = await testOpenLoan({ collateralAmount, daiAmount, relayed });
      let loanId2;
      if (withBatVault) {
        // Open a BAT vault with the old MakerV2 feature
        const batTestAmounts = await getTestAmounts(bat.address);
        await bat.mint(walletAddress, batTestAmounts.collateralAmount.add(new BN(web3.utils.toWei("0.01"))));
        loanId2 = await testOpenLoan({
          collateralAmount: batTestAmounts.collateralAmount,
          daiAmount: batTestAmounts.daiAmount,
          collateral: bat,
          relayed,
        });
      }

      // Add the upgraded feature
      await versionManager.addVersion([
        upgradedMakerV2.address,
        transferManager.address,
        relayerManager.address,
      ], [upgradedMakerV2.address]);

      const lastVersion = await versionManager.lastVersion();
      const params = [walletAddress, lastVersion.toNumber()];
      if (relayed) {
        const txR = await manager.relay(versionManager, "upgradeWallet", params, wallet, [owner]);
        const { success } = utils.parseRelayReceipt(txR);
        assert.isTrue(success, "Relayed tx should succeed");
      } else {
        await versionManager.upgradeWallet(...params, { gasLimit: 2000000, from: owner });
      }
      // Make sure that the vaults can be manipulated from the upgraded feature
      await testChangeCollateral({
        loanId: loanId1,
        collateralAmount: new BN(web3.utils.toWei("0.010")),
        add: true,
        relayed,
        makerV2Manager: upgradedMakerV2,
      });
      await upgradedMakerV2.closeLoan(walletAddress, loanId1, { gasLimit: 4500000, from: owner });

      if (withBatVault) {
        await testChangeCollateral({
          loanId: loanId2,
          collateralAmount: new BN(web3.utils.toWei("0.010")),
          add: true,
          relayed,
          collateral: bat,
          makerV2Manager: upgradedMakerV2,
        });
        await upgradedMakerV2.closeLoan(walletAddress, loanId2, { gasLimit: 4500000, from: owner });
      }

      // reset the last version to the default bundle
      await versionManager.addVersion([
        makerV2.address,
        transferManager.address,
        relayerManager.address,
      ], []);
    }

    it("should move a vault after a feature upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ relayed: false });
    });

    it("should move a vault after a feature upgrade (relayed tx)", async () => {
      await testUpgradeModule({ relayed: true });
    });

    it("should move 2 vaults after a feature upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: false });
    });

    it("should move 2 vaults after a feature upgrade (relayed tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: true });
    });

    it("should not allow non-feature to give vault", async () => {
      await truffleAssert.reverts(makerV2.giveVault(walletAddress, formatBytes32String(""), { from: owner }), "BF: must be a wallet feature");
    });

    it("should not allow (fake) feature to give unowned vault", async () => {
      // Deploy a (fake) bad feature
      const badFeature = await BadFeature.new(lockStorage.address, versionManager.address, 0);

      // Add the bad feature to the wallet
      await versionManager.addVersion([
        badFeature.address,
        transferManager.address,
        relayerManager.address,
      ], []);
      const lastVersion = await versionManager.lastVersion();
      await versionManager.upgradeWallet(walletAddress, lastVersion, { gasLimit: 2000000, from: owner });
      // Use the bad module to attempt a bad giveVault call
      const callData = makerV2.contract.methods.giveVault(walletAddress, utils.numberToBytes32(666)).encodeABI();
      await truffleAssert.reverts(badFeature.callContract(makerV2.address, 0, callData, { from: owner }), "MV2: unauthorized loanId");
    });
  });
});
