/* global utils */
const ethers = require("ethers");
const ArgentWalletDetector = require("../build/ArgentWalletDetector");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");

const TestManager = require("../utils/test-manager");

const RANDOM_CODE = "0x880ac7547a884027b93f5eaba5ff545919fdeb3c23ed0d2094db66303b3a80ac";
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;

const EMPTY_CODE_MSG = "AWR: empty _code";
const EMPTY_IMPL_MSG = "AWR: empty _impl";

describe("ArgentWalletDetector", () => {
  const manager = new TestManager();

  let deployer;
  let detector;
  let implementation1;
  let implementation2;
  let proxy1;
  let proxy2;
  let argentCode;

  before(async () => {
    deployer = manager.newDeployer();
    implementation1 = await deployer.deploy(BaseWallet);
    implementation2 = await deployer.deploy(BaseWallet);
    proxy1 = await deployer.deploy(Proxy, {}, implementation1.contractAddress);
    proxy2 = await deployer.deploy(Proxy, {}, implementation2.contractAddress);
    argentCode = ethers.utils.keccak256(proxy1._contract.deployedBytecode);
  });

  beforeEach(async () => {
    detector = await deployer.deploy(ArgentWalletDetector, {}, [], []);
  });

  describe("add info", () => {
    it("should deploy with codes and implementations", async () => {
      const c = [argentCode, RANDOM_CODE];
      const i = [implementation1.contractAddress, implementation2.contractAddress];
      detector = await deployer.deploy(ArgentWalletDetector, {}, c, i);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.contractAddress, "should have added first implementation");
      assert.equal(implementations[1], implementation2.contractAddress, "should have added second implementation");
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], RANDOM_CODE, "should have added second code");
    });

    it("should add implementations", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addImplementation(implementation2.contractAddress);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.contractAddress, "should have added first implementation");
      assert.equal(implementations[1], implementation2.contractAddress, "should have added second implementation");
    });

    it("should add codes", async () => {
      await detector.addCode(argentCode);
      await detector.addCode(RANDOM_CODE);
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], RANDOM_CODE, "should have added second code");
    });

    it("should not add an existing implementation", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      const tx = await detector.addImplementation(implementation1.contractAddress);
      const txReceipt = await detector.verboseWaitForTransaction(tx);
      assert.isFalse(await utils.hasEvent(txReceipt, detector, "ImplementationAdded"), "should not have generated ImplementationAdded event");
    });

    it("should not add an existing code", async () => {
      await detector.addCode(argentCode);
      const tx = await detector.addCode(argentCode);
      const txReceipt = await detector.verboseWaitForTransaction(tx);
      assert.isFalse(await utils.hasEvent(txReceipt, detector, "CodeAdded"), "should not have generated CodeAdded event");
    });

    it("should fail to add an empty code", async () => {
      await assert.revertWith(detector.addCode(ZERO_BYTES32), EMPTY_CODE_MSG);
    });

    it("should fail to add an empty implementation", async () => {
      await assert.revertWith(detector.addImplementation(ZERO_ADDRESS), EMPTY_IMPL_MSG);
    });

    it("should add code and implementation from a wallet", async () => {
      await detector.addCodeAndImplementationFromWallet(proxy1.contractAddress);
      const isArgent = await detector.isArgentWallet(proxy1.contractAddress);
      assert.isTrue(isArgent, "should return true for an Argent wallet");
    });

    it("should return false when the code is not correct", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addCode(RANDOM_CODE);
      const isArgent = await detector.isArgentWallet(proxy1.contractAddress);
      assert.isFalse(isArgent, "should return false when the code is not correct");
    });

    it("should return false when the implementation is not correct", async () => {
      await detector.addImplementation(implementation1.contractAddress);
      await detector.addCode(argentCode);
      const isArgent = await detector.isArgentWallet(proxy2.contractAddress);
      assert.isFalse(isArgent, "should return false when the implementation is not correct");
    });
  });
});
