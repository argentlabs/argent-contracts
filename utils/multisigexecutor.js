const ethers = require("ethers");
const inquirer = require("inquirer");
const utils = require("./utilities.js");

class MultisigExecutor {
  constructor(multisigWrapper, ownerWallet, autoSign = true, overrides = {}) {
    this._multisigWrapper = multisigWrapper;
    this._ownerWallet = ownerWallet;
    this._autoSign = autoSign;
    this._overrides = { gasLimit: 1000000, ...overrides };
  }

  async executeCall(contractWrapper, method, params) {
    // Encode the method call with its parameters
    const data = contractWrapper.contract.methods[method](params).encodeABI();

    // Get the nonce
    const nonce = (await this._multisigWrapper.nonce()).toNumber();

    // Get the sign Hash
    const signHash = MultisigExecutor.signHash(this._multisigWrapper.address, contractWrapper.address, 0, data, nonce);

    if (this._autoSign === true) {
      // Get the off chain signature
      let signature = await utils.signMessageHash(this._ownerWallet, signHash);

      // to make sure signature ends with 27/28
      const split = ethers.utils.splitSignature(signature);
      signature = ethers.utils.joinSignature(split);

      // Call "execute" on the Multisig wallet with data and signatures
      const executeTransaction = await this._multisigWrapper.execute(contractWrapper.address, 0, data, signature, this._overrides);

      return executeTransaction.receipt;
    }
    // Get the threshold
    const threshold = (await this._multisigWrapper.threshold()).toNumber();

    console.log("******* MultisigExecutor *******");
    console.log(`Signing data for transaction to ${contractWrapper._contract.contractName} located at ${contractWrapper.address}:`);
    console.log(`multisig: ${this._multisigWrapper.address}`);
    console.log(`to:       ${contractWrapper.address}`);
    console.log("value:    0");
    console.log(`data:     ${data}`);
    console.log(`nonce:    ${nonce}`);
    console.log(`SignHash: ${signHash}`);
    console.log(`Required signatures: ${threshold}`);
    console.log("********************************");

    const signaturesOutput = await inquirer.prompt(Array(threshold).fill(0).map((value, index) => ({
      type: "input",
      name: `signature_${index}`,
      message: `Please provide signature ${index + 1}/${threshold}`,
    })));

    const parsedSignatures = Object.values(signaturesOutput).map((signature) => JSON.parse(signature));
    const sortedSignatures = parsedSignatures.sort((s1, s2) => {
      const bn1 = ethers.BigNumber.from(s1.address);
      const bn2 = ethers.BigNumber.from(s2.address);
      if (bn1.lt(bn2)) return -1;
      if (bn1.gt(bn2)) return 1;
      return 0;
    });

    const signatures = `0x${sortedSignatures.map((s) => s.sig.slice(2)).join("")}`;

    // Call "execute" on the Multisig wallet with data and signatures
    const executeTransaction = await this._multisigWrapper.execute(contractWrapper.address, 0, data, signatures, this._overrides);

    return executeTransaction.receipt;
  }

  static signHash(walletAddr, destinationAddr, value, data, nonce) {
    const input = `0x${[
      "0x19",
      "0x00",
      walletAddr,
      destinationAddr,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
      data,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(nonce), 32),
    ].map((hex) => hex.slice(2)).join("")}`;

    return input;
  }
}

module.exports = MultisigExecutor;
