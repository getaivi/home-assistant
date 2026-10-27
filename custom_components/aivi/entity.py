"""The devices the integration's entities hang off: one per binding, and
one per account for what belongs to the account as a whole."""

from __future__ import annotations

from homeassistant.config_entries import ConfigSubentry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import CONF_NAME, DOMAIN
from .runtime import AiviConfigEntry, binding_model


def binding_device(subentry: ConfigSubentry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, subentry.subentry_id)},
        name=subentry.data[CONF_NAME],
        manufacturer="Aivi",
        model=binding_model(subentry),
        entry_type=DeviceEntryType.SERVICE,
    )


def account_device(entry: AiviConfigEntry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=entry.title,
        manufacturer="Aivi",
        model="Account",
        entry_type=DeviceEntryType.SERVICE,
    )
