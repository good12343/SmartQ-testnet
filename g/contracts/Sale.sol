// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVesting {
function deposit(address user, uint256 amount) external;
}

contract FortSale is AccessControl, Pausable, ReentrancyGuard {
using SafeERC20 for IERC20;

bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");  

IERC20 public token;  
address public treasury;  
address public vestingContract;  

// ========== Anti-bot ==========  
uint256 public cooldownTime = 30 seconds;  
mapping(address => uint256) public lastBuyTime;  

// ========== Limits ==========  
uint256 public minPurchase = 100 * 10**18;  
uint256 public maxPerWallet = 100000 * 10**18;  
uint256 public maxSale = 10_000_000 * 10**18;  

uint256 public totalSold;  

// ========== Sale ==========  
bool public saleActive;  
uint256 public saleStart;  
uint256 public saleEnd;  

// ========== Tracking ==========  
mapping(address => uint256) public totalPurchased;  

struct Currency {  
    address tokenAddress;  
    uint256 price;  
    uint8 decimals;  
    bool active;  
}  

mapping(string => Currency) public currencies;  
string[] public currencyList;  

// ========== Events ==========  
event TokensPurchased(address indexed buyer, uint256 amount, string currency, uint256 cost);  
event SaleStarted(uint256 start, uint256 end);  
event SaleEnded();  

constructor(  
    address _token,  
    address _treasury,  
    address _admin,  
    address _vesting  
) {  
    require(_treasury != address(0), "Invalid treasury");  

    token = IERC20(_token);  
    treasury = _treasury;  
    vestingContract = _vesting;  

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);  
    _grantRole(ADMIN_ROLE, _admin);  

    // Default ETH currency with 18 decimals for price calculation consistency  
    _addCurrency("ETH", address(0), 0.001 ether, 18);  
}  

// ========== BUY ==========  
function buyWithETH() external payable nonReentrant whenNotPaused {  
    _buy("ETH", msg.value);  
}  

function buyWithToken(string memory currency, uint256 amount)  
    external  
    nonReentrant  
    whenNotPaused  
{  
    Currency memory curr = currencies[currency];  
    require(curr.active, "Inactive currency");  
    require(curr.tokenAddress != address(0), "Use ETH function");  

    // Use safeTransferFrom for ERC20 tokens  
    IERC20(curr.tokenAddress).safeTransferFrom(msg.sender, treasury, amount);  

    _buy(currency, amount);  
}  

// ========== INTERNAL BUY ==========  
function _buy(string memory currency, uint256 paidAmount) internal {  
    require(saleActive, "Sale not active");  
    require(block.timestamp >= saleStart && block.timestamp <= saleEnd, "Sale ended");  

    // anti-bot cooldown  
    require(block.timestamp >= lastBuyTime[msg.sender] + cooldownTime, "Cooldown active");  
    lastBuyTime[msg.sender] = block.timestamp;  

    Currency memory curr = currencies[currency];  
    require(curr.active, "Currency inactive");  

    uint256 tokenAmount;  
    // Correctly calculate tokenAmount considering currency decimals  
    if (curr.decimals == 18) {  
        tokenAmount = (paidAmount * 1e18) / curr.price;  
    } else {  
        // Normalize paidAmount to 18 decimals before calculating tokenAmount  
        uint256 normalizedPaidAmount = paidAmount * (10 ** (18 - curr.decimals));  
        tokenAmount = (normalizedPaidAmount * 1e18) / curr.price;  
    }  

    _validatePurchase(tokenAmount);  

    // Apply Checks-Effects-Interactions pattern: update state before external calls  
    totalPurchased[msg.sender] += tokenAmount;  
    totalSold += tokenAmount;  

    // send ETH  
    if (keccak256(bytes(currency)) == keccak256(bytes("ETH"))) {  
        (bool ok, ) = treasury.call{value: paidAmount}("");  
        require(ok, "ETH transfer failed");  
    }  

    // 🔥 VESTING INSTEAD OF DIRECT TRANSFER  
    IVesting(vestingContract).deposit(msg.sender, tokenAmount);  

    emit TokensPurchased(msg.sender, tokenAmount, currency, paidAmount);  
}  

// ========== VALIDATION ==========  
function _validatePurchase(uint256 amount) internal view {  
    require(amount >= minPurchase, "Too small");  
    require(totalPurchased[msg.sender] + amount <= maxPerWallet, "Wallet cap exceeded");  
    require(totalSold + amount <= maxSale, "Sale cap reached");  
}  

// ========== ADMIN ==========  
function startSale(uint256 duration) external onlyRole(ADMIN_ROLE) {  
    // Removed saleInitialized check to allow restarting/extending sale  
    saleActive = true;  
    saleStart = block.timestamp;  
    saleEnd = block.timestamp + duration;  

    emit SaleStarted(saleStart, saleEnd);  
}  

function endSale() external onlyRole(ADMIN_ROLE) {  
    saleActive = false;  
    emit SaleEnded();  
}  

function _addCurrency(  
    string memory symbol,  
    address tokenAddress,  
    uint256 price,  
    uint8 decimals  
) internal {  
    currencies[symbol] = Currency(tokenAddress, price, decimals, true);  
    currencyList.push(symbol);  
}  

function addCurrency(  
    string memory symbol,  
    address tokenAddress,  
    uint256 price,  
    uint8 decimals  
) external onlyRole(ADMIN_ROLE) {  
    _addCurrency(symbol, tokenAddress, price, decimals);  
}  

// New admin function to update treasury address  
function setTreasury(address _newTreasury) external onlyRole(ADMIN_ROLE) {  
    require(_newTreasury != address(0), "Invalid treasury address");  
    treasury = _newTreasury;  
}  

// New admin function to rescue accidentally sent ERC20 tokens  
function rescueTokens(address _tokenAddress, uint256 _amount) external onlyRole(ADMIN_ROLE) {  
    require(_tokenAddress != address(token), "Cannot rescue sale token");  
    IERC20(_tokenAddress).safeTransfer(msg.sender, _amount);  
}  

// ========== VIEW ==========  
function getUserInfo(address user)  
    external  
    view  
    returns (uint256 bought, uint256 remaining)  
{  
    return (totalPurchased[user], maxPerWallet - totalPurchased[user]);  
}  

receive() external payable {  
    buyWithETH();  
}

}