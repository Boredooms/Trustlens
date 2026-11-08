// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Integrity registry for off-chain TrustLens threat reports.
/// @notice Stores commitments only. No URLs, no domains, no message text, no personal data, ever.
///         A record proves a report was not altered after registration; it does not prove the
///         report is true. Spec: docs/02-architecture/WEB3_REGISTRY.md.
contract ThreatReportRegistry {
    enum Status { Unknown, Active, Disputed, Withdrawn }

    struct Record {
        bytes32 commitment;   // keccak256(abi.encode(reportId, payloadHash, salt, revision))
        bytes32 payloadHash;  // sha256 of the canonical off-chain payload (no personal data)
        address reporter;
        uint64  registeredAt;
        uint32  revision;
        Status  status;
    }

    mapping(bytes32 => Record) private _records; // reportId => current record
    uint256 public total;

    event ReportRegistered(bytes32 indexed reportId, address indexed reporter, bytes32 commitment, uint32 revision, bytes32 payloadHash);
    event ReportDisputed(bytes32 indexed reportId, address indexed by, bytes32 reasonHash);
    event ReportWithdrawn(bytes32 indexed reportId, address indexed by);

    error AlreadyRegistered(bytes32 reportId);
    error NotRegistered(bytes32 reportId);
    error NotReporter(bytes32 reportId);
    error EmptyCommitment();
    error StaleRevision(uint32 current, uint32 proposed);

    /// @notice The one commitment formula. Pure, so callers without keccak agree by construction.
    function commitmentOf(bytes32 reportId, bytes32 payloadHash, bytes32 salt, uint32 revision) public pure returns (bytes32) {
        return keccak256(abi.encode(reportId, payloadHash, salt, revision));
    }

    function register(bytes32 reportId, bytes32 commitment, bytes32 payloadHash, uint32 revision) external {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (_records[reportId].commitment != bytes32(0)) revert AlreadyRegistered(reportId);
        _records[reportId] = Record(commitment, payloadHash, msg.sender, uint64(block.timestamp), revision, Status.Active);
        unchecked { total += 1; }
        emit ReportRegistered(reportId, msg.sender, commitment, revision, payloadHash);
    }

    /// @notice New revision (e.g. after analyst review). History lives in ReportRegistered events.
    function revise(bytes32 reportId, bytes32 commitment, bytes32 payloadHash, uint32 revision) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        if (r.reporter != msg.sender) revert NotReporter(reportId);
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (revision <= r.revision) revert StaleRevision(r.revision, revision);
        r.commitment = commitment;
        r.payloadHash = payloadHash;
        r.revision = revision;
        emit ReportRegistered(reportId, msg.sender, commitment, revision, payloadHash);
    }

    /// @notice Anyone may dispute. A dispute is a public signal; it never changes the commitment.
    function dispute(bytes32 reportId, bytes32 reasonHash) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        r.status = Status.Disputed;
        emit ReportDisputed(reportId, msg.sender, reasonHash);
    }

    function withdraw(bytes32 reportId) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        if (r.reporter != msg.sender) revert NotReporter(reportId);
        r.status = Status.Withdrawn;
        emit ReportWithdrawn(reportId, msg.sender);
    }

    function get(bytes32 reportId) external view returns (Record memory) {
        return _records[reportId];
    }

    /// @notice Independent check: do this payload hash and salt match the current commitment?
    function verify(bytes32 reportId, bytes32 payloadHash, bytes32 salt) external view returns (bool ok, uint32 revision, Status status) {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) return (false, 0, Status.Unknown);
        return (commitmentOf(reportId, payloadHash, salt, r.revision) == r.commitment, r.revision, r.status);
    }
}
