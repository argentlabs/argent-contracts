/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");

const ERC20 = artifacts.require("TestERC20");
const WETH = artifacts.require("WETH9");
const TestContract = artifacts.require("TestContract");

const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");

const ETH_LIMIT = new BN("1000000");
const SECURITY_PERIOD = 240;
const SECURITY_WINDOW = 240;
const ZERO_BYTES32 = ethers.constants.HashZero;

const ACTION_TRANSFER = 0;

const RelayManager = require("../utils/relay-manager");

contract("TransferManager", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const nonowner = accounts[2];
  const recipient = accounts[3];
  const spender = accounts[4];

  let registry;
  let wallet;
  let tokenPriceRegistry;
  let erc20;
  let weth;
  let relayerManager;

  before(async () => {
    weth = await WETH.new();
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);

    const modules = await setupWalletVersion({ wethToken: weth.address, tokenPriceRegistry: tokenPriceRegistry.address });
    registry = modules.registry;
    relayerManager = modules.relayerManager;

    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new(registry.address, owner, accounts[9]);
    wallet = await IWallet.at(proxy.address);

    const decimals = 12; // number of decimal for TOKN contract
    const tokenRate = new BN(10).pow(new BN(19)).muln(51); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19

    erc20 = await ERC20.new([infrastructure, wallet.address], 10000000, decimals); // TOKN contract with 10M tokens (5M TOKN for wallet and 5M TOKN for account[0])
    await tokenPriceRegistry.setPriceForTokenList([erc20.address], [tokenRate.toString()]);
    await wallet.send(ETH_LIMIT.muln(10000000).toString());
  });

  async function getEtherValue(amount, token) {
    if (token === ETH_TOKEN) {
      return amount;
    }
    const price = await tokenPriceRegistry.getTokenPrice(token);
    const ethPrice = new BN(price.toString()).mul(new BN(amount)).div(new BN(10).pow(new BN(18)));
    return ethPrice;
  }

  describe("Managing the whitelist", () => {
    it("should add/remove an account to/from the whitelist", async () => {
      await wallet.addToWhitelist(recipient, { from: owner });
      let isTrusted = await wallet.isWhitelisted(recipient);
      assert.isFalse(isTrusted, "should not be trusted during the security period");
      await utils.increaseTime(SECURITY_PERIOD + 1);
      isTrusted = await wallet.isWhitelisted(recipient);
      assert.isTrue(isTrusted, "should be trusted after the security period");
      await wallet.removeFromWhitelist(recipient, { from: owner });
      isTrusted = await wallet.isWhitelisted(recipient);
      assert.isFalse(isTrusted, "should no removed from whitelist immediately");
    });

    it("should not be able to whitelist a token twice", async () => {
      await wallet.addToWhitelist(recipient, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      await truffleAssert.reverts(
        wallet.addToWhitelist(recipient, { from: owner }), "TM: target already whitelisted",
      );
    });

    it("should be able to remove a whitelisted token from the whitelist during the security period", async () => {
      await wallet.addToWhitelist(recipient, { from: owner });
      await wallet.removeFromWhitelist(recipient, { from: owner });

      await utils.increaseTime(SECURITY_PERIOD + 1);
      const isTrusted = await wallet.isWhitelisted(recipient);
      assert.isFalse(isTrusted);
    });
  });

  describe("Calculating ether value", () => {
    let erc20First;
    let erc20ZeroDecimals;

    beforeEach(async () => {
      erc20First = await ERC20.new([infrastructure], 10000000, 18);
      erc20ZeroDecimals = await ERC20.new([infrastructure], 10000000, 0);
    });

    it("should be able to get the ether value of a given amount of tokens", async () => {
      const tokenPrice = new BN(10).pow(new BN(18)).muln(1800);
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [tokenPrice]);
      const etherValue = await getEtherValue("15000000000000000000", erc20First.address);
      // expectedValue = 1800*10^18/10^18 (price for 1 token wei) * 15*10^18 (amount) = 1800 * 15*10^18 = 27,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(27000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should be able to get the ether value for a token with 0 decimals", async () => {
      const tokenPrice = new BN(10).pow(new BN(36)).muln(23000);
      await tokenPriceRegistry.setPriceForTokenList([erc20ZeroDecimals.address], [tokenPrice]);
      const etherValue = await getEtherValue(100, erc20ZeroDecimals.address);
      // expectedValue = 23000*10^36 * 100 / 10^18 = 2,300,000 * 10^18
      const expectedValue = new BN(10).pow(new BN(18)).muln(2300000);
      expect(expectedValue).to.eq.BN(etherValue);
    });

    it("should return 0 as the ether value for a low priced token", async () => {
      await tokenPriceRegistry.setPriceForTokenList([erc20First.address], [23000]);
      const etherValue = await getEtherValue(100, erc20First.address);
      assert.equal(etherValue, 0); // 2,300,000
    });
  });

  describe("Daily limit", () => {
    it("should set the default limit for new wallets", async () => {
      const limit = await wallet.getCurrentLimit();
      expect(limit).to.eq.BN(ETH_LIMIT);
    });

    it("should only increase the limit after the security period", async () => {
      await wallet.changeLimit(4000000, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      limit = await wallet.getCurrentLimit();
      expect(limit).to.eq.BN(4000000);
    });

    it("should decrease the limit immediately", async () => {
      await wallet.changeLimit(ETH_LIMIT.divn(2), { from: owner });
      limit = await wallet.getCurrentLimit();
      expect(limit).to.eq.BN(ETH_LIMIT.divn(2));
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(wallet, "changeLimit", [4000000], [owner]);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      const limit = await wallet.getCurrentLimit();
      expect(limit).to.eq.BN(4000000);
    });

    it("should correctly set the pending limit", async () => {
      const tx = await wallet.changeLimit(4000000, { from: owner });
      const timestamp = await utils.getTimestamp(tx.receipt.block);
      const { _pendingLimit, _changeAfter } = await wallet.getPendingLimit();
      assert.equal(_pendingLimit.toNumber(), 4000000);
      assert.closeTo(_changeAfter.toNumber(), timestamp + SECURITY_PERIOD, 1); // timestamp is sometimes off by 1
    });

    it("should be able to disable the limit", async () => {
      const tx = await wallet.disableLimit({ from: owner });
      const txReceipt = tx.receipt;
      await utils.hasEvent(txReceipt, wallet, "DailyLimitDisabled");
      let limitDisabled = await wallet.isLimitDisabled();
      assert.isFalse(limitDisabled);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      limitDisabled = await wallet.isLimitDisabled();
      assert.isTrue(limitDisabled);
    });

    it("should return the correct unspent daily limit amount", async () => {
      await wallet.send(ETH_LIMIT);
      const transferAmount = ETH_LIMIT.subn(100).toString();
      await wallet.transferToken(ETH_TOKEN, recipient, transferAmount, ZERO_BYTES32, { from: owner });
      const { _unspent } = await wallet.getDailyUnspent();
      expect(_unspent).to.eq.BN(100);
    });

    it("should return the correct spent daily limit amount", async () => {
      await wallet.send(ETH_LIMIT);
      // Transfer 100 wei
      const tx = await wallet.transferToken(ETH_TOKEN, recipient, 100, ZERO_BYTES32, { from: owner });
      const timestamp = await utils.getTimestamp(tx.receipt.block);
      // Then transfer 200 wei more
      await wallet.transferToken(ETH_TOKEN, recipient, 200, ZERO_BYTES32, { from: owner });

      const dailySpent = await wallet.getDailySpent();
      expect(dailySpent[0]).to.eq.BN(300);
      assert.closeTo(new BN(dailySpent[1]).toNumber(), timestamp + (3600 * 24), 1); // timestamp is sometimes off by 1
    });

    it("should return 0 if the entire daily limit amount has been spent", async () => {
      await wallet.send(ETH_LIMIT);
      await wallet.transferToken(ETH_TOKEN, recipient, ETH_LIMIT.toString(), ZERO_BYTES32, { from: owner });
      const { _unspent } = await wallet.getDailyUnspent();
      assert.equal(_unspent.toNumber(), 0);
    });
  });

  describe("Token transfers", () => {
    async function doDirectTransfer({
      token, signer = owner, to, amount, relayed = false,
    }) {
      const fundsBefore = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const unspentBefore = await wallet.getDailyUnspent();
      const params = [token === ETH_TOKEN ? ETH_TOKEN : token.address, to, amount, ZERO_BYTES32];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(wallet, "transferToken", params, [signer]);
      } else {
        const tx = await wallet.transferToken(...params, { from: signer });
        txReceipt = tx.receipt;
      }

      await utils.hasEvent(txReceipt, wallet, "Transfer");
      const fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const unspentAfter = await wallet.getDailyUnspent();
      expect(fundsAfter.sub(fundsBefore)).to.eq.BN(amount);
      const ethValue = (token === ETH_TOKEN ? new BN(amount) : (await getEtherValue(amount, token.address)));
      if (ethValue.lt(ETH_LIMIT)) {
        expect(unspentBefore[0].sub(unspentAfter[0])).to.eq.BN(ethValue);
      }
      return txReceipt;
    }

    async function doPendingTransfer({ token, to, amount, delay, relayed = false }) {
      const tokenAddress = token === ETH_TOKEN ? ETH_TOKEN : token.address;
      const fundsBefore = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      const params = [tokenAddress, to, amount, ZERO_BYTES32];

      let txReceipt; let tx;
      if (relayed) {
        txReceipt = await manager.relay(wallet, "transferToken", params, [owner]);
      } else {
        tx = await wallet.transferToken(...params, { from: owner });
        txReceipt = tx.receipt;
      }
  
      await utils.hasEvent(txReceipt, wallet, "PendingTransferCreated");
      let fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      expect(fundsAfter.sub(fundsBefore)).to.be.zero;
      if (delay === 0) {
        const id = ethers.utils.solidityKeccak256(["uint8", "address", "address", "uint256", "bytes", "uint256"],
          [ACTION_TRANSFER, tokenAddress, recipient, amount, ZERO_BYTES32, txReceipt.blockNumber]);
        return id;
      }
      await utils.increaseTime(delay);
      tx = await wallet.executePendingTransfer(tokenAddress, recipient, amount, ZERO_BYTES32, txReceipt.blockNumber);
      txReceipt = tx.receipt;
      console.log(txReceipt.gasUsed)
      await utils.hasEvent(txReceipt, wallet, "PendingTransferExecuted");
      fundsAfter = (token === ETH_TOKEN ? await utils.getBalance(to) : await token.balanceOf(to));
      return expect(fundsAfter.sub(fundsBefore)).to.eq.BN(amount);
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
        const params = [ETH_TOKEN, recipient, 10000, ZERO_BYTES32];
        await truffleAssert.reverts(
          wallet.transferToken(...params, { from: nonowner }),
          "BM: must be wallet owner");
      });

      it("should calculate the daily unspent when the owner send ETH", async () => {
        let unspent = await wallet.getDailyUnspent();
        expect(unspent[0]).to.eq.BN(ETH_LIMIT);
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: 10000 });
        unspent = await wallet.getDailyUnspent();
        expect(unspent[0]).to.eq.BN(ETH_LIMIT.subn(10000));
      });

      it("should calculate the daily unspent in ETH when the owner send ERC20", async () => {
        let unspent = await wallet.getDailyUnspent();
        // unspent should be the limit at the beginning of a period
        expect(unspent[0]).to.eq.BN(ETH_LIMIT);
        await doDirectTransfer({ token: erc20, to: recipient, amount: 10 });
        unspent = await wallet.getDailyUnspent();
        const ethValue = await getEtherValue(10, erc20.address);
        // should be the limit minus the transfer
        expect(unspent[0]).to.eq.BN(ETH_LIMIT.sub(ethValue));
      });
    });

    describe("Large token transfers ", () => {
      it("should create and execute a pending ETH transfer", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: SECURITY_WINDOW + 1, relayed: false,
        });
      });

      it("should create and execute a pending ETH transfer (relayed)", async () => {
        await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: SECURITY_WINDOW + 1, relayed: true,
        });
      });

      it("should create and execute a pending ERC20 transfer", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: SECURITY_WINDOW + 1, relayed: false,
        });
      });

      it("should create and execute a pending ERC20 transfer (relayed)", async () => {
        await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: SECURITY_WINDOW + 1, relayed: true,
        });
      });

      it("should not execute a pending ETH transfer before the confirmation window", async () => {
        const params = [ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32];
        const tx = await wallet.transferToken(...params, { from: owner });

        await truffleAssert.reverts(
          wallet.executePendingTransfer(ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32, tx.receipt.blockNumber),
          "TM: transfer outside of the execution window");
      });

      it("should not execute a pending ETH transfer before the confirmation window (relayed)", async () => {
        const params = [ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32];
        const txReceipt = await manager.relay(wallet, "transferToken", params, [owner]);

        await truffleAssert.reverts(
          wallet.executePendingTransfer(ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32, txReceipt.blockNumber),
          "TM: transfer outside of the execution window");
      });

      it.skip("should not execute a pending ETH transfer after the confirmation window", async () => {
        const amount = ETH_LIMIT.muln(2).toString();
        const params = [ETH_TOKEN, recipient, amount, ZERO_BYTES32];
        const tx = await wallet.transferToken(...params, { from: owner });

        await utils.increaseTime(SECURITY_WINDOW + 10);
        await truffleAssert.reverts(
          wallet.executePendingTransfer(ETH_TOKEN, recipient, amount, ZERO_BYTES32, tx.receipt.blockNumber),
          "TM: transfer outside of the execution window");
      });

      it.skip("should not execute a pending ETH transfer after the confirmation window (relayed)", async () => {
        const params = [ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32];
        const txReceipt = await manager.relay(wallet, "transferToken", params, [owner]);

        await utils.increaseTime(SECURITY_WINDOW + 10);
        await truffleAssert.reverts(
          wallet.executePendingTransfer(ETH_TOKEN, recipient, ETH_LIMIT.muln(2).toString(), ZERO_BYTES32, txReceipt.blockNumber),
          "TM: transfer outside of the execution window");
      });

      it("should cancel a pending ETH transfer", async () => {
        const id = await doPendingTransfer({
          token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: 0,
        });
        await utils.increaseTime(1);
        const tx = await wallet.cancelPendingTransfer(id, { from: owner });
        const txReceipt = tx.receipt;
        await utils.hasEvent(txReceipt, wallet, "PendingTransferCanceled");
        const executeAfter = await wallet.getPendingTransfer(id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should cancel a pending ERC20 transfer", async () => {
        const id = await doPendingTransfer({
          token: erc20, to: recipient, amount: ETH_LIMIT.muln(2).toString(), delay: 0,
        });
        await utils.increaseTime(1);
        const tx = await wallet.cancelPendingTransfer(id, { from: owner });
        const txReceipt = tx.receipt;
        await utils.hasEvent(txReceipt, wallet, "PendingTransferCanceled");
        const executeAfter = await wallet.getPendingTransfer(id);
        assert.equal(executeAfter, 0, "should have cancelled the pending transfer");
      });

      it("should send immediately ETH to a whitelisted address", async () => {
        await wallet.addToWhitelist(recipient, { from: owner });
        await utils.increaseTime(SECURITY_PERIOD + 1);
        await doDirectTransfer({ token: ETH_TOKEN, to: recipient, amount: ETH_LIMIT.muln(2).toString() });
      });

      it("should send immediately ERC20 to a whitelisted address", async () => {
        await wallet.addToWhitelist(recipient, { from: owner });
        await utils.increaseTime(SECURITY_PERIOD + 1);
        await doDirectTransfer({ token: erc20, to: recipient, amount: ETH_LIMIT.muln(2).toString() });
      });
    });

    describe("Transfer with refund", () => {
      it("transfer to a whitelisted address with refund in ETH", async () => {
        await wallet.send("100000000000000");
        const params = [ETH_TOKEN, nonowner, 10000, ZERO_BYTES32];
        await wallet.addToWhitelist(nonowner, { from: owner });
        await utils.increaseTime(SECURITY_PERIOD + 1);
        const isTrusted = await wallet.isWhitelisted(nonowner);
        assert.isTrue(isTrusted, "should be trusted after the security period");
      
        // The first transaction incurs extra cost for setting the nonce first
        // therefore we test 2 transfers for gas cost accuracy
        await manager.relay(wallet, "transferToken", params, [owner], 10000, ETH_TOKEN, recipient);
        
        const wBalanceStart = await utils.getBalance(wallet.address);
        const rBalanceStart = await utils.getBalance(recipient);
        const sBalanceStart = await utils.getBalance(nonowner);
        
        const receipt = await manager.relay(wallet, "transferToken", params, [owner], 10000, ETH_TOKEN, recipient);
        // console.log(receipt.gasUsed);
        
        const wBalanceEnd = await utils.getBalance(wallet.address);
        const rBalanceEnd = await utils.getBalance(recipient);
        const sBalanceEnd = await utils.getBalance(nonowner);
        const refundAndTransfer = wBalanceStart.sub(wBalanceEnd);
        // The recipient refund
        const refund = rBalanceEnd.sub(rBalanceStart);
        // should have transferred out ETH and refund
        expect(refundAndTransfer).to.eq.BN(refund.addn(10000));
        // should have received the ETH
        expect(sBalanceEnd.sub(sBalanceStart)).to.eq.BN(10000);
      });

      it("transfer to a non-whitelisted address with refund in ETH", async () => {
        await wallet.send("100000000000000");
        const params = [ETH_TOKEN, nonowner, 10000, ZERO_BYTES32];
      
        // The first transaction incurs extra cost for setting the nonce first
        // therefore we test 2 transfers for gas cost accuracy
        await manager.relay(wallet, "transferToken", params, [owner], 10000, ETH_TOKEN, recipient);
        
        const wBalanceStart = await utils.getBalance(wallet.address);
        const rBalanceStart = await utils.getBalance(recipient);
        const sBalanceStart = await utils.getBalance(nonowner);
        
        const receipt = await manager.relay(wallet, "transferToken", params, [owner], 10000, ETH_TOKEN, recipient);
        // console.log(receipt.gasUsed);
        
        const wBalanceEnd = await utils.getBalance(wallet.address);
        const rBalanceEnd = await utils.getBalance(recipient);
        const sBalanceEnd = await utils.getBalance(nonowner);
        const refundAndTransfer = wBalanceStart.sub(wBalanceEnd);
        // The recipient refund
        const refund = rBalanceEnd.sub(rBalanceStart);
        // should have transferred out ETH and refund
        expect(refundAndTransfer).to.eq.BN(refund.addn(10000));
        // should have received the ETH
        expect(sBalanceEnd.sub(sBalanceStart)).to.eq.BN(10000);
      });
    });
  });

  describe("Token Approvals", () => {
    async function doDirectApprove({ signer = owner, amount, relayed = false }) {
      const unspentBefore = await wallet.getDailyUnspent();
      const params = [erc20.address, spender, amount];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(wallet, "approveToken", params, [signer]);
      } else {
        const tx = await wallet.approveToken(...params, { from: signer });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, wallet, "Approved");
      const unspentAfter = await wallet.getDailyUnspent();

      console.log(txReceipt.gasUsed)
      const amountInEth = await getEtherValue(amount, erc20.address);
      if (amountInEth.lt(ETH_LIMIT)) {
        expect(unspentBefore[0].sub(unspentAfter[0])).to.eq.BN(amountInEth);  // should have updated the daily limit
      }
      const approval = await erc20.allowance(wallet.address, spender);

      expect(approval).to.eq.BN(amount); // should have approved the amount
      return txReceipt;
    }

    it("should approve an ERC20 immediately when the amount is under the limit", async () => {
      await doDirectApprove({ amount: 10 });
    });

    it("should approve an ERC20 immediately when the amount is under the limit (relayed) ", async () => {
      await doDirectApprove({ amount: 10, relayed: true });
    });

    it("should approve an ERC20 immediately when the amount is under the existing approved amount", async () => {
      await doDirectApprove({ amount: 100 });
      await wallet.approveToken(erc20.address, spender, 10, { from: owner });
      const approval = await erc20.allowance(wallet.address, spender);
      expect(approval).to.eq.BN(10);
    });

    it("should not approve an ERC20 transfer when the signer is not the owner ", async () => {
      const params = [erc20.address, spender, 10];
      truffleAssert.reverts(
        wallet.approveToken(...params, { from: nonowner }),
        "BM: must be wallet owner");
    });

    it("should approve an ERC20 immediately when the spender is whitelisted ", async () => {
      await wallet.addToWhitelist(spender, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      await doDirectApprove({ amount: ETH_LIMIT.addn(10000).toString() });
    });

    it("should fail to approve an ERC20 when the amount is above the daily limit ", async () => {
      const params = [erc20.address, spender, ETH_LIMIT.addn(10000).toString()];
      truffleAssert.reverts(
        wallet.approveToken(...params, { from: owner }),
        "above daily limit");
    });
  });

  describe("Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await TestContract.new();
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doCallContract({ value, state, relayed = false }) {
      const dataToTransfer = contract.contract.methods.setState(state).encodeABI();
      const unspentBefore = await wallet.getDailyUnspent();
      const params = [contract.address, value, dataToTransfer];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(wallet, "callContract", params, [owner]);
      } else {
        const tx = await wallet.callContract(...params, { from: owner });
        txReceipt = tx.receipt;
      }

      await utils.hasEvent(txReceipt, wallet, "CalledContract");
      const unspentAfter = await wallet.getDailyUnspent();
      if (ETH_LIMIT.gt(value)) {
        expect(unspentBefore[0].sub(unspentAfter[0])).to.eq.BN(value); // should have updated the daily limit
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      return txReceipt;
    }

    it("should not be able to call the wallet itselt", async () => {
      const dataToTransfer = contract.contract.methods.setState(4).encodeABI();
      const params = [wallet.address, 10, dataToTransfer];
      await truffleAssert.reverts(wallet.callContract(...params, { from: owner }), "BT: Forbidden contract");
    });

    it("should not be able to call a supported ERC20 token contract", async () => {
      const dataToTransfer = contract.contract.methods.setState(4).encodeABI();
      const params = [erc20.address, 10, dataToTransfer];
      await truffleAssert.reverts(wallet.callContract(...params, { from: owner }), "TM: Forbidden contract");
    });

    it("should be able to call a supported token contract which is whitelisted", async () => {
      await wallet.addToWhitelist(erc20.address, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      const dataToTransfer = erc20.contract.methods.transfer(infrastructure, 4).encodeABI();
      const params = [erc20.address, 0, dataToTransfer];
      await wallet.callContract(...params, { from: owner });
    });

    it("should call a contract and transfer ETH value when under the daily limit", async () => {
      await doCallContract({ value: 10, state: 3 });
    });

    it("should call a contract and transfer ETH value when under the daily limit (relayed) ", async () => {
      await doCallContract({ value: 10, state: 3, relayed: true });
    });

    it.skip("should call a contract and transfer ETH value above the daily limit when the contract is whitelisted", async () => {
      await wallet.addToWhitelist(contract.address, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      await doCallContract({ value: ETH_LIMIT.add(new BN(10000)).toString(), state: 6 });
    });

    it("should fail to call a contract and transfer ETH when the amount is above the daily limit ", async () => {
      await truffleAssert.reverts(doCallContract({ value: ETH_LIMIT.add(new BN(10000)).toString(), state: 6 }, "above daily limit"));
    });
  });

  describe("Approve token and Call contract", () => {
    let contract;

    beforeEach(async () => {
      contract = await TestContract.new();
      assert.equal(await contract.state(), 0, "initial contract state should be 0");
    });

    async function doApproveTokenAndCallContract({ consumer = contract.address, amount, state, relayed = false, wrapEth = false }) {
      const fun = consumer === contract.address ? "setStateAndPayToken" : "setStateAndPayTokenWithConsumer";
      const token = wrapEth ? weth : erc20;
      const dataToTransfer = contract.contract.methods[fun](state, token.address, amount).encodeABI();
      const unspentBefore = await wallet.getDailyUnspent();
      const params = (wrapEth ? [] : [erc20.address])
        .concat([consumer, amount, contract.address, dataToTransfer]);
      const method = wrapEth ? "approveWethAndCallContract" : "approveTokenAndCallContract";
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(wallet, method, params, [owner]);
      } else {
        const tx = await wallet[method](...params, { from: owner });
        txReceipt = tx.receipt;
      }
      await utils.hasEvent(txReceipt, wallet, "ApprovedAndCalledContract");
      const unspentAfter = await wallet.getDailyUnspent();
      const amountInEth = wrapEth ? new BN(amount) : await getEtherValue(amount, erc20.address);

      if (amountInEth.lt(ETH_LIMIT)) {
        expect(unspentBefore[0].sub(unspentAfter[0])).to.eq.BN(amountInEth);
      }
      assert.equal((await contract.state()).toNumber(), state, "the state of the external contract should have been changed");
      const tokenBalance = await token.balanceOf(contract.address);
      assert.equal(tokenBalance.toNumber(), amount, "the contract should have transfered the tokens");

      console.log(txReceipt.gasUsed)
      return txReceipt;
    }

    // approveTokenAndCallContract

    it("should approve the token and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3 });
    });

    it("should approve the token and call the contract when under the limit (relayed)", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, relayed: true });
    });

    it("should restore existing approved amount after call", async () => {
      await wallet.approveToken(erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 5).encodeABI();
      await wallet.approveTokenAndCallContract(
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      );
      const approval = await erc20.allowance(wallet.address, contract.address);

      // Initial approval of 10 is restored, after approving and spending 5
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.address);
      assert.equal(erc20Balance.toNumber(), 5, "the contract should have transfered the tokens");
    });

    it("should be able to spend less than approved in call", async () => {
      await wallet.approveToken(erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 4).encodeABI();
      await wallet.approveTokenAndCallContract(
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      );
      const approval = await erc20.allowance(wallet.address, contract.address);
      // Initial approval of 10 is restored, after approving and spending 4
      assert.equal(approval.toNumber(), 10);

      const erc20Balance = await erc20.balanceOf(contract.address);
      assert.equal(erc20Balance.toNumber(), 4, "the contract should have transfered the tokens");
    });

    it("should not be able to spend more than approved in call", async () => {
      await wallet.approveToken(erc20.address, contract.address, 10, { from: owner });
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 6).encodeABI();
      await truffleAssert.reverts(wallet.approveTokenAndCallContract(
        erc20.address,
        contract.address,
        5,
        contract.address,
        dataToTransfer,
        { from: owner }
      ), "BT: insufficient amount for call");
    });

    it("should approve the token and call the contract when the token is above the limit and the contract is whitelisted ", async () => {
      await wallet.addToWhitelist(contract.address, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT.addn(10000).toString(), state: 6 });
    });

    it("should approve the token and call the contract when contract to call is different to token spender", async () => {
      const consumer = await contract.tokenConsumer();
      await doApproveTokenAndCallContract({ amount: 10, state: 3, consumer });
    });

    it("should approve token and call contract when contract != spender, amount > limit and contract is whitelisted", async () => {
      const consumer = await contract.tokenConsumer();
      await wallet.addToWhitelist(contract.address, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      await doApproveTokenAndCallContract({ amount: ETH_LIMIT.addn(10000).toString(), state: 6, consumer });
    });

    it("should fail to approve token and call contract when contract != spender, amount > limit and spender is whitelisted", async () => {
      const amount = ETH_LIMIT.addn(10000).toString();
      const consumer = await contract.tokenConsumer();
      await wallet.addToWhitelist(consumer, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      const dataToTransfer = contract.contract.methods.setStateAndPayTokenWithConsumer(6, erc20.address, amount).encodeABI();
      await truffleAssert.reverts(
        wallet.approveTokenAndCallContract(
          erc20.address, consumer, amount, contract.address, dataToTransfer, { from: owner }
        ),
        "TM: Approve above daily limit",
      );
    });

    it("should fail to approve the token and call the contract when the token is above the daily limit ", async () => {
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(6, erc20.address, ETH_LIMIT.addn(10000).toString()).encodeABI();
      const params = [erc20.address, contract.address, ETH_LIMIT.addn(10000).toString(), contract.address, dataToTransfer];

      await truffleAssert.reverts(
        wallet.approveTokenAndCallContract(...params, { from: owner }),
        "TM: Approve above daily limit");
    });

    it("should fail to approve token if the amount to be approved is greater than the current balance", async () => {
      const startingBalance = await erc20.balanceOf(wallet.address);
      await erc20.burn(wallet.address, startingBalance);
      const dataToTransfer = contract.contract.methods.setStateAndPayToken(3, erc20.address, 1).encodeABI();
      await truffleAssert.reverts(wallet.approveTokenAndCallContract(
        erc20.address,
        contract.address,
        1,
        contract.address,
        dataToTransfer,
        { from: owner }), "BT: insufficient balance");
    });

    // approveWethAndCallContract

    it("should approve WETH and call the contract when under the limit", async () => {
      await doApproveTokenAndCallContract({ amount: 10, state: 3, wrapEth: true });
    });

    it("should approve WETH and call the contract under the limit when already holding the WETH", async () => {
      const amount = 10;
      await weth.deposit({ value: amount });
      await weth.transfer(wallet.address, amount);
      await doApproveTokenAndCallContract({ amount, state: 3, wrapEth: true });
    });
  });

  describe("Static calls", () => {
    it.skip("should delegate isValidSignature static calls to the TransferManager", async () => {
      const ERC1271_ISVALIDSIGNATURE_BYTES32 = utils.sha3("isValidSignature(bytes32,bytes)").slice(0, 10);
      const isValidSignatureDelegate = await wallet.enabled(ERC1271_ISVALIDSIGNATURE_BYTES32);
      assert.equal(isValidSignatureDelegate, wallet.address);

      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(msg, owner);

      const valid = await wallet.isValidSignature(messageHash, signature);
      assert.equal(valid, ERC1271_ISVALIDSIGNATURE_BYTES32);
    });

    it("should revert isValidSignature static call for invalid signature", async () => {
      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(messageHash, owner);

      await truffleAssert.reverts(
        wallet.isValidSignature(messageHash, `${signature}a1`), "TM: invalid signature length",
      );
    });

    it("should revert isValidSignature static call for invalid signer", async () => {
      const msg = "0x1234";
      const messageHash = web3.eth.accounts.hashMessage(msg);
      const signature = await utils.signMessage(messageHash, owner);

      await truffleAssert.reverts(
        wallet.isValidSignature(messageHash, signature), "TM: Invalid signer",
      );
    });
  });
});
