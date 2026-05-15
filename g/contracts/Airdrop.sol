// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IVesting {
    function allocate(address user, uint256 amount) external;
    function getReservedTokens() external view returns (uint256);
}

contract Airdrop is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ================= ERRORS =================
    error ZeroAddress();
    error InvalidProof();
    error AlreadyClaimed();
    error NotActive();
    error DeadlinePassed();
    error InvalidAmount();
    error ExceedsCap();
    error InsufficientVestingBalance();
    error RootNotSet();
    error Unauthorized();
    error Finalized();
    error NotFinalized();
    error NothingToReclaim();

    // ================= ROLES =================
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ================= CONSTANTS =================
    uint256 public constant GOVERNANCE_LOCK = 10 days;
    uint256 public constant MAX_WINDOW_EXTENSION = 10 days;

    // ================= STATE =================
    IERC20 public immutable token;
    IVesting public vesting;
    address public treasury;

    bytes32 public merkleRoot;
    uint256 public claimStart;
    uint256 public claimEnd;

    uint256 public maxAllocation;
    uint256 public totalAllocated;

    mapping(address => bool) public claimed;

    bool public finalized;
    uint256 public immutable startTime;

    // ================= EVENTS =================
    event RootSet(bytes32 root, uint256 start, uint256 end, uint256 cap);
    event Claimed(address user, uint256 amount);
    event VestingUpdated(address vesting);
    event TreasuryUpdated(address treasury);
    event AirdropFinalized(uint256 timestamp);
    event UnsoldReclaimed(uint256 amount);

    // ================= MODIFIERS =================
    modifier onlyGov() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        _;
    }

    modifier active() {
        if (merkleRoot == bytes32(0)) revert RootNotSet();
        if (block.timestamp < claimStart) revert NotActive();
        if (block.timestamp > claimEnd) revert DeadlinePassed();
        _;
    }

    modifier notFinalized() {
        if (finalized) revert Finalized();
        _;
    }

    // ================= CONSTRUCTOR =================
    constructor(
        address _token,
        address _vesting,
        address _treasury,
        address _gov
    ) {
        if (_token == address(0) || _vesting == address(0) || _gov == address(0)) {
            revert ZeroAddress();
        }

        token = IERC20(_token);
        vesting = IVesting(_vesting);
        treasury = _treasury;

        startTime = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _gov);
        _grantRole(GOVERNANCE_ROLE, _gov);
        _grantRole(OPERATOR_ROLE, _gov);
    }

    // ================= SETUP =================
    function setMerkleRoot(
        bytes32 _root,
        uint256 _start,
        uint256 _end,
        uint256 _cap
    ) external onlyGov notFinalized {
        if (_root == bytes32(0)) revert RootNotSet();
        if (_start >= _end) revert InvalidAmount();
        if (_end > block.timestamp + MAX_WINDOW_EXTENSION) revert InvalidAmount();

        merkleRoot = _root;
        claimStart = _start;
        claimEnd = _end;
        maxAllocation = _cap;

        emit RootSet(_root, _start, _end, _cap);
    }

    // ================= CLAIM =================
    function claim(
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant whenNotPaused active {
        if (amount == 0) revert InvalidAmount();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, block.chainid)
        );

        if (!MerkleProof.verify(proof, merkleRoot, leaf)) {
            revert InvalidProof();
        }

        if (totalAllocated + amount > maxAllocation) {
            revert ExceedsCap();
        }

        uint256 available = _vestingAvailable();
        if (amount > available) revert InsufficientVestingBalance();

        claimed[msg.sender] = true;
        totalAllocated += amount;

        vesting.allocate(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }

    // ================= INTERNAL =================
    function _vestingAvailable() internal view returns (uint256) {
        uint256 bal = token.balanceOf(address(vesting));
        uint256 reserved = vesting.getReservedTokens();
        return bal > reserved ? bal - reserved : 0;
    }

    // ================= GOVERNANCE =================
    function updateVesting(address _v) external onlyGov notFinalized {
        if (_v == address(0)) revert ZeroAddress();
        vesting = IVesting(_v);
        emit VestingUpdated(_v);
    }

    function updateTreasury(address _t) external onlyGov notFinalized {
        if (_t == address(0)) revert ZeroAddress();
        treasury = _t;
        emit TreasuryUpdated(_t);
    }

    function finalize() external onlyGov {
        require(block.timestamp > claimEnd, "not ended");
        finalized = true;
        _pause();
        emit AirdropFinalized(block.timestamp);
    }

    // ================= RECLAIM UNSOLD =================
    function reclaimUnsold() external onlyGov {
        if (!finalized) revert NotFinalized();

        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) revert NothingToReclaim();

        token.safeTransfer(treasury, bal);

        emit UnsoldReclaimed(bal);
    }

    // ================= SAFETY =================
    function pause() external onlyGov {
        _pause();
    }

    function unpause() external onlyGov {
        _unpause();
    }
}