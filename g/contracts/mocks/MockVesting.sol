// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockVesting {
    IERC20 public projectToken;
    uint256 public totalAllocated;

    mapping(address => uint256) public allocations;
    // لمحاكاة الرصيد الاحتياطي
    uint256 public reservedTokens;

    constructor(address _token) {
        projectToken = IERC20(_token);
    }

    function allocate(address _user, uint256 _amount) external {
        // نتأكد أن المرسل (Sale) مصرح له – لكن هذا وهمي
        allocations[_user] += _amount;
        totalAllocated += _amount;
    }

    function getReservedTokens() external view returns (uint256) {
        return reservedTokens;
    }

    // دوال للمساعدة في الاختبار: تمويل العقد بتوكنات وضبط الرصيد الاحتياطي
    function fund(uint256 _amount) external {
        projectToken.transferFrom(msg.sender, address(this), _amount);
    }

    function setReservedTokens(uint256 _amount) external {
        reservedTokens = _amount;
    }
}