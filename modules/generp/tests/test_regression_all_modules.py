"""
GenERP API regression tests.

Requires: PostgreSQL + seeded DB, and either:
  - backend running on http://127.0.0.1:8030, or
  - set GENERP_TEST_BASE_URL

Run:
  cd backend
  .venv\\Scripts\\pytest tests -v
"""

from __future__ import annotations

import io
import os
import uuid
import zipfile
from datetime import date

import httpx
import pytest

BASE_URL = os.environ.get("GENERP_TEST_BASE_URL", "http://127.0.0.1:8030").rstrip("/")
API = f"{BASE_URL}/api/v1"
ADMIN_EMAIL = os.environ.get("GENERP_TEST_EMAIL", "admin@generp.example.com")
ADMIN_PASSWORD = os.environ.get("GENERP_TEST_PASSWORD", "admin123")

EXPECTED_MENU_CODES = {
    "dashboard",
    "sale_bill",
    "sale_bill_modify",
    "sale_bill_reprint",
    "wholesale_bill",
    "wholesale_bill_modify",
    "wholesale_bill_reprint",
    "product_creation",
    "barcode_generation",
    "print_master",
    "print_template_designer",
    "sale_bill_settings",
    "bill_prefix",
    "purchase_bill_details",
}


def uid(prefix: str = "T") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8].upper()}"


def _xlsx_col(index: int) -> str:
    n = index + 1
    s = ""
    while n:
        n, m = divmod(n - 1, 26)
        s = chr(65 + m) + s
    return s


def make_xlsx(rows: list[list[object]]) -> bytes:
    sheet_rows: list[str] = []
    for r, row in enumerate(rows, start=1):
        cells: list[str] = []
        for c, val in enumerate(row):
            if val is None or val == "":
                continue
            ref = f"{_xlsx_col(c)}{r}"
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                cells.append(f'<c r="{ref}"><v>{val}</v></c>')
            else:
                text = (
                    str(val)
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                )
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>')
        sheet_rows.append(f'<row r="{r}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        zf.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(base_url=API, timeout=30.0) as c:
        health = httpx.get(f"{BASE_URL}/health", timeout=5.0)
        if health.status_code != 200:
            pytest.skip(f"Backend not reachable at {BASE_URL}")
        yield c


@pytest.fixture(scope="session")
def token(client: httpx.Client) -> str:
    r = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("access_token"), data
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def login_payload(client: httpx.Client) -> dict:
    r = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def flatten_menu_codes(nodes: list) -> set[str]:
    out: set[str] = set()
    for n in nodes:
        out.add(n["code"])
        out |= flatten_menu_codes(n.get("children") or [])
    return out


# ---------------------------------------------------------------------------
# Auth / menus
# ---------------------------------------------------------------------------


class TestAuth:
    def test_login_success(self, login_payload: dict):
        assert login_payload["token_type"] in ("bearer", "Bearer")
        assert login_payload["user"]["email"] == ADMIN_EMAIL
        assert login_payload["menus"]

    def test_login_wrong_password(self, client: httpx.Client):
        r = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pass"})
        assert r.status_code in (401, 400)

    def test_me(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_my_menus(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/auth/my-menus", headers=auth_headers)
        assert r.status_code == 200
        codes = flatten_menu_codes(r.json())
        missing = EXPECTED_MENU_CODES - codes
        assert not missing, f"Missing menu codes: {missing}"

    def test_login_menus_cover_modules(self, login_payload: dict):
        codes = flatten_menu_codes(login_payload["menus"])
        for code in (
            "sale_bill",
            "wholesale_bill",
            "product_creation",
            "barcode_generation",
            "print_master",
        ):
            assert code in codes, f"{code} not in login menus"

    def test_unauthenticated_rejected(self, client: httpx.Client):
        r = client.get("/products")
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Dashboard shortcuts (unpin must not hide the real menu)
# ---------------------------------------------------------------------------


class TestDashboardShortcuts:
    def test_product_master_stays_in_menus(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/auth/my-menus", headers=auth_headers)
        assert r.status_code == 200
        codes = flatten_menu_codes(r.json())
        assert "product_creation" in codes

    def test_delete_shortcut_does_not_remove_menu(self, client: httpx.Client, auth_headers: dict):
        existing = client.get(
            "/dashboard-shortcuts",
            headers=auth_headers,
            params={"host_code": "dashboard"},
        )
        assert existing.status_code == 200, existing.text
        used = {s["menu_code"] for s in existing.json()}
        target = next(
            (c for c in ("company_profile", "audit_trail", "daybook") if c not in used),
            None,
        )
        if target is None:
            pytest.skip("No unused menu available to pin as a test shortcut")

        created = client.post(
            "/dashboard-shortcuts",
            headers=auth_headers,
            json={
                "host_code": "dashboard",
                "menu_code": target,
                "button_label": "Tmp Unpin",
                "sort_order": 99,
                "is_active": True,
            },
        )
        assert created.status_code == 200, created.text
        sid = created.json()["id"]

        deleted = client.delete(f"/dashboard-shortcuts/{sid}", headers=auth_headers)
        assert deleted.status_code == 200, deleted.text

        after = client.get(
            "/dashboard-shortcuts",
            headers=auth_headers,
            params={"host_code": "dashboard"},
        )
        assert after.status_code == 200, after.text
        assert all(s["id"] != sid for s in after.json())

        menus = flatten_menu_codes(client.get("/auth/my-menus", headers=auth_headers).json())
        assert "product_creation" in menus
        assert target in menus

    def test_product_creation_shortcut_label(self, client: httpx.Client, auth_headers: dict):
        r = client.get(
            "/dashboard-shortcuts",
            headers=auth_headers,
            params={"host_code": "dashboard"},
        )
        assert r.status_code == 200, r.text
        pins = [s for s in r.json() if s["menu_code"] == "product_creation"]
        for s in pins:
            assert s["button_label"] != "Product Creation"


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class TestCategories:
    def test_crud(self, client: httpx.Client, auth_headers: dict):
        code = uid("CAT")
        r = client.post(
            "/categories",
            headers=auth_headers,
            json={"code": code, "name": f"Cat {code}"},
        )
        assert r.status_code == 200, r.text
        cat = r.json()
        cat_id = cat["id"]

        r = client.get("/categories", headers=auth_headers)
        assert r.status_code == 200
        assert any(x["id"] == cat_id for x in r.json())

        r = client.patch(
            f"/categories/{cat_id}",
            headers=auth_headers,
            json={"name": f"Cat {code} Updated"},
        )
        assert r.status_code == 200
        assert r.json()["name"].endswith("Updated")

        r = client.delete(f"/categories/{cat_id}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Sub-categories
# ---------------------------------------------------------------------------


class TestSubCategories:
    def test_crud(self, client: httpx.Client, auth_headers: dict):
        code = uid("SC")
        cat = client.post(
            "/categories",
            headers=auth_headers,
            json={"code": uid("CAT"), "name": f"Parent {code}"},
        ).json()

        r = client.post(
            "/sub-categories",
            headers=auth_headers,
            json={"category_id": cat["id"], "code": code, "name": f"Sub {code}"},
        )
        assert r.status_code == 200, r.text
        sub_id = r.json()["id"]

        r = client.get("/sub-categories", headers=auth_headers, params={"category_id": cat["id"]})
        assert r.status_code == 200
        assert any(x["id"] == sub_id for x in r.json())

        r = client.patch(
            f"/sub-categories/{sub_id}",
            headers=auth_headers,
            json={"name": f"Sub {code} Updated"},
        )
        assert r.status_code == 200

        r = client.delete(f"/sub-categories/{sub_id}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# GST
# ---------------------------------------------------------------------------


class TestGst:
    def test_list_seeded(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/gst", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_crud(self, client: httpx.Client, auth_headers: dict):
        code = uid("G")
        r = client.post(
            "/gst",
            headers=auth_headers,
            json={"code": code, "name": f"GST {code}", "rate": 12},
        )
        assert r.status_code == 200, r.text
        gst_id = r.json()["id"]

        r = client.patch(f"/gst/{gst_id}", headers=auth_headers, json={"name": f"GST {code} U"})
        assert r.status_code == 200

        r = client.delete(f"/gst/{gst_id}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Products + barcodes + variants
# ---------------------------------------------------------------------------


class TestProducts:
    def test_crud_and_lookup(self, client: httpx.Client, auth_headers: dict):
        name = f"Prod {uid()}"
        r = client.post(
            "/products",
            headers=auth_headers,
            json={
                "name": name,
                "sale_price": 100,
                "wholesale_price": 90,
                "opening_stock": 10,
            },
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["barcode"]
        assert prod["code"]

        r = client.get(f"/products/{prod['id']}", headers=auth_headers)
        assert r.status_code == 200

        r = client.get("/products/lookup", headers=auth_headers, params={"q": prod["barcode"]})
        assert r.status_code == 200
        assert r.json()["id"] == prod["id"]

        r = client.patch(
            f"/products/{prod['id']}",
            headers=auth_headers,
            json={"name": f"{name} Updated", "sale_price": 110},
        )
        assert r.status_code == 200
        assert r.json()["sale_price"] == 110

        r = client.get("/products", headers=auth_headers, params={"q": name[:8], "limit": 20})
        assert r.status_code == 200

        r = client.delete(f"/products/{prod['id']}", headers=auth_headers)
        assert r.status_code == 200

    def test_explicit_code_unique_and_auto(self, client: httpx.Client, auth_headers: dict):
        suffix = uid()[-4:]
        # Use a high unique range so it does not collide with catalog codes.
        code_a = str(910000 + int(suffix, 16) % 8000)
        r = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"Coded {uid()}", "code": code_a, "sale_price": 10},
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["code"] == str(int(code_a))
        dup = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"Dup {uid()}", "code": code_a, "sale_price": 11},
        )
        assert dup.status_code == 400
        auto = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"Auto {uid()}", "sale_price": 12},
        )
        assert auto.status_code == 200, auto.text
        assert auto.json()["code"]
        assert int(auto.json()["code"]) >= int(code_a)
        client.delete(f"/products/{prod['id']}", headers=auth_headers)
        client.delete(f"/products/{auto.json()['id']}", headers=auth_headers)

    def test_excel_import_uses_given_or_next_code(self, client: httpx.Client, auth_headers: dict):
        tag = uid()
        code1 = str(920000 + (int(tag[-4:], 16) % 7000))
        code2 = str(int(code1) + 1)
        payload = make_xlsx(
            [
                ["Code", "Name", "Category", "Sub category", "Sale"],
                [int(code1), f"Imp A {tag}", "General", "General", 10],
                [int(code2), f"Imp B {tag}", "General", "General", 20],
                ["", f"Imp C {tag}", "General", "", 30],
            ]
        )
        r = client.post(
            "/products/import",
            headers=auth_headers,
            files={
                "file": (
                    "products.xlsx",
                    payload,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] == 3, body
        found = []
        for name in (f"Imp A {tag}", f"Imp B {tag}", f"Imp C {tag}"):
            got = client.get("/products", headers=auth_headers, params={"q": name, "limit": 5})
            assert got.status_code == 200
            match = next((p for p in got.json() if p["name"] == name), None)
            assert match, name
            found.append(match)
        assert found[0]["code"] == str(int(code1))
        assert found[1]["code"] == str(int(code2))
        # Blank code is max(file codes, existing numeric codes) + 1.
        assert int(found[2]["code"]) >= int(code2) + 1
        assert found[2]["code"] not in {found[0]["code"], found[1]["code"]}
        assert (found[0].get("category_name") or "").lower() == "general"
        for p in found:
            client.delete(f"/products/{p['id']}", headers=auth_headers)

    def test_company_barcode_crud(self, client: httpx.Client, auth_headers: dict):
        prod = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"BC Prod {uid()}", "sale_price": 50},
        ).json()
        company_bc = f"890{uid()[:10]}"

        r = client.post(
            f"/products/{prod['id']}/barcodes",
            headers=auth_headers,
            json={"barcode": company_bc, "sale_rate": 55, "ws_rate": 48},
        )
        assert r.status_code == 200, r.text
        bc_id = r.json()["id"]

        r = client.get(f"/products/{prod['id']}/barcodes", headers=auth_headers)
        assert r.status_code == 200
        assert any(x["id"] == bc_id for x in r.json())

        r = client.get("/products/lookup", headers=auth_headers, params={"q": company_bc})
        assert r.status_code == 200
        assert r.json()["id"] == prod["id"]
        assert float(r.json()["sale_price"]) == 55

        r = client.patch(
            f"/products/barcodes/{bc_id}",
            headers=auth_headers,
            json={"sale_rate": 56},
        )
        assert r.status_code == 200

        r = client.delete(f"/products/barcodes/{bc_id}", headers=auth_headers)
        assert r.status_code == 200

        client.delete(f"/products/{prod['id']}", headers=auth_headers)

    def test_own_barcode_and_fifo_rates(self, client: httpx.Client, auth_headers: dict):
        orig = client.get("/company-profile", headers=auth_headers).json()
        prod = client.post(
            "/products",
            headers=auth_headers,
            json={
                "name": f"Own {uid()}",
                "sale_price": 80,
                "mrp": 100,
                "opening_stock": 5,
                "own_barcode": True,
            },
        ).json()
        assert prod["own_barcode"] is True

        r = client.patch(
            f"/products/{prod['id']}",
            headers=auth_headers,
            json={"own_barcode": False},
        )
        assert r.status_code == 200, r.text
        assert r.json()["own_barcode"] is False
        r = client.patch(
            f"/products/{prod['id']}",
            headers=auth_headers,
            json={"own_barcode": True, "mrp": 250},
        )
        assert r.status_code == 200, r.text
        assert r.json()["own_barcode"] is True
        got = client.get(f"/products/{prod['id']}", headers=auth_headers).json()
        assert got["own_barcode"] is True

        r = client.get(f"/products/{prod['id']}/barcodes", headers=auth_headers)
        assert r.status_code == 200, r.text
        auto = next((x for x in r.json() if x.get("kind") == "own"), None)
        assert auto, r.text
        assert auto["barcode"].endswith("000100")

        r = client.post(
            f"/products/{prod['id']}/own-barcodes",
            headers=auth_headers,
            json={"mrp": 199},
        )
        assert r.status_code == 200, r.text
        bc = r.json()["barcode"]
        assert bc.endswith("000199")
        looked = client.get("/products/lookup", headers=auth_headers, params={"q": bc}).json()
        assert float(looked["mrp"]) == 199
        assert float(looked["sale_price"]) == 199

        r = client.post(
            f"/products/{prod['id']}/barcodes",
            headers=auth_headers,
            json={"barcode": f"890{uid()[:10]}"},
        )
        assert r.status_code == 400

        maker = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"Maker {uid()}", "sale_price": 40, "own_barcode": False},
        ).json()
        r = client.post(
            f"/products/{maker['id']}/own-barcodes",
            headers=auth_headers,
            json={"mrp": 99},
        )
        assert r.status_code == 400
        for extra in (f"890{uid()[:10]}", f"890{uid()[:10]}"):
            r = client.post(
                f"/products/{maker['id']}/barcodes",
                headers=auth_headers,
                json={"barcode": extra, "mrp": 120, "sale_rate": 110},
            )
            assert r.status_code == 200, r.text

        try:
            client.patch(
                f"/products/{prod['id']}",
                headers=auth_headers,
                json={"sale_price": 50, "mrp": 60},
            )
            r = client.put(
                "/company-profile",
                headers=auth_headers,
                json={"name": orig.get("name") or "GenERP Company", "sale_rate_source": "fifo"},
            )
            assert r.status_code == 200, r.text
            by_code = client.get("/products/lookup", headers=auth_headers, params={"q": prod["code"]}).json()
            assert float(by_code["sale_price"]) == 80
            assert float(by_code["mrp"]) == 100
            scanned = client.get("/products/lookup", headers=auth_headers, params={"q": bc}).json()
            assert float(scanned["sale_price"]) == 199
            client.put(
                "/company-profile",
                headers=auth_headers,
                json={"name": orig.get("name") or "GenERP Company", "sale_rate_source": "product_master"},
            )
            by_code2 = client.get(
                "/products/lookup", headers=auth_headers, params={"q": prod["code"]}
            ).json()
            assert float(by_code2["sale_price"]) == 50
        finally:
            client.put(
                "/company-profile",
                headers=auth_headers,
                json={
                    "name": orig.get("name") or "GenERP Company",
                    "sale_rate_source": orig.get("sale_rate_source") or "product_master",
                },
            )
        client.delete(f"/products/{prod['id']}", headers=auth_headers)
        client.delete(f"/products/{maker['id']}", headers=auth_headers)

    def test_multi_barcode_piece_qty_and_paged(self, client: httpx.Client, auth_headers: dict):
        name = f"Multi {uid()}"
        r = client.post(
            "/products",
            headers=auth_headers,
            json={
                "name": name,
                "sale_price": 15,
                "multi_barcode": True,
                "barcode_piece_qty": 12,
            },
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["multi_barcode"] is True
        assert float(prod["barcode_piece_qty"]) == 12

        zero = client.post(
            "/products",
            headers=auth_headers,
            json={
                "name": f"MultiZero {uid()}",
                "sale_price": 5,
                "multi_barcode": True,
                "barcode_piece_qty": 0,
            },
        )
        assert zero.status_code == 200, zero.text
        assert zero.json()["multi_barcode"] is True
        assert float(zero.json()["barcode_piece_qty"]) == 1

        page = client.get(
            "/products/paged",
            headers=auth_headers,
            params={"q": name, "skip": 0, "limit": 10},
        )
        assert page.status_code == 200, page.text
        body = page.json()
        match = next((p for p in body["items"] if p["id"] == prod["id"]), None)
        assert match, body
        assert match["multi_barcode"] is True
        assert float(match["barcode_piece_qty"]) == 12
        assert body["total"] >= 1

        r = client.patch(
            f"/products/{prod['id']}",
            headers=auth_headers,
            json={"multi_barcode": False, "barcode_piece_qty": 4},
        )
        assert r.status_code == 200, r.text
        assert r.json()["multi_barcode"] is False
        assert float(r.json()["barcode_piece_qty"]) == 4

        client.delete(f"/products/{prod['id']}", headers=auth_headers)
        client.delete(f"/products/{zero.json()['id']}", headers=auth_headers)

    def test_generate_variants(self, client: httpx.Client, auth_headers: dict):
        base = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"VariantBase {uid()}", "sale_price": 200},
        ).json()
        r = client.post(
            "/products/generate-variants",
            headers=auth_headers,
            json={
                "product_id": base["id"],
                "axes": [
                    {"name": "Color", "values": ["Red", "Blue"]},
                    {"name": "Size", "values": ["S"]},
                ],
            },
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert len(created) == 2
        for v in created:
            client.delete(f"/products/{v['id']}", headers=auth_headers)
        client.delete(f"/products/{base['id']}", headers=auth_headers)


# ---------------------------------------------------------------------------
# Parties
# ---------------------------------------------------------------------------


class TestParties:
    def test_customer_crud(self, client: httpx.Client, auth_headers: dict):
        code = uid("CUST")
        r = client.post(
            "/parties",
            headers=auth_headers,
            json={"party_type": "customer", "code": code, "name": f"Customer {code}", "phone": "9999999999"},
        )
        assert r.status_code == 200, r.text
        party_id = r.json()["id"]

        r = client.get("/parties", headers=auth_headers, params={"party_type": "customer"})
        assert r.status_code == 200
        assert any(x["id"] == party_id for x in r.json())

        r = client.patch(f"/parties/{party_id}", headers=auth_headers, json={"name": f"Customer {code} U"})
        assert r.status_code == 200

        r = client.delete(f"/parties/{party_id}", headers=auth_headers)
        assert r.status_code == 200

    def test_vendor_and_quick(self, client: httpx.Client, auth_headers: dict):
        code = uid("VEND")
        r = client.post(
            "/parties",
            headers=auth_headers,
            json={"party_type": "vendor", "code": code, "name": f"Vendor {code}"},
        )
        assert r.status_code == 200, r.text
        client.delete(f"/parties/{r.json()['id']}", headers=auth_headers)

        r = client.post(
            "/parties/quick",
            headers=auth_headers,
            json={"name": f"Walkin {uid()}", "party_type": "customer", "phone": "8888888888"},
        )
        assert r.status_code == 200, r.text
        client.delete(f"/parties/{r.json()['id']}", headers=auth_headers)

    def test_both_customer_and_supplier(self, client: httpx.Client, auth_headers: dict):
        r = client.post(
            "/parties",
            headers=auth_headers,
            json={
                "party_type": "both",
                "name": f"Both {uid()}",
                "state": "Karnataka",
                "address_line1": "Billing 1",
                "address_line3": "Billing 3",
                "same_as_billing": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["party_type"] == "both"
        assert body["state"] == "Karnataka"
        assert body["shipping_address_line1"] == "Billing 1"
        assert body["shipping_address_line3"] == "Billing 3"
        party_id = body["id"]

        customers = client.get("/parties", headers=auth_headers, params={"party_type": "customer"}).json()
        vendors = client.get("/parties", headers=auth_headers, params={"party_type": "vendor"}).json()
        assert any(x["id"] == party_id for x in customers)
        assert any(x["id"] == party_id for x in vendors)

        client.delete(f"/parties/{party_id}", headers=auth_headers)


# ---------------------------------------------------------------------------
# Ledgers
# ---------------------------------------------------------------------------


class TestLedgers:
    def test_list_seeded_and_crud(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/ledgers", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

        code = uid("LED")
        r = client.post(
            "/ledgers",
            headers=auth_headers,
            json={"code": code, "name": f"Ledger {code}", "group_name": "General"},
        )
        assert r.status_code == 200, r.text
        lid = r.json()["id"]

        r = client.patch(f"/ledgers/{lid}", headers=auth_headers, json={"name": f"Ledger {code} U"})
        assert r.status_code == 200

        r = client.delete(f"/ledgers/{lid}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Payment modes
# ---------------------------------------------------------------------------


class TestPaymentModes:
    def test_list_and_crud(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/payment-modes", headers=auth_headers)
        assert r.status_code == 200
        modes = r.json()
        assert any(m.get("is_cash") for m in modes)

        code = uid("PM")
        r = client.post(
            "/payment-modes",
            headers=auth_headers,
            json={"code": code, "name": f"Mode {code}", "is_cash": False},
        )
        assert r.status_code == 200, r.text
        mid = r.json()["id"]

        r = client.patch(f"/payment-modes/{mid}", headers=auth_headers, json={"name": f"Mode {code} U"})
        assert r.status_code == 200

        r = client.delete(f"/payment-modes/{mid}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Settings: company / print / sale-entry
# ---------------------------------------------------------------------------


class TestSettings:
    def test_company_profile(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/company-profile", headers=auth_headers)
        assert r.status_code == 200
        original = r.json()

        r = client.put(
            "/company-profile",
            headers=auth_headers,
            json={"name": original.get("name") or "GenERP Test Co", "city": "TestCity"},
        )
        assert r.status_code == 200
        assert r.json().get("city") == "TestCity"

    def test_reset_company_rejects_wrong_code(self, client: httpx.Client, auth_headers: dict):
        before = client.get("/ledgers", headers=auth_headers)
        assert before.status_code == 200
        ledgers = before.json()
        assert ledgers

        r = client.post(
            "/company-profile/reset-company",
            headers=auth_headers,
            json={"password": "wrong"},
        )
        assert r.status_code == 403

        after = client.get("/ledgers", headers=auth_headers)
        assert after.status_code == 200
        assert len(after.json()) == len(ledgers)

    def test_print_configs(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/print-configs", headers=auth_headers)
        assert r.status_code == 200
        configs = r.json()
        assert configs
        codes = {c["code"] for c in configs}
        assert "SALE_BILL" in codes
        assert "WHOLESALE_BILL" in codes

        cfg = next(c for c in configs if c["code"] == "SALE_BILL")
        r = client.patch(
            f"/print-configs/{cfg['id']}",
            headers=auth_headers,
            json={"paper_size": cfg.get("paper_size") or "A4", "copies": max(1, int(cfg.get("copies") or 1))},
        )
        assert r.status_code == 200

        r = client.get("/print-configs/by-code/SALE_BILL", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body.get("bill_format") in {"A4", "A5", "THERMAL_80", "THERMAL_58"}

        r = client.patch(
            f"/print-configs/{cfg['id']}",
            headers=auth_headers,
            json={"bill_format": "THERMAL_80", "copies": max(1, int(cfg.get("copies") or 1))},
        )
        assert r.status_code == 200
        # Bill format is chosen in the browser. The API does not store it on the row.
        assert r.json().get("bill_format") in {"A4", "A5", "THERMAL_80", "THERMAL_58"}

        r = client.get("/print-configs/formats", headers=auth_headers)
        assert r.status_code == 200
        format_codes = {row["code"] for row in r.json().get("formats") or []}
        assert "THERMAL_80" in format_codes
        assert "A4" in format_codes

        r = client.patch(
            f"/print-configs/{cfg['id']}",
            headers=auth_headers,
            json={"bill_format": "A4"},
        )
        assert r.status_code == 200

        r = client.get("/print-configs/layouts/catalog", headers=auth_headers)
        assert r.status_code == 200
        docs = {d["code"] for d in (r.json().get("documents") or [])}
        assert "SALE_BILL" in docs
        assert "BARCODE_GENERATION" in docs

        r = client.get("/print-configs/barcode-printers", headers=auth_headers)
        assert r.status_code == 200
        printers = r.json()
        assert "SINGLE" in printers
        assert "DOUBLE" in printers
        assert "MINI" in printers

        r = client.put(
            "/print-configs/barcode-printers/MINI",
            headers=auth_headers,
            json={"printer_name": "GenERP Test Label Printer"},
        )
        assert r.status_code == 200
        assert r.json().get("layout") == "MINI"
        assert r.json().get("printer_name") == "GenERP Test Label Printer"
        r = client.get("/print-configs/barcode-printers", headers=auth_headers)
        assert r.json().get("MINI") == "GenERP Test Label Printer"
        r = client.put(
            "/print-configs/barcode-printers/MINI",
            headers=auth_headers,
            json={"printer_name": None},
        )
        assert r.status_code == 200

        r = client.put("/print-configs/barcode-printers/WIDE", headers=auth_headers, json={"printer_name": "X"})
        assert r.status_code == 400

        r = client.get("/print-configs/layouts/by-code/SALE_BILL", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body.get("code") == "SALE_BILL"
        layout = body.get("layout") or {}
        assert isinstance(layout, dict)
        assert "A4" in (layout.get("formats") or {})

        r = client.patch(
            "/print-configs/layouts/by-code/SALE_BILL/page",
            headers=auth_headers,
            json={"bill_format": "A5", "orientation": "landscape"},
        )
        assert r.status_code == 200
        saved_orients = ((r.json().get("layout") or {}).get("page_orientations") or {})
        assert saved_orients.get("A5") == "landscape"
        r = client.patch(
            "/print-configs/layouts/by-code/SALE_BILL/page",
            headers=auth_headers,
            json={"bill_format": "A5", "orientation": "portrait"},
        )
        assert r.status_code == 200

        r = client.post(
            "/print-configs/layouts/preview",
            headers=auth_headers,
            json={"code": "SALE_BILL", "bill_format": "A4", "layout": body.get("layout")},
        )
        assert r.status_code == 200
        assert "Sample Traders" in r.text or "html" in r.text.lower()

    def test_sale_entry_config(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/sale-entry-config", headers=auth_headers)
        assert r.status_code == 200
        cfg = r.json()

        r = client.put(
            "/sale-entry-config",
            headers=auth_headers,
            json={
                "enable_qty": cfg.get("enable_qty", True),
                "enable_rate": cfg.get("enable_rate", True),
                "enable_discount": cfg.get("enable_discount", True),
                "default_qty": cfg.get("default_qty", 1),
                "allow_negative_stock": cfg.get("allow_negative_stock", True),
            },
        )
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Vouchers (Sale / Wholesale)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def bill_deps(client: httpx.Client, auth_headers: dict) -> dict:
    prod = client.post(
        "/products",
        headers=auth_headers,
        json={
            "name": f"BillItem {uid()}",
            "sale_price": 100,
            "wholesale_price": 80,
            "opening_stock": 100,
        },
    ).json()
    modes = client.get("/payment-modes", headers=auth_headers).json()
    cash = next((m for m in modes if m.get("is_cash")), modes[0])
    return {"product": prod, "cash": cash}


class TestVouchers:
    def _create(self, client, headers, deps, voucher_type: str, rate: float) -> dict:
        r = client.post(
            "/vouchers",
            headers=headers,
            json={
                "voucher_type": voucher_type,
                "voucher_date": date.today().isoformat(),
                "narration": f"regression {voucher_type}",
                "items": [
                    {
                        "product_id": deps["product"]["id"],
                        "description": deps["product"]["name"],
                        "quantity": 1,
                        "rate": rate,
                    }
                ],
                "payments": [{"payment_mode_id": deps["cash"]["id"], "amount": rate}],
            },
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_next_no(self, client: httpx.Client, auth_headers: dict):
        for vt in ("SALE", "WHOLESALE"):
            r = client.get("/vouchers/next-no", headers=auth_headers, params={"voucher_type": vt})
            assert r.status_code == 200, r.text
            assert r.json().get("next_no")

    def test_sale_create_get_modify_cancel(self, client: httpx.Client, auth_headers: dict, bill_deps: dict):
        from modules.generp.ge.services.document_numbers import fy_code

        bill = self._create(client, auth_headers, bill_deps, "SALE", 100)
        assert bill["voucher_no"].startswith(fy_code())

        r = client.get(f"/vouchers/{bill['id']}", headers=auth_headers)
        assert r.status_code == 200

        r = client.get(
            "/vouchers/by-no/" + bill["voucher_no"],
            headers=auth_headers,
            params={"voucher_type": "SALE"},
        )
        assert r.status_code == 200

        r = client.put(
            f"/vouchers/{bill['id']}",
            headers=auth_headers,
            json={
                "voucher_type": "SALE",
                "voucher_date": date.today().isoformat(),
                "narration": "updated sale",
                "items": [
                    {
                        "product_id": bill_deps["product"]["id"],
                        "description": bill_deps["product"]["name"],
                        "quantity": 2,
                        "rate": 100,
                    }
                ],
                "payments": [{"payment_mode_id": bill_deps["cash"]["id"], "amount": 200}],
            },
        )
        assert r.status_code == 200, r.text
        assert float(r.json()["net_amount"]) == 200

        r = client.get(
            "/vouchers",
            headers=auth_headers,
            params={"voucher_type": "SALE", "date_from": date.today().isoformat(), "date_to": date.today().isoformat()},
        )
        assert r.status_code == 200

        r = client.delete(f"/vouchers/{bill['id']}", headers=auth_headers)
        assert r.status_code == 200

    def test_wholesale_create(self, client: httpx.Client, auth_headers: dict, bill_deps: dict):
        from modules.generp.ge.services.document_numbers import fy_code

        bill = self._create(client, auth_headers, bill_deps, "WHOLESALE", 80)
        assert bill["voucher_no"].startswith(fy_code())
        client.delete(f"/vouchers/{bill['id']}", headers=auth_headers)

    def test_purchase_payments_and_import(self, client: httpx.Client, auth_headers: dict, bill_deps: dict):
        code = uid("VEND")
        vendor = client.post(
            "/parties",
            headers=auth_headers,
            json={"party_type": "vendor", "code": code, "name": f"Supp {code}"},
        ).json()
        assert vendor.get("id"), vendor
        prod = bill_deps["product"]
        cash = bill_deps["cash"]

        r = client.post(
            "/vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "PURCHASE",
                "voucher_date": date.today().isoformat(),
                "party_id": vendor["id"],
                "party_bill_no": "PB-1001",
                "items": [{"product_id": prod["id"], "quantity": 1, "rate": 50}],
                "payments": [{"payment_mode_id": cash["id"], "amount": 50}],
            },
        )
        assert r.status_code == 200, r.text
        cash_bill = r.json()
        assert cash_bill["is_credit"] is False
        assert abs(float(cash_bill["paid_amount"]) - float(cash_bill["net_amount"])) < 0.02
        assert cash_bill.get("party_bill_no") == "PB-1001"

        paged = client.get(
            "/vouchers/paged",
            headers=auth_headers,
            params={
                "voucher_type": "PURCHASE",
                "party_name": vendor["name"],
                "party_bill_no": "PB-1001",
                "voucher_no": cash_bill["voucher_no"],
                "date_from": date.today().isoformat(),
                "date_to": date.today().isoformat(),
                "page": 1,
                "page_size": 10,
            },
        )
        assert paged.status_code == 200, paged.text
        assert cash_bill["id"] in [row["id"] for row in paged.json()["rows"]]

        upd = client.put(
            f"/vouchers/{cash_bill['id']}",
            headers=auth_headers,
            json={
                "voucher_type": "PURCHASE",
                "voucher_date": date.today().isoformat(),
                "party_id": vendor["id"],
                "party_bill_no": "PB-1001A",
                "items": [{"product_id": prod["id"], "quantity": 2, "rate": 50}],
                "payments": [{"payment_mode_id": cash["id"], "amount": 100}],
            },
        )
        assert upd.status_code == 200, upd.text
        assert upd.json().get("party_bill_no") == "PB-1001A"

        r = client.post(
            "/vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "PURCHASE",
                "voucher_date": date.today().isoformat(),
                "party_id": vendor["id"],
                "items": [{"product_id": prod["id"], "quantity": 1, "rate": 40}],
                "payments": [],
            },
        )
        assert r.status_code == 200, r.text
        credit_bill = r.json()
        assert credit_bill["is_credit"] is True
        assert abs(float(credit_bill["credit_amount"]) - float(credit_bill["net_amount"])) < 0.02

        r = client.post(
            "/vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "PURCHASE",
                "voucher_date": date.today().isoformat(),
                "items": [{"product_id": prod["id"], "quantity": 1, "rate": 10}],
                "payments": [],
            },
        )
        assert r.status_code == 400

        lookup = prod.get("code") or prod.get("name")
        csv_body = (
            f"Code,Product,Qty,Rate,MRP,Sale Price,Disc%,GST%\n"
            f"{lookup},{prod['name']},2,25,99,80,0,0\n"
        )
        r = client.post(
            "/vouchers/purchase-import-preview",
            headers=auth_headers,
            files={"file": ("purchase.csv", csv_body.encode("utf-8"), "text/csv")},
        )
        assert r.status_code == 200, r.text
        preview = r.json()
        assert preview["imported"] >= 1
        assert preview["lines"][0]["product_id"] == prod["id"]
        assert float(preview["lines"][0]["qty"]) == 2
        assert float(preview["lines"][0]["mrp"]) == 99
        assert float(preview["lines"][0]["sale_price"]) == 80

        r = client.get(
            "/reports/sundry-debtors",
            headers=auth_headers,
            params={"group_name": "Sundry Creditors"},
        )
        assert r.status_code == 200
        names = [row.get("name") for row in r.json()]
        assert vendor["name"] in names

        r = client.get(f"/reports/sale-bill/{cash_bill['id']}/html", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert "Purchase" in r.text

        stock_before = float(
            client.get(f"/products/{prod['id']}", headers=auth_headers).json().get("current_stock") or 0
        )
        dlt = client.delete(f"/vouchers/{cash_bill['id']}", headers=auth_headers)
        assert dlt.status_code == 200, dlt.text
        stock_after = float(
            client.get(f"/products/{prod['id']}", headers=auth_headers).json().get("current_stock") or 0
        )
        assert stock_after == pytest.approx(stock_before - 2, abs=0.02)
        gone = client.get(f"/vouchers/{cash_bill['id']}", headers=auth_headers).json()
        assert gone["is_cancelled"] is True

        logs = client.get("/audit-logs", headers=auth_headers, params={"action": "DELETE", "limit": 50})
        assert logs.status_code == 200, logs.text
        delete_row = next((x for x in logs.json() if x.get("entity_id") == cash_bill["id"]), None)
        assert delete_row, "delete audit row missing"
        assert isinstance(delete_row.get("details"), dict)
        assert (delete_row["details"].get("snapshot") or {}).get("id") == cash_bill["id"]

        rest = client.post(f"/audit-logs/{delete_row['id']}/restore", headers=auth_headers, json={})
        assert rest.status_code == 200, rest.text
        live = client.get(f"/vouchers/{cash_bill['id']}", headers=auth_headers).json()
        assert live["is_cancelled"] is False
        stock_rest = float(
            client.get(f"/products/{prod['id']}", headers=auth_headers).json().get("current_stock") or 0
        )
        assert stock_rest == pytest.approx(stock_before, abs=0.02)

        client.delete(f"/vouchers/{cash_bill['id']}", headers=auth_headers)
        client.delete(f"/vouchers/{credit_bill['id']}", headers=auth_headers)
        client.delete(f"/parties/{vendor['id']}", headers=auth_headers)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class TestReports:
    def test_report_endpoints(self, client: httpx.Client, auth_headers: dict):
        ledgers = client.get("/ledgers", headers=auth_headers).json()
        assert ledgers
        lid = ledgers[0]["id"]

        checks = [
            ("/reports/ledger-details", {"ledger_id": lid}),
            ("/reports/sundry-debtors", {}),
            ("/reports/cashbook", {}),
            ("/reports/daybook", {"day": date.today().isoformat()}),
            ("/reports/daily-collection", {"day": date.today().isoformat()}),
            ("/reports/daily-collection/bills", {"day": date.today().isoformat()}),
            ("/reports/taxwise-bill-summary", {"date_from": date.today().isoformat()}),
            ("/reports/taxwise-summary", {"date_from": date.today().isoformat()}),
        ]
        for path, params in checks:
            r = client.get(path, headers=auth_headers, params=params)
            assert r.status_code == 200, f"{path}: {r.text}"

        r = client.get(
            "/reports/daily-collection/html",
            headers=auth_headers,
            params={"day": date.today().isoformat()},
        )
        assert r.status_code == 200, r.text
        r = client.get(
            "/reports/daily-collection/bills/html",
            headers=auth_headers,
            params={"day": date.today().isoformat()},
        )
        assert r.status_code == 200, r.text
        assert "Bills Summary" in r.text
        r = client.get(
            "/reports/taxwise-bill-summary/html",
            headers=auth_headers,
            params={"date_from": date.today().isoformat()},
        )
        assert r.status_code == 200, r.text
        r = client.get(
            "/reports/taxwise-summary/html",
            headers=auth_headers,
            params={"date_from": date.today().isoformat()},
        )
        assert r.status_code == 200, r.text

    def test_customer_details_include_cashbook_party_ledger_entries(
        self, client: httpx.Client, auth_headers: dict
    ):
        code = uid("CUST")
        party = client.post(
            "/parties",
            headers=auth_headers,
            json={"party_type": "customer", "code": code, "name": f"Customer {code}"},
        ).json()
        ledgers = client.get("/ledgers", headers=auth_headers).json()
        cash = next(row for row in ledgers if row.get("is_cash"))
        payment_id = None
        try:
            payment = client.post(
                "/cashbook/payment",
                headers=auth_headers,
                json={
                    "voucher_date": date.today().isoformat(),
                    "ledger_id": party["ledger_id"],
                    "counter_ledger_id": cash["id"],
                    "party_id": party["id"],
                    "amount": 25,
                    "entry_type": "payment",
                    "narration": "Unified customer statement test",
                },
            )
            assert payment.status_code == 201, payment.text
            payment_id = payment.json()["id"]
            voucher_no = payment.json()["voucher_no"]

            details = client.get(
                "/reports/debtor-details",
                headers=auth_headers,
                params={"party_id": party["id"]},
            )
            assert details.status_code == 200, details.text
            row = next((item for item in details.json()["rows"] if item["voucher_no"] == voucher_no), None)
            assert row
            assert float(row["debit"]) == pytest.approx(25, abs=0.01)

            schedule = client.get(
                "/reports/sundry-debtors",
                headers=auth_headers,
                params={"group_name": "Sundry Debtors"},
            )
            assert schedule.status_code == 200, schedule.text
            scheduled = next((item for item in schedule.json() if item.get("party_id") == party["id"]), None)
            assert scheduled
            assert float(scheduled["balance"]) == pytest.approx(25, abs=0.01)
        finally:
            if payment_id:
                client.delete(f"/cashbook/vouchers/{payment_id}", headers=auth_headers)
            client.delete(f"/parties/{party['id']}", headers=auth_headers)

    def test_sale_bill_html(self, client: httpx.Client, auth_headers: dict, bill_deps: dict):
        # create a small sale for html preview
        r = client.post(
            "/vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "SALE",
                "voucher_date": date.today().isoformat(),
                "items": [
                    {
                        "product_id": bill_deps["product"]["id"],
                        "quantity": 1,
                        "rate": 100,
                    }
                ],
                "payments": [{"payment_mode_id": bill_deps["cash"]["id"], "amount": 100}],
            },
        )
        assert r.status_code == 200, r.text
        bill = r.json()
        r = client.get(f"/reports/sale-bill/{bill['id']}/html", headers=auth_headers)
        assert r.status_code == 200
        assert "html" in r.text.lower() or "<" in r.text
        r = client.get(
            f"/reports/sale-bill/{bill['id']}/html",
            headers=auth_headers,
            params={"format": "THERMAL_80"},
        )
        assert r.status_code == 200
        assert "thermal-slip" in r.text
        assert "THANK YOU VISIT AGAIN" in r.text
        client.delete(f"/vouchers/{bill['id']}", headers=auth_headers)

    def test_taxwise_multiple_rates(self, client: httpx.Client, auth_headers: dict, bill_deps: dict):
        gst = client.get("/gst", headers=auth_headers).json()
        rates = [g for g in gst if float(g.get("rate") or 0) > 0]
        assert len(rates) >= 2
        a, b = rates[0], rates[1]
        r = client.post(
            "/vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "SALE",
                "voucher_date": date.today().isoformat(),
                "items": [
                    {
                        "product_id": bill_deps["product"]["id"],
                        "quantity": 1,
                        "rate": 100,
                        "gst_id": a["id"],
                    },
                    {
                        "product_id": bill_deps["product"]["id"],
                        "quantity": 1,
                        "rate": 100,
                        "gst_id": b["id"],
                    },
                ],
                "payments": [{"payment_mode_id": bill_deps["cash"]["id"], "amount": 200}],
            },
        )
        assert r.status_code == 200, r.text
        bill = r.json()
        params = {
            "date_from": date.today().isoformat(),
            "date_to": date.today().isoformat(),
            "bill_from": bill["voucher_no"],
            "bill_to": bill["voucher_no"],
        }
        r = client.get("/reports/taxwise-bill-summary", headers=auth_headers, params=params)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["rows"]) >= 2
        pcts = {str(row["gst_pct"]) for row in body["rows"]}
        expected = set()
        for g in (a, b):
            n = float(g.get("rate") or 0)
            expected.add(str(int(round(n))) if abs(n - round(n)) < 0.001 else f"{n:.2f}".rstrip("0").rstrip("."))
        assert expected <= pcts
        for row in body["rows"]:
            assert "cgst" in row and "sgst" in row and "igst" in row and "cess" in row
            assert "taxable" in row
        r = client.get("/reports/taxwise-summary", headers=auth_headers, params=params)
        assert r.status_code == 200, r.text
        summary = r.json()
        assert summary["rows"]
        keys = {str(row["gst_pct"]) for row in summary["rows"]}
        assert len(keys) >= 2
        client.delete(f"/vouchers/{bill['id']}", headers=auth_headers)


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------


class TestUserManagement:
    def test_user_types_roles_list(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/user-types", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()

        r = client.get("/roles", headers=auth_headers)
        assert r.status_code == 200
        assert any(x.get("role_name") == "Super Admin" for x in r.json())

        r = client.get("/users", headers=auth_headers)
        assert r.status_code == 200
        assert any(u.get("email") == ADMIN_EMAIL for u in r.json())

    def test_role_menu_permissions(self, client: httpx.Client, auth_headers: dict):
        roles = client.get("/roles", headers=auth_headers).json()
        role = next(r for r in roles if r.get("role_name") == "Super Admin")
        r = client.get(f"/role-menu-permissions/{role['id']}", headers=auth_headers)
        assert r.status_code == 200

        r = client.get("/role-menu-permissions/menus", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()

    def test_user_crud_cycle(self, client: httpx.Client, auth_headers: dict):
        email = f"reg_{uid().lower()}@example.com"
        r = client.post(
            "/users",
            headers=auth_headers,
            json={
                "email": email,
                "password": "test1234",
                "full_name": "Regression User",
            },
        )
        assert r.status_code == 200, r.text
        user_id = r.json()["id"]

        r = client.patch(
            f"/users/{user_id}",
            headers=auth_headers,
            json={"full_name": "Regression User Updated"},
        )
        assert r.status_code == 200

        r = client.delete(f"/users/{user_id}", headers=auth_headers)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Dashboard / menus API
# ---------------------------------------------------------------------------


class TestDashboardAndMenus:
    def test_dashboard(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/dashboard/stats", headers=auth_headers)
        assert r.status_code == 200, r.text

    def test_menus_endpoint(self, client: httpx.Client, auth_headers: dict):
        r = client.get("/menus", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()
