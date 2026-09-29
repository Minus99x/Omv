// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title OmegaVaultRecoveryVaultTRONV063
/// @notice Development-only TVM vault with inactivity-gated threshold recovery for TRX and TRC-20.
/// @dev Compile only with the pinned TRON Solidity distribution. Not audited; testnet only.
contract OmegaVaultRecoveryVaultTRONV063 {
    uint32 public constant ADAPTER_VERSION = 603;
    uint8 public constant MAX_TRUSTED_CONTACTS = 32;

    address public immutable owner;
    address payable public immutable rescueDestination;
    uint64 public immutable inactivityPeriod;
    uint8 public immutable threshold;
    uint64 public lastHeartbeat;
    uint64 public recoveryEpoch = 1;
    uint8 public approvalCount;
    bool public recovered;

    mapping(address => bool) public isTrustedContact;
    mapping(address => uint64) public approvedEpoch;
    address[] public trustedContacts;
    bool private entered;

    event Heartbeat(uint64 timestamp, uint64 recoveryEpoch);
    event RecoveryApproved(address indexed contact, uint8 approvals, uint8 threshold, uint64 recoveryEpoch);
    event RecoveryExecuted(address indexed destination, uint256 trxAmount);
    event TRC20Recovered(address indexed token, address indexed destination, uint256 amount);
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
    error ReentrantCall();

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

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Proves owner activity and invalidates all approvals in O(1) via an epoch increment.
    function heartbeat() external onlyOwner {
        if (recovered) revert AlreadyRecovered();
        lastHeartbeat = uint64(block.timestamp);
        recoveryEpoch += 1;
        approvalCount = 0;
        emit Heartbeat(lastHeartbeat, recoveryEpoch);
    }

    function ownerWithdraw(address payable destination, uint256 amount) external onlyOwner nonReentrant {
        if (recovered) revert AlreadyRecovered();
        if (destination == address(0) || amount > address(this).balance) revert InvalidAmount();
        (bool ok,) = destination.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit OwnerWithdrawal(destination, amount);
    }

    function approveRecovery() external onlyTrusted {
        if (recovered) revert AlreadyRecovered();
        if (block.timestamp < uint256(lastHeartbeat) + inactivityPeriod) revert InactivityNotElapsed();
        if (approvedEpoch[msg.sender] != recoveryEpoch) {
            approvedEpoch[msg.sender] = recoveryEpoch;
            approvalCount += 1;
            emit RecoveryApproved(msg.sender, approvalCount, threshold, recoveryEpoch);
        }
    }

    /// @notice Permissionless execution after the immutable threshold and inactivity rules are satisfied.
    function executeRecovery() external nonReentrant {
        if (recovered) revert AlreadyRecovered();
        if (block.timestamp < uint256(lastHeartbeat) + inactivityPeriod) revert InactivityNotElapsed();
        if (approvalCount < threshold) revert ThresholdNotMet();
        recovered = true;
        uint256 amount = address(this).balance;
        (bool ok,) = rescueDestination.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RecoveryExecuted(rescueDestination, amount);
    }

    /// @notice Sweeps a TRC-20 balance only to the immutable rescue destination after recovery.
    /// @dev Accepts standards-compliant boolean returns and legacy tokens returning no data.
    function recoverTRC20(address token) external nonReentrant returns (uint256 amount) {
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
        emit TRC20Recovered(token, rescueDestination, amount);
    }

    function secondsUntilEligible() external view returns (uint256) {
        uint256 eligibleAt = uint256(lastHeartbeat) + inactivityPeriod;
        return block.timestamp >= eligibleAt ? 0 : eligibleAt - block.timestamp;
    }

    function hasApprovedCurrentEpoch(address contact) external view returns (bool) {
        return approvedEpoch[contact] == recoveryEpoch;
    }

    function getTrustedContacts() external view returns (address[] memory) {
        return trustedContacts;
    }
}
