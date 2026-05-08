// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Airdrop
 * @dev Merkle Airdrop + Vesting Integration — Eligibility Verification + Allocation Forwarder
 *
 * Security & Design Principles:
 * 1. Stateless Verification: Uses Merkle proofs for eligibility without storing full list
 * 2. Allocation Forwarder Only: Calls Vesting.allocate(), never holds or transfers tokens directly
 * 3. Anti-Double Claim: Permanent tracking per user + chainId in leaf
 * 4. Deadline Enforcement: Claim window with strict time bounds
 * 5. Timelock Governance: 48h delay for all admin actions
 * 6. Governance Lockdown: Admin functions disabled after 180 days
 * 7. Emergency Deactivation: Pause claims + rescue remaining tokens
 * 8. Max Allocation Cap: Prevents over-allocation even with incorrect Merkle root
 * 9. Root Updatable: Merkle root can be updated before first claim
 * 10. State Checks on Root Set: Prevents reactivation after Finalized/Deactivated
 * 11. Deadline ≤ Governance Lock: Prevents extending claims beyond immutable cutoff
 * 12. Pause/Unpause via Timelock: Multi-sig controlled emergency controls
 *
 * Architecture:
 * User → Merkle Proof → Airdrop.verify → Vesting.allocate(user, amount) → User claims from Vesting
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IVesting {
    function allocate(address _user, uint256 _amount) external;
    function getReservedTokens() external view returns (uint256);
}

contract Airdrop is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════
    error Airdrop__ZeroAddress();
    error Airdrop__NotGovernance();
    error Airdrop__NotAuthorized();
    error Airdrop__LockPeriodNotElapsed();
    error Airdrop__ActionAlreadyExecuted();
    error Airdrop__ActionNotProposed();
    error Airdrop__TimelockNotElapsed();
    error Airdrop__ActionExpired();
    error Airdrop__FunctionLockedAfter180Days();
    error Airdrop__RoleManagementLocked();
    error Airdrop__InvalidMerkleProof();
    error Airdrop__AlreadyClaimed();
    error Airdrop__ClaimWindowNotStarted();
    error Airdrop__ClaimWindowEnded();
    error Airdrop__InvalidAmount();
    error Airdrop__MerkleRootAlreadySet();
    error Airdrop__MerkleRootNotSet();
    error Airdrop__AirdropNotActive();
    error Airdrop__AirdropAlreadyFinalized();
    error Airdrop__AirdropAlreadyDeactivated();
    error Airdrop__NoTokensToRescue();
    error Airdrop__NoEthToRescue();
    error Airdrop__EthTransferFailed();
    error Airdrop__DeadlineInPast();
    error Airdrop__InvalidDeadline();
    error Airdrop__DeadlineExceedsGovernanceLock();
    error Airdrop__InsufficientTokensInVesting();
    error Airdrop__ExceedsMaxAllocation();
    error Airdrop__ClaimWindowNotEnded();

    // ═══════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant GOVERNANCE_LOCK_PERIOD = 180 days;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant TIMELOCK_GRACE_PERIOD = 7 days;
    

    // ═══════════════════════════════════════════════════════════════
    // STATES & GOVERNANCE ACTIONS
    // ═══════════════════════════════════════════════════════════════
    enum AirdropState {
        Uninitialized,
        Active,
        Finalized,
        Deactivated
    }

    enum ActionType {
        SetMerkleRoot,
        UpdateDeadline,
        Deactivate,
        Reactivate,
        Finalize,
        FinalizeGovernance,
        RescueTokens,
        RescueEth,
        UpdateVesting,
        UpdateTreasury,
        Pause,
        Unpause
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
    // MERKLE & CLAIM DATA
    // ═══════════════════════════════════════════════════════════════
    /// @notice Merkle root for eligibility verification
    bytes32 public merkleRoot;

    /// @notice Claim deadline timestamp
    uint256 public claimDeadline;

    /// @notice Claim start timestamp (when merkleRoot is set)
    uint256 public claimStart;

    /// @notice Maximum total tokens that can be allocated via this airdrop
    uint256 public maxAirdropAllocation;

    /// @notice Whether user has claimed their allocation
    mapping(address => bool) public hasClaimed;

    /// @notice Total tokens allocated through claims
    uint256 public totalAllocated;

    /// @notice Total unique claimers
    uint256 public totalClaimers;

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT REFERENCES
    // ═══════════════════════════════════════════════════════════════
    address public projectToken;
    IVesting public vestingContract;
    address public treasury;

    uint256 public immutable governanceStartTime;
    bool public governanceFinalized;
    AirdropState public airdropState;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    event ActionProposed(bytes32 indexed actionId, ActionType indexed actionType, uint256 eta, uint256 nonce);
    event ActionExecuted(bytes32 indexed actionId, ActionType indexed actionType);
    event MerkleRootSet(bytes32 indexed merkleRoot, uint256 claimDeadline, uint256 claimStart, uint256 maxAllocation);
    event Claimed(address indexed user, uint256 amount);
    event Deactivated(uint256 timestamp, uint256 remainingTokens);
    event Reactivated(uint256 timestamp);
    event Finalized(uint256 timestamp, uint256 totalAllocated, uint256 totalClaimers);
    event GovernanceFinalized(uint256 timestamp);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event EthRescued(address indexed to, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event VestingUpdated(address indexed oldVesting, address indexed newVesting);

    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════
    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert Airdrop__NotGovernance();
        _;
    }

    modifier onlyAuthorized() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender) && !hasRole(OPERATOR_ROLE, msg.sender)) {
            revert Airdrop__NotAuthorized();
        }
        _;
    }

    modifier whenAirdropActive() {
        if (airdropState != AirdropState.Active) revert Airdrop__AirdropNotActive();
        if (merkleRoot == bytes32(0)) revert Airdrop__MerkleRootNotSet();
        if (block.timestamp < claimStart) revert Airdrop__ClaimWindowNotStarted();
        if (block.timestamp > claimDeadline) revert Airdrop__ClaimWindowEnded();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    constructor(
        address _projectToken,
        address _vesting,
        address _treasury,
        address _multiSigGovernance
    ) {
        if (_projectToken == address(0)) revert Airdrop__ZeroAddress();
        if (_vesting == address(0)) revert Airdrop__ZeroAddress();
        if (_treasury == address(0)) revert Airdrop__ZeroAddress();
        if (_multiSigGovernance == address(0)) revert Airdrop__ZeroAddress();

        projectToken = _projectToken;
        vestingContract = IVesting(_vesting);
        treasury = _treasury;
        governanceStartTime = block.timestamp;
        airdropState = AirdropState.Uninitialized;

        _grantRole(DEFAULT_ADMIN_ROLE, _multiSigGovernance);
        _grantRole(GOVERNANCE_ROLE, _multiSigGovernance);
        _grantRole(OPERATOR_ROLE, _multiSigGovernance);
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMELOCK CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function proposeAction(ActionType _type, bytes calldata _data) external onlyGovernance returns (bytes32) {
        _validateGovernanceActionAllowed(_type);

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

        if (proposal.timestamp == 0) revert Airdrop__ActionNotProposed();
        if (proposal.executed) revert Airdrop__ActionAlreadyExecuted();
        if (block.timestamp < proposal.timestamp + TIMELOCK_DELAY) revert Airdrop__TimelockNotElapsed();
        if (block.timestamp > proposal.timestamp + TIMELOCK_DELAY + TIMELOCK_GRACE_PERIOD) {
            revert Airdrop__ActionExpired();
        }

        _validateGovernanceActionAllowed(proposal.actionType);
        proposal.executed = true;

        if (proposal.actionType == ActionType.SetMerkleRoot) {
            (bytes32 root, uint256 deadline, uint256 maxAllocation) = abi.decode(
                proposal.data, 
                (bytes32, uint256, uint256)
            );
            _setMerkleRoot(root, deadline, maxAllocation);
        } else if (proposal.actionType == ActionType.UpdateDeadline) {
            uint256 newDeadline = abi.decode(proposal.data, (uint256));
            _updateDeadline(newDeadline);
        } else if (proposal.actionType == ActionType.Deactivate) {
            _deactivate();
        } else if (proposal.actionType == ActionType.Reactivate) {
            _reactivate();
        } else if (proposal.actionType == ActionType.Finalize) {
            _finalize();
        } else if (proposal.actionType == ActionType.FinalizeGovernance) {
            _finalizeGovernance();
        } else if (proposal.actionType == ActionType.RescueTokens) {
            (address token, address to, uint256 amount) = abi.decode(
                proposal.data, 
                (address, address, uint256)
            );
            _rescueTokens(token, to, amount);
        } else if (proposal.actionType == ActionType.RescueEth) {
            address payable to = abi.decode(proposal.data, (address));
            _rescueEth(to);
        } else if (proposal.actionType == ActionType.UpdateVesting) {
            address newVesting = abi.decode(proposal.data, (address));
            _updateVesting(newVesting);
        } else if (proposal.actionType == ActionType.UpdateTreasury) {
            address newTreasury = abi.decode(proposal.data, (address));
            _updateTreasury(newTreasury);
        } else if (proposal.actionType == ActionType.Pause) {
            _pause();
        } else if (proposal.actionType == ActionType.Unpause) {
            _unpause();
        }

        emit ActionExecuted(_actionId, proposal.actionType);
    }

    // ═══════════════════════════════════════════════════════════════
    // CLAIM SYSTEM (User-facing)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Claim airdrop allocation via Merkle proof
     * @param _amount Amount of tokens allocated to user
     * @param _merkleProof Array of proof hashes
     */
    function claim(uint256 _amount, bytes32[] calldata _merkleProof) 
        external 
        nonReentrant 
        whenAirdropActive 
        whenNotPaused 
    {
        if (_amount == 0) revert Airdrop__InvalidAmount();
        if (hasClaimed[msg.sender]) revert Airdrop__AlreadyClaimed();

        // Verify Merkle proof using OpenZeppelin
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, _amount, block.chainid));
        if (!MerkleProof.verify(_merkleProof, merkleRoot, leaf)) {
            revert Airdrop__InvalidMerkleProof();
        }

        // Validate against max allocation cap
        if (totalAllocated + _amount > maxAirdropAllocation) {
            revert Airdrop__ExceedsMaxAllocation();
        }

        // Validate Vesting has enough tokens
        uint256 availableInVesting = _availableTokensInVesting();
        if (_amount > availableInVesting) revert Airdrop__InsufficientTokensInVesting();

        // Mark as claimed
        hasClaimed[msg.sender] = true;
        totalAllocated += _amount;
        totalClaimers++;

        // Allocate to user via Vesting
        _allocateToVesting(msg.sender, _amount);

        emit Claimed(msg.sender, _amount);
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Allocate tokens to user via Vesting (stateless)
     */
    function _allocateToVesting(address _user, uint256 _amount) internal {
        vestingContract.allocate(_user, _amount);
    }

    /**
     * @dev Check available tokens in Vesting contract
     */
    function _availableTokensInVesting() internal view returns (uint256) {
        uint256 reserved = vestingContract.getReservedTokens();
        uint256 vestingBalance = IERC20(projectToken).balanceOf(address(vestingContract));
        return vestingBalance > reserved ? vestingBalance - reserved : 0;
    }

    // ═══════════════════════════════════════════════════════════════
    // AIRDROP STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Set or update the Merkle root
     * Added: State checks to prevent setting root after Finalized/Deactivated
     * Added: Deadline cannot exceed governance lock period
     */
    function _setMerkleRoot(bytes32 _root, uint256 _deadline, uint256 _maxAllocation) internal {
        if (_root == bytes32(0)) revert Airdrop__InvalidMerkleProof();
        if (_deadline <= block.timestamp) revert Airdrop__DeadlineInPast();
        if (_deadline <= block.timestamp + 1 days) revert Airdrop__InvalidDeadline();
        if (_maxAllocation == 0) revert Airdrop__InvalidAmount();
        
        // Prevent setting root if already finalized or deactivated
        if (airdropState == AirdropState.Finalized) revert Airdrop__AirdropAlreadyFinalized();
        if (airdropState == AirdropState.Deactivated) revert Airdrop__AirdropAlreadyDeactivated();
        
        // Deadline cannot exceed governance lock period
        if (_deadline > governanceStartTime + GOVERNANCE_LOCK_PERIOD) {
            revert Airdrop__DeadlineExceedsGovernanceLock();
        }
        
        // Allow root update only if no claims have been made yet
        if (totalClaimers > 0) revert Airdrop__MerkleRootAlreadySet();

        merkleRoot = _root;
        claimDeadline = _deadline;
        claimStart = block.timestamp;
        maxAirdropAllocation = _maxAllocation;
        airdropState = AirdropState.Active;

        emit MerkleRootSet(_root, _deadline, block.timestamp, _maxAllocation);
    }

    /**
     * @dev Update deadline - cannot exceed governance lock
     */
    function _updateDeadline(uint256 _newDeadline) internal {
        if (_newDeadline <= block.timestamp) revert Airdrop__DeadlineInPast();
        if (airdropState != AirdropState.Active) revert Airdrop__AirdropNotActive();
        if (_newDeadline > governanceStartTime + GOVERNANCE_LOCK_PERIOD) {
            revert Airdrop__DeadlineExceedsGovernanceLock();
        }
        claimDeadline = _newDeadline;
    }

    function _deactivate() internal {
        if (airdropState == AirdropState.Deactivated) revert Airdrop__AirdropAlreadyDeactivated();
        if (airdropState == AirdropState.Finalized) revert Airdrop__AirdropAlreadyFinalized();

        airdropState = AirdropState.Deactivated;

        // If contract holds any tokens, rescue to treasury
        uint256 balance = IERC20(projectToken).balanceOf(address(this));
        if (balance > 0) {
            IERC20(projectToken).safeTransfer(treasury, balance);
        }

        emit Deactivated(block.timestamp, balance);
    }

    function _reactivate() internal {
        if (airdropState != AirdropState.Deactivated) revert Airdrop__AirdropNotActive();
        if (block.timestamp > claimDeadline) revert Airdrop__ClaimWindowEnded();
        if (merkleRoot == bytes32(0)) revert Airdrop__MerkleRootNotSet();

        airdropState = AirdropState.Active;
        emit Reactivated(block.timestamp);
    }

    function _finalize() internal {
        if (airdropState == AirdropState.Finalized) revert Airdrop__AirdropAlreadyFinalized();
        if (airdropState == AirdropState.Deactivated) revert Airdrop__AirdropAlreadyDeactivated();
        // Prevent finalize before claim window ends
        if (block.timestamp < claimDeadline) revert Airdrop__ClaimWindowNotEnded();

        airdropState = AirdropState.Finalized;
        if (!paused()) { _pause();
        }

        // Rescue any remaining tokens to treasury
        uint256 balance = IERC20(projectToken).balanceOf(address(this));
        if (balance > 0) {
            IERC20(projectToken).safeTransfer(treasury, balance);
        }

        emit Finalized(block.timestamp, totalAllocated, totalClaimers);
    }

    // ═══════════════════════════════════════════════════════════════
    // TREASURY & VESTING UPDATES
    // ═══════════════════════════════════════════════════════════════
    function _updateTreasury(address _newTreasury) internal {
        if (_newTreasury == address(0)) revert Airdrop__ZeroAddress();
        if (_newTreasury.code.length == 0) revert Airdrop__ZeroAddress();
        address oldTreasury = treasury;
        treasury = _newTreasury;
        emit TreasuryUpdated(oldTreasury, _newTreasury);
    }

    function _updateVesting(address _newVesting) internal {
        if (_newVesting == address(0)) revert Airdrop__ZeroAddress();
        if (_newVesting.code.length == 0) revert Airdrop__ZeroAddress();
        address oldVesting = address(vestingContract);
        vestingContract = IVesting(_newVesting);
        emit VestingUpdated(oldVesting, _newVesting);
    }

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION
    // ═══════════════════════════════════════════════════════════════
    function _finalizeGovernance() internal {
        if (block.timestamp < governanceStartTime + GOVERNANCE_LOCK_PERIOD) {
            revert Airdrop__LockPeriodNotElapsed();
        }
        governanceFinalized = true;
        emit GovernanceFinalized(block.timestamp);
    }

    function _validateGovernanceActionAllowed(ActionType _type) internal view {
        if (_isGovernanceLocked()) {
            if (
                _type != ActionType.RescueTokens &&
                _type != ActionType.RescueEth &&
                _type != ActionType.FinalizeGovernance
            ) {
                revert Airdrop__FunctionLockedAfter180Days();
            }
        }
    }

    function _isGovernanceLocked() internal view returns (bool) {
        return governanceFinalized || block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD;
    }

    // ═══════════════════════════════════════════════════════════════
    // RESCUE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function _rescueTokens(address _token, address _to, uint256 _amount) internal {
    if (_to == address(0)) revert Airdrop__ZeroAddress();
    if (_token == address(0)) revert Airdrop__ZeroAddress();

    uint256 balance = IERC20(_token).balanceOf(address(this));

    if (balance == 0) revert Airdrop__NoTokensToRescue();

    IERC20(_token).safeTransfer(_to, _amount);

    emit TokensRescued(_token, _to, _amount);
    }

    function _rescueEth(address payable _to) internal {
        if (_to == address(0)) revert Airdrop__ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert Airdrop__NoEthToRescue();
        (bool success, ) = _to.call{value: balance}("");
        if (!success) revert Airdrop__EthTransferFailed();
        emit EthRescued(_to, balance);
    }

    // ═══════════════════════════════════════════════════════════════
    // ACCESS CONTROL OVERRIDES (Lockdown after Finalization)
    // ═══════════════════════════════════════════════════════════════
    function grantRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Airdrop__RoleManagementLocked();
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Airdrop__RoleManagementLocked();
        super.revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) public override {
    // Allow self-renounce even after governance lock
    if (msg.sender != account) {
        if (_isGovernanceLocked()) revert Airdrop__RoleManagementLocked();
    }

    super.renounceRole(role, account);
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Check if a user can claim
     */
    function canClaim(address _user, uint256 _amount, bytes32[] calldata _merkleProof) 
        external 
        view 
        returns (bool) 
    {
        if (paused()) return false;
        if (airdropState != AirdropState.Active) return false;
        if (block.timestamp < claimStart || block.timestamp > claimDeadline) return false;
        if (hasClaimed[_user]) return false;
        if (_amount == 0) return false;
        if (totalAllocated + _amount > maxAirdropAllocation) return false;
        if (_amount > _availableTokensInVesting()) return false;

        bytes32 leaf = keccak256(abi.encodePacked(_user, _amount, block.chainid));
        return MerkleProof.verify(_merkleProof, merkleRoot, leaf);
    }

    /**
     * @notice Check if claim window is open
     */
    function isClaimWindowOpen() external view returns (bool) {
        return airdropState == AirdropState.Active &&
               block.timestamp >= claimStart &&
               block.timestamp <= claimDeadline;
    }

    /**
     * @notice Get time until claim window closes
     */
    function timeUntilDeadline() external view returns (uint256) {
        if (block.timestamp >= claimDeadline) return 0;
        return claimDeadline - block.timestamp;
    }

    /**
     * @notice Get time until claim window starts
     */
    function timeUntilStart() external view returns (uint256) {
        if (block.timestamp >= claimStart) return 0;
        return claimStart - block.timestamp;
    }

    /**
     * @notice Check if user has claimed
     */
    function hasUserClaimed(address _user) external view returns (bool) {
        return hasClaimed[_user];
    }

    /**
     * @notice Get available tokens in Vesting for new allocations
     */
    function availableTokensInVesting() external view returns (uint256) {
        return _availableTokensInVesting();
    }

    /**
     * @notice Get current airdrop state
     */
    function getAirdropState() external view returns (AirdropState) {
        return airdropState;
    }

    /**
     * @notice Check if governance can be finalized
     */
    function canFinalizeGovernance() external view returns (bool) {
        return !governanceFinalized && block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD;
    }

    /**
     * @notice Get time until governance finalization
     */
    function timeUntilFinalization() external view returns (uint256) {
        uint256 eligibleTime = governanceStartTime + GOVERNANCE_LOCK_PERIOD;
        if (block.timestamp >= eligibleTime) return 0;
        return eligibleTime - block.timestamp;
    }

    /**
     * @notice Check if governance is locked
     */
    function isGovernanceLocked() external view returns (bool) {
        return _isGovernanceLocked();
    }

    /**
     * @notice Generate leaf hash for off-chain verification
     */
    function getLeaf(address _user, uint256 _amount) external view returns (bytes32) {
        return keccak256(abi.encodePacked(_user, _amount, block.chainid));
    }

    /**
     * @notice Helper to generate action hash for proposal
     */
    function getActionHash(
        ActionType _type,
        bytes calldata _data,
        uint256 _timestamp,
        address _proposer,
        uint256 _nonce
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(_type, _data, _timestamp, _proposer, _nonce));
    }

    // ═══════════════════════════════════════════════════════════════
    // RECEIVE FUNCTION
    // ═══════════════════════════════════════════════════════════════
    receive() external payable {
        // Direct ETH can be rescued through timelocked governance
    }
}