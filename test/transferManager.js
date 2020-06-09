/* global accounts, utils */
const ethers = require("ethers");

const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const TransferStorage = require("../build/TransferStorage");
const GuardianStorage = require("../build/GuardianStorage");
const TransferModule = require("../build/TransferManager");
const LegacyTransferManager = require("../build-legacy/LegacyTransferManager");
const TokenPriceProvider = require("../build/TokenPriceProvider");
const ERC20 = require("../build/TestERC20");
const TestContract = require("../build/TestContract");

const { ETH_TOKEN } = require("../utils/utilities.js");

const ETH_LIMIT = 1000000;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const DECIMALS = 12; // number of decimal for TOKN contract
const TOKEN_RATE = ethers.utils.bigNumberify(51 * 10 ** 13); // 1 TOKN = 0.00051 ETH
const ZERO_BYTES32 = ethers.constants.HashZero;

const ACTION_TRANSFER = 0;

const TestManager = require("../utils/test-manager");

describe("TransferManager", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const owner = accounts[1].signer;
  const nonowner = accounts[2].signer;
  const recipient = accounts[3].signer;
  const spender = accounts[4].signer;

  let deployer;
  let registry;
  let priceProvider;
  let transferStorage;
  let guardianStorage;
  let transferModule;
  let previousTransferModule;
  let wallet;
  let erc20;

  before(async () => {
    deployer = manager.newDeployer();
    registry = await deployer.deploy(Registry);
    priceProvider = await deployer.deploy(TokenPriceProvider);
    await priceProvider.addManager(infrastructure.address);

    transferStorage = await deployer.deploy(TransferStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);

    previousTransferModule = await deployer.deploy(LegacyTransferManager, {},
      registry.contractAddress,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      priceProvider.contractAddress,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero);

    transferModule = await deployer.deploy(TransferModule, {},
      registry.contractAddress,
      transferStorage.contractAddress,
      guardianStorage.contractAddress,
      priceProvider.contractAddress,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      previousTransferModule.contractAddress);

    await registry.registerModule(transferModule.contractAddress, ethers.utils.formatBytes32String("TransferModule"));
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
    await wallet.init(owner.address, [transferModule.contractAddress]);
    erc20 = await deployer.deploy(ERC20, {}, [infrastructure.address, wallet.contractAddress], 10000000, DECIMALS); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await priceProvider.setPrice(erc20.contractAddress, TOKEN_RATE);
    await infrastructure.sendTransaction({ to: wallet.contractAddress, value: ethers.utils.bigNumberify("1000000000000000000") });
  });

  describe("Initialising the module", () => {
    it("when no previous transfer manager is passed, should initialise with default limit", async () => {
      const transferModule1 = await deployer.deploy(TransferModule, {},
        registry.contractAddress,
        transferStorage.contractAddress,
        guardianStorage.contractAddress,
        priceProvider.contractAddress,
        SECURITY_PERIOD,
        SECURITY_WINDOW,
        10,
        ethers.constants.AddressZero);

      const existingWallet = await deployer.deploy(Wallet);
      await existingWallet.init(owner.address, [transferModule1.contractAddress]);

      const limit = await transferModule1.defaultLimit();
      assert.equal(limit, 10);
    });
  });

  describe("Managing limit and whitelist ", () => {
    it("should migrate the limit for existing wallets", async () => {
      // create wallet with previous module and funds
      const existingWallet = await deployer.deploy(Wallet);
      await existingWallet.init(owner.address, [previousTransferModule.contractAddress]);
      await infrastructure.sendTransaction({ to: existingWallet.contractAddress, value: ethers.utils.bigNumberify("100000000") });
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
      const unspent = await transferModule.getDailyUnspent(existingWallet.contractAddress);
      assert.equal(unspent[0].toNumber(), 4000000 - 1000000, "unspent should have been migrated");
    });

    it("should set the default limit for new wallets", async () => {
      const limit = await transferModule.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
    });

    it("should only change the limit after the security period", async () => {
      await transferModule.from(owner).changeLimit(wallet.contractAddress, 4000000);
      let limit = await transferModule.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), ETH_LIMIT, "limit should be ETH_LIMIT");
      await manager.increaseTime(3);
      limit = await transferModule.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(transferModule, "changeLimit", [wallet.contractAddress, 4000000], wallet, [owner]);
      await manager.increaseTime(3);
      const limit = await transferModule.getCurrentLimit(wallet.contractAddress);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });

    it("should add/remove an account to/from the whitelist", async () => {
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      let isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false, "should not be trusted during the security period");
      await manager.increaseTime(3);
      isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, true, "should be trusted after the security period");
      await transferModule.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address);
      isTrusted = await transferModule.isWhitelisted(wallet.contractAddress, recipient.address);
      assert.equal(isTrusted, false, "should no removed from whitelist immediately");
    });

    it("should not be able to whitelist a token twice", async () => {
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
      await manager.increaseTime(3);
      await assert.revertWith(transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address), "TT: target already whitelisted");
    });

    it("should not be able to remove a non-whitelisted token from the whitelist", async () => {
      await assert.revertWith(transferModule.from(owner).removeFromWhitelist(wallet.contractAddress, recipient.address),
        "TT: target not whitelisted");
    });
  });

  describe("Token transfers", () => {
    async function doDirectTransfer({
      token, signer = owner, to, amount, relayed = false,
    }) {
      const fundsBefore = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, token === ETH_TOKEN ? ETH_TOKEN : token.contractAddress, to.address, amount, ZERO_BYTES32];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferModule, "transferToken", params, wallet, [signer]);
      } else {
        const tx = await transferModule.from(signer).transferToken(...params);
        txReceipt = await transferModule.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "Transfer"), "should have generated Transfer event");
      const fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, "should have transfered amount");
      const ethValue = (token === ETH_TOKEN ? amount : (await priceProvider.getEtherValue(amount, token.contractAddress)).toNumber());
      if (ethValue < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), ethValue, "should have updated the daily spent in ETH");
      }
      return txReceipt;
    }

    async function doPendingTransfer({
      token, to, amount, delay, relayed = false,
    }) {
      const tokenAddress = token === ETH_TOKEN ? ETH_TOKEN : token.contractAddress;
      const fundsBefore = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      const params = [wallet.contractAddress, tokenAddress, to.address, amount, ZERO_BYTES32];
      let txReceipt; let
        tx;
      if (relayed) {
        txReceipt = await manager.relay(transferModule, "transferToken", params, wallet, [owner]);
      } else {
        tx = await transferModule.from(owner).transferToken(...params);
        txReceipt = await transferModule.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCreated"), "should have generated PendingTransferCreated event");
      let fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      assert.equal(fundsAfter.sub(fundsBefore).toNumber(), 0, "should not have transfered amount");
      if (delay === 0) {
        const id = ethers.utils.solidityKeccak256(["uint8", "address", "address", "uint256", "bytes", "uint256"],
          [ACTION_TRANSFER, tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber]);
        return id;
      }
      await manager.increaseTime(delay);
      tx = await transferModule.executePendingTransfer(wallet.contractAddress,
        tokenAddress, recipient.address, amount, ZERO_BYTES32, txReceipt.blockNumber);
      txReceipt = await transferModule.verboseWaitForTransaction(tx);
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferExecuted"),
        "should have generated PendingTransferExecuted event");
      fundsAfter = (token === ETH_TOKEN ? await deployer.provider.getBalance(to.address) : await token.balanceOf(to.address));
      return assert.equal(fundsAfter.sub(fundsBefore).toNumber(), amount, "should have transfered amount");
    }

    describe("Small token transfers", () => {
      it("should let the owner send ETH", async () => {
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
      });
      it("should let the owner send ETH (relayed)", async () => {
        await doDirectTransfer({
          token: ETH_TOKEN, to: recipient, amount: 10000, relayed: true,
        });
      });
      it("should let the owner send ERC20", async () => {
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
      });
      it("should let the owner send ERC20 (relayed)", async () => {
        await doDirectTransfer({
          token: erc20, to: recipient, amount: 10, relayed: true,
        });
      });
      it("should only let the owner send ETH", async () => {
        try {
          await doDirectTransfer({
            token: ETH_TOKEN, signer: nonowner, to: recipient, amount: 10000,
          });
          assert.fail("transfer should have failed");
        } catch (error) {
          assert.ok(await manager.isRevertReason(error, "BM: must be wallet owner"));
        }
      });
      it("should calculate the daily unspent when the owner send ETH", async () => {
        let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
        unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT - 10000, "should be the limit minuss the transfer");
      });
      it("should calculate the daily unspent in ETH when the owner send ERC20", async () => {
        let unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT, "unspent should be the limit at the beginning of a period");
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
        unspent = await transferModule.getDailyUnspent(wallet.contractAddress);
        const ethValue = await priceProvider.getEtherValue(10, erc20.contractAddress);
        assert.equal(unspent[0].toNumber(), ETH_LIMIT - ethValue.toNumber(), "should be the limit minuss the transfer");
      });
    });

    describe("Large token transfers ", () => {
      it("should create and execute a pending ETH transfer", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: false,
        });
      });
      it("should create and execute a pending ETH transfer (relayed)", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: true,
        });
      });
      it("should create and execute a pending ERC20 transfer", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: false,
        });
      });
      it("should create and execute a pending ERC20 transfer (relayed)", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 3, relayed: true,
        });
      });
      it("should not execute a pending ETH transfer before the confirmation window", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 1, relayed: false,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });
      it("should not execute a pending ETH transfer before the confirmation window (relayed)", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 1, relayed: true,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });
      it("should not execute a pending ETH transfer after the confirmation window", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 10, relayed: false,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });
      it("should not execute a pending ETH transfer after the confirmation window (relayed)", async () => {
        try {
          await doPendingTransfer({
            token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 10, relayed: true,
          });
        } catch (error) {
          assert.isTrue(await manager.isRevertReason(error, "outside of the execution window"), "should throw ");
        }
      });
      it("should cancel a pending ETH transfer", async () => {
        const id = await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000, delay: 0,
        });
        await manager.increaseTime(1);
        const tx = await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
        const txReceipt = await transferModule.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCanceled"),
          "should have generated PendingTransferCanceled event");
        const executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });
      it("should cancel a pending ERC20 transfer", async () => {
        const id = await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT + 10000, delay: 0,
        });
        await manager.increaseTime(1);
        const tx = await transferModule.from(owner).cancelPendingTransfer(wallet.contractAddress, id);
        const txReceipt = await transferModule.verboseWaitForTransaction(tx);
        assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "PendingTransferCanceled"),
          "should have generated PendingTransferCanceled event");
        const executeAfter = await transferModule.getPendingTransfer(wallet.contractAddress, id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });
      it("should send immediately ETH to a whitelisted address", async () => {
        await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
        await manager.increaseTime(3);
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT + 10000 });
      });
      it("should send immediately ERC20 to a whitelisted address", async () => {
        await transferModule.from(owner).addToWhitelist(wallet.contractAddress, recipient.address);
        await manager.increaseTime(3);
        await doDirectTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT + 10000 });
      });
    });
  });

  describe("Token Approvals", () => {
    async function doDirectApprove({ signer = owner, amount, relayed = false }) {
      const unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, erc20.contractAddress, spender.address, amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferModule, "approveToken", params, wallet, [signer]);
      } else {
        const tx = await transferModule.from(signer).approveToken(...params);
        txReceipt = await transferModule.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "Approved"), "should have generated Approved event");
      const unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);

      const amountInEth = await priceProvider.getEtherValue(amount, erc20.contractAddress);
      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      const approval = await erc20.allowance(wallet.contractAddress, spender.address);

      assert.equal(approval.toNumber(), amount, "should have approved the amount");
      return txReceipt;
    }

    it("should appprove an ERC20 immediately when the amount is under the limit", async () => {
      await doDirectApprove({ amount: 10 });
    });

    it("should appprove an ERC20 immediately when the amount is under the limit (relayed) ", async () => {
      await doDirectApprove({ amount: 10, relayed: true });
    });

    it("should appprove an ERC20 immediately when the amount is under the existing approved amount", async () => {
      await doDirectApprove({ amount: 100 });
      await transferModule.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, spender.address, 10);
      const approval = await erc20.allowance(wallet.contractAddress, spender.address);
      assert.equal(approval.toNumber(), 10);
    });

    it("should not appprove an ERC20 transfer when the signer is not the owner ", async () => {
      try {
        await doDirectApprove({ signer: nonowner, amount: 10 });
        assert.fail("approve should have failed");
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "BM: must be wallet owner"));
      }
    });
    it("should appprove an ERC20 immediately when the spender is whitelisted ", async () => {
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, spender.address);
      await manager.increaseTime(3);
      await doDirectApprove({ amount: ETH_LIMIT + 10000 });
    });
    it("should fail to appprove an ERC20 when the amount is above the daily limit ", async () => {
      try {
        await doDirectApprove({ amount: ETH_LIMIT + 10000 });
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "above daily limit"));
      }
    });
  });

  describe("Call contract", () => {
    let contract; let
      dataToTransfer;

    beforeEach(async () => {
      contract = await deployer.deploy(TestContract);
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doCallContract({
      signer = owner, value, state, relayed = false,
    }) {
      dataToTransfer = contract.contract.interface.functions.setState.encode([state]);
      const unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, contract.contractAddress, value, dataToTransfer];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferModule, "callContract", params, wallet, [signer]);
      } else {
        const tx = await transferModule.from(signer).callContract(...params);
        txReceipt = await transferModule.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "CalledContract"), "should have generated CalledContract event");
      const unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
      if (value < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), value, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      return txReceipt;
    }

    it("should call a contract and transfer ETH under the limit", async () => {
      await doCallContract({ value: 10, state: 3 });
    });
    it("should call a contract and transfer ETH under the limit (relayed) ", async () => {
      await doCallContract({ value: 10, state: 3, relayed: true });
    });

    it("should call a contract and transfer ETH above my limit value when the contract is whitelisted ", async () => {
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
    });
    it("should fail to call a contract and transfer ETH when the amount is above the daily limit ", async () => {
      try {
        await doCallContract({ value: ETH_LIMIT + 10000, state: 6 });
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "above daily limit"));
      }
    });
  });

  describe("Approve token and Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await deployer.deploy(TestContract);
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doApproveTokenAndCallContract({
      signer = owner, consumer = contract.contractAddress, amount, state, relayed = false,
    }) {
      const fun = consumer === contract.contractAddress ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
      const dataToTransfer = contract.contract.interface.functions[fun].encode([state, erc20.contractAddress, amount]);
      const unspentBefore = await transferModule.getDailyUnspent(wallet.contractAddress);
      const params = [wallet.contractAddress, erc20.contractAddress, consumer, amount, contract.contractAddress, dataToTransfer];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(transferModule, "approveTokenAndCallContract", params, wallet, [signer]);
      } else {
        const tx = await transferModule.from(signer).approveTokenAndCallContract(...params);
        txReceipt = await transferModule.verboseWaitForTransaction(tx);
      }
      assert.isTrue(await utils.hasEvent(txReceipt, transferModule, "ApprovedAndCalledContract"), "should have generated CalledContract event");
      const unspentAfter = await transferModule.getDailyUnspent(wallet.contractAddress);
      const amountInEth = await priceProvider.getEtherValue(amount, erc20.contractAddress);

      if (amountInEth < ETH_LIMIT) {
        assert.equal(unspentBefore[0].sub(unspentAfter[0]).toNumber(), amountInEth, "should have updated the daily limit");
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      const erc20Balance = await erc20.balanceOf(contract.contractAddress);
      assert.equal(erc20Balance.toNumber(), amount, "the contract should have transfered the tokens");
      return txReceipt;
    }

    it("should approve the token and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3 });
    });

    it("should approve the token and call the contract when under the limit (relayed) ", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, relayed: true });
    });

    it("should restore existing approved amount after call", async () => {
      await transferModule.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 5]);
      await transferModule.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      );
      const approval = await erc20.allowance(wallet.contractAddress, contract.contractAddress);

      // Initial approval of 10 is restored, after approving and spending 5
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.contractAddress);
      assert.equal(erc20Balance.toNumber(), 5, "the contract should have transfered the tokens");
    });

    it("should be able to spend less than approved in call", async () => {
      await transferModule.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 4]);
      await transferModule.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      );
      const approval = await erc20.allowance(wallet.contractAddress, contract.contractAddress);
      // Initial approval of 10 is restored, after approving and spending 4
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.contractAddress);
      assert.equal(erc20Balance.toNumber(), 4, "the contract should have transfered the tokens");
    });

    it("should not be able to spend more than approved in call", async () => {
      await transferModule.from(owner).approveToken(wallet.contractAddress, erc20.contractAddress, contract.contractAddress, 10);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayToken.encode([3, erc20.contractAddress, 6]);
      await assert.revertWith(transferModule.from(owner).approveTokenAndCallContract(
        wallet.contractAddress,
        erc20.contractAddress,
        contract.contractAddress,
        5,
        contract.contractAddress,
        dataToTransfer,
      ), "BT: insufficient amount for call");
    });

    it("should approve the token and call the contract when the token is above the limit and the contract is whitelisted ", async () => {
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
    });

    it("should approve the token and call the contract when contract to call is different to token spender", async () => {
      const consumer = await contract.tokenConsumer();
      await doApproveTokenAndCallContract({ amount: 10, state: 3, consumer });
    });

    it("should approve token and call contract when contract != spender, amount > limit and spender is whitelisted ", async () => {
      const consumer = await contract.tokenConsumer();
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, consumer);
      await manager.increaseTime(3);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6, consumer });
    });

    it("should fail to approve token and call contract when contract != spender, amount > limit and contract is whitelisted ", async () => {
      const amount = ETH_LIMIT + 10000;
      const consumer = await contract.tokenConsumer();
      await transferModule.from(owner).addToWhitelist(wallet.contractAddress, contract.contractAddress);
      await manager.increaseTime(3);
      const dataToTransfer = contract.contract.interface.functions.setStateAndPayTokenWithConsumer.encode([6, erc20.contractAddress, amount]);
      await assert.revertWith(
        transferModule.from(owner).approveTokenAndCallContract(
          wallet.contractAddress, erc20.contractAddress, consumer, amount, contract.contractAddress, dataToTransfer,
        ),
        "TM: Approve above daily limit",
      );
    });

    it("should fail to approve the token and call the contract when the token is above the daily limit ", async () => {
      try {
        await doApproveTokenAndCallContract({ amount: ETH_LIMIT + 10000, state: 6 });
      } catch (error) {
        assert.ok(await manager.isRevertReason(error, "above daily limit"));
      }
    });
  });
});
