DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd $DIR
cd ..

while [ ! -d ./.coverage_artifacts ]; do sleep 1; done

cp build/ENSRegistry.json .coverage_artifacts/ENSRegistry.json
cp build/ENSRegistryWithFallback.json .coverage_artifacts/ENSRegistryWithFallback.json
cp build/ReverseRegistrar.json .coverage_artifacts/ReverseRegistrar.json
cp build/KyberNetworkTest.json .coverage_artifacts/KyberNetworkTest.json
cp build/TestERC20.json .coverage_artifacts/TestERC20.json
cp build/TestERC721.json .coverage_artifacts/TestERC721.json
cp build/TestContract.json .coverage_artifacts/TestContract.json
cp build/Unitroller.json .coverage_artifacts/Unitroller.json
cp build/SimplePriceOracle.json .coverage_artifacts/SimplePriceOracle.json
cp build/PriceOracleProxy.json .coverage_artifacts/PriceOracleProxy.json
cp build/Comptroller.json .coverage_artifacts/Comptroller.json
cp build/WhitePaperInterestRateModel.json .coverage_artifacts/WhitePaperInterestRateModel.json
cp build/CEther.json .coverage_artifacts/CEther.json
cp build/CErc20.json .coverage_artifacts/CErc20.json
cp build/SaiVox.json .coverage_artifacts/SaiVox.json
cp build/SaiTub.json .coverage_artifacts/SaiTub.json
cp build/WETH9.json .coverage_artifacts/WETH9.json
cp build/DSToken.json .coverage_artifacts/DSToken.json
cp build/DSValue.json .coverage_artifacts/DSValue.json
cp build/CryptoKittyTest.json .coverage_artifacts/CryptoKittyTest.json
cp build/TestRegistry.json .coverage_artifacts/TestRegistry.json
cp build/GemJoin.json .coverage_artifacts/GemJoin.json
cp build/OldTestModule.json .coverage_artifacts/OldTestModule.json
cp build/NewTestModule.json .coverage_artifacts/NewTestModule.json
cp build/NonCompliantGuardian.json .coverage_artifacts/NonCompliantGuardian.json
cp build/FaucetUser.json .coverage_artifacts/FaucetUser.json
cp build/TestCdpManager.json .coverage_artifacts/TestCdpManager.json
cp build/TestUpgradedMakerV2Manager.json .coverage_artifacts/TestUpgradedMakerV2Manager.json
cp build/ERC20Approver.json .coverage_artifacts/ERC20Approver.json
cp build/TestModuleRelayer.json .coverage_artifacts/TestModuleRelayer.json
cp build/TestOnlyOwnerModule.json .coverage_artifacts/TestOnlyOwnerModule.json
cp build/FakeWallet.json .coverage_artifacts/FakeWallet.json
cp build/LegacyBaseWallet.json .coverage_artifacts/LegacyBaseWallet.json
cp build/DS*.json .coverage_artifacts