// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.5.4;


/**
* @title Liquid staking pool implementation
*
* Lido is an Ethereum 2.0 liquid staking protocol solving the problem of frozen staked Ethers
* until transfers become available in Ethereum 2.0.
* Whitepaper: https://lido.fi/static/Lido:Ethereum-Liquid-Staking.pdf
*
* NOTE: the code below assumes moderate amount of node operators, e.g. up to 50.
*
* Since balances of all token holders change when the amount of total pooled Ether
* changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
* events upon explicit transfer between holders. In contrast, when Lido oracle reports
* rewards, no Transfer events are generated: doing so would require emitting an event
* for each token holder and thus running an unbounded loop.
*/
interface ILido {
    function submit(address referral) external;

    function balanceOf(address user) external view returns (uint256);

    function approve(address user, uint256 amount) external returns (bool success);
}