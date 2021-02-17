/* global artifacts */

const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const TruffleContract = require("@truffle/contract");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const BaseWalletV24Contract = require("../build-legacy/v2.4.0/BaseWallet");

const BaseWalletV24 = TruffleContract(BaseWalletV24Contract);

const Registry = artifacts.require("ModuleRegistry");
const LockStorage = artifacts.require("LockStorage");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("DappRegistry");

const utils = require("../utils/utilities.js");
const { ARGENT_WHITELIST } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

const RelayManager = require("../utils/relay-manager");

contract("Static Calls", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const relayer = accounts[9];

  const msg = "0x1234";
  const messageHash = web3.eth.accounts.hashMessage(msg);
  let signature;

  let registry;
  let lockStorage;
  let transferStorage;
  let guardianStorage;
  let module;
  let wallet;
  let oldWallet;
  let walletImplementation;
  let oldWalletImplementation;

  let authoriser;

  before(async () => {
    BaseWalletV24.defaults({ from: accounts[0] });
    BaseWalletV24.setProvider(web3.currentProvider);

    registry = await Registry.new();
    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    authoriser = await Authoriser.new();

    module = await ArgentModule.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      transferStorage.address,
      authoriser.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      LOCK_PERIOD,
      RECOVERY_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, relayer, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();
    oldWalletImplementation = await BaseWalletV24.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
    signature = await utils.signMessage(msg, owner);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    const proxy2 = await Proxy.new(oldWalletImplementation.address);
    oldWallet = await BaseWalletV24.at(proxy2.address);
    await oldWallet.init(owner, [module.address]);
  });

  async function checkStaticCalls({ _wallet, _supportERC1155 }) {
    const staticCalls = [
      { method: "isValidSignature(bytes32,bytes)", params: [messageHash, signature] },
      { method: "onERC721Received(address,address,uint256,bytes)", params: [infrastructure, infrastructure, 0, "0x"] },
    ];
    if (_supportERC1155) {
      staticCalls.push(
        { method: "onERC1155Received(address,address,uint256,uint256,bytes)", params: [infrastructure, infrastructure, 0, 0, "0x"] },
        { method: "onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)", params: [infrastructure, infrastructure, [0], [0], "0x"] },
      );
    }

    for (const { method, params } of staticCalls) {
      const expectedRes = utils.sha3(method).slice(0, 10);
      const delegate = await _wallet.enabled(expectedRes);
      assert.equal(delegate, module.address, "wallet.enabled() is not module");
      const res = await web3.eth.call({
        to: _wallet.address,
        data: utils.encodeFunctionCall(method, params),
      });
      assert.equal(res.slice(0, 10), expectedRes, "unexpected static call return value");
    }
  }

  describe("default static calls", () => {
    it("should have ERC721 and ERC1271 static calls enabled by default (old wallet)", async () => {
      await checkStaticCalls({ _wallet: oldWallet, _supportERC1155: false });
    });
    it("should have all static calls enabled by default (new wallett)", async () => {
      await checkStaticCalls({ _wallet: wallet, _supportERC1155: true });
    });
  });

  describe("isValidSignature", () => {
    it("should revert isValidSignature static call for invalid signature", async () => {
      const walletAsModule = await ArgentModule.at(wallet.address);
      await truffleAssert.reverts(
        walletAsModule.isValidSignature(messageHash, `${signature}a1`), "TM: invalid signature length",
      );
    });

    it("should revert isValidSignature static call for invalid signer", async () => {
      const walletAsModule = await ArgentModule.at(wallet.address);
      const badSig = await utils.signMessage(messageHash, infrastructure);
      await truffleAssert.reverts(
        walletAsModule.isValidSignature(messageHash, badSig), "TM: Invalid signer",
      );
    });
  });

  describe("ERC1155 activation", () => {
    it("lets the owner enable ERC1155TokenReceiver", async () => {
      const txReceipt = await manager.relay(
        module,
        "enableERC1155TokenReceiver",
        [wallet.address],
        wallet,
        [owner]);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "enableERC1155TokenReceiver failed");
      checkStaticCalls({ _wallet: wallet, _supportERC1155: true });
    });
  });
});
