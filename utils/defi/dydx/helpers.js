const { BigNumber } = require("bignumber.js");

const INTEGERS = {
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

function verifyNetwork(network) {
  if (!network) {
    throw new Error("No network provided");
  }
}


module.exports = {
  getRiskLimits,
  getRiskParams,
  getPolynomialParams
};
