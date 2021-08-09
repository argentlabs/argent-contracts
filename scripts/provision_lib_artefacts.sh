DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd $DIR
cd ..

cp lib_0.5/uniswap/UniswapExchange.json build/contracts/UniswapExchange.json
cp lib_0.5/uniswap/UniswapFactory.json build/contracts/UniswapFactory.json
cp lib_0.7/uniV3/UniswapV3Factory.json build/contracts/UniswapV3Factory.json
cp lib_0.7/uniV3/SwapRouter.json build/contracts/SwapRouter.json