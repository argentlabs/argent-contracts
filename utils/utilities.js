const readline = require("readline");
const ethers = require("ethers");
const BN = require("bn.js");
const chai = require("chai");

const { expect } = chai;
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

  numberToBytes32: (input) => `0x${new BN(input).toString(16, 64)}`,

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

  async signOffchain(signers, from, to, value, data, chainId, nonce, gasPrice, gasLimit, refundToken, refundAddress) {
    const messageHash = this.getMessageHash(from, to, value, data, chainId, nonce, gasPrice, gasLimit, refundToken, refundAddress);
    const signatures = await Promise.all(
      signers.map(async (signer) => {
        const sig = await this.signMessage(messageHash, signer);
        return sig.slice(2);
      })
    );
    const joinedSignatures = `0x${signatures.join("")}`;

    return joinedSignatures;
  },

  getMessageHash(from, to, value, data, chainId, nonce, gasPrice, gasLimit, refundToken, refundAddress) {
    const message = `0x${[
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

    const messageHash = ethers.utils.keccak256(message);
    return messageHash;
  },

  async signMessage(message, signer) {
    const sig = await web3.eth.sign(message, signer);
    let v = parseInt(sig.substring(130, 132), 16);
    if (v < 27) v += 27;
    const normalizedSig = `${sig.substring(0, 130)}${v.toString(16)}`;
    return normalizedSig;
  },

  personalSign: async (signHash, signer) => ethers.utils.joinSignature(signer.signingKey.signDigest(signHash)),

  sortWalletByAddress(wallets) {
    return wallets.sort((s1, s2) => {
      const bn1 = ethers.BigNumber.from(s1);
      const bn2 = ethers.BigNumber.from(s2);
      if (bn1.lt(bn2)) return -1;
      if (bn1.gt(bn2)) return 1;
      return 0;
    });
  },

  // Parses the RelayerModule.execute receipt to decompose the success value of the transaction
  // and additionally if an error was raised in the sub-call to optionally return that
  parseRelayReceipt(txReceipt) {
    const { args } = txReceipt.logs.find((e) => e.event === "TransactionExecuted");

    let errorBytes;
    let error;
    if (args.returnData) {
      if (args.returnData.startsWith("0x08c379a0")) {
        // Remove the encoded error signatures 08c379a0
        const noErrorSelector = `0x${args.returnData.slice(10)}`;
        const errorBytesArray = ethers.utils.defaultAbiCoder.decode(["bytes"], noErrorSelector);
        errorBytes = errorBytesArray[0]; // eslint-disable-line prefer-destructuring
      } else {
        errorBytes = args.returnData;
      }
      error = ethers.utils.toUtf8String(errorBytes);
    }
    return { success: args.success, error };
  },

  async hasEvent(txReceipt, emitter, eventName) {
    const event = await this.getEvent(txReceipt, emitter, eventName);
    return expect(event, "Event does not exist in recept").to.exist;
  },

  async getEvent(txReceipt, emitter, eventName) {
    const receipt = await web3.eth.getTransactionReceipt(txReceipt.transactionHash);
    const logs = await this.decodeLogs(receipt.logs, emitter, eventName);
    const event = logs.find((e) => e.event === eventName);
    return event;
  },

  // Copied from https://github.com/OpenZeppelin/openzeppelin-test-helpers
  // This decodes longs for a single event type, and returns a decoded object in
  // the same form truffle-contract uses on its receipts
  decodeLogs(logs, emitter, eventName) {
    let address;

    const { abi } = emitter;
    try {
      address = emitter.address;
    } catch (e) {
      address = null;
    }

    const eventABIs = abi.filter((x) => x.type === "event" && x.name === eventName);
    if (eventABIs.length === 0) {
      throw new Error(`No ABI entry for event '${eventName}'`);
    } else if (eventABIs.length > 1) {
      throw new Error(`Multiple ABI entries for event '${eventName}', only uniquely named events are supported`);
    }

    const [eventABI] = eventABIs;

    // The first topic will equal the hash of the event signature
    const eventSignature = `${eventName}(${eventABI.inputs.map((input) => input.type).join(",")})`;
    const eventTopic = web3.utils.sha3(eventSignature);

    // Only decode events of type 'EventName'
    return logs
      .filter((log) => log.topics.length > 0 && log.topics[0] === eventTopic && (!address || log.address === address))
      .map((log) => web3.eth.abi.decodeLog(eventABI.inputs, log.data, log.topics.slice(1)))
      .map((decoded) => ({ event: eventName, args: decoded }));
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

  async getBalance(account) {
    const balance = await web3.eth.getBalance(account);
    return new BN(balance);
  },

  async getTimestamp(blockNumber) {
    const blockN = !blockNumber ? "latest" : blockNumber;
    const { timestamp } = await web3.eth.getBlock(blockN);
    return timestamp;
  },

  async getChainId() {
    // TODO: The web3 version packaged with truffle is 1.2.1 while the getChainId logic
    // we need here was introduced in 1.2.2
    // Uncomment when https://github.com/trufflesuite/truffle/issues/2688#issuecomment-709879003 is resolved
    // const chainId = await web3.eth.getChainId();
    // console.log("chainId", chainId)
    // return chainId;
    return 1895;
  },

  async web3GetClient() {
    return new Promise((resolve, reject) => {
      web3.eth.getNodeInfo((err, res) => {
        if (err !== null) return reject(err);
        return resolve(res);
      });
    });
  },

  async increaseTime(seconds) {
    const client = await this.web3GetClient();
    const p = new Promise((resolve, reject) => {
      if (client.indexOf("TestRPC") === -1) {
        console.warning("Client is not ganache-cli and cannot forward time");
      } else {
        web3.currentProvider.send(
          {
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [seconds],
            id: 0,
          },
          (err) => {
            if (err) {
              return reject(err);
            }
            return web3.currentProvider.send(
              {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [],
                id: 0,
              },
              (err2, res) => {
                if (err2) {
                  return reject(err2);
                }
                return resolve(res);
              }
            );
          }
        );
      }
    });
    return p;
  },

  async getNonceForRelay() {
    const block = await web3.eth.getBlockNumber();
    const timestamp = new Date().getTime();
    return `0x${ethers.utils.hexZeroPad(ethers.utils.hexlify(block), 16)
      .slice(2)}${ethers.utils.hexZeroPad(ethers.utils.hexlify(timestamp), 16).slice(2)}`;
  },

  async getAccount(index) {
    const accounts = await web3.eth.getAccounts();
    return accounts[index];
  }
};
