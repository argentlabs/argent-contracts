pragma solidity ^0.7.0;

contract UniswapCreate2Check {
    function test() external pure returns (address[4] memory result) {
        address token0 = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
        address token1 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        result[0] = address(uint(keccak256(abi.encodePacked(
            hex"ff",
            0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f, //UniswapV2 factory
            keccak256(abi.encodePacked(token0, token1)),
            hex"96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f"
        )))); //0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc
        result[1] = address(uint(keccak256(abi.encodePacked(
            hex"ff",
            0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac, //SushiSwap factory
            keccak256(abi.encodePacked(token0, token1)),
            hex"e18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303"
        )))); //0x397FF1542f962076d0BFE58eA045FfA2d347ACa0
        result[2] = address(uint(keccak256(abi.encodePacked(
            hex"ff",
            0x696708Db871B77355d6C2bE7290B27CF0Bb9B24b, //LinkSwap factory
            keccak256(abi.encodePacked(token0, token1)),
            hex"50955d9250740335afc702786778ebeae56a5225e4e18b7cb046e61437cde6b3"
        )))); //0x466d82B7D15Af812FB6c788D7b15C635FA933499
        result[3] = address(uint(keccak256(abi.encodePacked(
            hex"ff",
            0x9DEB29c9a4c7A88a3C0257393b7f3335338D9A9D, //DefiSwap factory
            keccak256(abi.encodePacked(token0, token1)),
            hex"69d637e77615df9f235f642acebbdad8963ef35c5523142078c9b8f9d0ceba7e"
        )))); //0x3Aa370AacF4CB08C7E1E7AA8E8FF9418D73C7e0F
    }
}
