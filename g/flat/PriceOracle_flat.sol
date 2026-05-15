// Sources flattened with hardhat v2.28.6 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts/access/IAccessControl.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (access/IAccessControl.sol)

pragma solidity >=0.8.4;

/**
 * @dev External interface of AccessControl declared to support ERC-165 detection.
 */
interface IAccessControl {
    /**
     * @dev The `account` is missing a role.
     */
    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    /**
     * @dev The caller of a function is not the expected one.
     *
     * NOTE: Don't confuse with {AccessControlUnauthorizedAccount}.
     */
    error AccessControlBadConfirmation();

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted to signal this.
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call. This account bears the admin role (for the granted role).
     * Expected in cases where the role was granted using the internal {AccessControl-_grantRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     */
    function renounceRole(bytes32 role, address callerConfirmation) external;
}


// File @openzeppelin/contracts/utils/Context.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/utils/introspection/IERC165.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File @openzeppelin/contracts/utils/introspection/ERC165.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/ERC165.sol)

pragma solidity ^0.8.20;

/**
 * @dev Implementation of the {IERC165} interface.
 *
 * Contracts that want to implement ERC-165 should inherit from this contract and override {supportsInterface} to check
 * for the additional interface id that will be supported. For example:
 *
 * ```solidity
 * function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
 *     return interfaceId == type(MyInterface).interfaceId || super.supportsInterface(interfaceId);
 * }
 * ```
 */
abstract contract ERC165 is IERC165 {
    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}


// File @openzeppelin/contracts/access/AccessControl.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.6.0) (access/AccessControl.sol)

pragma solidity ^0.8.20;



/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms. This is a lightweight version that doesn't allow enumerating role
 * members except through off-chain means by accessing the contract event logs. Some
 * applications may benefit from on-chain enumerability, for those cases see
 * {AccessControlEnumerable}.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```solidity
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```solidity
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it. We recommend using {AccessControlDefaultAdminRules}
 * to enforce additional security measures for this role.
 */
abstract contract AccessControl is Context, IAccessControl, ERC165 {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    mapping(bytes32 role => RoleData) private _roles;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with an {AccessControlUnauthorizedAccount} error including the required role.
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    /// @inheritdoc ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IAccessControl).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        return _roles[role].hasRole[account];
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `_msgSender()`
     * is missing `role`. Overriding this function changes the behavior of the {onlyRole} modifier.
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `account`
     * is missing `role`.
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert AccessControlUnauthorizedAccount(account, role);
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return _roles[role].adminRole;
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address callerConfirmation) public virtual {
        if (callerConfirmation != _msgSender()) {
            revert AccessControlBadConfirmation();
        }

        _revokeRole(role, callerConfirmation);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previousAdminRole = getRoleAdmin(role);
        _roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Attempts to grant `role` to `account` and returns a boolean indicating if `role` was granted.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        if (!hasRole(role, account)) {
            _roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Attempts to revoke `role` from `account` and returns a boolean indicating if `role` was revoked.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        if (hasRole(role, account)) {
            _roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }
}


// File @openzeppelin/contracts/utils/Pausable.sol@v5.6.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (utils/Pausable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Context {
    bool private _paused;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}


// File contracts/PriceOracle.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;


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

        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = aggregator.latestRoundData();

        // Validate Chainlink data
        if (answer <= 0) revert PO__InvalidPrice();
        if (updatedAt == 0) revert PO__StalePrice();
        if (answeredInRound < roundId) revert PO__StalePrice();
        if (block.timestamp - updatedAt > STALENESS_THRESHOLD) revert PO__StalePrice();

        // Chainlink prices are 8 decimals for ETH/USD
        uint8 feedDecimals = aggregator.decimals();

        // Convert to 1e6 precision
        return uint256(answer) * (10 ** (6 - feedDecimals));
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
