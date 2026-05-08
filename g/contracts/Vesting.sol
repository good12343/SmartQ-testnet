// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Vesting (Final Absolute Version)
 * @dev Deterministic Vesting Engine - Vault + Release Engine + Claim System
 * 
 * 🚀 Final Critical Fixes:
 * 1. Immediate Tranche Release: First 25% is now claimable immediately after cliff.
 * 2. Funding Verification: `_allocate` now checks if the contract has enough tokens to cover the new allocation.
 * 3. Automatic Role Lockdown: Admin roles are locked after 180 days even if not manually finalized.
 * 4. Decentralized Claims: `claim()` is no longer blocked by `whenNotPaused` to reduce centralization risk.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

contract Vesting is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    
    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════
    error Vesting__ZeroAddress();
    error Vesting__NotGovernance();
    error Vesting__LockPeriodNotElapsed();
    error Vesting__AlreadyFinalized();
    error Vesting__ActionNotProposed();
    error Vesting__TimelockNotElapsed();
    error Vesting__ActionExpired();
    error Vesting__FunctionLockedAfter180Days();
    error Vesting__RoleManagementLocked();
    error Vesting__NoAllocation();
    error Vesting__NothingToClaim();
    error Vesting__ClaimExpired();
    error Vesting__CliffNotReached();
    error Vesting__TransferFailed();
    error Vesting__InvalidAmount();
    error Vesting__AllocationAlreadyExists();
    error Vesting__NotExpiredYet();
    error Vesting__ContractPaused();
    error Vesting__NotAuthorized();
    error Vesting__NoEthToRescue();
    error Vesting__EthTransferFailed();
    error Vesting__InsufficientContractBalance(); // Fixed: Added specific error for funding check
    
    // ═══════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");
    
    uint256 public constant TOTAL_SUPPLY_CAP = 1_000_000_000 * 10**18;
    uint256 public constant CLIFF_PERIOD = 180 days;
    uint256 public constant MONTHLY_INTERVAL = 30 days;
    uint256 public constant CLAIM_EXPIRATION = 1095 days; // 3 * 365
    uint256 public constant GOVERNANCE_LOCK_PERIOD = 180 days;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant TIMELOCK_GRACE_PERIOD = 7 days;
    uint256 public constant TOTAL_TRANCHES = 4;
    uint256 public constant TRANCHE_PERCENTAGE = 2500; // 25% in basis points (10000 = 100%)
    
    // ═══════════════════════════════════════════════════════════════
    // TIMELOCK LOGIC
    // ═══════════════════════════════════════════════════════════════
    enum ActionType { 
        Allocate,           
        BatchAllocate,        
        SetDepositor,         
        BatchSetDepositors,   
        Pause,                
        Unpause,              
        FinalizeGovernance,   
        WithdrawExpired,      
        RescueTokens,         
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
    // VESTING STRUCTURE
    // ═══════════════════════════════════════════════════════════════
    struct VestingSchedule {
        uint256 totalAllocation;    
        uint256 claimedAmount;    
        uint256 startTime;        
        bool exists;              
    }
    
    IERC20 public immutable projectToken;
    address public immutable treasury;
    uint256 public immutable projectLaunchTime;
    uint256 public immutable governanceStartTime;
    bool public governanceFinalized;
    
    uint256 public totalAllocated;
    uint256 public totalClaimedAmount;
    
    mapping(address => VestingSchedule) public vestingSchedules;
    address[] public allUsers;
    mapping(address => bool) public isUserRegistered;
    
    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    event ActionProposed(bytes32 indexed actionId, ActionType indexed actionType, uint256 eta, uint256 nonce);
    event ActionExecuted(bytes32 indexed actionId, ActionType indexed actionType);
    event TokensAllocated(address indexed user, uint256 amount, uint256 startTime);
    event TokensClaimed(address indexed user, uint256 amount, uint256 timestamp);
    event ExpiredTokensWithdrawn(address indexed user, uint256 amount, address indexed treasury);
    event GovernanceFinalized(uint256 timestamp);
    event TokensRescued(address indexed to, uint256 amount);
    event EthRescued(address indexed to, uint256 amount);
    event TokensDeposited(address indexed from, uint256 amount);
    
    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════
    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert Vesting__NotGovernance();
        _;
    }

    modifier onlyAuthorized() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender) && !hasRole(DEPOSITOR_ROLE, msg.sender)) {
            revert Vesting__NotAuthorized();
        }
        _;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    constructor(
        address _projectToken,
        address _treasury,
        address _multiSigGovernance,
        uint256 _projectLaunchTime
    ) {
        if (_projectToken == address(0)) revert Vesting__ZeroAddress();
        if (_treasury == address(0)) revert Vesting__ZeroAddress();
        if (_multiSigGovernance == address(0)) revert Vesting__ZeroAddress();
        if (_projectLaunchTime == 0) revert Vesting__InvalidAmount();
        
        projectToken = IERC20(_projectToken);
        treasury = _treasury;
        projectLaunchTime = _projectLaunchTime;
        governanceStartTime = block.timestamp;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _multiSigGovernance);
        _grantRole(GOVERNANCE_ROLE, _multiSigGovernance);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // FUNDING & ALLOCATION (For Sale/Airdrop Contracts)
    // ═══════════════════════════════════════════════════════════════

    function depositTokens(uint256 _amount) external onlyAuthorized whenNotPaused {
        if (_amount == 0) revert Vesting__InvalidAmount();
        projectToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit TokensDeposited(msg.sender, _amount);
    }

    function depositAndAllocate(address _user, uint256 _amount) external onlyAuthorized whenNotPaused nonReentrant {
        if (_amount == 0) revert Vesting__InvalidAmount();
        projectToken.safeTransferFrom(msg.sender, address(this), _amount);
        _allocate(_user, _amount);
        emit TokensDeposited(msg.sender, _amount);
    }

    function allocate(address _user, uint256 _amount) external onlyAuthorized whenNotPaused nonReentrant {
        _allocate(_user, _amount);
    }

    function batchAllocate(address[] calldata _users, uint256[] calldata _amounts) external onlyAuthorized whenNotPaused nonReentrant {
        _batchAllocate(_users, _amounts);
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMELOCK CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    function proposeAction(ActionType _type, bytes calldata _data) external onlyGovernance returns (bytes32) {
        if (_isGovernanceLocked()) { // Fixed: Used unified lock check
            if (_type != ActionType.WithdrawExpired && _type != ActionType.RescueTokens && _type != ActionType.RescueEth) {
                revert Vesting__FunctionLockedAfter180Days();
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
    
    function executeAction(bytes32 _actionId) external onlyGovernance nonReentrant {
        ProposedAction storage proposal = proposals[_actionId];
        
        if (proposal.timestamp == 0) revert Vesting__ActionNotProposed();
        if (proposal.executed) revert Vesting__AlreadyFinalized();
        if (block.timestamp < proposal.timestamp + TIMELOCK_DELAY) revert Vesting__TimelockNotElapsed();
        if (block.timestamp > proposal.timestamp + TIMELOCK_DELAY + TIMELOCK_GRACE_PERIOD) revert Vesting__ActionExpired();
        
        proposal.executed = true;
        
        if (proposal.actionType == ActionType.Allocate) {
            (address user, uint256 amount) = abi.decode(proposal.data, (address, uint256));
            _allocate(user, amount);
        }
        else if (proposal.actionType == ActionType.BatchAllocate) {
            (address[] memory users, uint256[] memory amounts) = abi.decode(proposal.data, (address[], uint256[]));
            _batchAllocate(users, amounts);
        }
        else if (proposal.actionType == ActionType.SetDepositor) {
            (address depositor, bool granted) = abi.decode(proposal.data, (address, bool));
            _setDepositor(depositor, granted);
        }
        else if (proposal.actionType == ActionType.BatchSetDepositors) {
            (address[] memory depositors, bool[] memory granted) = abi.decode(proposal.data, (address[], bool[]));
            _batchSetDepositors(depositors, granted);
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
        else if (proposal.actionType == ActionType.WithdrawExpired) {
            address user = abi.decode(proposal.data, (address));
            _withdrawExpired(user);
        }
        else if (proposal.actionType == ActionType.RescueTokens) {
            (address token, address to, uint256 amount) = abi.decode(proposal.data, (address, address, uint256));
            _rescueTokens(token, to, amount);
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
    
    function _allocate(address _user, uint256 _amount) internal {
        if (_user == address(0)) revert Vesting__ZeroAddress();
        if (_amount == 0) revert Vesting__InvalidAmount();
        if (vestingSchedules[_user].exists) revert Vesting__AllocationAlreadyExists();
        if (totalAllocated + _amount > TOTAL_SUPPLY_CAP) revert Vesting__InvalidAmount();
        
        // Fixed: Verify contract has enough tokens to cover the new allocation
        uint256 requiredReserved = totalAllocated + _amount - totalClaimedAmount;
        if (projectToken.balanceOf(address(this)) < requiredReserved) {
            revert Vesting__InsufficientContractBalance();
        }
        
        if (!isUserRegistered[_user]) {
            allUsers.push(_user);
            isUserRegistered[_user] = true;
        }
        
        vestingSchedules[_user] = VestingSchedule({
            totalAllocation: _amount,
            claimedAmount: 0,
            startTime: projectLaunchTime,
            exists: true
        });
        
        totalAllocated += _amount;
        emit TokensAllocated(_user, _amount, projectLaunchTime);
    }
    
    function _batchAllocate(address[] memory _users, uint256[] memory _amounts) internal {
        if (_users.length != _amounts.length || _users.length == 0) revert Vesting__InvalidAmount();
        for (uint256 i = 0; i < _users.length; i++) {
            _allocate(_users[i], _amounts[i]);
        }
    }
    
    function _setDepositor(address _depositor, bool _granted) internal {
        if (_depositor == address(0)) revert Vesting__ZeroAddress();
        if (_granted) {
            _grantRole(DEPOSITOR_ROLE, _depositor);
        } else {
            _revokeRole(DEPOSITOR_ROLE, _depositor);
        }
    }
    
    function _batchSetDepositors(address[] memory _depositors, bool[] memory _granted) internal {
        if (_depositors.length != _granted.length) revert Vesting__InvalidAmount();
        for (uint256 i = 0; i < _depositors.length; i++) {
            _setDepositor(_depositors[i], _granted[i]);
        }
    }

    function _finalizeGovernance() internal {
        if (block.timestamp < governanceStartTime + GOVERNANCE_LOCK_PERIOD) revert Vesting__LockPeriodNotElapsed();
        governanceFinalized = true;
        emit GovernanceFinalized(block.timestamp);
    }

    function _withdrawExpired(address _user) internal {
        VestingSchedule storage schedule = vestingSchedules[_user];
        if (!schedule.exists) revert Vesting__NoAllocation();
        if (block.timestamp < schedule.startTime + CLAIM_EXPIRATION) revert Vesting__NotExpiredYet();
        
        uint256 unclaimed = schedule.totalAllocation - schedule.claimedAmount;
        if (unclaimed == 0) revert Vesting__NothingToClaim();
        
        totalClaimedAmount += unclaimed;
        schedule.claimedAmount = schedule.totalAllocation;
        
        projectToken.safeTransfer(treasury, unclaimed);
        emit ExpiredTokensWithdrawn(_user, unclaimed, treasury);
    }

    function _rescueTokens(address _token, address _to, uint256 _amount) internal {
        if (_to == address(0)) revert Vesting__ZeroAddress();
        if (_token == address(0)) revert Vesting__ZeroAddress();
        
        if (_token == address(projectToken)) {
            uint256 contractBalance = projectToken.balanceOf(address(this));
            uint256 reservedForUsers = totalAllocated - totalClaimedAmount;
            uint256 availableForRescue = contractBalance > reservedForUsers ? contractBalance - reservedForUsers : 0;
            
            if (_amount > availableForRescue) revert Vesting__InvalidAmount();
        }
        
        IERC20(_token).safeTransfer(_to, _amount);
        emit TokensRescued(_to, _amount);
    }

    function _rescueEth(address payable _to) internal {
        if (_to == address(0)) revert Vesting__ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert Vesting__NoEthToRescue();
        (bool success, ) = _to.call{value: balance}("");
        if (!success) revert Vesting__EthTransferFailed();
        emit EthRescued(_to, balance);
    }

    function _isGovernanceLocked() internal view returns (bool) {
        // Fixed: Unified lock check for manual finalization or 180 days elapsed
        return governanceFinalized || block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD;
    }

    // ═══════════════════════════════════════════════════════════════
    // CLAIM SYSTEM
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Claim vested tokens
     * @dev Fixed: Removed whenNotPaused to allow claims even during emergency pause
     */
    function claim() external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        if (!schedule.exists) revert Vesting__NoAllocation();
        if (block.timestamp < projectLaunchTime + CLIFF_PERIOD) revert Vesting__CliffNotReached();
        
        uint256 releasable = calculateReleasable(msg.sender);
        if (releasable == 0) revert Vesting__NothingToClaim();
        
        totalClaimedAmount += releasable;
        schedule.claimedAmount += releasable;
        
        projectToken.safeTransfer(msg.sender, releasable);
        emit TokensClaimed(msg.sender, releasable, block.timestamp);
    }
    
    function calculateReleasable(address _user) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[_user];
        if (!schedule.exists || block.timestamp < projectLaunchTime + CLIFF_PERIOD) return 0;
        
        uint256 elapsed = block.timestamp - (projectLaunchTime + CLIFF_PERIOD);
        
        // Fixed: Immediate tranche release after cliff (elapsed / interval + 1)
        uint256 completedTranches = (elapsed / MONTHLY_INTERVAL) + 1;
        if (completedTranches >= TOTAL_TRANCHES) completedTranches = TOTAL_TRANCHES;
        
        uint256 vestedAmount = (schedule.totalAllocation * (completedTranches * TRANCHE_PERCENTAGE)) / 10000;
        if (vestedAmount <= schedule.claimedAmount) return 0;
        return vestedAmount - schedule.claimedAmount;
    }

    // ═══════════════════════════════════════════════════════════════
    // ACCESS CONTROL OVERRIDES
    // ═══════════════════════════════════════════════════════════════

    function grantRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Vesting__RoleManagementLocked(); // Fixed: Used unified lock check
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Vesting__RoleManagementLocked(); // Fixed: Used unified lock check
        super.revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) public override {
        if (_isGovernanceLocked()) revert Vesting__RoleManagementLocked(); // Fixed: Used unified lock check
        super.renounceRole(role, account);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function getReservedTokens() public view returns (uint256) {
        return totalAllocated - totalClaimedAmount;
    }

    function getExcessTokens() external view returns (uint256) {
        uint256 balance = projectToken.balanceOf(address(this));
        uint256 reserved = getReservedTokens();
        return balance > reserved ? balance - reserved : 0;
    }

    receive() external payable {}
}
