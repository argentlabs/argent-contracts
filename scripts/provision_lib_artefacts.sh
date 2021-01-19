DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd $DIR
cd ..

cp lib/uniswap/UniswapExchange.json build/contracts/UniswapExchange.json
cp lib/uniswap/UniswapFactory.json build/contracts/UniswapFactory.json