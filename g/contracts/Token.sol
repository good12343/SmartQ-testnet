// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Token (Production Clean Version)
 * @dev Execution-only ERC20 Token governed by TimelockController
 */
contract Token is ERC20, ERC20Permit, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    // ═════════════════════════════════════════════
    // ERRORS
    // ═════════════════════════════════════════════
    error Token__ZeroAddress();
    error Token__AllocationMismatch();
    error Token__ExceedsWalletCap();
    error Token__ArrayLengthMismatch();
    error Token__NoEthToRescue();
    error Token__EthTransferFailed();
    error Token__RoleManagementLocked();
    error Token__DexLocked();

    // ═════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant WALLET_CAP = 10_000_000 * 1e18;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ═════════════════════════════════════════════
    // STATE
    // ═════════════════════════════════════════════
    address public dexRouter;
    address public dexPair;
    bool public dexLocked;

    mapping(address => bool) public isExcludedFromWalletCap;

    // ═════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════
    event TokensMinted(address indexed to, uint256 amount);
    event ExclusionUpdated(address indexed account, bool excluded);
    event DexSetupUpdated(address indexed router, address indexed pair);
    event DexSetupLocked();
    event EthRescued(address indexed to, uint256 amount);
    event ERC20Rescued(address indexed token, address indexed to, uint256 amount);

    // ═════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════
    constructor(
        string memory name_,
        string memory symbol_,
        address governance,   // TimelockController
        address treasury,
        address vesting,
        address airdrop,
        address saleAllocation,
        uint256 treasuryAmount,
        uint256 vestingAmount,
        uint256 airdropAmount,
        uint256 saleAmount
    ) ERC20(name_, symbol_) ERC20Permit(name_) {

        if (governance == address(0)) revert Token__ZeroAddress();

        uint256 total = treasuryAmount + vestingAmount + airdropAmount + saleAmount;
        if (total != TOTAL_SUPPLY) revert Token__AllocationMismatch();

        // Timelock is the ONLY governance
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);

        // Mint allocations
        _mint(treasury, treasuryAmount);
        emit TokensMinted(treasury, treasuryAmount);

        _mint(vesting, vestingAmount);
        emit TokensMinted(vesting, vestingAmount);

        _mint(airdrop, airdropAmount);
        emit TokensMinted(airdrop, airdropAmount);

        if (saleAmount > 0 && saleAllocation != address(0)) {
            _mint(saleAllocation, saleAmount);
            emit TokensMinted(saleAllocation, saleAmount);
            isExcludedFromWalletCap[saleAllocation] = true;
        }

        // Exclusions
        isExcludedFromWalletCap[treasury] = true;
        isExcludedFromWalletCap[vesting] = true;
        isExcludedFromWalletCap[airdrop] = true;
    }

    // ═════════════════════════════════════════════
    // GOVERNANCE FUNCTIONS (ONLY TIMELOCK)
    // ═════════════════════════════════════════════

    function setExclusion(address account, bool excluded)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (account == address(0)) revert Token__ZeroAddress();
        isExcludedFromWalletCap[account] = excluded;
        emit ExclusionUpdated(account, excluded);
    }

    function batchSetExclusions(address[] calldata accounts, bool[] calldata excluded)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (accounts.length != excluded.length) revert Token__ArrayLengthMismatch();

        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert Token__ZeroAddress();
            isExcludedFromWalletCap[accounts[i]] = excluded[i];
            emit ExclusionUpdated(accounts[i], excluded[i]);
        }
    }

    function setDexSetup(address router, address pair)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (router == address(0) || pair == address(0)) revert Token__ZeroAddress();
        if (dexLocked) revert Token__DexLocked();

        dexRouter = router;
        dexPair = pair;

        isExcludedFromWalletCap[pair] = true;

        emit DexSetupUpdated(router, pair);
    }

    function lockDexSetup()
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        dexLocked = true;
        emit DexSetupLocked();
    }

    function pause() external onlyRole(GOVERNANCE_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNANCE_ROLE) {
        _unpause();
    }

    function rescueEth(address payable to)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (to == address(0)) revert Token__ZeroAddress();

        uint256 bal = address(this).balance;
        if (bal == 0) revert Token__NoEthToRescue();

        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert Token__EthTransferFailed();

        emit EthRescued(to, bal);
    }

    function rescueERC20(
        address erc20,
        address to,
        uint256 amount
    )
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (to == address(0)) revert Token__ZeroAddress();

        IERC20(erc20).safeTransfer(to, amount);

        emit ERC20Rescued(erc20, to, amount);
    }

    // ═════════════════════════════════════════════
    // TRANSFER LOGIC (Wallet Cap)
    // ═════════════════════════════════════════════

    function _update(address from, address to, uint256 value)
        internal
        override
        whenNotPaused
    {
        if (from != address(0) && to != address(0)) {
            if (!isExcludedFromWalletCap[to]) {
                unchecked {
                    require(balanceOf(to) + value <= WALLET_CAP, "WALLET_CAP_EXCEEDED");
                }
            }
        }

        super._update(from, to, value);
    }

    // ═════════════════════════════════════════════
    // SAFETY
    // ═════════════════════════════════════════════

    function mint(address, uint256) external pure {
        revert("MINT_DISABLED");
    }

    receive() external payable {}

}