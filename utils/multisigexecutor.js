const ethers = require("ethers");
const inquirer = require("inquirer");
const utils = require("./utilities.js");

class MultisigExecutor {
  constructor(multisigWrapper, ownerAccount, autoSign = true, setupGas = false) {
    this._multisigWrapper = multisigWrapper;
    this._multisigWrapper.constructor.defaults({ gasLimit: 1000000 });
    this._ownerAccount = ownerAccount;
    this._autoSign = autoSign;
    this._setupGas = setupGas;
  }

  async executeCall(contractWrapper, method, params) {
    // Encode the method call with its parameters
    const data = contractWrapper.contract.methods[method](...params).encodeABI();

    // Get the nonce
    const nonce = (await this._multisigWrapper.nonce()).toNumber();

    // Get the sign Hash
    const signHash = MultisigExecutor.signHash(this._multisigWrapper.address, contractWrapper.address, 0, data, nonce);

    let signatures;
    let estimateGas;
    if (this._autoSign === true) {
      // Get the off chain signature
      signatures = await utils.signMessage(signHash, this._ownerAccount);
    } else {
      // Get the threshold
      const threshold = (await this._multisigWrapper.threshold()).toNumber();

      console.log("******* MultisigExecutor *******");
      console.log(`Signing data for transaction to ${contractWrapper.constructor.contractName} located at ${contractWrapper.address}:`);
      console.log(`multisig: ${this._multisigWrapper.address}`);
      console.log(`to:       ${contractWrapper.address}`);
      console.log("value:    0");
      console.log(`data:     ${data}`);
      console.log(`nonce:    ${nonce}`);
      console.log(`SignHash: ${signHash}`);
      console.log(`Required signatures: ${threshold}`);
      console.log("********************************");

      estimateGas = await web3.eth.estimateGas({ from: this._multisigWrapper.address, to: contractWrapper.address, data });
      console.log(`Gas Estimate Direct: ${estimateGas}`);

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

      signatures = `0x${sortedSignatures.map((s) => s.sig.slice(2)).join("")}`;
    }

    const options = {};
    if (this._setupGas) {
      try {
        estimateGas = await this._multisigWrapper.execute.estimateGas(contractWrapper.address, 0, data, signatures);
      } catch (error) {
        console.error("GAS ESTIMATE FAILED", error);
        estimateGas += 100000;
      }

      const { gasPriceGwei, gasLimit } = await inquirer.prompt([{
        type: "number",
        name: "gasLimit",
        message: "Gas Limit",
        default: estimateGas.toString(),
      }, {
        type: "number",
        name: "gasPriceGwei",
        message: "Gas Price (gwei)",
        default: 50,
      }]);

      options.gas = parseInt(gasLimit, 10);
      options.gasPrice = web3.utils.toWei(String(gasPriceGwei), "gwei");

      const executeTransaction = await this._multisigWrapper.execute(contractWrapper.address, 0, data, signatures, options);
      return executeTransaction.receipt;
    }

    // // Call "execute" on the Multisig wallet with data and signatures
    const executeTransaction = await this._multisigWrapper.execute(contractWrapper.address, 0, data, signatures);

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

    return ethers.utils.keccak256(input);
  }
}

module.exports = MultisigExecutor;
