// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ProjectTimelock
 * @dev Central Governance Contract - OZ v5 Compatible
 * 
 * Architecture:
 * - Proposers: Multi-sig wallet (Safe)
 * - Executors: Multi-sig wallet (Safe) - NOT open
 * - Admin: Deployer initially, then renounced
 * - Canceller: Guardian address for emergency
 * 
 * OZ v5 Changes:
 * - Uses EnumerableSet for role tracking (AccessControlEnumerable removed)
 * - Custom errors throughout
 * - Enhanced safety checks
 * - _grantRole and _revokeRole return bool
 */
contract ProjectTimelock is TimelockController {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ═════════════════════ CONSTANTS ═════════════════════
    uint256 public constant MINIMUM_DELAY = 5 minutes;

    // ═════════════════════ CUSTOM ERRORS ═════════════════════
    error Timelock__DelayTooShort();
    error Timelock__ZeroAddress();
    error Timelock__OpenExecutorNotAllowed();
    error Timelock__EmptyArray();
    error Timelock__CannotRenounceLastProposer();
    error Timelock__CannotRenounceLastExecutor();
    error Timelock__OperationNotPending();
    error Timelock__RoleNotGranted();

    // ═════════════════════ EVENTS ═════════════════════
    event AdminRenounced(address indexed admin);
    event GuardianSet(address indexed guardian);
    event EmergencyCancelled(bytes32[] operationIds);

    // ═════════════════════ STATE ═════════════════════
    address public guardian;
    
    // OZ v5: Manual tracking using EnumerableSet (AccessControlEnumerable removed)
    mapping(bytes32 => EnumerableSet.AddressSet) private _roleMembers;

    // ═════════════════════ CONSTRUCTOR ═════════════════════
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    )
        TimelockController(
            minDelay,
            proposers,
            executors,
            admin
        )
    {
        // Validate arrays
        if (proposers.length == 0) revert Timelock__EmptyArray();
        if (executors.length == 0) revert Timelock__EmptyArray();

        // Prevent open executors
        for (uint256 i = 0; i < executors.length; i++) {
            if (executors[i] == address(0)) revert Timelock__OpenExecutorNotAllowed();
        }

        // Enforce minimum delay
        if (minDelay < MINIMUM_DELAY) revert Timelock__DelayTooShort();

        // Set guardian
        guardian = proposers[0];
        emit GuardianSet(guardian);
        
        // Track initial members in EnumerableSet
        for (uint256 i = 0; i < proposers.length; i++) {
            _roleMembers[PROPOSER_ROLE].add(proposers[i]);
        }
        for (uint256 i = 0; i < executors.length; i++) {
            _roleMembers[EXECUTOR_ROLE].add(executors[i]);
        }
        _roleMembers[DEFAULT_ADMIN_ROLE].add(admin);
    }

    // ═════════════════════ OZ v5 ROLE TRACKING ═════════════════════
    
    /**
     * @notice OZ v5: Get all addresses with a specific role
     * @dev Replaces getRoleMember from removed AccessControlEnumerable
     */
    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        return _roleMembers[role].values();
    }
    
    /**
     * @notice OZ v5: Get count of role members
     * @dev Replaces getRoleMemberCount from removed AccessControlEnumerable
     */
    function getRoleMemberCount(bytes32 role) external view returns (uint256) {
        return _roleMembers[role].length();
    }

    // ═════════════════════ GUARDIAN MANAGEMENT ═════════════════════

    function setGuardian(address _guardian) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_guardian == address(0)) revert Timelock__ZeroAddress();
        guardian = _guardian;
        emit GuardianSet(_guardian);
    }

    function grantCancellerRole(address _guardian) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_guardian == address(0)) revert Timelock__ZeroAddress();
        _grantRole(CANCELLER_ROLE, _guardian);
        _roleMembers[CANCELLER_ROLE].add(_guardian);
    }

    function revokeCancellerRole(address _guardian) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(CANCELLER_ROLE, _guardian);
        _roleMembers[CANCELLER_ROLE].remove(_guardian);
    }

    // ═════════════════════ ADMIN RENOUNCEMENT ═════════════════════

    function renounceAdminRole() external onlyRole(DEFAULT_ADMIN_ROLE) {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _roleMembers[DEFAULT_ADMIN_ROLE].remove(msg.sender);
        emit AdminRenounced(msg.sender);
    }

    // ═════════════════════ ROLE CHECKERS ═════════════════════

    function isProposer(address account) external view returns (bool) {
        return hasRole(PROPOSER_ROLE, account);
    }

    function isExecutor(address account) external view returns (bool) {
        return hasRole(EXECUTOR_ROLE, account);
    }

    function isCanceller(address account) external view returns (bool) {
        return hasRole(CANCELLER_ROLE, account);
    }

    // ═════════════════════ EMERGENCY FUNCTIONS ═════════════════════

    function emergencyCancelBatch(bytes32[] calldata operationIds) external onlyRole(CANCELLER_ROLE) {
        for (uint256 i = 0; i < operationIds.length; i++) {
            bytes32 id = operationIds[i];
            if (isOperationPending(id)) {
                cancel(id);
            }
        }
        emit EmergencyCancelled(operationIds);
    }

    // ═════════════════════ OZ v5 OVERRIDES - FIXED RETURN TYPES ═════════════════════

    /**
     * @notice OZ v5: Override to track members in EnumerableSet
     * @dev OZ v5: _grantRole returns bool
     */
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool granted = super._grantRole(role, account);
        if (granted) {
            _roleMembers[role].add(account);
        }
        return granted;
    }

    /**
     * @notice OZ v5: Override to track members in EnumerableSet
     * @dev OZ v5: _revokeRole returns bool
     */
    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        bool revoked = super._revokeRole(role, account);
        if (revoked) {
            _roleMembers[role].remove(account);
        }
        return revoked;
    }

    function renounceRole(bytes32 role, address account) public override {
        if (role == PROPOSER_ROLE && _roleMembers[PROPOSER_ROLE].length() <= 1) {
            revert Timelock__CannotRenounceLastProposer();
        }
        if (role == EXECUTOR_ROLE && _roleMembers[EXECUTOR_ROLE].length() <= 1) {
            revert Timelock__CannotRenounceLastExecutor();
        }
        
        super.renounceRole(role, account);
        _roleMembers[role].remove(account);
    }

    function revokeRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role == PROPOSER_ROLE && _roleMembers[PROPOSER_ROLE].length() <= 1) {
            revert Timelock__CannotRenounceLastProposer();
        }
        if (role == EXECUTOR_ROLE && _roleMembers[EXECUTOR_ROLE].length() <= 1) {
            revert Timelock__CannotRenounceLastExecutor();
        }
        
        super.revokeRole(role, account);
        _roleMembers[role].remove(account);
    }
}