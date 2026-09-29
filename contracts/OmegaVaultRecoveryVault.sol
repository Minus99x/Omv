// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OmegaVaultRecoveryVault - Ethereum proof adapter
/// @notice A Sepolia-only proof harness for OmegaVault recovery-policy semantics.
/// @dev This contract is an Ethereum adapter, not the chain-agnostic OmegaVault core.
///      Prototype only. It has not been audited and must not hold production value.
contract OmegaVaultRecoveryVault {
    uint32 public constant ADAPTER_VERSION = 400; // 0.4.0
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

    event Heartbeat(uint64 timestamp);
    event RecoveryRequested(address indexed contact);
    event RecoveryApproved(address indexed contact, uint8 approvals, uint8 threshold);
    event RecoveryCancelled(uint8 approvalsCleared);
    event RecoveryExecuted(address indexed destination, uint256 amount);
    event OwnerWithdrawal(address indexed destination, uint256 amount);

    error OnlyOwner();
    error NotTrustedContact();
    error InactivityNotElapsed();
    error InvalidConfiguration();
    error ThresholdNotMet();
    error AlreadyRecovered();
    error TransferFailed();
    error InvalidAmount();

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
