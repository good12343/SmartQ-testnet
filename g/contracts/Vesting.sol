// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Vesting is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    bytes32 public constant SALE_ROLE = keccak256("SALE_ROLE");  // ← جديد

    uint256 public constant CLIFF = 30 days;
    uint256 public constant VESTING_DURATION = 90 days;
    uint256 public constant GOVERNANCE_PERIOD = 180 days;
    uint256 public constant PROPOSAL_EXPIRY = 3 days;
    uint256 public constant MAX_SIGNERS = 50;

    IERC20 public immutable token;
    address public immutable timelock;
    uint64 public immutable deployedAt;

    bool public finalized;
    uint256 public proposalNonce;
    uint256 public threshold;

    enum ProposalType { CREATE, CANCEL, FINALIZE }

    struct VestingSchedule {
        uint256 totalAllocation;
        uint256 vestingAllocation;
        uint256 released;
        uint64 start;
        bool active;
        bool cancelled;
        uint256 immediate;
    }

    struct Proposal {
        ProposalType pType;
        address user;
        uint256 amount;
        uint256 approvals;
        uint64 createdAt;
        bool executed;
    }

    mapping(address => VestingSchedule) public vesting;
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public approved;

    mapping(address => bool) public isSigner;
    address[] public signers;

    uint256 public totalAllocated;
    uint256 public totalReleased;
    uint256 public obligations;

    // ← جديد: تتبع المشتريات من Sale
    mapping(address => uint256) public salePurchased;

    event VestingCreated(address indexed user, uint256 total, uint256 immediate, uint256 vest);
    event VestingCancelled(address indexed user, uint256 remaining);
    event TokensReleased(address indexed user, uint256 amount);
    event ProposalCreated(bytes32 indexed id, ProposalType pType, address indexed user, uint256 amount);
    event ProposalApproved(bytes32 indexed id, address indexed signer);
    event ProposalExecuted(bytes32 indexed id);
    event Finalized(uint256 timestamp);
    event GovernanceEnded();
    event Funded(address indexed from, uint256 amount);
    event SaleDeposit(address indexed user, uint256 amount);  // ← جديد

    constructor(
        address _token,
        address _timelock,
        address[] memory _signers,
        uint256 _threshold
    ) {
        require(_token != address(0), "Invalid token");
        require(_timelock != address(0), "Invalid timelock");
        require(_signers.length > 0 && _signers.length <= MAX_SIGNERS, "Bad signers");
        require(_threshold >= 2 && _threshold <= _signers.length, "Bad threshold");

        token = IERC20(_token);
        timelock = _timelock;
        deployedAt = uint64(block.timestamp);
        threshold = _threshold;

        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        _grantRole(FUNDER_ROLE, _timelock);

        for (uint i; i < _signers.length; i++) {
            require(_signers[i] != address(0), "Invalid signer");
            require(!isSigner[_signers[i]], "Duplicate signer");
            isSigner[_signers[i]] = true;
            signers.push(_signers[i]);
        }
    }

    modifier onlySigner() {
        require(isSigner[msg.sender], "Not signer");
        _;
    }

    modifier onlyActive() {
        require(!finalized, "Finalized");
        _;
    }

    // ========== دوال Multi-Sig الأصلية ==========

    function fund(uint256 amount) external onlyRole(FUNDER_ROLE) onlyActive {
        require(amount > 0, "Zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function createProposal(
        ProposalType pType,
        address user,
        uint256 amount
    ) external onlyRole(FUNDER_ROLE) onlyActive returns (bytes32) {

        require(amount > 0, "Zero amount");
        bytes32 id = keccak256(abi.encode(pType, user, amount, proposalNonce++));
        proposals[id] = Proposal(pType, user, amount, 0, uint64(block.timestamp), false);

        emit ProposalCreated(id, pType, user, amount);
        return id;
    }

    function approve(bytes32 id) external onlySigner onlyActive {
        Proposal storage p = proposals[id];

        require(p.createdAt != 0, "Invalid");
        require(!p.executed, "Executed");
        require(block.timestamp <= p.createdAt + PROPOSAL_EXPIRY, "Expired");
        require(!approved[id][msg.sender], "Approved");

        approved[id][msg.sender] = true;
        p.approvals++;

        emit ProposalApproved(id, msg.sender);
    }

    function execute(bytes32 id) external onlySigner nonReentrant onlyActive {
        Proposal storage p = proposals[id];

        require(p.createdAt != 0, "Invalid");
        require(!p.executed, "Executed");
        require(block.timestamp <= p.createdAt + PROPOSAL_EXPIRY, "Expired");
        require(p.approvals >= threshold, "Not enough");

        p.executed = true;

        if (p.pType == ProposalType.CREATE) {
            _create(p.user, p.amount);
        } 
        else if (p.pType == ProposalType.CANCEL) {
            _cancel(p.user);
        } 
        else if (p.pType == ProposalType.FINALIZE) {
            _finalize();
        }

        emit ProposalExecuted(id);
    }

    // ========== دوال Vesting الأصلية ==========

    function release() external nonReentrant {
        VestingSchedule storage s = vesting[msg.sender];
        require(s.active, "Inactive");

        uint256 amount = releasable(msg.sender);
        require(amount > 0, "Nothing");

        s.released += amount;
        obligations -= amount;
        totalReleased += amount;

        token.safeTransfer(msg.sender, amount);

        emit TokensReleased(msg.sender, amount);
    }

    function releasable(address user) public view returns (uint256) {
        VestingSchedule storage s = vesting[user];
        if (!s.active) return 0;

        if (block.timestamp < s.start + CLIFF) return 0;

        if (block.timestamp >= s.start + VESTING_DURATION) {
            return s.vestingAllocation - s.released;
        }

        uint256 elapsed = block.timestamp - s.start - CLIFF;
        uint256 duration = VESTING_DURATION - CLIFF;

        uint256 vested = (s.vestingAllocation * elapsed) / duration;
        return vested > s.released ? vested - s.released : 0;
    }

    // ========== دوال داخلية ==========

    function _create(address user, uint256 amount) internal {
        require(user != address(0), "Invalid user");
        require(!vesting[user].active && !vesting[user].cancelled, "Exists");

        uint256 immediate = (amount * 2500) / 10000;
        uint256 vest = amount - immediate;

        require(token.balanceOf(address(this)) >= obligations + vest, "Insufficient");

        vesting[user] = VestingSchedule(
            amount,
            vest,
            0,
            uint64(block.timestamp),
            true,
            false,
            immediate
        );

        obligations += vest;
        totalAllocated += amount;
        totalReleased += immediate;

        if (immediate > 0) {
            token.safeTransfer(user, immediate);
        }

        emit VestingCreated(user, amount, immediate, vest);
    }

    function _cancel(address user) internal {
        VestingSchedule storage s = vesting[user];
        require(s.active && !s.cancelled, "Invalid");

        uint256 remaining = s.vestingAllocation - s.released;

        s.cancelled = true;
        s.active = false;

        obligations -= remaining;

        if (remaining > 0) {
            token.safeTransfer(user, remaining);
        }

        emit VestingCancelled(user, remaining);
    }

    function _finalize() internal {
        require(!finalized, "Finalized");

        finalized = true;

        uint256 balance = token.balanceOf(address(this));
        uint256 excess = balance - obligations;

        if (excess > 0) {
            token.safeTransfer(timelock, excess);
        }

        emit Finalized(block.timestamp);

        if (block.timestamp >= deployedAt + GOVERNANCE_PERIOD) {
            emit GovernanceEnded();
        }
    }

    // ========== دوال جديدة للـ Sale ==========

    /// @notice منح صلاحية Sale Contract
    function grantSaleRole(address saleContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(saleContract != address(0), "Invalid address");
        _grantRole(SALE_ROLE, saleContract);
    }

    /// @notice سحب صلاحية Sale Contract
    function revokeSaleRole(address saleContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(SALE_ROLE, saleContract);
    }

    /// @notice إيداع مباشر من Sale Contract (25% فوراً + 75% قفل)
    function deposit(address user, uint256 amount) external onlyRole(SALE_ROLE) nonReentrant {
        require(amount > 0, "Zero amount");
        require(user != address(0), "Invalid user");
        VestingSchedule storage s = vesting[user];

        require(!s.cancelled, "Cancelled");


        uint256 immediate = (amount * 2500) / 10000;  // 25%
        uint256 vest = amount - immediate;            // 75%

        require(token.balanceOf(address(this)) >= obligations + vest, "Insufficient balance");

        // تحديث الحالة
        
        if (!s.active) {
        s.start = uint64(block.timestamp);
        s.active = true;
        s.cancelled = false;
        }

        s.totalAllocation += amount;
        s.vestingAllocation += vest;
        s.immediate += immediate;
        

        obligations += vest;
        totalAllocated += amount;
        totalReleased += immediate;
        salePurchased[user] += amount;

        // إرسال 25% فوراً
        if (immediate > 0) {
            token.safeTransfer(user, immediate);
        }

        emit SaleDeposit(user, amount);
        emit VestingCreated(user, amount, immediate, vest);
    }

    /// @notice الحصول على معلومات مشتريات المستخدم من Sale
    function getSaleInfo(address user) external view returns (
        uint256 totalPurchased,
        uint256 immediateReceived,
        uint256 lockedAmount,
        uint256 releasableAmount,
        uint256 releasedAmount
    ) {
        VestingSchedule memory s = vesting[user];
        return (
            salePurchased[user],
            s.immediate,
            s.vestingAllocation,
            releasable(user),
            s.released
        );
    }

    // ========== دوال الاستعلام ==========

    function getSigners() external view returns (address[] memory) { return signers; }
    function getProposal(bytes32 id) external view returns (Proposal memory) { return proposals[id]; }
    function getVesting(address user) external view returns (VestingSchedule memory) { return vesting[user]; }
}
