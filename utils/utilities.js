const ethers = require('ethers');
const readline = require('readline');
const ethereumUtil = require('ethereumjs-util');

module.exports = {

    namehash: function (_name) {
        return ethers.utils.namehash(_name);
    },

    sha3: (input) => {
        if (ethers.utils.isHexString(input)) {
            return ethers.utils.keccak256(input);
        }
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(input));
    },

    asciiToBytes32: (input) => {
        return ethers.utils.formatBytes32String(input);
        //return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(input));
    },

    bigNumToBytes32: (input) => {
        return ethers.utils.hexZeroPad(input.toHexString(), 32)
    },

    waitForUserInput: (text) => {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            rl.question(text, (answer) => {
                resolve(answer);
                rl.close();
            });
        });
    },

    signOffchain: async (signers, from, to, value, data, nonce, gasPrice, gasLimit) => {
        let input = '0x' + [
            '0x19',
            '0x00',
            from,
            to,
            ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
            data,
            nonce,
            ethers.utils.hexZeroPad(ethers.utils.hexlify(gasPrice), 32),
            ethers.utils.hexZeroPad(ethers.utils.hexlify(gasLimit), 32)
        ].map(hex => hex.slice(2)).join("");

        let signedData = ethers.utils.keccak256(input);

        const tasks = signers.map(signer => signer.signMessage(ethers.utils.arrayify(signedData)));
        const signatures = await Promise.all(tasks);
        const sigs = "0x" + signatures.map(signature => {
            const split = ethers.utils.splitSignature(signature);
            return ethers.utils.joinSignature(split).slice(2);
        }).join("");

        return sigs;
    },

    sortWalletByAddress(wallets) {
        return wallets.sort((s1, s2) => {
            const bn1 = ethers.utils.bigNumberify(s1.address);
            const bn2 = ethers.utils.bigNumberify(s2.address);
            if (bn1.lt(bn2)) return -1;
            if (bn1.gt(bn2)) return 1;
            return 0;
        });
    },

    parseRelayReceipt(txReceipt) {
        return txReceipt.events.find(l => l.event === 'TransactionExecuted').args.success;
    },

    versionFingerprint(modules) {
        let concat = modules.map((module) => {
            return module.address;
        }).sort((m1, m2) => {
            const bn1 = ethers.utils.bigNumberify(m1);
            const bn2 = ethers.utils.bigNumberify(m2);
            if (bn1.lt(bn2)) {
                return 1;
            }
            if (bn1.gt(bn2)) {
                return -1;
            }
            return 0;
        }).reduce((prevValue, currentValue) => {
            return prevValue + currentValue.slice(2);
        }, "0x");
        return ethers.utils.keccak256(concat).slice(0, 10);
    },
    getRandomAddress() {
        const addressBuffer = ethereumUtil.generateAddress(Math.floor(Math.random() * (100 - 0)));
        const addressHex = ethereumUtil.bufferToHex(addressBuffer);
        return ethereumUtil.toChecksumAddress(addressHex);
    }
}
