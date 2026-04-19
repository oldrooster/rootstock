"""Shared SSH utilities used across routers (containers, backups, ingress).

Centralises paramiko boilerplate so fixes (retry logic, key types, etc.) only
need to be made in one place.
"""

import asyncio
import io
import logging

import paramiko

logger = logging.getLogger(__name__)


def load_private_key(pem: str) -> paramiko.PKey:
    """Load a private key from a PEM string. Tries Ed25519 then RSA."""
    try:
        return paramiko.Ed25519Key.from_private_key(io.StringIO(pem))
    except paramiko.SSHException:
        pass
    return paramiko.RSAKey.from_private_key(io.StringIO(pem))


def ssh_exec(
    host: str,
    user: str,
    pem: str,
    command: str,
    timeout: int = 30,
) -> tuple[int, str, str]:
    """Execute a command over SSH. Returns (exit_code, stdout, stderr)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = load_private_key(pem)
    try:
        client.connect(
            hostname=host, username=user, pkey=pkey,
            timeout=15, look_for_keys=False, allow_agent=False,
        )
        _, stdout, stderr = client.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()
    finally:
        client.close()


async def open_ssh_client(ip: str, user: str, pem: str) -> paramiko.SSHClient:
    """Open and return a connected SSH client (async-safe)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = load_private_key(pem)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: client.connect(
            hostname=ip, username=user, pkey=pkey,
            timeout=15, look_for_keys=False, allow_agent=False,
        ),
    )
    return client
