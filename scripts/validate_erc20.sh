// ///////////////////////////////////////////////////////////////////
// Script to print environment configuration from AWS.
//
// Can be executed (from the project root as we're loading .env file from root via `dotenv`) as:
// bash ./scripts/execute_script.sh --no-compile scripts/configReader.js <network>
//
// where:
//     - network = [test, staging, prod]
// note: ganache configuration in solution under ./utils/config/ganache.json
// ////////////////////////////////////////////////////////////////////

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

require("dotenv").config();

async function main() {
  const response = await fetch("https://cloud.argent-api.com/v1/tokens/dailyLimit");
  const jsonTokens = await response.json();

 // jsonTokens.tokens.forEach(async (token) => {
   const token = jsonTokens.tokens[0];
    const resultEtherScan = await fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${token.address}&apikey=${process.env.ETHERSCAN_API_KEY}`);
    const jsonEtherScan = await resultEtherScan.json();
    
    const contractName = jsonEtherScan.result[0].ContractName;
    const contractSourceCode = jsonEtherScan.result[0].SourceCode;

    const fileName = `${contractName}.sol`;
    const newPath = path.join(__dirname, "./temp");

    fs.mkdirSync(newPath);

    const filePath = path.join(__dirname, "./temp", fileName);
    console.log("filePath", filePath)
    console.log("contractName", contractName)
    fs.writeFileSync(filePath, contractSourceCode);
    
    sendToPython(filePath, contractName); // --erc 20
    fs.unlinkSync(filePath);
 // });

    fs.rmdirSync(newPath);
}

function sendToPython(_filePath, _contractName) {
  var python = require('child_process').spawn('python', ['./slither-check-erc', _filePath, _contractName]);
  python.stdout.on('data', function (data) {
    console.log("Python response: ", data.toString('utf8'));
    result.textContent = data.toString('utf8');
  });

  python.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  python.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });

}

main().catch((err) => {
  throw err;
});
