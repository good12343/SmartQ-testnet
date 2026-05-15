// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract PriceOracleV3 is AccessControl, Pausable {

    // ═════════════════════ ERRORS ═════════════════════
    error PO__UnsupportedCurrency();
    error PO__ZeroAddress();
    error PO__InvalidPrice();
    error PO__DuplicateCurrency();
    error PO__StalePrice();
    error PO__PriceDeviationTooHigh();

    // ═════════════════════ ROLES ═════════════════════
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ═════════════════════ CONSTANTS ═════════════════════
    uint256 public constant STALENESS_THRESHOLD = 1 days;
    uint256 public constant MAX_BPS = 2000; // 20% max deviation
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ═════════════════════ STRUCTS ═════════════════════
    struct Currency {
        bool supported;
        uint8 decimals;
        uint256 priceUsd; // 1e6 precision (manual fallback)
        uint256 updatedAt;
        address chainlinkFeed; // address(0) if manual
    }

    // ═════════════════════ STATE ═════════════════════
    mapping(address => Currency) private currencies;
    address[] private currencyList;

    // Token pricing (shared reference for all quotes)
    uint256 public tokenPriceUsd = 10_000; // 0.01 USD (1e6 precision)
    uint256 public tokenPriceUpdatedAt;

    // ═════════════════════ EVENTS ═════════════════════
    event CurrencyAdded(address indexed currency, uint256 priceUsd, address chainlinkFeed);
    event CurrencyUpdated(address indexed currency, uint256 oldPrice, uint256 newPrice);
    event CurrencyRemoved(address indexed currency);
    event TokenPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event ChainlinkFeedUpdated(address indexed currency, address feed);

    // ═════════════════════ CONSTRUCTOR ═════════════════════
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        // ETH default with manual price (can be updated to Chainlink)
        _addCurrency(address(0), 18, 2_500_000_000, address(0));
    }

    // ═════════════════════ ADMIN: TOKEN PRICE ═════════════════════
    function updateTokenPrice(uint256 newPriceUsd)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (newPriceUsd == 0) revert PO__InvalidPrice();

        uint256 old = tokenPriceUsd;

        // Max deviation check
        uint256 deviation = _calculateDeviation(old, newPriceUsd);
        if (deviation > MAX_BPS) revert PO__PriceDeviationTooHigh();

        tokenPriceUsd = newPriceUsd;
        tokenPriceUpdatedAt = block.timestamp;

        emit TokenPriceUpdated(old, newPriceUsd);
    }

    // ═════════════════════ ADMIN: CURRENCIES ═════════════════════
    function addCurrency(address currency, uint8 decimals, uint256 priceUsd, address chainlinkFeed)
        external
        onlyRole(OPERATOR_ROLE)
    {
        _addCurrency(currency, decimals, priceUsd, chainlinkFeed);
    }

    function _addCurrency(address currency, uint8 decimals, uint256 priceUsd, address chainlinkFeed)
        internal
    {
        if (currency == address(0) && decimals != 18) {
            revert PO__InvalidPrice();
        }

        // PATCH-P1: Prevent duplicate currencies
        if (currencies[currency].supported) revert PO__DuplicateCurrency();

        currencies[currency] = Currency({
            supported: true,
            decimals: decimals,
            priceUsd: priceUsd,
            updatedAt: block.timestamp,
            chainlinkFeed: chainlinkFeed
        });

        currencyList.push(currency);

        emit CurrencyAdded(currency, priceUsd, chainlinkFeed);
    }

    function updateCurrencyPrice(address currency, uint256 newPriceUsd)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Currency storage c = currencies[currency];
        if (!c.supported) revert PO__UnsupportedCurrency();

        // Cannot update if Chainlink feed is set
        if (c.chainlinkFeed != address(0)) revert PO__InvalidPrice();

        uint256 old = c.priceUsd;

        // Max deviation check
        uint256 deviation = _calculateDeviation(old, newPriceUsd);
        if (deviation > MAX_BPS) revert PO__PriceDeviationTooHigh();

        c.priceUsd = newPriceUsd;
        c.updatedAt = block.timestamp;

        emit CurrencyUpdated(currency, old, newPriceUsd);
    }

    function setChainlinkFeed(address currency, address feed)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Currency storage c = currencies[currency];
        if (!c.supported) revert PO__UnsupportedCurrency();

        c.chainlinkFeed = feed;

        emit ChainlinkFeedUpdated(currency, feed);
    }

    function removeCurrency(address currency)
        external
        onlyRole(OPERATOR_ROLE)
    {
        currencies[currency].supported = false;

        emit CurrencyRemoved(currency);
    }

    // ═════════════════════ VIEW: RAW DATA ═════════════════════
    function getCurrency(address currency)
        external
        view
        returns (
            bool supported,
            uint8 decimals,
            uint256 priceUsd,
            uint256 updatedAt,
            address chainlinkFeed
        )
    {
        Currency memory c = currencies[currency];
        return (c.supported, c.decimals, c.priceUsd, c.updatedAt, c.chainlinkFeed);
    }

    // PATCH-P5: Return only active currencies
    function getCurrencies() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < currencyList.length; i++) {
            if (currencies[currencyList[i]].supported) {
                activeCount++;
            }
        }

        address[] memory activeCurrencies = new address[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < currencyList.length; i++) {
            if (currencies[currencyList[i]].supported) {
                activeCurrencies[index] = currencyList[i];
                index++;
            }
        }

        return activeCurrencies;
    }

    // ═════════════════════ 🔥 QUOTE ENGINE CORE ═════════════════════

    /// @notice Convert payment → token amount
    function quote(address currency, uint256 amount)
        public
        view
        returns (uint256 tokens)
    {
        Currency memory c = currencies[currency];

        if (!c.supported) revert PO__UnsupportedCurrency();

        // PATCH-P2: Stale price protection
        if (block.timestamp - c.updatedAt > STALENESS_THRESHOLD) {
            revert PO__StalePrice();
        }

        uint256 priceUsd = c.priceUsd;

        // PATCH-P3: Use Chainlink if available
        if (c.chainlinkFeed != address(0)) {
            priceUsd = _getChainlinkPrice(c.chainlinkFeed);
        }

        return _calc(amount, priceUsd, c.decimals);
    }

    /// @notice Reverse quote (tokens → required payment)
    function quoteReverse(address currency, uint256 tokenAmount)
        external
        view
        returns (uint256 payment)
    {
        Currency memory c = currencies[currency];

        if (!c.supported) revert PO__UnsupportedCurrency();

        // PATCH-P2: Stale price protection
        if (block.timestamp - c.updatedAt > STALENESS_THRESHOLD) {
            revert PO__StalePrice();
        }

        uint256 priceUsd = c.priceUsd;

        // PATCH-P3: Use Chainlink if available
        if (c.chainlinkFeed != address(0)) {
            priceUsd = _getChainlinkPrice(c.chainlinkFeed);
        }

        payment =
            (tokenAmount * tokenPriceUsd * (10 ** c.decimals)) /
            (priceUsd * 1e18);
    }

    // ═════════════════════ FRONTEND HELPERS ═════════════════════

    /// @notice Full quote info for UI (best UX function)
    function getQuoteInfo(address currency, uint256 amount)
        external
        view
        returns (
            uint256 tokens,
            uint256 usdValue,
            uint256 tokenPrice
        )
    {
        Currency memory c = currencies[currency];

        if (!c.supported) revert PO__UnsupportedCurrency();

        // PATCH-P2: Stale price protection
        if (block.timestamp - c.updatedAt > STALENESS_THRESHOLD) {
            revert PO__StalePrice();
        }

        uint256 priceUsd = c.priceUsd;

        // PATCH-P3: Use Chainlink if available
        if (c.chainlinkFeed != address(0)) {
            priceUsd = _getChainlinkPrice(c.chainlinkFeed);
        }

        tokens = _calc(amount, priceUsd, c.decimals);
        usdValue = (amount * priceUsd) / 1e6;
        tokenPrice = tokenPriceUsd;
    }

    // ═════════════════════ CHAINLINK INTEGRATION ═════════════════════

    /// @notice Get price from Chainlink feed
    function _getChainlinkPrice(address feed) internal view returns (uint256) {
    AggregatorV3Interface aggregator = AggregatorV3Interface(feed);

    (, int256 answer, , uint256 updatedAt, ) = aggregator.latestRoundData();

    if (answer <= 0) revert PO__InvalidPrice();
    if (updatedAt == 0 || block.timestamp - updatedAt > STALENESS_THRESHOLD) {
        revert PO__StalePrice();
    }

    uint256 price = uint256(answer);
    uint8 feedDecimals = aggregator.decimals();

    if (feedDecimals > 6) {
        uint256 diff = feedDecimals - 6;
        price = price / (10 ** diff);
    } else if (feedDecimals < 6) {
        uint256 diff = 6 - feedDecimals;
        price = price * (10 ** diff);
    }

    return price;
}

    /// @notice Get Chainlink price directly (external view)
    function getChainlinkPrice(address currency) external view returns (uint256) {
        Currency memory c = currencies[currency];
        if (c.chainlinkFeed == address(0)) revert PO__UnsupportedCurrency();
        return _getChainlinkPrice(c.chainlinkFeed);
    }

    // ═════════════════════ INTERNAL MATH ═════════════════════

    // PATCH-P4: Fixed _calc with single return
    function _calc(
        uint256 amount,
        uint256 currencyPriceUsd,
        uint8 currencyDecimals
    )
        internal
        view
        returns (uint256)
    {
        uint256 paidUsd =
            (amount * currencyPriceUsd)
            / (10 ** currencyDecimals);

        return (paidUsd * 1e18)
            / tokenPriceUsd;
    }

    // ═════════════════════ DEVIATION CALCULATION ═════════════════════

    /// @notice Calculate price deviation in basis points
    function _calculateDeviation(uint256 oldPrice, uint256 newPrice)
        internal
        pure
        returns (uint256)
    {
        if (oldPrice == 0) return 0;

        uint256 diff = newPrice > oldPrice
            ? newPrice - oldPrice
            : oldPrice - newPrice;

        return (diff * BPS_DENOMINATOR) / oldPrice;
    }

    // ═════════════════════ SAFETY ═════════════════════
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
}