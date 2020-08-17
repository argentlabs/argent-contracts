const readline = require("readline");
const ethers = require("ethers");
const web3 = require("web3");

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

module.exports = {

  ETH_TOKEN,

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

  signOffchain: async (signers, from, to, value, data, chainId, nonce, gasPrice, gasLimit, refundToken, refundAddress) => {
    const input = `0x${[
      "0x19",
      "0x00",
      from,
      to,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
      data,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(chainId), 32),
      nonce,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(gasPrice), 32),
      ethers.utils.hexZeroPad(ethers.utils.hexlify(gasLimit), 32),
      refundToken,
      refundAddress,
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
      const bn1 = ethers.BigNumber.from(s1[addressKey]);
      const bn2 = ethers.BigNumber.from(s2[addressKey]);
      if (bn1.lt(bn2)) return -1;
      if (bn1.gt(bn2)) return 1;
      return 0;
    });
  },

  // Parses the RelayerModule.execute receipt to decompose the success value of the transaction
  // and additionally if an error was raised in the sub-call to optionally return that
  parseRelayReceipt(txReceipt) {
    const { args } = txReceipt.events.find((l) => l.event === "TransactionExecuted");

    let errorBytes;
    if (args.returnData.startsWith("0x08c379a0")) {
      // Remove the encoded error signatures 08c379a0
      const noErrorSelector = `0x${args.returnData.slice(10)}`;
      const errorBytesArray = ethers.utils.defaultAbiCoder.decode(["bytes"], noErrorSelector);
      errorBytes = errorBytesArray[0]; // eslint-disable-line prefer-destructuring
    } else {
      errorBytes = args.returnData;
    }
    const error = ethers.utils.toUtf8String(errorBytes);
    return { success: args.success, error };
  },

  parseLogs(txReceipt, contract, eventName) {
    const filter = txReceipt.logs.filter((e) => (
      e.topics.find((t) => (
        contract.interface.events[eventName].topic === t
      )) !== undefined
    ));
    const res = [];
    for (const f of filter) {
      res.push(contract.interface.events[eventName].decode(f.data, f.topics));
    }
    return res;
  },

  hasEvent(txReceipt, contract, eventName) {
    return txReceipt.logs.find((e) => (
      e.topics.find((t) => (
        contract.interface.events[eventName].topic === t
      )) !== undefined
    )) !== undefined;
  },

  versionFingerprint(modules) {
    const concat = modules.map((module) => module.address).sort((m1, m2) => {
      const bn1 = ethers.BigNumber.from(m1);
      const bn2 = ethers.BigNumber.from(m2);
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
      ethers.BigNumber.from(ethers.utils.randomBytes(32)).toHexString(),
      32,
    );
  },

  personalSign: async (signHash, signer) => ethers.utils.joinSignature(signer.signingKey.signDigest(signHash)),

  callStatic: async (contractWrapper, method, ...args) => {
    const contract = new ethers.Contract(
      contractWrapper.contractAddress,
      contractWrapper.contract.interface.abi,
      ethers.getDefaultProvider(contractWrapper.provider.connection.url),
    );
    return contract.callStatic[method](...args);
  },
};
