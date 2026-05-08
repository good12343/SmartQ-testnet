// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Sale
 * @dev Presale / Token Sale Contract — Payment Router + Allocation Engine
 *
 * Security & Design Principles:
 * 1. Payments are forwarded directly to the treasury.
 * 2. Project tokens are expected to be pre-funded in Vesting, not held by Sale.
 * 3. Sale calculates allocations and calls Vesting.allocate(user, amount).
 * 4. Critical admin actions are protected by a 48h timelock.
 * 5. Governance actions are locked after 180 days, except rescue actions.
 * 6. Emergency pause/unpause is supported through timelocked governance.
 *
 * IMPORTANT INTEGRATION REQUIREMENT:
 * Vesting contract must expose allocate(address user, uint256 amount), and Sale
 * must be authorized by Vesting to allocate from pre-funded Vesting reserves.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IVesting {
    function allocate(address _user, uint256 _amount) external;
    function getReservedTokens() external view returns (uint256);
}

contract Sale is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════
    error Sale__ZeroAddress();
    error Sale__NotGovernance();
    error Sale__NotAuthorized();
    error Sale__LockPeriodNotElapsed();
    error Sale__ActionAlreadyExecuted();
    error Sale__ActionNotProposed();
    error Sale__TimelockNotElapsed();
    error Sale__ActionExpired();
    error Sale__FunctionLockedAfter180Days();
    error Sale__RoleManagementLocked();
    error Sale__SaleNotActive();
    error Sale__SaleAlreadyEnded();
    error Sale__SaleNotStarted();
    error Sale__SaleAlreadyActive();
    error Sale__InvalidAmount();
    error Sale__ExceedsWalletCap();
    error Sale__ExceedsSaleCap();
    error Sale__BelowMinPurchase();
    error Sale__CooldownNotElapsed();
    error Sale__CurrencyNotSupported();
    error Sale__CurrencyAlreadySupported();
    error Sale__InvalidPrice();
    error Sale__InvalidTimeRange();
    error Sale__TransferToTreasuryFailed();
    error Sale__InsufficientTokensInVesting();
    error Sale__NoEthToRescue();
    error Sale__EthTransferFailed();
    error Sale__InvalidDecimals();

    // ═══════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant GOVERNANCE_LOCK_PERIOD = 180 days;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant TIMELOCK_GRACE_PERIOD = 7 days;
    uint256 public constant TOKEN_DECIMALS = 18;
    uint256 public constant PRICE_PRECISION = 1e6;

    // ═══════════════════════════════════════════════════════════════
    // SALE STATES & GOVERNANCE ACTIONS
    // ═══════════════════════════════════════════════════════════════
    enum SaleState {
        Inactive,
        Active,
        Ended
    }

    enum ActionType {
        StartSale,
        EndSale,
        UpdatePrice,
        UpdateTimes,
        UpdateCaps,
        UpdateMinPurchase,
        UpdateCooldown,
        AddCurrency,
        RemoveCurrency,
        UpdateTreasury,
        UpdateVesting,
        FinalizeGovernance,
        RescueTokens,
        RescueEth,
        Pause,
        Unpause,
        UpdateCurrencyPrice
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
    // CURRENCY SUPPORT
    // ═══════════════════════════════════════════════════════════════
    struct Currency {
        bool supported;
        uint8 decimals;
        uint256 price; // price per 1 project token, scaled by PRICE_PRECISION
    }

    /// @notice ETH is represented as address(0).
    mapping(address => Currency) public currencies;
    address[] private supportedCurrencyList;
    mapping(address => uint256) private currencyIndexPlusOne;

    // ═══════════════════════════════════════════════════════════════
    // SALE PARAMETERS
    // ═══════════════════════════════════════════════════════════════
    address public projectToken;
    IVesting public vestingContract;
    address public treasury;

    uint256 public saleStart;
    uint256 public saleEnd;

    /// @notice Kept as a public base ETH/default price for backwards compatibility.
    uint256 public tokenPrice;

    uint256 public saleCap;
    uint256 public minPurchase;
    uint256 public walletCap;
    uint256 public purchaseCooldown;
    uint256 public totalSold;

    uint256 public immutable governanceStartTime;
    bool public governanceFinalized;
    SaleState public saleState;

    // ═══════════════════════════════════════════════════════════════
    // USER TRACKING
    // ═══════════════════════════════════════════════════════════════
    mapping(address => uint256) public totalPurchased;
    mapping(address => uint256) public lastPurchaseTime;
    uint256 public totalBuyers;
    mapping(address => bool) public hasPurchased;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    event ActionProposed(bytes32 indexed actionId, ActionType indexed actionType, uint256 eta, uint256 nonce);
    event ActionExecuted(bytes32 indexed actionId, ActionType indexed actionType);
    event TokensPurchased(
        address indexed buyer,
        address indexed currency,
        uint256 paidAmount,
        uint256 tokenAmount,
        uint256 timestamp
    );
    event SaleStarted(uint256 startTime, uint256 endTime);
    event SaleEnded(uint256 endTime, uint256 totalSold);
    event TreasuryUpdated(address indexed newTreasury);
    event VestingUpdated(address indexed newVesting);
    event CurrencyAdded(address indexed currency, uint256 price, uint8 decimals);
    event CurrencyRemoved(address indexed currency);
    event PriceUpdated(address indexed currency, uint256 oldPrice, uint256 newPrice);
    event CapsUpdated(uint256 walletCap, uint256 saleCap);
    event MinPurchaseUpdated(uint256 oldMinPurchase, uint256 newMinPurchase);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event GovernanceFinalized(uint256 timestamp);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event EthRescued(address indexed to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════
    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert Sale__NotGovernance();
        _;
    }

    modifier onlyAuthorized() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender) && !hasRole(OPERATOR_ROLE, msg.sender)) {
            revert Sale__NotAuthorized();
        }
        _;
    }

    modifier whenSaleActive() {
        if (saleState != SaleState.Active) revert Sale__SaleNotActive();
        if (block.timestamp < saleStart) revert Sale__SaleNotStarted();
        if (block.timestamp > saleEnd) revert Sale__SaleAlreadyEnded();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    constructor(
        address _projectToken,
        address _vesting,
        address _treasury,
        address _multiSigGovernance,
        uint256 _tokenPrice,
        uint256 _saleCap,
        uint256 _minPurchase,
        uint256 _saleStart,
        uint256 _saleEnd
    ) {
        if (_projectToken == address(0)) revert Sale__ZeroAddress();
        if (_vesting == address(0)) revert Sale__ZeroAddress();
        if (_treasury == address(0)) revert Sale__ZeroAddress();
        if (_multiSigGovernance == address(0)) revert Sale__ZeroAddress();
        if (_tokenPrice == 0) revert Sale__InvalidPrice();
        if (_saleCap == 0) revert Sale__InvalidAmount();
        if (_saleStart == 0 || _saleEnd == 0) revert Sale__InvalidTimeRange();
        if (_saleEnd <= _saleStart) revert Sale__InvalidTimeRange();
        if (_saleStart < block.timestamp) revert Sale__InvalidTimeRange();

        projectToken = _projectToken;
        vestingContract = IVesting(_vesting);
        treasury = _treasury;
        tokenPrice = _tokenPrice;
        saleCap = _saleCap;
        minPurchase = _minPurchase;
        walletCap = 10_000_000 * 10 ** TOKEN_DECIMALS;
        purchaseCooldown = 60 seconds;
        saleStart = _saleStart;
        saleEnd = _saleEnd;
        governanceStartTime = block.timestamp;
        saleState = SaleState.Inactive;

        _grantRole(DEFAULT_ADMIN_ROLE, _multiSigGovernance);
        _grantRole(GOVERNANCE_ROLE, _multiSigGovernance);
        _grantRole(OPERATOR_ROLE, _multiSigGovernance);

        currencies[address(0)] = Currency({supported: true, decimals: 18, price: _tokenPrice});
        supportedCurrencyList.push(address(0));
        currencyIndexPlusOne[address(0)] = 1;
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

        if (proposal.timestamp == 0) revert Sale__ActionNotProposed();
        if (proposal.executed) revert Sale__ActionAlreadyExecuted();
        if (block.timestamp < proposal.timestamp + TIMELOCK_DELAY) revert Sale__TimelockNotElapsed();
        if (block.timestamp > proposal.timestamp + TIMELOCK_DELAY + TIMELOCK_GRACE_PERIOD) {
            revert Sale__ActionExpired();
        }

        _validateGovernanceActionAllowed(proposal.actionType);
        proposal.executed = true;

        if (proposal.actionType == ActionType.StartSale) {
            _startSale();
        } else if (proposal.actionType == ActionType.EndSale) {
            _endSale();
        } else if (proposal.actionType == ActionType.UpdatePrice) {
            uint256 newPrice = abi.decode(proposal.data, (uint256));
            _updatePrice(newPrice);
        } else if (proposal.actionType == ActionType.UpdateTimes) {
            (uint256 newStart, uint256 newEnd) = abi.decode(proposal.data, (uint256, uint256));
            _updateTimes(newStart, newEnd);
        } else if (proposal.actionType == ActionType.UpdateCaps) {
            (uint256 newWalletCap, uint256 newSaleCap) = abi.decode(proposal.data, (uint256, uint256));
            _updateCaps(newWalletCap, newSaleCap);
        } else if (proposal.actionType == ActionType.UpdateMinPurchase) {
            uint256 newMin = abi.decode(proposal.data, (uint256));
            _updateMinPurchase(newMin);
        } else if (proposal.actionType == ActionType.UpdateCooldown) {
            uint256 newCooldown = abi.decode(proposal.data, (uint256));
            _updateCooldown(newCooldown);
        } else if (proposal.actionType == ActionType.AddCurrency) {
            (address currency, uint256 price, uint8 decimals_) = abi.decode(proposal.data, (address, uint256, uint8));
            _addCurrency(currency, price, decimals_);
        } else if (proposal.actionType == ActionType.RemoveCurrency) {
            address currency = abi.decode(proposal.data, (address));
            _removeCurrency(currency);
        } else if (proposal.actionType == ActionType.UpdateTreasury) {
            address newTreasury = abi.decode(proposal.data, (address));
            _updateTreasury(newTreasury);
        } else if (proposal.actionType == ActionType.UpdateVesting) {
            address newVesting = abi.decode(proposal.data, (address));
            _updateVesting(newVesting);
        } else if (proposal.actionType == ActionType.FinalizeGovernance) {
            _finalizeGovernance();
        } else if (proposal.actionType == ActionType.RescueTokens) {
            (address token, address to, uint256 amount) = abi.decode(proposal.data, (address, address, uint256));
            _rescueTokens(token, to, amount);
        } else if (proposal.actionType == ActionType.RescueEth) {
            address payable to = abi.decode(proposal.data, (address));
            _rescueEth(to);
        } else if (proposal.actionType == ActionType.Pause) {
            _pause();
        } else if (proposal.actionType == ActionType.Unpause) {
            _unpause();
        } else if (proposal.actionType == ActionType.UpdateCurrencyPrice) {
            (address currency, uint256 newPrice) = abi.decode(proposal.data, (address, uint256));
            _updateCurrencyPrice(currency, newPrice);
        }

        emit ActionExecuted(_actionId, proposal.actionType);
    }

    // ═══════════════════════════════════════════════════════════════
    // PURCHASE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function purchaseWithEth() external payable nonReentrant whenSaleActive whenNotPaused {
        if (msg.value == 0) revert Sale__InvalidAmount();

        uint256 tokenAmount = _calculateTokenAmount(address(0), msg.value);
        _validatePurchase(msg.sender, tokenAmount);

        (bool success, ) = payable(treasury).call{value: msg.value}("");
        if (!success) revert Sale__TransferToTreasuryFailed();

        _allocateToVesting(msg.sender, tokenAmount);
        _updatePurchaseTracking(msg.sender, tokenAmount);

        emit TokensPurchased(msg.sender, address(0), msg.value, tokenAmount, block.timestamp);
    }

    function purchaseWithERC20(address _currency, uint256 _amount)
        external
        nonReentrant
        whenSaleActive
        whenNotPaused
    {
        if (_amount == 0) revert Sale__InvalidAmount();
        if (_currency == address(0)) revert Sale__CurrencyNotSupported();

        uint256 treasuryBalanceBefore = IERC20(_currency).balanceOf(treasury);
        IERC20(_currency).safeTransferFrom(msg.sender, treasury, _amount);
        uint256 receivedAmount = IERC20(_currency).balanceOf(treasury) - treasuryBalanceBefore;
        if (receivedAmount == 0) revert Sale__InvalidAmount();

        uint256 tokenAmount = _calculateTokenAmount(_currency, receivedAmount);
        _validatePurchase(msg.sender, tokenAmount);

        _allocateToVesting(msg.sender, tokenAmount);
        _updatePurchaseTracking(msg.sender, tokenAmount);

        emit TokensPurchased(msg.sender, _currency, receivedAmount, tokenAmount, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════
    function _calculateTokenAmount(address _currency, uint256 _paidAmount) internal view returns (uint256) {
        Currency memory curr = currencies[_currency];
        if (!curr.supported) revert Sale__CurrencyNotSupported();
        if (curr.price == 0) revert Sale__InvalidPrice();
        if (curr.decimals > 77) revert Sale__InvalidDecimals();

        return (_paidAmount * PRICE_PRECISION * 10 ** TOKEN_DECIMALS) / (curr.price * 10 ** curr.decimals);
    }

    function _validatePurchase(address _buyer, uint256 _tokenAmount) internal view {
        if (_tokenAmount < minPurchase) revert Sale__BelowMinPurchase();
        if (totalPurchased[_buyer] + _tokenAmount > walletCap) revert Sale__ExceedsWalletCap();
        if (totalSold + _tokenAmount > saleCap) revert Sale__ExceedsSaleCap();
        if (block.timestamp < lastPurchaseTime[_buyer] + purchaseCooldown) revert Sale__CooldownNotElapsed();

        uint256 availableInVesting = _availableTokensInVesting();
        if (_tokenAmount > availableInVesting) revert Sale__InsufficientTokensInVesting();
    }

    function _availableTokensInVesting() internal view returns (uint256) {
        uint256 reserved = vestingContract.getReservedTokens();
        uint256 vestingBalance = IERC20(projectToken).balanceOf(address(vestingContract));
        return vestingBalance > reserved ? vestingBalance - reserved : 0;
    }

    function _allocateToVesting(address _buyer, uint256 _tokenAmount) internal {
        vestingContract.allocate(_buyer, _tokenAmount);
    }

    function _updatePurchaseTracking(address _buyer, uint256 _tokenAmount) internal {
        if (!hasPurchased[_buyer]) {
            hasPurchased[_buyer] = true;
            totalBuyers++;
        }

        totalPurchased[_buyer] += _tokenAmount;
        totalSold += _tokenAmount;
        lastPurchaseTime[_buyer] = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════
    // SALE STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    function _startSale() internal {
        if (saleState == SaleState.Active) revert Sale__SaleAlreadyActive();
        if (saleState == SaleState.Ended) revert Sale__SaleAlreadyEnded();
        if (block.timestamp >= saleEnd) revert Sale__SaleAlreadyEnded();

        saleState = SaleState.Active;
        if (block.timestamp > saleStart) saleStart = block.timestamp;

        emit SaleStarted(saleStart, saleEnd);
    }

    function _endSale() internal {
        if (saleState != SaleState.Active) revert Sale__SaleNotActive();
        saleState = SaleState.Ended;
        emit SaleEnded(block.timestamp, totalSold);
    }

    function _updatePrice(uint256 _newPrice) internal {
        _updateCurrencyPrice(address(0), _newPrice);
        tokenPrice = _newPrice;
    }

    function _updateCurrencyPrice(address _currency, uint256 _newPrice) internal {
        if (!currencies[_currency].supported) revert Sale__CurrencyNotSupported();
        if (_newPrice == 0) revert Sale__InvalidPrice();
        uint256 oldPrice = currencies[_currency].price;
        currencies[_currency].price = _newPrice;
        if (_currency == address(0)) tokenPrice = _newPrice;
        emit PriceUpdated(_currency, oldPrice, _newPrice);
    }

    function _updateTimes(uint256 _newStart, uint256 _newEnd) internal {
        if (_newEnd <= _newStart) revert Sale__InvalidTimeRange();
        if (_newEnd <= block.timestamp) revert Sale__InvalidTimeRange();
        saleStart = _newStart;
        saleEnd = _newEnd;
    }

    function _updateCaps(uint256 _newWalletCap, uint256 _newSaleCap) internal {
        if (_newWalletCap == 0 || _newSaleCap == 0) revert Sale__InvalidAmount();
        if (_newWalletCap < minPurchase || _newSaleCap < totalSold) revert Sale__InvalidAmount();
        walletCap = _newWalletCap;
        saleCap = _newSaleCap;
        emit CapsUpdated(_newWalletCap, _newSaleCap);
    }

    function _updateMinPurchase(uint256 _newMin) internal {
        if (_newMin > walletCap) revert Sale__InvalidAmount();
        uint256 oldMin = minPurchase;
        minPurchase = _newMin;
        emit MinPurchaseUpdated(oldMin, _newMin);
    }

    function _updateCooldown(uint256 _newCooldown) internal {
        uint256 oldCooldown = purchaseCooldown;
        purchaseCooldown = _newCooldown;
        emit CooldownUpdated(oldCooldown, _newCooldown);
    }

    // ═══════════════════════════════════════════════════════════════
    // CURRENCY MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    function _addCurrency(address _currency, uint256 _price, uint8 _decimals) internal {
        if (_currency == address(0)) revert Sale__ZeroAddress();
        if (_price == 0) revert Sale__InvalidPrice();
        if (_decimals > 77) revert Sale__InvalidDecimals();
        if (currencies[_currency].supported) revert Sale__CurrencyAlreadySupported();

        currencies[_currency] = Currency({supported: true, decimals: _decimals, price: _price});
        supportedCurrencyList.push(_currency);
        currencyIndexPlusOne[_currency] = supportedCurrencyList.length;

        emit CurrencyAdded(_currency, _price, _decimals);
    }

    function _removeCurrency(address _currency) internal {
        if (_currency == address(0)) revert Sale__CurrencyNotSupported();
        if (!currencies[_currency].supported) revert Sale__CurrencyNotSupported();

        currencies[_currency].supported = false;

        uint256 indexPlusOne = currencyIndexPlusOne[_currency];
        if (indexPlusOne != 0) {
            uint256 index = indexPlusOne - 1;
            uint256 lastIndex = supportedCurrencyList.length - 1;
            if (index != lastIndex) {
                address lastCurrency = supportedCurrencyList[lastIndex];
                supportedCurrencyList[index] = lastCurrency;
                currencyIndexPlusOne[lastCurrency] = index + 1;
            }
            supportedCurrencyList.pop();
            delete currencyIndexPlusOne[_currency];
        }

        emit CurrencyRemoved(_currency);
    }

    // ═══════════════════════════════════════════════════════════════
    // TREASURY & VESTING UPDATES
    // ═══════════════════════════════════════════════════════════════
    function _updateTreasury(address _newTreasury) internal {
        if (_newTreasury == address(0)) revert Sale__ZeroAddress();
        if (_newTreasury.code.length == 0) revert Airdrop__ZeroAddress();
        treasury = _newTreasury;
        emit TreasuryUpdated(_newTreasury);
    }

    function _updateVesting(address _newVesting) internal {
        if (_newVesting == address(0)) revert Sale__ZeroAddress();
        if (_newVesting.code.length == 0) revert Airdrop__ZeroAddress();
        vestingContract = IVesting(_newVesting);
        emit VestingUpdated(_newVesting);
    }

    // ═══════════════════════════════════════════════════════════════
    // GOVERNANCE FINALIZATION & LOCK CHECKS
    // ═══════════════════════════════════════════════════════════════
    function _finalizeGovernance() internal {
        if (block.timestamp < governanceStartTime + GOVERNANCE_LOCK_PERIOD) revert Sale__LockPeriodNotElapsed();
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
                revert Sale__FunctionLockedAfter180Days();
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
        if (_to == address(0)) revert Sale__ZeroAddress();
        if (_token == address(0)) revert Sale__ZeroAddress();
        IERC20(_token).safeTransfer(_to, _amount);
        emit TokensRescued(_token, _to, _amount);
    }

    function _rescueEth(address payable _to) internal {
        if (_to == address(0)) revert Sale__ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert Sale__NoEthToRescue();
        (bool success, ) = _to.call{value: balance}("");
        if (!success) revert Sale__EthTransferFailed();
        emit EthRescued(_to, balance);
    }

    // ═══════════════════════════════════════════════════════════════
    // ACCESS CONTROL OVERRIDES
    // ═══════════════════════════════════════════════════════════════
    function grantRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Sale__RoleManagementLocked();
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyGovernance {
        if (_isGovernanceLocked()) revert Sale__RoleManagementLocked();
        super.revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) public override {
        if (_isGovernanceLocked()) revert Sale__RoleManagementLocked();
        super.renounceRole(role, account);
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function getSaleState() external view returns (SaleState) {
        if (saleState == SaleState.Inactive) return SaleState.Inactive;
        if (block.timestamp > saleEnd) return SaleState.Ended;
        if (block.timestamp >= saleStart && block.timestamp <= saleEnd && saleState == SaleState.Active) {
            return SaleState.Active;
        }
        return SaleState.Inactive;
    }

    function previewTokenAmount(address _currency, uint256 _paidAmount) external view returns (uint256 tokenAmount) {
        return _calculateTokenAmount(_currency, _paidAmount);
    }

    function remainingSaleCap() external view returns (uint256) {
        if (totalSold >= saleCap) return 0;
        return saleCap - totalSold;
    }

    function remainingWalletCap(address _user) external view returns (uint256) {
        if (totalPurchased[_user] >= walletCap) return 0;
        return walletCap - totalPurchased[_user];
    }

    function isCurrencySupported(address _currency) external view returns (bool) {
        return currencies[_currency].supported;
    }

    function getSupportedCurrencies() external view returns (address[] memory) {
        return supportedCurrencyList;
    }

    function timeUntilStart() external view returns (uint256) {
        if (block.timestamp >= saleStart) return 0;
        return saleStart - block.timestamp;
    }

    function timeUntilEnd() external view returns (uint256) {
        if (block.timestamp >= saleEnd) return 0;
        return saleEnd - block.timestamp;
    }

    function canPurchase(address _user, uint256 _tokenAmount) external view returns (bool) {
        if (paused()) return false;
        if (saleState != SaleState.Active) return false;
        if (block.timestamp < saleStart || block.timestamp > saleEnd) return false;
        if (_tokenAmount < minPurchase) return false;
        if (totalPurchased[_user] + _tokenAmount > walletCap) return false;
        if (totalSold + _tokenAmount > saleCap) return false;
        if (block.timestamp < lastPurchaseTime[_user] + purchaseCooldown) return false;
        if (_tokenAmount > _availableTokensInVesting()) return false;
        return true;
    }

    function canPurchaseWithPayment(address _user, address _currency, uint256 _paidAmount) external view returns (bool) {
        if (!currencies[_currency].supported) return false;
        uint256 tokenAmount = _calculateTokenAmount(_currency, _paidAmount);
        if (paused()) return false;
        if (saleState != SaleState.Active) return false;
        if (block.timestamp < saleStart || block.timestamp > saleEnd) return false;
        if (tokenAmount < minPurchase) return false;
        if (totalPurchased[_user] + tokenAmount > walletCap) return false;
        if (totalSold + tokenAmount > saleCap) return false;
        if (block.timestamp < lastPurchaseTime[_user] + purchaseCooldown) return false;
        if (tokenAmount > _availableTokensInVesting()) return false;
        return true;
    }

    function getPurchaseInfo(address _user)
        external
        view
        returns (uint256 purchased, uint256 remainingCap, uint256 lastPurchase, uint256 cooldownRemaining)
    {
        purchased = totalPurchased[_user];
        remainingCap = totalPurchased[_user] >= walletCap ? 0 : walletCap - totalPurchased[_user];
        lastPurchase = lastPurchaseTime[_user];
        cooldownRemaining = block.timestamp >= lastPurchaseTime[_user] + purchaseCooldown
            ? 0
            : (lastPurchaseTime[_user] + purchaseCooldown) - block.timestamp;
    }

    function getCurrencyInfo(address _currency) external view returns (bool supported, uint8 decimals_, uint256 price) {
        Currency memory curr = currencies[_currency];
        return (curr.supported, curr.decimals, curr.price);
    }

    function canFinalizeGovernance() external view returns (bool) {
        return !governanceFinalized && block.timestamp >= governanceStartTime + GOVERNANCE_LOCK_PERIOD;
    }

    function timeUntilFinalization() external view returns (uint256) {
        uint256 eligibleTime = governanceStartTime + GOVERNANCE_LOCK_PERIOD;
        if (block.timestamp >= eligibleTime) return 0;
        return eligibleTime - block.timestamp;
    }

    function isGovernanceLocked() external view returns (bool) {
        return _isGovernanceLocked();
    }

    function availableTokensInVesting() external view returns (uint256) {
        return _availableTokensInVesting();
    }

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
        // Direct ETH can be rescued through timelocked governance.
    }
}
