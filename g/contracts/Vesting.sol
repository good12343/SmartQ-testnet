// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract Vesting is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════
    error ZeroAddress();
    error NotAuthorized();
    error NoAllocation();
    error CliffNotReached();
    error NothingToClaim();
    error InsufficientBalance();
    error RoleLocked();
    error InvalidAmount();

    // ═══════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant DEPOSITOR_ROLE  = keccak256("DEPOSITOR_ROLE");

    uint256 public constant CLIFF = 4 days;
    uint256 public constant MONTH = 1 days;
    uint256 public constant TOTAL_STAGES = 4;
    uint256 public constant STAGE_SHARE = 25; // %

    uint256 public constant LOCK_180 = 180 days;

    // ═══════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════
    IERC20 public immutable token;
    address public immutable treasury;
    uint256 public immutable startTime;

    bool public finalized;
    uint256 public immutable govStart;

    struct Vest {
        uint256 total;
        uint256 claimed;
    }

    mapping(address => Vest) public vesting;

    uint256 public totalAllocated;
    uint256 public totalClaimed;

    // ═══════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════
    event Allocated(address user, uint256 amount);
    event Claimed(address user, uint256 amount);
    event Deposited(uint256 amount);
    event Finalized(uint256 time);
    event ERC20Rescued(address token, address to, uint256 amount);

    // ═══════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════
    modifier onlyGov() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier onlyAllowed() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender) && !hasRole(DEPOSITOR_ROLE, msg.sender)) {
            revert NotAuthorized();
        }
        _;
    }

    // ═══════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════
    constructor(
        address _token,
        address _treasury,
        address _gov,
        uint256 _start
    ) {
        if (_token == address(0) || _treasury == address(0) || _gov == address(0)) {
            revert ZeroAddress();
        }

        token = IERC20(_token);
        treasury = _treasury;
        startTime = _start;

        govStart = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _gov);
        _grantRole(GOVERNANCE_ROLE, _gov);
    }

    // ═══════════════════════════════════════════════
    // DEPOSIT
    // ═══════════════════════════════════════════════
    function deposit(uint256 amount) external onlyAllowed {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(amount);
    }

    // ═══════════════════════════════════════════════
    // ALLOCATION
    // ═══════════════════════════════════════════════
    function allocate(address user, uint256 amount) external onlyAllowed {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 required = totalAllocated + amount - totalClaimed;

        if (token.balanceOf(address(this)) < required) {
            revert InsufficientBalance();
        }

        vesting[user].total += amount;
        totalAllocated += amount;

        emit Allocated(user, amount);
    }
     
     function getReservedTokens() external view returns (uint256) {
    // الرموز المحجوزة = المخصصات التي لم تُسحب بعد
    return totalAllocated - totalClaimed;
    }
    // ═══════════════════════════════════════════════
    // CLAIM LOGIC
    // ═══════════════════════════════════════════════
    function claim() external nonReentrant whenNotPaused {
        Vest storage v = vesting[msg.sender];

        if (v.total == 0) revert NoAllocation();
        if (block.timestamp < startTime + CLIFF) revert CliffNotReached();

        uint256 claimableAmount = _releasable(msg.sender);
        if (claimableAmount == 0) revert NothingToClaim();

        v.claimed += claimableAmount;
        totalClaimed += claimableAmount;

        token.safeTransfer(msg.sender, claimableAmount);

        emit Claimed(msg.sender, claimableAmount);
    }

    function _releasable(address user) internal view returns (uint256) {
        Vest storage v = vesting[user];
        if (v.total == 0) return 0;

        uint256 elapsed = block.timestamp - (startTime + CLIFF);

        uint256 stages = (elapsed / MONTH) + 1;
        if (stages > TOTAL_STAGES) stages = TOTAL_STAGES;

        uint256 vested = (v.total * stages * STAGE_SHARE) / 100;

        if (vested <= v.claimed) return 0;

        return vested - v.claimed;
    }

    function releasable(address user)
        external
        view
        returns (uint256)
    {
        return _releasable(user);
    }

    // ═══════════════════════════════════════════════
    // GOVERNANCE FINAL LOCK
    // ═══════════════════════════════════════════════
    function finalize() external onlyGov {
        if (block.timestamp < govStart + LOCK_180) revert RoleLocked();
        finalized = true;
        emit Finalized(block.timestamp);
    }

    function _isLocked() internal view returns (bool) {
        return finalized || block.timestamp >= govStart + LOCK_180;
    }

    function grantRole(bytes32 role, address account) public override onlyGov {
        if (_isLocked()) revert RoleLocked();
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyGov {
        if (_isLocked()) revert RoleLocked();
        super.revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) public override {
        if (_isLocked()) revert RoleLocked();
        super.renounceRole(role, account);
    }

    // ═══════════════════════════════════════════════
    // EMERGENCY RECOVERY
    // ═══════════════════════════════════════════════
    function rescueERC20(
        address erc20,
        address to,
        uint256 amount
    )
        external
        onlyGov
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        IERC20(erc20).safeTransfer(to, amount);

        emit ERC20Rescued(erc20, to, amount);
    }
}