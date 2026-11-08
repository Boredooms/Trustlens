"""Address classification for the SSRF policy (SECURITY_THREAT_MODEL.md §4).

Pure functions: given an IP, say whether it is reachable under policy and why not. The guard
(services/guard.py) calls this for every resolved address of every hop.
"""

from __future__ import annotations

import ipaddress

# Ranges not covered (or not reliably covered) by the stdlib flags.
_EXTRA_BLOCKED_V4 = [
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",  # "this" network
        "100.64.0.0/10",  # CGNAT
        "192.0.0.0/24",  # IETF protocol assignments
        "192.0.2.0/24",  # TEST-NET-1
        "198.18.0.0/15",  # benchmarking
        "198.51.100.0/24",  # TEST-NET-2
        "203.0.113.0/24",  # TEST-NET-3
        "240.0.0.0/4",  # reserved
        "255.255.255.255/32",
    )
]
_METADATA_HOSTS = {"169.254.169.254", "fd00:ec2::254", "100.100.100.200"}
_BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata",
    "metadata.google.internal",
    "instance-data",
}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa")


def classify_ip(raw: str) -> str | None:
    """Return a block reason, or None when the address may be contacted."""
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return "invalid_address"
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return classify_ip(str(ip.ipv4_mapped))
    if isinstance(ip, ipaddress.IPv6Address) and ip.sixtofour is not None:
        return classify_ip(str(ip.sixtofour))
    if str(ip) in _METADATA_HOSTS:
        return "metadata_address"
    if ip.is_loopback:
        return "loopback"
    if ip.is_link_local:
        return "link_local"
    if ip.is_multicast:
        return "multicast"
    if ip.is_private:
        return "private_range"
    if ip.is_reserved or ip.is_unspecified:
        return "reserved_range"
    if isinstance(ip, ipaddress.IPv4Address) and any(ip in net for net in _EXTRA_BLOCKED_V4):
        return "reserved_range"
    if not ip.is_global:
        return "non_global"
    return None


def classify_hostname(host: str) -> str | None:
    """Block internal names before any DNS query is made."""
    name = host.rstrip(".").lower()
    if name in _BLOCKED_HOSTNAMES or name.endswith(_BLOCKED_SUFFIXES):
        return "internal_name"
    if "." not in name:
        return "internal_name"  # single-label names resolve via search domains
    return None
