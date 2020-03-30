const ENSRegistry = require('../build/ENSRegistry');
const ENSRegistryWithFallback = require('../build/ENSRegistryWithFallback');
const Kyber = require('../build/KyberNetworkTest');
const ERC20 = require('../build/TestERC20');
const MakerMigration = require('../build/MockScdMcdMigration');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');

const TEST_ERC20_SUPPLY = 1000000000; //10**9
const TEST_ERC20_DECIMALS = 10;
const TEST_ERC20_RATE = 6 * 10**14; // 1 AGT = 0.0006 ETH

const BYTES32_NULL = '0x0000000000000000000000000000000000000000000000000000000000000000';

// For development purpose
async function deployENSRegistry(deployer, owner, domain) {
	// Deploy the public ENS registry
	const ensRegistryWithoutFallback = await deployer.deploy(ENSRegistry);
    const ENSWrapper = await deployer.deploy(ENSRegistryWithFallback, {}, ensRegistryWithoutFallback.contractAddress);

	// ENS domain
	const parts = domain.split('.');
	const extension = parts[1];
	const domainName = parts[0];

	// Create the 'eth' and 'xyz' namespaces
	const setSubnodeOwnerXYZ = await ENSWrapper.contract.setSubnodeOwner(BYTES32_NULL, utils.sha3(extension), owner);
	await ENSWrapper.verboseWaitForTransaction(setSubnodeOwnerXYZ, `Setting Subnode Owner for ${extension}`);

	// Create the 'argentx.xyz' wallet ENS namespace
	const setSubnodeOwnerArgent = await ENSWrapper.contract.setSubnodeOwner(utils.namehash(extension), utils.sha3(domainName), owner);
	await ENSWrapper.verboseWaitForTransaction(setSubnodeOwnerArgent, `Setting Subnode Owner for ${domainName}.${extension}`);

	return ENSWrapper.contractAddress;
}

// For development purpose
async function deployKyber(deployer) {
    const KyberWrapper = await deployer.deploy(Kyber);
	const ERC20Wrapper = await deployer.deploy(ERC20, {}, [KyberWrapper.contractAddress], TEST_ERC20_SUPPLY, TEST_ERC20_DECIMALS);

	const addToken = await KyberWrapper.contract.addToken(ERC20Wrapper.contractAddress, TEST_ERC20_RATE, TEST_ERC20_DECIMALS);
	await KyberWrapper.verboseWaitForTransaction(addToken, 'Add test token to Kyber');

    return KyberWrapper.contractAddress;
}

const deploy = async (network, secret) => {

	const manager = new DeployManager(network);
	await manager.setup();

	const configurator = manager.configurator;
	const deployer = manager.deployer;

	const config = configurator.config;

	const deploymentAccount = await deployer.signer.getAddress();

	if (config.ENS.deployOwnRegistry) {
		// on some testnets, we use our own ENSRegistry
        const address = await deployENSRegistry(deployer, deploymentAccount, config.ENS.domain);
        configurator.updateENSRegistry(address);
    }

    if (config.Kyber.deployOwn) {
        // Deploy Kyber Network if needed
        const address = await deployKyber(deployer);
        configurator.updateKyberContract(address);
	}
	
	if (config.defi.maker.deployOwn) {
        // Deploy Maker's mock Migration contract if needed
		const MakerMigrationWrapper = await deployer.deploy(MakerMigration);
        configurator.updateMakerMigration(MakerMigrationWrapper.contractAddress);
	}

    // save configuration
    await configurator.save();
};

module.exports = {
	deploy
};