// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

    mapping(address => uint256) public bought;
    mapping(address => uint256) public lastBuy;

    // ───── EVENTS ─────
    event Purchased(address indexed user, address indexed currency, uint256 paid, uint256 tokens);

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
    function buyETH() external payable nonReentrant whenNotPaused {
        _buy(address(0), msg.value);
    }

    // ───── BUY ERC20 ─────
    function buyToken(address currency, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        IERC20(currency).safeTransferFrom(msg.sender, treasury, amount);
        _buy(currency, amount);
    }

    // ───── CORE ─────
    function _buy(address currency, uint256 amount) internal {
    if (block.timestamp < saleStart || block.timestamp > saleEnd) {
        revert Sale__NotActive();
    }

    // جلب عدد التوكنات مباشرة من PriceOracle
    uint256 tokensToAllocate = priceOracle.quote(currency, amount);

    // جلب معلومات العملة للتحقق من الدعم
    (bool supported, , ) = priceOracle.getCurrency(currency);
    if (!supported) revert Sale__CurrencyNotSupported();

    if (tokensToAllocate < minPurchase) revert Sale__BelowMinPurchase();
    if (bought[msg.sender] + tokensToAllocate > walletCap) revert Sale__ExceedsWalletCap();
    if (totalSold + tokensToAllocate > saleCap) revert Sale__ExceedsSaleCap();
    if (block.timestamp < lastBuy[msg.sender] + cooldown) revert Sale__Cooldown();

    if (tokensToAllocate > _availableVesting()) revert Sale__InsufficientVesting();

    vesting.allocate(msg.sender, tokensToAllocate);

    bought[msg.sender] += tokensToAllocate;
    totalSold += tokensToAllocate;
    lastBuy[msg.sender] = block.timestamp;

    emit Purchased(msg.sender, currency, amount, tokensToAllocate);
    }

    // ───── MATH ─────
    function _calc(uint256 amount, uint256 priceUsd, uint8 decimals)
        internal
        pure
        returns (uint256)
    {
        return (amount * priceUsd * 1e18) / (priceUsd * 1e6 * 10 ** decimals);
    }

    // ───── VESTING CHECK ─────
    function _availableVesting() internal view returns (uint256) {
        uint256 reserved = vesting.getReservedTokens();
        uint256 bal = IERC20(token).balanceOf(address(vesting));
        return bal > reserved ? bal - reserved : 0;
    }

    // ───── ADMIN ─────
    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    receive() external payable {}
}