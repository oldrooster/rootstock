"""Utilities for building Ansible playbooks as Python dicts.

Replaces f-string YAML concatenation with structured dict construction + ruamel.yaml
serialisation. This guarantees correct indentation and quoting.

Usage::

    from app.services.playbook_util import dump_playbook, literal, task

    plays = [
        {
            "name": "My play",
            "hosts": "all",
            "become": True,
            "tasks": [
                task("Copy file", copy={"src": "foo", "dest": "/etc/foo", "mode": "0644"}),
                task("Run script", shell=literal("for x in items; do\n  echo $x\ndone\n"),
                     changed_when=False),
            ],
        }
    ]
    playbook_yml = dump_playbook(plays)
"""

from io import StringIO

from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import LiteralScalarString


def literal(s: str) -> LiteralScalarString:
    """Return a YAML literal block scalar (``|`` style) for multi-line strings."""
    return LiteralScalarString(s)


def task(name: str, **kwargs: object) -> dict:
    """Build a task dict with ``name`` first, then keyword arguments as module args.

    Keyword args that map to Ansible task-level keywords (``when``, ``register``,
    ``failed_when``, ``changed_when``, ``become``, ``loop``, ``ignore_errors``,
    ``args``) are placed directly on the task dict. Everything else is treated as a
    module name with its argument dict.
    """
    _TASK_KEYWORDS = {
        "when", "register", "failed_when", "changed_when",
        "become", "loop", "ignore_errors", "args", "with_items",
        "notify", "no_log", "retries", "delay", "until",
    }
    t: dict = {"name": name}
    # Modules first (non-keyword args), then task-level keywords
    for k, v in kwargs.items():
        if k not in _TASK_KEYWORDS:
            t[k] = v
    for k in _TASK_KEYWORDS:
        if k in kwargs:
            t[k] = kwargs[k]
    return t


def dump_playbook(plays: list[dict]) -> str:
    """Serialise a list of play dicts to a YAML string."""
    y = YAML()
    y.default_flow_style = False
    y.width = 9999  # prevent line wrapping
    y.best_sequence_indent = 2
    y.indent(mapping=2, sequence=4, offset=2)
    stream = StringIO()
    y.dump(plays, stream)
    return stream.getvalue()
