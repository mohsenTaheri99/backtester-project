"""User settings, defined in one list and stored as JSON on the user's machine.

Adding a setting is a one-liner: append a `SettingDef` to `SETTINGS`. Validation,
persistence, the REST payload and the control the modal renders all follow from
that entry, so neither the API nor the frontend needs touching.

The file lives in %LOCALAPPDATA%\\GoldBacktester\\settings.json (outside the
installation, so upgrades and uninstalls leave it alone). Secrets - the API key -
are stored in clear there like any other desktop app credential, but never sent
back to the UI: the payload only says whether one is set, and shows its last 4
characters.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import USER_DIR

SETTINGS_FILE = USER_DIR / "settings.json"

TEXT, PASSWORD, NUMBER, BOOL, SELECT = "text", "password", "number", "bool", "select"


@dataclass(frozen=True)
class SettingDef:
    key: str
    label: str
    group: str
    type: str
    default: Any
    help: str = ""
    options: tuple[str, ...] = ()
    min: float | None = None
    max: float | None = None
    step: float | None = None
    placeholder: str = ""
    integer: bool = False

    @property
    def secret(self) -> bool:
        return self.type == PASSWORD

    def coerce(self, value: Any) -> Any:
        """Validate one incoming value, or raise ValueError."""
        if self.type == BOOL:
            if isinstance(value, bool):
                return value
            raise ValueError(f"{self.key} must be true or false")

        if self.type == NUMBER:
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{self.key} must be a number") from exc
            if self.min is not None and number < self.min:
                raise ValueError(f"{self.key} must be at least {self.min:g}")
            if self.max is not None and number > self.max:
                raise ValueError(f"{self.key} must be at most {self.max:g}")
            return int(round(number)) if self.integer else number

        if self.type == SELECT:
            text = str(value)
            if self.options and text not in self.options:
                raise ValueError(f"{self.key} must be one of {', '.join(self.options)}")
            return text

        return str(value).strip()


# ---------------------------------------------------------------------------
# every setting the app has; the modal is built from this list, in this order
# ---------------------------------------------------------------------------
SETTINGS: tuple[SettingDef, ...] = (
    SettingDef(
        key="twelvedata_api_key",
        label="API key",
        group="Data provider",
        type=PASSWORD,
        default="",
        placeholder="paste your Twelve Data key",
        help="Free key from twelvedata.com. Needed to add symbols and stream live prices.",
    ),
    SettingDef(
        key="history_days",
        label="History to download",
        group="Data provider",
        type=NUMBER,
        default=30,
        min=1,
        max=365,
        step=1,
        integer=True,
        help=(
            "Days of 1-minute candles fetched when a symbol is imported. One credit "
            "covers about 3.5 days, so 30 days costs roughly 9."
        ),
    ),
    SettingDef(
        key="provider_credits_per_minute",
        label="Rate limit",
        group="Data provider",
        type=NUMBER,
        default=8,
        min=1,
        max=3000,
        step=1,
        integer=True,
        help="Requests a minute your plan allows. Downloads are paced to stay under it.",
    ),
    SettingDef(
        key="live_enabled",
        label="Stream live prices",
        group="Live data",
        type=BOOL,
        default=False,
        help="Polls the provider for new 1-minute bars and appends them to the chart.",
    ),
    SettingDef(
        key="live_interval_seconds",
        label="Poll every",
        group="Live data",
        type=NUMBER,
        default=60,
        min=5,
        max=3600,
        step=5,
        integer=True,
        help="Seconds between requests. A free plan allows 8 per minute and 800 per day.",
    ),
    SettingDef(
        key="live_symbol",
        label="Symbol to stream",
        group="Live data",
        type=TEXT,
        default="",
        placeholder="the chart's symbol",
        help="Leave empty to follow whichever symbol the chart is showing.",
    ),
    SettingDef(
        key="forward_cash",
        label="Paper account",
        group="Forward test",
        type=NUMBER,
        default=10000,
        min=100,
        max=10_000_000,
        step=1000,
        help="Starting balance of the forward test, independent of the backtest.",
    ),
    SettingDef(
        key="forward_autostart",
        label="Resume on launch",
        group="Forward test",
        type=BOOL,
        default=True,
        help="Pick a running forward test back up when the app starts again.",
    ),
)

BY_KEY = {definition.key: definition for definition in SETTINGS}
GROUPS = list(dict.fromkeys(definition.group for definition in SETTINGS))


@dataclass
class _State:
    values: dict[str, Any] = field(default_factory=dict)


class SettingsStore:
    """Reads and writes settings.json, with the defaults filled in.

    Keys that are not in `SETTINGS` survive a round trip untouched, which is how
    non-user-facing state (the imported symbol catalog, the forward-test session)
    shares the same file.
    """

    def __init__(self, path: Path = SETTINGS_FILE) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._state = _State()
        self._loaded = False

    # -- disk ---------------------------------------------------------------
    def load(self) -> None:
        with self._lock:
            raw: dict[str, Any] = {}
            if self.path.exists():
                try:
                    raw = json.loads(self.path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    print(f"[settings] ignoring unreadable {self.path}: {exc}")
                    raw = {}
            self._state.values = raw if isinstance(raw, dict) else {}
            self._loaded = True

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(self._state.values, indent=2), encoding="utf-8")
        temp.replace(self.path)  # atomic: never leave a half-written file behind

    # -- access -------------------------------------------------------------
    def _ensure(self) -> None:
        if not self._loaded:
            self.load()

    def get(self, key: str, fallback: Any = None) -> Any:
        self._ensure()
        with self._lock:
            if key in self._state.values:
                return self._state.values[key]
        definition = BY_KEY.get(key)
        return definition.default if definition else fallback

    def all(self) -> dict[str, Any]:
        """Every defined setting, defaults included."""
        self._ensure()
        return {definition.key: self.get(definition.key) for definition in SETTINGS}

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Apply validated changes. Unknown keys are ignored, None means 'leave as is'."""
        self._ensure()
        clean: dict[str, Any] = {}
        for key, value in changes.items():
            definition = BY_KEY.get(key)
            if definition is None or value is None:
                continue
            clean[key] = definition.coerce(value)

        with self._lock:
            self._state.values.update(clean)
            self._save()
        return self.all()

    # -- free-form state sharing the same file ------------------------------
    def get_state(self, key: str, fallback: Any = None) -> Any:
        self._ensure()
        with self._lock:
            return self._state.values.get(f"_{key}", fallback)

    def set_state(self, key: str, value: Any) -> None:
        self._ensure()
        with self._lock:
            if value is None:
                self._state.values.pop(f"_{key}", None)
            else:
                self._state.values[f"_{key}"] = value
            self._save()

    # -- what the modal renders ---------------------------------------------
    def describe(self) -> dict[str, Any]:
        self._ensure()
        groups = []
        for group in GROUPS:
            entries = []
            for definition in SETTINGS:
                if definition.group != group:
                    continue
                value = self.get(definition.key)
                entry: dict[str, Any] = {
                    "key": definition.key,
                    "label": definition.label,
                    "type": definition.type,
                    "help": definition.help,
                    "placeholder": definition.placeholder,
                    "default": definition.default,
                    "value": "" if definition.secret else value,
                }
                if definition.options:
                    entry["options"] = list(definition.options)
                for bound in ("min", "max", "step"):
                    if getattr(definition, bound) is not None:
                        entry[bound] = getattr(definition, bound)
                if definition.secret:
                    text = str(value or "")
                    entry["isSet"] = bool(text)
                    entry["hint"] = f"…{text[-4:]}" if len(text) >= 4 else ""
                entries.append(entry)
            groups.append({"name": group, "settings": entries})
        return {"file": str(self.path), "groups": groups}


settings = SettingsStore()
