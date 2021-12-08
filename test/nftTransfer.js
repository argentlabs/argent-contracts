const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const GuardianStorage = require("../build/GuardianStorage");
const NftModule = require("../build/NftTransfer");

const ERC721 = require("../build/TestERC721");
const CK = require("../build/CryptoKittyTest");
const ERC20 = require("../build/TestERC20");
const ERC20Approver = require("../build/ERC20Approver");

const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

describe("Test Token Transfer", function () {
    this.timeout(10000);

    const manager = new TestManager();

    const owner1 = accounts[1].signer;
    const owner2 = accounts[2].signer;
    const eoaRecipient = accounts[3].signer;

    let nftModule, wallet1, wallet2, erc721, erc20, erc20Approver;

    const tokenId = 1;


    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);

        const guardianStorage = await deployer.deploy(GuardianStorage);
        nftModule = await deployer.deploy(NftModule, {},
            registry.contractAddress,
            guardianStorage.contractAddress
        );
        erc20Approver = await deployer.deploy(ERC20Approver, {}, registry.contractAddress);
    });

    beforeEach(async () => {
        wallet1 = await deployer.deploy(Wallet);
        wallet2 = await deployer.deploy(Wallet);
        await wallet1.init(owner1.address, [nftModule.contractAddress, erc20Approver.contractAddress]);
        await wallet2.init(owner2.address, [nftModule.contractAddress]);
        erc721 = await deployer.deploy(ERC721);
        await erc721.mint(wallet1.contractAddress, tokenId);
    });


    describe("NFT transfers", () => {
        async function testNftTransfer({ safe = true, relayed, recipientAddress, nftContract = erc721, nftId = tokenId, shouldSucceed = true }) {
            let beforeWallet1 = await nftContract.balanceOf(wallet1.contractAddress);
            let beforeRecipient = await nftContract.balanceOf(recipientAddress);
            if (relayed) {
                const txReceipt = await manager.relay(nftModule, 'transferNFT', [wallet1.contractAddress, nftContract.contractAddress, recipientAddress, nftId, safe, ZERO_BYTES32], wallet1, [owner1]);
                const success = parseRelayReceipt(txReceipt);
                assert.equal(success, shouldSucceed)
            } else {
                const txPromise = nftModule.from(owner1).transferNFT(wallet1.contractAddress, nftContract.contractAddress, recipientAddress, nftId, safe, ZERO_BYTES32);
                shouldSucceed && await txPromise || assert.revert(txPromise);
            }
            if (shouldSucceed) {
                let afterWallet1 = await nftContract.balanceOf(wallet1.contractAddress);
                let afterRecipient = await nftContract.balanceOf(recipientAddress);
                assert.equal(beforeWallet1.sub(afterWallet1).toNumber(), 1, `wallet1 should have one less NFT (safe: ${safe}, relayed: ${relayed})`);
                assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe: ${safe}, relayed: ${relayed})`);
            }
        }

        describe("transfer to EOA account", () => {
            it('should allow unsafe NFT transfer from wallet1 to an EOA account', async () => {
                await testNftTransfer({ safe: false, relayed: false, recipientAddress: eoaRecipient.address });
            });

            it('should allow safe NFT transfer from wallet1 to an EOA account', async () => {
                await testNftTransfer({ safe: true, relayed: false, recipientAddress: eoaRecipient.address });
            });


            it('should allow unsafe NFT transfer from wallet1 to an EOA account (relayed)', async () => {
                await testNftTransfer({ safe: false, relayed: true, recipientAddress: eoaRecipient.address });
            });

            it('should allow safe NFT transfer from wallet1 to an EOA account (relayed)', async () => {
                await testNftTransfer({ safe: true, relayed: true, recipientAddress: eoaRecipient.address });
            });
        });

        describe("transfer to other wallet", () => {
            it('should allow unsafe NFT transfer from wallet1 to wallet2', async () => {
                await testNftTransfer({ safe: false, relayed: false, recipientAddress: wallet2.contractAddress });
            });

            it('should allow safe NFT transfer from wallet1 to wallet2', async () => {
                await testNftTransfer({ safe: true, relayed: false, recipientAddress: wallet2.contractAddress });
            });

            it('should allow unsafe NFT transfer from wallet1 to wallet2 (relayed)', async () => {
                await testNftTransfer({ safe: false, relayed: true, recipientAddress: wallet2.contractAddress });
            });

            it('should allow safe NFT transfer from wallet1 to wallet2 (relayed)', async () => {
                await testNftTransfer({ safe: true, relayed: true, recipientAddress: wallet2.contractAddress });
            });
        });

        describe("Protecting from transferFrom hijacking", () => {
            beforeEach(async () => {
                erc20 = await deployer.deploy(ERC20, {}, [wallet1.contractAddress], 1000, 18);
                await erc20Approver.from(owner1).approveERC20(
                    wallet1.contractAddress,
                    erc20.contractAddress,
                    wallet1.contractAddress, // spender
                    100, { gasLimit: 1000000 }); // amount
            });

            it('should NOT allow ERC20 transfer from wallet1 to wallet2', async () => {
                await testNftTransfer({ shouldSucceed: false, safe: false, relayed: false, nftId: 100, nftContract: erc20, recipientAddress: wallet2.contractAddress });
            });

            it('should NOT allow ERC20 transfer from wallet1 to wallet2 (relayed)', async () => {
                await testNftTransfer({ shouldSucceed: false, safe: false, relayed: true, nftId: 100, nftContract: erc20, recipientAddress: wallet2.contractAddress });
            });

        });
    });

});