// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ProjectTimelock
 * @dev Central Governance Contract (Single source of truth)
 *
 * Controls all admin actions for:
 * - Sale
 * - Token
 * - Vesting
 * - Airdrop
 *
 * Delay ensures 48h governance security window.
 */
contract ProjectTimelock is TimelockController {

    // ═════════════════════ CONSTRUCTOR ═════════════════════
    constructor(
        uint256 minDelay,            // e.g. 48 hours
        address[] memory proposers,  // governance wallets / multisig
        address[] memory executors,  // usually same as proposers or open
        address admin                // initial admin (later renounced recommended)
    )
        TimelockController(
            minDelay,
            proposers,
            executors,
            admin
        )
    {}
}