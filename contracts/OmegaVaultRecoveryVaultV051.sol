// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OmegaVaultRecoveryVaultV051 - development EVM recovery proof with late-native rescue
/// @notice Development-only successor to the 0.4 Sepolia proof. Adds post-recovery ERC-20 sweeping.
/// @dev Not audited. Testnet only. OmegaVault never receives wallet secret material.
contract OmegaVaultRecoveryVaultV051 {
    uint32 public constant ADAPTER_VERSION = 501; // 0.5.1-dev
    uint8 public constant MAX_TRUSTED_CONTACTS = 32;

    address public immutable owner;
    address payable public immutable rescueDestination;
    uint64 public immutable inactivityPeriod;
    uint8 public immutable threshold;
    uint64 public lastHeartbeat;
    bool public recovered;

    mapping(address => bool) public isTrustedContact;
    mapping(address => bool) public approved;
    address[] public trustedContacts;
    uint8 public approvalCount;
    bool private tokenRecoveryEntered;

    event Heartbeat(uint64 timestamp);
    event RecoveryRequested(address indexed contact);
    event RecoveryApproved(address indexed contact, uint8 approvals, uint8 threshold);
    event RecoveryCancelled(uint8 approvalsCleared);
    event RecoveryExecuted(address indexed destination, uint256 nativeAmount);
    event ERC20Recovered(address indexed token, address indexed destination, uint256 amount);
    event LateNativeRecovered(address indexed destination, uint256 amount);
    event OwnerWithdrawal(address indexed destination, uint256 amount);

    error OnlyOwner();
    error NotTrustedContact();
    error InactivityNotElapsed();
    error InvalidConfiguration();
    error ThresholdNotMet();
    error AlreadyRecovered();
    error NotRecovered();
    error TransferFailed();
    error InvalidAmount();
    error InvalidToken();
    error ReentrantTokenRecovery();

    constructor(
        address[] memory contacts,
        uint8 requiredApprovals,
        uint64 inactivitySeconds,
        address payable destination
    ) payable {
        if (
            contacts.length == 0 || contacts.length > MAX_TRUSTED_CONTACTS ||
            requiredApprovals == 0 || requiredApprovals > contacts.length ||
            inactivitySeconds == 0 || destination == address(0)
        ) revert InvalidConfiguration();

        owner = msg.sender;
        rescueDestination = destination;
        threshold = requiredApprovals;
        inactivityPeriod = inactivitySeconds;
        lastHeartbeat = uint64(block.timestamp);

        for (uint256 i = 0; i < contacts.length; i++) {
            address contact = contacts[i];
            if (contact == address(0) || contact == msg.sender || contact == destination || isTrustedContact[contact]) {
                revert InvalidConfiguration();
            }
            isTrustedContact[contact] = true;
            trustedContacts.push(contact);
        }
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyTrusted() {
        if (!isTrustedContact[msg.sender]) revert NotTrustedContact();
        _;
    }

    modifier nonReentrantTokenRecovery() {
        if (tokenRecoveryEntered) revert ReentrantTokenRecovery();
        tokenRecoveryEntered = true;
        _;
        tokenRecoveryEntered = false;
    }

    function heartbeat() external onlyOwner {
        if (recovered) revert AlreadyRecovered();
        lastHeartbeat = uint64(block.timestamp);
        uint8 cleared = _clearApprovals();
        emit Heartbeat(lastHeartbeat);
        emit RecoveryCancelled(cleared);
    }

    function ownerWithdraw(address payable destination, uint256 amount) external onlyOwner {
        if (recovered) revert AlreadyRecovered();
        if (destination == address(0) || amount > address(this).balance) revert InvalidAmount();
        (bool ok,) = destination.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit OwnerWithdrawal(destination, amount);
    }

    function approveRecovery() external onlyTrusted {
        if (recovered) revert AlreadyRecovered();
        if (block.timestamp < uint256(lastHeartbeat) + inactivityPeriod) revert InactivityNotElapsed();
        emit RecoveryRequested(msg.sender);
        if (!approved[msg.sender]) {
            approved[msg.sender] = true;
            approvalCount += 1;
            emit RecoveryApproved(msg.sender, approvalCount, threshold);
        }
    }

    function executeRecovery() external {
        if (recovered) revert AlreadyRecovered();
        if (block.timestamp < uint256(lastHeartbeat) + inactivityPeriod) revert InactivityNotElapsed();
        if (approvalCount < threshold) revert ThresholdNotMet();
        recovered = true;
        uint256 amount = address(this).balance;
        (bool ok,) = rescueDestination.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RecoveryExecuted(rescueDestination, amount);
    }

    /// @notice Forward native funds that arrive AFTER executeRecovery.
    /// @dev Permissionless but funds can ONLY go to immutable rescueDestination.
    ///      V0.5 lacked this path and could strand late native deposits.
    ///      The destination must itself be able to receive a plain native transfer.
    function recoverLateNative() external {
        if (!recovered) revert NotRecovered();
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok,) = rescueDestination.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit LateNativeRecovered(rescueDestination, amount);
    }

    /// @notice Sweeps an ERC-20 held by this vault to the immutable rescue destination.
    /// @dev Enabled only after the threshold recovery has already executed. Permissionless by design:
    ///      no caller can redirect the token; the destination is immutable.
    function recoverERC20(address token) external nonReentrantTokenRecovery returns (uint256 amount) {
        if (!recovered) revert NotRecovered();
        if (token == address(0)) revert InvalidToken();

        (bool balanceOk, bytes memory balanceData) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("balanceOf(address)")), address(this))
        );
        if (!balanceOk || balanceData.length < 32) revert InvalidToken();
        amount = abi.decode(balanceData, (uint256));
        if (amount == 0) return 0;

        (bool transferOk, bytes memory returnData) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), rescueDestination, amount)
        );
        if (!transferOk || (returnData.length != 0 && !abi.decode(returnData, (bool)))) revert TransferFailed();
        emit ERC20Recovered(token, rescueDestination, amount);
    }

    function secondsUntilEligible() external view returns (uint256) {
        uint256 eligibleAt = uint256(lastHeartbeat) + inactivityPeriod;
        return block.timestamp >= eligibleAt ? 0 : eligibleAt - block.timestamp;
    }

    function getTrustedContacts() external view returns (address[] memory) {
        return trustedContacts;
    }

    function _clearApprovals() internal returns (uint8 cleared) {
        for (uint256 i = 0; i < trustedContacts.length; i++) {
            address contact = trustedContacts[i];
            if (approved[contact]) {
                approved[contact] = false;
                cleared += 1;
            }
        }
        approvalCount = 0;
    }
}
