/* global artifacts */
const { expect, assert } = require("chai");
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const ArgentWalletDetector = artifacts.require("ArgentWalletDetector");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");

const utils = require("../utils/utilities.js");

const RANDOM_CODE = "0x880ac7547a884027b93f5eaba5ff545919fdeb3c23ed0d2094db66303b3a80ac";
const ZERO_BYTES32 = ethers.constants.HashZero;
const ZERO_ADDRESS = ethers.constants.AddressZero;

const EMPTY_CODE_MSG = "AWR: empty _code";
const EMPTY_IMPL_MSG = "AWR: empty _impl";

describe("ArgentWalletDetector", () => {
  let detector;
  let implementation1;
  let implementation2;
  let proxy1;
  let proxy2;
  let argentCode;

  before(async () => {
    implementation1 = await BaseWallet.new();
    implementation2 = await BaseWallet.new();
    proxy1 = await Proxy.new(implementation1.address);
    proxy2 = await Proxy.new(implementation2.address);
    argentCode = ethers.utils.keccak256(Proxy.deployedBytecode);
  });

  beforeEach(async () => {
    detector = await ArgentWalletDetector.new([], []);
  });

  describe("add info", () => {
    it("should deploy with codes and implementations", async () => {
      const c = [argentCode, RANDOM_CODE];
      const i = [implementation1.address, implementation2.address];
      detector = await ArgentWalletDetector.new(c, i);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.address, "should have added first implementation");
      assert.equal(implementations[1], implementation2.address, "should have added second implementation");
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], RANDOM_CODE, "should have added second code");
    });

    it("should add implementations", async () => {
      await detector.addImplementation(implementation1.address);
      await detector.addImplementation(implementation2.address);
      const implementations = await detector.getImplementations();
      assert.equal(implementations[0], implementation1.address, "should have added first implementation");
      assert.equal(implementations[1], implementation2.address, "should have added second implementation");
    });

    it("should add codes", async () => {
      await detector.addCode(argentCode);
      await detector.addCode(RANDOM_CODE);
      const codes = await detector.getCodes();
      assert.equal(codes[0], argentCode, "should have added first code");
      assert.equal(codes[1], RANDOM_CODE, "should have added second code");
    });

    it("should not add an existing implementation", async () => {
      await detector.addImplementation(implementation1.address);
      const tx = await detector.addImplementation(implementation1.address);
      const event = await utils.getEvent(tx.receipt, detector, "ImplementationAdded");
      expect(event).to.not.exist;
    });

    it("should not add an existing code", async () => {
      await detector.addCode(argentCode);
      const tx = await detector.addCode(argentCode);
      const event = await utils.getEvent(tx.receipt, detector, "CodeAdded");
      expect(event).to.not.exist;
    });

    it("should fail to add an empty code", async () => {
      await truffleAssert.reverts(detector.addCode(ZERO_BYTES32), EMPTY_CODE_MSG);
    });

    it("should fail to add an empty implementation", async () => {
      await truffleAssert.reverts(detector.addImplementation(ZERO_ADDRESS), EMPTY_IMPL_MSG);
    });

    it("should add code and implementation from a wallet", async () => {
      await detector.addCodeAndImplementationFromWallet(proxy1.address);
      const isArgent = await detector.isArgentWallet(proxy1.address);
      assert.isTrue(isArgent, "should return true for an Argent wallet");
    });

    it("should return false when the code is not correct", async () => {
      await detector.addImplementation(implementation1.address);
      await detector.addCode(RANDOM_CODE);
      const isArgent = await detector.isArgentWallet(proxy1.address);
      assert.isFalse(isArgent, "should return false when the code is not correct");
    });

    it("should return false when the implementation is not correct", async () => {
      await detector.addImplementation(implementation1.address);
      await detector.addCode(argentCode);
      const isArgent = await detector.isArgentWallet(proxy2.address);
      assert.isFalse(isArgent, "should return false when the implementation is not correct");
    });
  });
});
