// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Token (Final Permit Version)
 * @dev ERC20 Asset Layer Contract - Fixed Supply, Timelocked Governance, EIP-2612 Permit
 * 
 * 🛡️ Security & Feature Highlights:
 * 1. EIP-2612 Permit: Gasless approvals via signatures.
 * 2. Nonce in proposeAction: Prevents actionId collisions.
 * 3. Pre-update Wallet Cap Check: Enforces cap before state changes.
 * 4. Role Management Lockdown: Permanently disabling role changes after finalization.
 * 5. AccessControl Only: No Ownable backdoors.
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract Token is ERC20, ERC20Permit, AccessControl, ReentrancyGuard, Pausable {
    
    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════
    error Token__ZeroAddress();
    error Token__AllocationMismatch();
    error Token__NotGovernance();
    error Token__LockPeriodNotElapsed();
    error Token__AlreadyFinalized();
    error Token__ExceedsWalletCap();
    error Token__ArrayLengthMismatch();
    error Token__NoEthToRescue();
    error Token__EthTransferFailed();
    error Token__MintingDisabled();
    error Token__ActionNotProposed();
    error Token__TimelockNotElapsed();
    error Token__ActionExpired();
    error Token__FunctionLockedAfter180Days();
    error Token__RoleManagementLocked();

    // ═══════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18;
    uint256 public constant WALLET_CAP = 10_000_000 * 10**18;
    uint256 public constant GOVERNANCE_LOCK_PERIOD = 180 days;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant TIMELOCK_GRACE_PERIOD = 7 days;

    // ═══════════════════════════════════════════════════════════════
    // TIMELOCK LOGIC
    // ═══════════════════════════════════════════════════════════════
    enum ActionType { 
        SetExclusion, 
        BatchSetExclusions, 
        SetDexSetup, 
        Pause, 
        Unpause, 
        FinalizeGovernance,
        UpdateDexAfterFinalization,
        RescueEth
    }

    struct ProposedAction {
        ActionType actionType;
        bytes data;
        uint256 timestamp;
        bool executed;
    }

    mapping(bytes32 => ProposedAction) public proposals;
    uint256 public proposalNonce;
    
    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════
    address public dexRouter;
    address public dexPair;
    uint256 public immutable governanceStartTime;
    bool public governanceFinalized;
    mapping(address => bool) public isExcludedFromWalletCap;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    event ActionProposed(bytes32 indexed actionId, ActionType indexed actionType, uint256 eta, uint256 nonce);
    event ActionExecuted(bytes32 indexed actionId, ActionType indexed actionType);
    event TokensMinted(address indexed to, uint256 amount);
    event ExclusionUpdated(address indexed account, bool excluded);
    event DexSetupUpdated(address indexed router, address indexed pair);
    event GovernanceFinalized(uint256 timestamp);
    event EthRescued(address indexed to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════
    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert Token__NotGovernance();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    constructor(
        string memory _name,
        string memory _symbol,
        address _multiSigGovernance,
        address _treasury,
        address _vesting,
        address _airdrop,
        address _saleAllocation,
        uint256 _treasuryAmount,
        uint256 _vestingAmount,
        uint256 _airdropAmount,
        uint256 _saleAmount
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        if (_multiSigGovernance == address(0)) revert Token__ZeroAddress();
        if (_treasury == address(0)) revert Token__ZeroAddress();
        if (_vesting == address(0)) revert Token__ZeroAddress();
        if (_airdrop == address(0)) revert Token__ZeroAddress();
        
        uint256 totalAllocated = _treasuryAmount + _vestingAmount + _airdropAmount + _saleAmount;
        if (totalAllocated != TOTAL_SUPPLY) revert Token__AllocationMismatch();

        // Set up AccessControl
        _grantRole(DEFAULT_ADMIN_ROLE, _multiSigGovernance);
        _grantRole(GOVERNANCE_ROLE, _multiSigGovernance);
        
        governanceStartTime = block.timestamp;

        // Initial Minting with Events
        _mint(_treasury, _treasuryAmount);
        emit TokensMinted(_treasury, _treasuryAmount);
        
        _mint(_vesting, _vestingAmount);
        emit TokensMinted(_vesting, _vestingAmount);
        
        _mint(_airdrop, _airdropAmount);
        emit TokensMinted(_airdrop, _airdropAmount);
        
        if (_saleAmount > 0 && _saleAllocation != address(0)) {
            _mint(_saleAllocation, _saleAmount);
            emit TokensMinted(_saleAllocation, _saleAmount);
            _setExclusion(_saleAllocation, true);
        }

        // Initial Exclusions
        _setExclusion(_treasury, true);
        _setExclusion(_vesting, true);
        _setExclusion(_airdrop, true);
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMELOCK CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Propose a governance action
     */
    function proposeAction(ActionType _type, bytes calldata _data) external onlyGovernance returns (bytes32) {
        // After 180 days, only DEX updates and ETH rescue are allowed
        if (block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD) {
            if (_type != ActionType.UpdateDexAfterFinalization && _type != ActionType.RescueEth) {
                revert Token__FunctionLockedAfter180Days();
            }
        }

        // If governance is finalized, only DEX updates and ETH rescue are allowed regardless of time
        if (governanceFinalized) {
            if (_type != ActionType.UpdateDexAfterFinalization && _type != ActionType.RescueEth) {
                revert Token__AlreadyFinalized();
            }
        }

        uint256 currentNonce = proposalNonce++;
        bytes32 actionId = keccak256(abi.encode(_type, _data, block.timestamp, msg.sender, currentNonce));
        
        proposals[actionId] = ProposedAction({
            actionType: _type,
            data: _data,
            timestamp: block.timestamp,
            executed: false
        });

        emit ActionProposed(actionId, _type, block.timestamp + TIMELOCK_DELAY, currentNonce);
        return actionId;
    }

    /**
     * @notice Execute a proposed action after 48 hours
     */
    function executeAction(bytes32 _actionId) external onlyGovernance nonReentrant {
        ProposedAction storage proposal = proposals[_actionId];
        
        if (proposal.timestamp == 0) revert Token__ActionNotProposed();
        if (proposal.executed) revert Token__AlreadyFinalized();
        if (block.timestamp < proposal.timestamp + TIMELOCK_DELAY) revert Token__TimelockNotElapsed();
        if (block.timestamp > proposal.timestamp + TIMELOCK_DELAY + TIMELOCK_GRACE_PERIOD) revert Token__ActionExpired();

        proposal.executed = true;

        if (proposal.actionType == ActionType.SetExclusion) {
            (address account, bool excluded) = abi.decode(proposal.data, (address, bool));
            _setExclusion(account, excluded);
        } 
        else if (proposal.actionType == ActionType.BatchSetExclusions) {
            (address[] memory accounts, bool[] memory excluded) = abi.decode(proposal.data, (address[], bool[]));
            _batchSetExclusions(accounts, excluded);
        }
        else if (proposal.actionType == ActionType.SetDexSetup || proposal.actionType == ActionType.UpdateDexAfterFinalization) {
            (address router, address pair) = abi.decode(proposal.data, (address, address));
            _updateDexSetup(router, pair);
        }
        else if (proposal.actionType == ActionType.Pause) {
            _pause();
        }
        else if (proposal.actionType == ActionType.Unpause) {
            _unpause();
        }
        else if (proposal.actionType == ActionType.FinalizeGovernance) {
            _finalizeGovernance();
        }
        else if (proposal.actionType == ActionType.RescueEth) {
            address payable to = abi.decode(proposal.data, (address));
            _rescueEth(to);
        }

        emit ActionExecuted(_actionId, proposal.actionType);
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _setExclusion(address _account, bool _excluded) internal {
        if (_account == address(0)) revert Token__ZeroAddress();
        isExcludedFromWalletCap[_account] = _excluded;
        emit ExclusionUpdated(_account, _excluded);
    }

    function _batchSetExclusions(address[] memory _accounts, bool[] memory _excluded) internal {
        if (_accounts.length != _excluded.length) revert Token__ArrayLengthMismatch();
        for (uint256 i = 0; i < _accounts.length; i++) {
            _setExclusion(_accounts[i], _excluded[i]);
        }
    }

    function _updateDexSetup(address _router, address _pair) internal {
        if (_router == address(0) || _pair == address(0)) revert Token__ZeroAddress();
        dexRouter = _router;
        dexPair = _pair;
        isExcludedFromWalletCap[_pair] = true;
        emit DexSetupUpdated(_router, _pair);
    }

    function _isGovernanceLocked() internal view returns (bool) {
    return governanceFinalized || block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD;
    }

      function _finalizeGovernance() internal {
        if (block.timestamp < governanceStartTime + GOVERNANCE_LOCK_PERIOD) revert Token__LockPeriodNotElapsed();
        governanceFinalized = true;
        emit GovernanceFinalized(block.timestamp);
    }
    function _rescueEth(address payable _to) internal {
        uint256 balance = address(this).balance;
        if (balance == 0) revert Token__NoEthToRescue();
        (bool success, ) = _to.call{value: balance}("");
        if (!success) revert Token__EthTransferFailed();
        emit EthRescued(_to, balance);
    }

    // ═══════════════════════════════════════════════════════════════
    // ERC20 OVERRIDES (OpenZeppelin 5.x)
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @dev Enforces wallet cap during transfers.
     * Note: Wallet cap check is performed BEFORE the state update (Checks-Effects).
     */
    function _update(address from, address to, uint256 amount) internal override whenNotPaused {
        // Skip checks for minting and burning
        if (from != address(0) && to != address(0)) {
            // Enforce wallet cap on recipient if not excluded
            if (!isExcludedFromWalletCap[to]) {
                if (balanceOf(to) + amount > WALLET_CAP) {
                    revert Token__ExceedsWalletCap();
                }
            }
        }

        // Perform the transfer (Effects)
        super._update(from, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    // ACCESS CONTROL OVERRIDES (Lockdown after Finalization)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Prevents role changes after governance is finalized.
     */
    function grantRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Token__RoleManagementLocked();
        super.grantRole(role, account);
    }

    /**
     * @dev Prevents role changes after governance is finalized.
     */
    function revokeRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Token__RoleManagementLocked();
        super.revokeRole(role, account);
    }

    /**
     * @dev Prevents role changes after governance is finalized.
     */
    function renounceRole(bytes32 role, address account) public override {
        if (_isGovernanceLocked()) revert Token__RoleManagementLocked();
        super.renounceRole(role, account);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURITY & VIEW
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Explicitly disable minting after deployment
     */
    function mint(address, uint256) external pure { 
        revert Token__MintingDisabled(); 
    }
    
    receive() external payable {}

    /**
     * @notice Helper to generate action hash for proposal
     */
    function getActionHash(ActionType _type, bytes calldata _data, uint256 _timestamp, address _proposer, uint256 _nonce) external pure returns (bytes32) {
        return keccak256(abi.encode(_type, _data, _timestamp, _proposer, _nonce));
    }
}