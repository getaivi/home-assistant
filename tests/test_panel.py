"""Sidebar panel registration and the files the panel is served from.

The bundle is the entry: a fixed name whose URL carries
`?v=<manifest version>.<bundle hash>`, revalidated on every load. The
template editor has a content-hashed name and is cached for good.
"""

from __future__ import annotations

import gzip
import hashlib
from pathlib import Path

import pytest
from aiohttp import web
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.aivi import panel as aivi_panel
from custom_components.aivi.const import DOMAIN


async def _setup_with_frontend(hass: HomeAssistant) -> MockConfigEntry:
    # The real frontend component needs the hass_frontend package (not a
    # test dependency); panel registration only needs http for the static
    # path and the "frontend" marker panel.py guards on.
    assert await async_setup_component(hass, "http", {})
    hass.config.components.add("frontend")
    entry = MockConfigEntry(domain=DOMAIN, data={"token": "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_module_url_carries_version_and_bundle_hash(hass: HomeAssistant) -> None:
    """The registered module URL is the static bundle plus `?v=<version>.<hash
    of the bundle>`, so a rebuilt bundle is never served from a browser's
    cache; without a built bundle the version stands alone."""
    await _setup_with_frontend(hass)

    panel = hass.data[frontend.DATA_PANELS]["aivi"]
    integration = await async_get_integration(hass, DOMAIN)
    assert integration.version is not None  # custom integrations always have one
    module_url = panel.config["_panel_custom"]["module_url"]
    bundle = Path(aivi_panel.__file__).parent / "frontend" / "aivi-panel.js"
    tag = integration.version
    if bundle.exists():
        tag += "." + hashlib.sha1(bundle.read_bytes()).hexdigest()[:10]  # noqa: S324
    assert module_url == f"/aivi_panel/aivi-panel.js?v={tag}"


async def test_panel_registered_once(hass: HomeAssistant) -> None:
    """A second account entry must not re-register the panel (or crash)."""
    await _setup_with_frontend(hass)

    second = MockConfigEntry(domain=DOMAIN, data={"token": "t2"}, title="aivi 2")
    second.add_to_hass(hass)
    assert await hass.config_entries.async_setup(second.entry_id)
    await hass.async_block_till_done()

    assert "aivi" in hass.data[frontend.DATA_PANELS]


async def test_panel_leaves_the_sidebar_with_the_last_account(
    hass: HomeAssistant,
) -> None:
    first = await _setup_with_frontend(hass)
    second = MockConfigEntry(domain=DOMAIN, data={"token": "t2"}, title="aivi 2")
    second.add_to_hass(hass)
    assert await hass.config_entries.async_setup(second.entry_id)

    assert await hass.config_entries.async_unload(first.entry_id)
    assert "aivi" in hass.data[frontend.DATA_PANELS]
    assert await hass.config_entries.async_unload(second.entry_id)
    assert "aivi" not in hass.data[frontend.DATA_PANELS]

    # Loading an account again brings it back.
    assert await hass.config_entries.async_setup(first.entry_id)
    assert "aivi" in hass.data[frontend.DATA_PANELS]


async def test_accounts_set_up_together_share_one_panel(hass: HomeAssistant) -> None:
    """At startup every account entry sets up concurrently; only one may
    register the panel."""
    assert await async_setup_component(hass, "http", {})
    hass.config.components.add("frontend")
    entries = [
        MockConfigEntry(domain=DOMAIN, data={"token": f"t{n}"}, title=f"aivi {n}")
        for n in range(2)
    ]
    for entry in entries:
        entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert all(entry.state is ConfigEntryState.LOADED for entry in entries)
    assert "aivi" in hass.data[frontend.DATA_PANELS]


async def test_editor_module_is_served_beside_the_bundle(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The template editor the panel imports on demand is served from the
    same directory as the bundle, so its relative URL resolves. Its name
    carries a hash of its content, so it is cached for good."""
    (tmp_path / "aivi-panel.js").write_text("export {};")
    editor = "export function mountCodeEditor() {}"
    (tmp_path / "aivi-code-editor-DdMd_S-J.js").write_text(editor)
    monkeypatch.setattr(aivi_panel, "_FRONTEND_DIR", tmp_path)
    await _setup_with_frontend(hass)

    client = await hass_client()
    res = await client.get("/aivi_panel/aivi-code-editor-DdMd_S-J.js")
    assert res.status == 200
    assert res.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert "mountCodeEditor" in await res.text()


@pytest.mark.parametrize(
    "path",
    [
        # Not the panel's: outside the allowlist and the editor's pattern.
        "secret.txt",
        "sf-symbols.json.gz",
        "aivi-code-editor.js",
        "aivi-code-editor-short.js",
        "aivi-code-editor-DdMdpSaJ.js.map",
        "xaivi-code-editor-DdMdpSaJ.js",
        # Out of the frontend directory, plain and percent-encoded.
        "..%2F__init__.py",
        "aivi-code-editor-..%2F..%2Fx.js",
        "%2E%2E%2Fmanifest.json",
    ],
)
async def test_only_the_panels_own_files_are_served(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    for name in (
        "secret.txt",
        "sf-symbols.json.gz",
        "aivi-code-editor.js",
        "aivi-code-editor-short.js",
        "aivi-code-editor-DdMdpSaJ.js.map",
        "xaivi-code-editor-DdMdpSaJ.js",
    ):
        (frontend_dir / name).write_text("not served")
    (tmp_path / "__init__.py").write_text("not served")
    (tmp_path / "manifest.json").write_text("not served")
    monkeypatch.setattr(aivi_panel, "_FRONTEND_DIR", frontend_dir)
    await _setup_with_frontend(hass)

    client = await hass_client()
    res = await client.get(f"/aivi_panel/{path}")
    # A 404 from the view, or a 400 when Home Assistant's own request
    # filter turns the path away first.
    assert res.status in (400, 404)
    assert "not served" not in await res.text()


async def test_panel_files_are_revalidated_on_every_load(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A browser asks on every load whether the bundle changed, so a rebuilt
    or upgraded panel shows on a normal reload, and an unchanged one costs
    a 304."""
    (tmp_path / "aivi-panel.js").write_text("export {};")
    monkeypatch.setattr(aivi_panel, "_FRONTEND_DIR", tmp_path)
    await _setup_with_frontend(hass)

    client = await hass_client()
    res = await client.get("/aivi_panel/aivi-panel.js")
    assert res.status == 200
    assert res.headers["Cache-Control"] == "no-cache"
    etag = res.headers["ETag"]
    again = await client.get(
        "/aivi_panel/aivi-panel.js", headers={"If-None-Match": etag}
    )
    assert again.status == 304

    (tmp_path / "aivi-panel.js").write_text("export const rebuilt = 1;")
    rebuilt = await client.get(
        "/aivi_panel/aivi-panel.js", headers={"If-None-Match": etag}
    )
    assert rebuilt.status == 200
    assert "rebuilt" in await rebuilt.text()

    # The SF Symbols index is revalidated the same way; missing, a 404.
    assert (await client.get("/aivi_panel/sf-symbols.json")).status == 404
    (tmp_path / "sf-symbols.json").write_text("{}")
    symbols = await client.get("/aivi_panel/sf-symbols.json")
    assert symbols.status == 200
    assert symbols.headers["Cache-Control"] == "no-cache"
    assert "Content-Encoding" not in symbols.headers
    # Beside a gzipped copy (the release zip's), that copy goes out.
    with gzip.open(tmp_path / "sf-symbols.json.gz", "wt") as packed:
        packed.write('{"symbols":[]}')
    gzipped = await client.get(
        "/aivi_panel/sf-symbols.json", headers={"Accept-Encoding": "gzip"}
    )
    assert gzipped.headers["Content-Encoding"] == "gzip"
    assert await gzipped.json() == {"symbols": []}


@pytest.mark.parametrize(
    "filename",
    [
        "../manifest.json",
        "../frontend/aivi-panel.js",
        "aivi-code-editor-../../../x.js",
        "aivi-code-editor-DdMdpSaJ.js/../../manifest.json",
        "/etc/passwd",
    ],
)
async def test_the_view_refuses_paths_out_of_the_frontend_directory(
    filename: str,
) -> None:
    """Behind Home Assistant's own request filter, the view itself only
    answers the allowlist and the editor's pattern."""
    with pytest.raises(web.HTTPNotFound):
        await aivi_panel.PanelFileView().get(None, filename)  # type: ignore[arg-type]
