const { BigNumber } = require("bignumber.js");

const ONE_MINUTE_IN_SECONDS = new BigNumber(60);
const ONE_HOUR_IN_SECONDS = ONE_MINUTE_IN_SECONDS.times(60);
const ONE_DAY_IN_SECONDS = ONE_HOUR_IN_SECONDS.times(24);
const ONE_YEAR_IN_SECONDS = ONE_DAY_IN_SECONDS.times(365);

const INTEGERS = {
  ONE_MINUTE_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  ONE_DAY_IN_SECONDS,
  ONE_YEAR_IN_SECONDS,
  ZERO: new BigNumber(0),
  ONE: new BigNumber(1),
  ONES_31: new BigNumber("4294967295"), // 2**32-1
  ONES_127: new BigNumber("340282366920938463463374607431768211455"), // 2**128-1
  ONES_255: new BigNumber(
    "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  ), // 2**256-1
  INTEREST_RATE_BASE: new BigNumber("1e18")
};

function decimalToString(d) {
  return new BigNumber(d).times(INTEGERS.INTEREST_RATE_BASE).toFixed(0);
}

function coefficientsToString(coefficients) {
  let m = new BigNumber(1);
  let result = new BigNumber(0);
  for (let i = 0; i < coefficients.length; i += 1) {
    result = result.plus(m.times(coefficients[i]));
    m = m.times(256);
  }
  return result.toFixed(0);
}

// ============ Network Helper Functions ============

function isDevNetwork(network) {
  verifyNetwork(network);
  return (
    network === "development" ||
    network === "test" ||
    network === "test_ci" ||
    network === "develop" ||
    network === "dev" ||
    network === "docker" ||
    network === "coverage"
  );
}

function isMainNet(network) {
  verifyNetwork(network);
  return network === "mainnet";
}

function isKovan(network) {
  verifyNetwork(network);
  return network === "kovan";
}

function isDocker(network) {
  verifyNetwork(network);
  return network === "docker";
}

function getChainId(network) {
  if (isMainNet(network)) {
    return 1;
  }
  if (isKovan(network)) {
    return 42;
  }
  if (network === "coverage") {
    return 1002;
  }
  if (network === "docker") {
    return 1313;
  }
  if (network === "test" || network === "test_ci") {
    return 1001;
  }
  throw new Error("No chainId for network", network);
}

async function getRiskLimits() {
  return {
    marginRatioMax: decimalToString("2.00"),
    liquidationSpreadMax: decimalToString("0.50"),
    earningsRateMax: decimalToString("1.00"),
    marginPremiumMax: decimalToString("2.00"),
    spreadPremiumMax: decimalToString("2.00"),
    minBorrowedValueMax: decimalToString("100.00")
  };
}

async function getRiskParams(network) {
  verifyNetwork(network);
  let mbv = "0.00";
  if (isDevNetwork(network)) {
    mbv = "0.05";
  }
  return {
    marginRatio: { value: decimalToString("0.15") },
    liquidationSpread: { value: decimalToString("0.05") },
    earningsRate: { value: decimalToString("0.90") },
    minBorrowedValue: { value: decimalToString(mbv) }
  };
}

async function getPolynomialParams(network) {
  if (isMainNet(network)) {
    return {
      maxAPR: decimalToString("0.75"), // 75%
      coefficients: coefficientsToString([0, 15, 0, 0, 0, 0, 85])
    };
  }
  return {
    maxAPR: decimalToString("1.00"), // 100%
    coefficients: coefficientsToString([0, 10, 10, 0, 0, 80])
  };
}

function getDaiPriceOracleParams(network) {
  verifyNetwork(network);
  if (isDevNetwork) {
    return {
      oasisEthAmount: decimalToString("0.01"),
      deviationParams: {
        denominator: decimalToString("1.00"),
        maximumPerSecond: decimalToString("0.0001"),
        maximumAbsolute: decimalToString("0.01")
      }
    };
  }
  return {
    oasisEthAmount: decimalToString("1.00"),
    deviationParams: {
      denominator: decimalToString("1.00"),
      maximumPerSecond: decimalToString("0.0001"),
      maximumAbsolute: decimalToString("0.01")
    }
  };
}

function getExpiryRampTime() {
  return "3600";
}

function verifyNetwork(network) {
  if (!network) {
    throw new Error("No network provided");
  }
}

function getOraclePokerAddress(network, accounts) {
  if (isMainNet(network)) {
    return "0xac89e378758c97625d5448065d92f63f4851f1e2";
  }
  if (isKovan(network)) {
    return "0xa13cc3ab215bf669764a1a56a831c1bdc95659dd";
  }
  if (isDevNetwork(network)) {
    return accounts[0];
  }
  throw new Error("Cannot find Oracle Poker");
}

function getPartiallyDelayedMultisigAddress(network) {
  if (isMainNet(network)) {
    return "0xba2906b18B069b40C6D2CAFd392E76ad479B1B53";
  }
  if (isKovan(network)) {
    return "0x3d62d8b3ef034e0fde7de8fec4f557a3e6e4efa1";
  }
  throw new Error("Cannot find Admin Multisig");
}

function getNonDelayedMultisigAddress(network) {
  if (isMainNet(network)) {
    return "0x03b24cf9fe32dd719631d52bd6705d014c49f86f";
  }
  if (isKovan(network)) {
    return "0xecc04f59c69e6ddb19d601282eb6dd4ea763ee09";
  }
  throw new Error("Cannot find Admin Multisig");
}

module.exports = {
  isDevNetwork,
  isMainNet,
  isKovan,
  isDocker,
  getChainId,
  getRiskLimits,
  getRiskParams,
  getPolynomialParams,
  getDaiPriceOracleParams,
  getExpiryRampTime,
  getOraclePokerAddress,
  getPartiallyDelayedMultisigAddress,
  getNonDelayedMultisigAddress
};
