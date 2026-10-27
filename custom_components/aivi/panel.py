"""Register the custom sidebar panel and serve its frontend bundle.

The panel is shown while at least one account entry is loaded. The bundle
and the template editor it loads on demand are generated from
frontend/src (gitignored), built by `make bundle` and the release
workflow.

The bundle is the entry: Home Assistant reads its URL once, at startup,
so its name stays fixed. It is served with `Cache-Control: no-cache`: a
browser keeps its copy but asks on every load whether it changed (an ETag
answer, usually a 304), so a rebuilt or upgraded panel shows on a normal
reload. Its URL also carries the release version and a hash of the bundle.
The SF Symbols index is revalidated the same way.

The template editor's name carries a hash of its content
(aivi-code-editor-<hash>.js, chosen by the build, which tells the bundle
the name), so a changed editor is a new URL and the file is cached for good.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path

from aiohttp import web
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN

PANEL_URL_PATH = "aivi"
PANEL_TITLE = "Aivi"
PANEL_ICON = "mdi:widgets"

_STATIC_URL = "/aivi_panel/aivi-panel.js"
_MODULE = "aivi-panel"
_FRONTEND_DIR = Path(__file__).parent / "frontend"
# What the view serves from the frontend directory, and nothing else: the
# bundle and the icon picker's SF Symbols index the panel loads on first
# open (scripts/refresh_sf_symbols.py), both revalidated on every load,
# and the template code editor it imports the first time a template box
# shows (frontend/vite.editor.config.ts), under a content-hashed name that
# is cached for good. The pattern admits no dots or slashes in the hash.
_REVALIDATED = frozenset({"aivi-panel.js", "sf-symbols.json"})
_HASHED = re.compile(r"aivi-code-editor-[A-Za-z0-9_-]{8,}\.js")
_NO_CACHE = "no-cache"
_IMMUTABLE = "public, max-age=31536000, immutable"

# Views cannot be unregistered, so the view is added once.
_STATIC_REGISTERED: HassKey[bool] = HassKey(f"{DOMAIN}_static_registered")
# Account entries set up concurrently at startup; registering is not atomic.
_REGISTER_LOCK: HassKey[asyncio.Lock] = HassKey(f"{DOMAIN}_panel_lock")


def _bundle_hash() -> str:
    """A short content hash of the bundle on disk; empty when it is not
    there (a source checkout without a build)."""
    try:
        # A cache-busting tag, not a security boundary.
        digest = hashlib.sha1((_FRONTEND_DIR / "aivi-panel.js").read_bytes())  # noqa: S324
    except OSError:
        return ""
    return digest.hexdigest()[:10]


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the sidebar panel unless it is already shown.

    Guarded on the frontend being loaded: a real Home Assistant always has
    it, but a headless test hass may not, and the integration's core
    (pushing content) must not depend on the frontend."""
    async with hass.data.setdefault(_REGISTER_LOCK, asyncio.Lock()):
        await _async_register_panel(hass)


async def _async_register_panel(hass: HomeAssistant) -> None:
    if "frontend" not in hass.config.components or PANEL_URL_PATH in hass.data.get(
        frontend.DATA_PANELS, {}
    ):
        return
    if not hass.data.get(_STATIC_REGISTERED):
        hass.data[_STATIC_REGISTERED] = True
        hass.http.register_view(PanelFileView())
    # The module URL carries the release version (the release workflow
    # stamps manifest.json) and a hash of the bundle as it was when Home
    # Assistant started; the no-cache answer covers a bundle rebuilt since.
    integration = await async_get_integration(hass, DOMAIN)
    stamp = await hass.async_add_executor_job(_bundle_hash)
    tag = ".".join(part for part in (integration.version, stamp) if part)
    module_url = f"{_STATIC_URL}?v={tag}" if tag else _STATIC_URL
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=_MODULE,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=module_url,
        require_admin=True,
        config_panel_domain=DOMAIN,
    )


@callback
def async_remove_panel(hass: HomeAssistant) -> None:
    """Take the panel out of the sidebar (the last account unloaded)."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)


class PanelFileView(HomeAssistantView):
    """The panel's bundle, its template editor and the symbols index, from
    the frontend directory. Public, like the static paths frontend files
    use: the panel itself requires an admin."""

    url = "/aivi_panel/{filename}"
    name = "aivi:panel_file"
    requires_auth = False

    async def get(self, request: web.Request, filename: str) -> web.StreamResponse:
        if filename in _REVALIDATED:
            # Revalidated on every load: a rebuilt bundle shows on a normal
            # reload, an unchanged one costs a 304.
            cache = _NO_CACHE
        elif _HASHED.fullmatch(filename):
            # A new build is a new name, so this file never changes.
            cache = _IMMUTABLE
        else:
            raise web.HTTPNotFound
        return web.FileResponse(
            _FRONTEND_DIR / filename, headers={"Cache-Control": cache}
        )
