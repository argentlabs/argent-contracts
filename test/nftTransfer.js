const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const GuardianStorage = require("../build/GuardianStorage");
const NftModule = require("../build/NftTransfer");

const ERC721 = require("../build/TestERC721");

const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");

describe("Test Token Transfer", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let owner = accounts[1].wallet;
    let recipient = accounts[2].wallet;
    let nftModule, wallet, erc721;

    const tokenId = 1;

    before(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);

        const guardianStorage = await deployer.deploy(GuardianStorage);
        nftModule = await deployer.deploy(NftModule, {},
            registry.contractAddress,
            guardianStorage.contractAddress,
        );
    });

    beforeEach(async () => {
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [nftModule.contractAddress]);
        erc721 = await deployer.deploy(ERC721);
        await erc721.mint(wallet.contractAddress, tokenId);
    });


    describe("NFT transfers", () => {
        async function testNftTransfer(safe) {
            let beforeWallet = await erc721.balanceOf(wallet.contractAddress);
            let beforeRecipient = await erc721.balanceOf(recipient.address);
            await nftModule.from(owner).transferNFT(wallet.contractAddress, erc721.contractAddress, recipient.address, tokenId, safe, ZERO_BYTES32);
            let afterWallet = await erc721.balanceOf(wallet.contractAddress);
            let afterRecipient = await erc721.balanceOf(recipient.address);
            assert.equal(beforeWallet.sub(afterWallet).toNumber(), 1, `wallet should have one less NFT (safe transfer: ${safe})`);
            assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe transfer: ${safe})`);
        }

        it('should allow safe NFT transfer from the owner', async () => {
            await testNftTransfer(false);
        });

        it('should allow unsafe NFT transfer from the owner', async () => {
            await testNftTransfer(true);
        });

        async function testRelayedNftTransfer(safe) {
            let beforeWallet = await erc721.balanceOf(wallet.contractAddress);
            let beforeRecipient = await erc721.balanceOf(recipient.address);
            await nftModule.from(owner).transferNFT(wallet.contractAddress, erc721.contractAddress, recipient.address, tokenId, safe, ZERO_BYTES32);
            await manager.relay(nftModule, 'transferNFT', [wallet.contractAddress, erc721.contractAddress, recipient.address, tokenId, safe, ZERO_BYTES32], wallet, [owner]);
            let afterWallet = await erc721.balanceOf(wallet.contractAddress);
            let afterRecipient = await erc721.balanceOf(recipient.address);
            assert.equal(beforeWallet.sub(afterWallet).toNumber(), 1, `wallet should have one less NFT (relayed; safe transfer: ${safe})`);
            assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (relayed; safe transfer: ${safe})`);
        }


        it('should allow safe NFT transfer from the owner (relayed)', async () => {
            await testRelayedNftTransfer(false);
        });

        it('should allow unsafe NFT transfer from the owner (relayed)', async () => {
            await testRelayedNftTransfer(true);
        });
    });

});