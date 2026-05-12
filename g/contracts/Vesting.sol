// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    error AlreadyAllocated();
    error CliffNotReached();
    error NothingToClaim();
    error InsufficientBalance();
    error RoleLocked();

    // ═══════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant DEPOSITOR_ROLE  = keccak256("DEPOSITOR_ROLE");

    uint256 public constant CLIFF = 180 days;
    uint256 public constant MONTH = 30 days;
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
    mapping(address => bool) public depositor;

    uint256 public totalAllocated;
    uint256 public totalClaimed;

    // ═══════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════
    event Allocated(address user, uint256 amount);
    event Claimed(address user, uint256 amount);
    event Deposited(uint256 amount);
    event Finalized(uint256 time);

    // ═══════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════
    modifier onlyGov() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotAuthorized();
        _;
    }

    modifier onlyAllowed() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender) && !depositor[msg.sender]) {
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

    function setDepositor(address user, bool ok) external onlyGov {
        depositor[user] = ok;
    }

    // ═══════════════════════════════════════════════
    // ALLOCATION
    // ═══════════════════════════════════════════════
    function allocate(address user, uint256 amount) external onlyAllowed {
        if (user == address(0)) revert ZeroAddress();
        if (vesting[user].total != 0) revert AlreadyAllocated();

        uint256 required = totalAllocated + amount - totalClaimed;

        if (token.balanceOf(address(this)) < required) {
            revert InsufficientBalance();
        }

        vesting[user] = Vest({
            total: amount,
            claimed: 0
        });

        totalAllocated += amount;

        emit Allocated(user, amount);
    }

    // ═══════════════════════════════════════════════
    // CLAIM LOGIC
    // ═══════════════════════════════════════════════
    function claim() external nonReentrant whenNotPaused {
        Vest storage v = vesting[msg.sender];

        if (v.total == 0) revert NoAllocation();
        if (block.timestamp < startTime + CLIFF) revert CliffNotReached();

        uint256 releasable = _releasable(msg.sender);
        if (releasable == 0) revert NothingToClaim();

        v.claimed += releasable;
        totalClaimed += releasable;

        token.safeTransfer(msg.sender, releasable);

        emit Claimed(msg.sender, releasable);
    }

    function _releasable(address user) internal view returns (uint256) {
        Vest memory v = vesting[user];
        if (v.total == 0) return 0;

        uint256 elapsed = block.timestamp - (startTime + CLIFF);

        uint256 stages = (elapsed / MONTH) + 1;
        if (stages > TOTAL_STAGES) stages = TOTAL_STAGES;

        uint256 vested = (v.total * stages * STAGE_SHARE) / 100;

        if (vested <= v.claimed) return 0;

        return vested - v.claimed;
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

    receive() external payable {}
}