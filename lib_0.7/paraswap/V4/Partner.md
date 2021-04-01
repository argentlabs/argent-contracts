# Partner contract Specifications

## Introduction
paraswap.io wants to allows it's partners to monetize the protocol using their referral id.

    1. The contract should allow ParaSwap's partners to monetise the transactions.
    2. Each partner should be registered on a smart contract and tracked using the referrer parameter which is a string.
    3. Each partner should have a specific contract instance
    4. Fees slices for Partner should be set when registering the partner (default = 20% for ParaSwap, 80% for the Partner).
    5. The slice distribution could not be changed by both parties
    6. The partner should have the freedom to set the fees they want
    7. The partner should be able to set their fee wallet
    8. The partner should be able to transfer ownership
    9. ParaSwap should not have any control of over the partner fee, partner admin and wallet
    10. ParaSwap could terminate a partnership by removing the referral from the partners list.
    11. After each swap, if the partner fee > 0, the partner's slice should be redirected to their wallet (80% for instance) and the rest is sent to a ParaSwap wallet
    12. The ParaSwap wallet is controlled by ParaSwap deployer wallet
    13. Each partner contract will be controlled by an admin wallet. Partner will hold key to that wallet