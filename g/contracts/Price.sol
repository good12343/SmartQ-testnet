// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract PriceOracleV2 is AccessControl, Pausable {

    // ═════════════════════ ERRORS ═════════════════════
    error PO__UnsupportedCurrency();
    error PO__ZeroAddress();
    error PO__InvalidPrice();

    // ═════════════════════ ROLES ═════════════════════
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ═════════════════════ STRUCTS ═════════════════════
    struct Currency {
        bool supported;
        uint8 decimals;
        uint256 priceUsd; // 1e6 precision
    }

    // ═════════════════════ STATE ═════════════════════
    mapping(address => Currency) private currencies;
    address[] private currencyList;

    // Token pricing (shared reference for all quotes)
    uint256 public tokenPriceUsd = 10_000; // 0.01 USD (1e6 precision)

    // ═════════════════════ EVENTS ═════════════════════
    event CurrencyAdded(address indexed currency, uint256 priceUsd);
    event CurrencyUpdated(address indexed currency, uint256 oldPrice, uint256 newPrice);
    event CurrencyRemoved(address indexed currency);
    event TokenPriceUpdated(uint256 oldPrice, uint256 newPrice);

    // ═════════════════════ CONSTRUCTOR ═════════════════════
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        // ETH default
        _addCurrency(address(0), 18, 2_500_000_000);
    }

    // ═════════════════════ ADMIN: TOKEN PRICE ═════════════════════
    function updateTokenPrice(uint256 newPriceUsd)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (newPriceUsd == 0) revert PO__InvalidPrice();

        uint256 old = tokenPriceUsd;
        tokenPriceUsd = newPriceUsd;

        emit TokenPriceUpdated(old, newPriceUsd);
    }

    // ═════════════════════ ADMIN: CURRENCIES ═════════════════════
    function addCurrency(address currency, uint8 decimals, uint256 priceUsd)
        external
        onlyRole(OPERATOR_ROLE)
    {
        _addCurrency(currency, decimals, priceUsd);
    }

    function _addCurrency(address currency, uint8 decimals, uint256 priceUsd)
        internal
    {
        if (currency == address(0) && decimals != 18) {
            revert PO__InvalidPrice();
        }

        currencies[currency] = Currency({
            supported: true,
            decimals: decimals,
            priceUsd: priceUsd
        });

        currencyList.push(currency);

        emit CurrencyAdded(currency, priceUsd);
    }

    function updateCurrencyPrice(address currency, uint256 newPriceUsd)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Currency storage c = currencies[currency];
        if (!c.supported) revert PO__UnsupportedCurrency();

        uint256 old = c.priceUsd;
        c.priceUsd = newPriceUsd;

        emit CurrencyUpdated(currency, old, newPriceUsd);
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
            uint256 priceUsd
        )
    {
        Currency memory c = currencies[currency];
        return (c.supported, c.decimals, c.priceUsd);
    }

    function getCurrencies() external view returns (address[] memory) {
        return currencyList;
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

        return _calc(amount, c.priceUsd, c.decimals);
    }

    /// @notice Reverse quote (tokens → required payment)
    function quoteReverse(address currency, uint256 tokenAmount)
        external
        view
        returns (uint256 payment)
    {
        Currency memory c = currencies[currency];

        if (!c.supported) revert PO__UnsupportedCurrency();

        payment =
            (tokenAmount * tokenPriceUsd * (10 ** c.decimals)) /
            (c.priceUsd * 1e18);
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

        tokens = _calc(amount, c.priceUsd, c.decimals);
        usdValue = (amount * c.priceUsd) / 1e6;
        tokenPrice = tokenPriceUsd;
    }

    // ═════════════════════ INTERNAL MATH ═════════════════════

    function _calc(
        uint256 amount,
        uint256 priceUsd,
        uint8 decimals
    ) internal pure returns (uint256) {
        return (amount * priceUsd * 1e18) / (priceUsd * 10 ** decimals);
    }

    // ═════════════════════ SAFETY ═════════════════════
    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
}