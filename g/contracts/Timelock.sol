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
 *
 * Architecture:
 * - Proposers: Multi-sig wallet (Safe)
 * - Executors: Multi-sig wallet (Safe) - NOT open
 * - Admin: Deployer initially, then renounced
 * - Canceller: Guardian address for emergency
 */
contract ProjectTimelock is TimelockController {

    // ═════════════════════ CONSTANTS ═════════════════════
    uint256 public constant MINIMUM_DELAY = 48 hours;

    // ═════════════════════ ERRORS ═════════════════════
    error Timelock__DelayTooShort();
    error Timelock__ZeroAddress();
    error Timelock__OpenExecutorNotAllowed();
    error Timelock__ProposerCannotBeExecutor();

    // ═════════════════════ EVENTS ═════════════════════
    event AdminRenounced(address indexed admin);
    event GuardianSet(address indexed guardian);

    // ═════════════════════ STATE ═════════════════════
    address public guardian;

    // ═════════════════════ CONSTRUCTOR ═════════════════════
    constructor(
        uint256 minDelay,            // e.g. 48 hours
        address[] memory proposers,  // Safe multisig
        address[] memory executors,  // Safe multisig (NOT address(0))
        address admin                // initial admin (renounced after setup)
    )
        TimelockController(
            minDelay,
            proposers,
            executors,
            admin
        )
    {
        // PATCH-TL2: Prevent open executors (address(0))
        for (uint256 i = 0; i < executors.length; i++) {
            if (executors[i] == address(0)) revert Timelock__OpenExecutorNotAllowed();
        }

        // PATCH-TL1: Enforce minimum delay
        if (minDelay < MINIMUM_DELAY) revert Timelock__DelayTooShort();

        // Validate proposers and executors are not zero
        if (proposers.length == 0) revert Timelock__ZeroAddress();
        if (executors.length == 0) revert Timelock__ZeroAddress();

        // Set guardian as first proposer (can be changed later)
        if (proposers.length > 0) {
            guardian = proposers[0];
            emit GuardianSet(guardian);
        }
    }

    // ═════════════════════ GUARDIAN MANAGEMENT ═════════════════════

    /**
     * @notice Set a dedicated guardian address for emergency cancellation
     * @param _guardian The address that can cancel proposals
     */
    function setGuardian(address _guardian) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        if (_guardian == address(0)) revert Timelock__ZeroAddress();
        guardian = _guardian;
        emit GuardianSet(_guardian);
    }

    /**
     * @notice Grant canceller role to guardian
     * @param _guardian The address to grant canceller role
     */
    function grantCancellerRole(address _guardian) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        if (_guardian == address(0)) revert Timelock__ZeroAddress();
        _grantRole(CANCELLER_ROLE, _guardian);
    }

    /**
     * @notice Revoke canceller role from address
     * @param _guardian The address to revoke canceller role from
     */
    function revokeCancellerRole(address _guardian) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        _revokeRole(CANCELLER_ROLE, _guardian);
    }

    // ═════════════════════ ADMIN RENOUNCEMENT ═════════════════════

    /**
     * @notice Renounce admin role - CALL THIS AFTER SETUP
     * @dev PATCH-TL3: Must be called by deployer after all roles are configured
     * This ensures no single entity has admin control
     */
    function renounceAdminRole() external onlyRole(TIMELOCK_ADMIN_ROLE) {
        renounceRole(TIMELOCK_ADMIN_ROLE, msg.sender);
        emit AdminRenounced(msg.sender);
    }

    // ═════════════════════ ROLE SEPARATION HELPERS ═════════════════════

    /**
     * @notice Check if an address has proposer role
     */
    function isProposer(address account) external view returns (bool) {
        return hasRole(PROPOSER_ROLE, account);
    }

    /**
     * @notice Check if an address has executor role
     */
    function isExecutor(address account) external view returns (bool) {
        return hasRole(EXECUTOR_ROLE, account);
    }

    /**
     * @notice Check if an address has canceller role
     */
    function isCanceller(address account) external view returns (bool) {
        return hasRole(CANCELLER_ROLE, account);
    }

    /**
     * @notice Get all role holders (helper for verification)
     */
    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        uint256 count = getRoleMemberCount(role);
        address[] memory members = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            members[i] = getRoleMember(role, i);
        }
        return members;
    }

    // ═════════════════════ EMERGENCY FUNCTIONS ═════════════════════

    /**
     * @notice Emergency cancel all pending operations
     * @dev Only callable by guardian (canceller role)
     * @param operationIds Array of operation ids to cancel
     */
    function emergencyCancelBatch(bytes32[] calldata operationIds) external onlyRole(CANCELLER_ROLE) {
        for (uint256 i = 0; i < operationIds.length; i++) {
            if (isOperationPending(operationIds[i])) {
                _cancel(operationIds[i]);
            }
        }
    }

    // ═════════════════════ OVERRIDE SAFETY ═════════════════════

    /**
     * @notice Override renounceRole to add safety check
     * @dev Prevents accidental renouncement of critical roles
     */
    function renounceRole(bytes32 role, address account) public override {
        // Prevent renouncing the last proposer/executor
        if (role == PROPOSER_ROLE && getRoleMemberCount(PROPOSER_ROLE) <= 1) {
            revert("CANNOT_RENOUNCE_LAST_PROPOSER");
        }
        if (role == EXECUTOR_ROLE && getRoleMemberCount(EXECUTOR_ROLE) <= 1) {
            revert("CANNOT_RENOUNCE_LAST_EXECUTOR");
        }
        
        super.renounceRole(role, account);
    }
}