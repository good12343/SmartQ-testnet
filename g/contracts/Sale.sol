// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IPriceOracle {
    function getCurrency(address currency)
        external
        view
        returns (bool supported, uint8 decimals, uint256 priceUsd);
    
    function quote(address currency, uint256 amount)
        external
        view
        returns (uint256);
}

interface IVesting {
    function allocate(address user, uint256 amount) external;
    function getReservedTokens() external view returns (uint256);
}

contract Sale is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ───── ERRORS ─────
    error Sale__NotActive();
    error Sale__CurrencyNotSupported();
    error Sale__ExceedsWalletCap();
    error Sale__ExceedsSaleCap();
    error Sale__BelowMinPurchase();
    error Sale__Cooldown();
    error Sale__InsufficientVesting();
    error Sale__ZeroAddress();
    error Sale__InvalidToken();
    error Sale__Finalized();
    error Sale__NotFinalized();
    error Sale__NothingToReclaim();

    // ───── ROLES ─────
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ───── STATE ─────
    address public immutable token;
    IVesting public vesting;
    IPriceOracle public priceOracle;
    address public treasury;

    uint256 public saleCap;
    uint256 public walletCap;
    uint256 public minPurchase;
    uint256 public totalSold;

    uint256 public saleStart;
    uint256 public saleEnd;
    uint256 public cooldown = 60;

    bool public finalized;

    mapping(address => uint256) public bought;
    mapping(address => uint256) public lastBuy;

    // ───── EVENTS ─────
    event Purchased(address indexed user, address indexed currency, uint256 paid, uint256 tokens);
    event CooldownUpdated(uint256 newCooldown);
    event WalletCapUpdated(uint256 newCap);
    event MinPurchaseUpdated(uint256 newMin);
    event Finalized(uint256 timestamp);
    event UnsoldReclaimed(uint256 amount);
    event SaleWindowUpdated(uint256 indexed start, uint256 indexed end);


    // ───── MODIFIERS ─────
    modifier notFinalized() {
        if (finalized) revert Sale__Finalized();
        _;
    }

    constructor(
        address _token,
        address _vesting,
        address _oracle,
        address _treasury,
        address admin,
        uint256 _saleCap,
        uint256 _walletCap,
        uint256 _minPurchase,
        uint256 _start,
        uint256 _end
    ) {
        if (_token == address(0) || _vesting == address(0) || _oracle == address(0) || 
            _treasury == address(0) || admin == address(0)) {
            revert Sale__ZeroAddress();
        }

        token = _token;
        vesting = IVesting(_vesting);
        priceOracle = IPriceOracle(_oracle);
        treasury = _treasury;

        saleCap = _saleCap;
        walletCap = _walletCap;
        minPurchase = _minPurchase;

        saleStart = _start;
        saleEnd = _end;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ───── BUY ETH ─────
    function buyETH()
        external
        payable
        nonReentrant
        whenNotPaused
        notFinalized
    {
        if (msg.value == 0) revert Sale__BelowMinPurchase();

        _validateBuy(address(0), msg.value);
        _executeBuy(address(0), msg.value);

        // Forward ETH to treasury
        (bool ok,) = payable(treasury).call{value: msg.value}("");
        if (!ok) revert Sale__ZeroAddress(); // Using existing error for transfer failure
    }

    // ───── BUY ERC20 ─────
    function buyToken(address currency, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        notFinalized
    {
        if (currency == address(0)) revert Sale__InvalidToken();

        _validateBuy(currency, amount);

        IERC20(currency).safeTransferFrom(msg.sender, treasury, amount);

        _executeBuy(currency, amount);
    }

    // ───── VALIDATION ─────
    function _validateBuy(address currency, uint256 amount)
        internal
        view
    {
        if (block.timestamp < saleStart || block.timestamp > saleEnd) {
            revert Sale__NotActive();
        }

        (bool supported, , ) = priceOracle.getCurrency(currency);
        if (!supported) revert Sale__CurrencyNotSupported();

        uint256 tokensToAllocate = priceOracle.quote(currency, amount);

        if (tokensToAllocate < minPurchase) revert Sale__BelowMinPurchase();
        if (bought[msg.sender] + tokensToAllocate > walletCap) revert Sale__ExceedsWalletCap();
        if (totalSold + tokensToAllocate > saleCap) revert Sale__ExceedsSaleCap();
        if (block.timestamp < lastBuy[msg.sender] + cooldown) revert Sale__Cooldown();

        if (tokensToAllocate > _availableVesting()) revert Sale__InsufficientVesting();
    }

    // ───── EXECUTION ─────
    function _executeBuy(address currency, uint256 amount)
        internal
    {
        uint256 tokensToAllocate = priceOracle.quote(currency, amount);

        vesting.allocate(msg.sender, tokensToAllocate);

        bought[msg.sender] += tokensToAllocate;
        totalSold += tokensToAllocate;
        lastBuy[msg.sender] = block.timestamp;

        emit Purchased(msg.sender, currency, amount, tokensToAllocate);
    }

    // ───── VESTING CHECK ─────
    function _availableVesting() internal view returns (uint256) {
        uint256 reserved = vesting.getReservedTokens();
        uint256 bal = IERC20(token).balanceOf(address(vesting));
        return bal > reserved ? bal - reserved : 0;
    }

    // ───── ADMIN SETTERS ─────
    function setCooldown(uint256 c)
        external
        onlyRole(OPERATOR_ROLE)
        notFinalized
    {
        cooldown = c;
        emit CooldownUpdated(c);
    }

    function setWalletCap(uint256 cap)
        external
        onlyRole(OPERATOR_ROLE)
        notFinalized
    {
        walletCap = cap;
        emit WalletCapUpdated(cap);
    }

    function setMinPurchase(uint256 min)
        external
        onlyRole(OPERATOR_ROLE)
        notFinalized
    {
        minPurchase = min;
        emit MinPurchaseUpdated(min);
    }

    function setSaleWindow(uint256 start, uint256 end)
    external
    onlyRole(OPERATOR_ROLE)
    notFinalized
    {
    require(block.timestamp < saleStart, "Sale already started");
    require(start >= block.timestamp, "Start must be in future");  // ✅ جديد
    require(end > start, "Invalid window");
    require(end - start <= 365 days, "Window too long");           // ✅ جديد (اختياري)
    require(end - start >= 1 hours, "Window too short");           // ✅ جديد (اختياري)

    saleStart = start;
    saleEnd = end;

    emit SaleWindowUpdated(start, end);  // ✅ إضافة event
    }


    // ───── FINALIZE ─────
    function finalize()
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (block.timestamp < saleEnd) revert Sale__NotActive();
        finalized = true;
        _pause();
        emit Finalized(block.timestamp);
    }

    // ───── RECLAIM ─────
    function reclaimUnsold()
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (!finalized) revert Sale__NotFinalized();

        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert Sale__NothingToReclaim();

        IERC20(token).safeTransfer(treasury, bal);

        emit UnsoldReclaimed(bal);
    }

    // ───── PAUSE ─────
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
}