const readline = require("readline");
const ethers = require("ethers");

const { bigNumberify } = ethers.utils;

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const RAY = bigNumberify("1000000000000000000000000000"); // 10**27
const WAD = bigNumberify("1000000000000000000"); // 10**18
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH

module.exports = {

  ETH_TOKEN,
  RAY,
  WAD,
  USD_PER_DAI,
  USD_PER_ETH,
  USD_PER_MKR,
  ETH_PER_MKR,
  ETH_PER_DAI,

  namehash(_name) {
    return ethers.utils.namehash(_name);
  },

  sha3: (input) => {
    if (ethers.utils.isHexString(input)) {
      return ethers.utils.keccak256(input);
    }
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(input));
  },

  asciiToBytes32: (input) => ethers.utils.formatBytes32String(input), // return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(input));

  bigNumberify: (input) => ethers.utils.bigNumberify(input),

  bigNumToBytes32: (input) => ethers.utils.hexZeroPad(input.toHexString(), 32),

  waitForUserInput: (text) => new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(text, (answer) => {
      resolve(answer);
      rl.close();
    });
  }),

  signOffchain: async (signers, from, to, value, data, nonce, gasPrice, gasLimit) => {
    const input = `0x${[
      "0x19",
      "0x00",
      from,
      to,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
      data,
      nonce,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(gasPrice), 32),
      ethers.utils.hexZeroPad(ethers.utils.hexlify(gasLimit), 32),
    ].map((hex) => hex.slice(2)).join("")}`;

    const signedData = ethers.utils.keccak256(input);

    const tasks = signers.map((signer) => signer.signMessage(ethers.utils.arrayify(signedData)));
    const signatures = await Promise.all(tasks);
    const sigs = `0x${signatures.map((signature) => {
      const split = ethers.utils.splitSignature(signature);
      return ethers.utils.joinSignature(split).slice(2);
    }).join("")}`;

    return sigs;
  },

  sortWalletByAddress(wallets, addressKey = "address") {
    return wallets.sort((s1, s2) => {
      const bn1 = ethers.utils.bigNumberify(s1[addressKey]);
      const bn2 = ethers.utils.bigNumberify(s2[addressKey]);
      if (bn1.lt(bn2)) return -1;
      if (bn1.gt(bn2)) return 1;
      return 0;
    });
  },

  parseRelayReceipt(txReceipt) {
    return txReceipt.events.find((l) => l.event === "TransactionExecuted").args.success;
  },

  versionFingerprint(modules) {
    const concat = modules.map((module) => module.address).sort((m1, m2) => {
      const bn1 = ethers.utils.bigNumberify(m1);
      const bn2 = ethers.utils.bigNumberify(m2);
      if (bn1.lt(bn2)) {
        return 1;
      }
      if (bn1.gt(bn2)) {
        return -1;
      }
      return 0;
    }).reduce((prevValue, currentValue) => prevValue + currentValue.slice(2), "0x");
    return ethers.utils.keccak256(concat).slice(0, 10);
  },

  getRandomAddress() {
    return ethers.Wallet.createRandom().address;
  },

  generateSaltValue() {
    return ethers.utils.hexZeroPad(
      ethers.utils.bigNumberify(ethers.utils.randomBytes(32)).toHexString(),
      32,
    );
  },
};
