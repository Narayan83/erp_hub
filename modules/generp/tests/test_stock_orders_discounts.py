"""
Stock, orders, and discount API tests.

Requires: PostgreSQL + seeded DB, backend on GENERP_TEST_BASE_URL (default http://127.0.0.1:8030).

Run:
  cd backend
  .venv\\Scripts\\pytest tests/test_stock_orders_discounts.py -v
"""

from __future__ import annotations

import os
import uuid
from datetime import date

import httpx
import pytest

BASE_URL = os.environ.get("GENERP_TEST_BASE_URL", "http://127.0.0.1:8030").rstrip("/")
API = f"{BASE_URL}/api/v1"
ADMIN_EMAIL = os.environ.get("GENERP_TEST_EMAIL", "admin@generp.example.com")
ADMIN_PASSWORD = os.environ.get("GENERP_TEST_PASSWORD", "admin123")
TODAY = date.today().isoformat()


def uid(prefix: str = "T") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8].upper()}"


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    with httpx.Client(base_url=API, timeout=60.0) as c:
        health = httpx.get(f"{BASE_URL}/health", timeout=5.0)
        if health.status_code != 200:
            pytest.skip(f"Backend not reachable at {BASE_URL}")
        yield c


@pytest.fixture(scope="module")
def auth_headers(client: httpx.Client) -> dict[str, str]:
    r = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def product_stock(client: httpx.Client, headers: dict, product_id: str) -> float:
    r = client.get(f"/products/{product_id}", headers=headers)
    assert r.status_code == 200, r.text
    return float(r.json()["current_stock"])


def assert_stock(
    client: httpx.Client,
    headers: dict,
    product_id: str,
    expected: float,
    label: str = "",
) -> None:
    actual = product_stock(client, headers, product_id)
    assert abs(actual - expected) < 0.01, f"{label} expected {expected}, got {actual}"


class TestStockOrdersDiscounts:
    def test_full_stock_order_discount_flow(self, client: httpx.Client, auth_headers: dict):
        # --- products ---
        bag = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"Bag Sugar {uid()}", "unit": "bag", "sale_price": 500},
        ).json()
        pack = client.post(
            "/products",
            headers=auth_headers,
            json={"name": f"1kg Pack {uid()}", "unit": "kg", "sale_price": 60},
        ).json()
        bag_id, pack_id = bag["id"], pack["id"]

        # --- branches ---
        r = client.get("/stock/branches", headers=auth_headers)
        assert r.status_code == 200, r.text
        branches = r.json()
        assert branches, "expected at least main branch"
        main_branch_id = branches[0]["id"]

        branch_code = uid("BR")
        r = client.post(
            "/stock/branches",
            headers=auth_headers,
            json={"code": branch_code, "name": f"Branch {branch_code}", "is_main": False},
        )
        assert r.status_code == 200, r.text
        branch2_id = r.json()["id"]

        # --- INWARD_DC: +100 bag ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "INWARD_DC",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "narration": "Opening inward",
                "items": [{"product_id": bag_id, "quantity": 100, "rate": 400}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, bag_id, 100, "after INWARD_DC")

        # --- CONVERSION: bag 100 -> pack 80, wastage 0.2 ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "CONVERSION",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "wastage_qty": 0.2,
                "items": [
                    {"product_id": bag_id, "line_role": "DEBIT", "quantity": 100},
                    {"product_id": pack_id, "line_role": "CREDIT", "quantity": 80},
                ],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, bag_id, -0.2, "after CONVERSION bag")
        assert_stock(client, auth_headers, pack_id, 80, "after CONVERSION pack")

        # --- SHORTAGE pack -5 ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "SHORTAGE",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "items": [{"product_id": pack_id, "quantity": 5}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, 75, "after SHORTAGE")

        # --- EXCESS pack +3 ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "EXCESS",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "items": [{"product_id": pack_id, "quantity": 3}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, 78, "after EXCESS")

        # --- WASTAGE pack -2 ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "WASTAGE",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "items": [{"product_id": pack_id, "quantity": 2}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, 76, "after WASTAGE")

        # --- TRANSFER out 10, then in 10 ---
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "TRANSFER_OUT",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "counterparty_branch_id": branch2_id,
                "items": [{"product_id": pack_id, "quantity": 10}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, 66, "after TRANSFER_OUT")

        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "TRANSFER_IN",
                "voucher_date": TODAY,
                "branch_id": branch2_id,
                "counterparty_branch_id": main_branch_id,
                "items": [{"product_id": pack_id, "quantity": 10}],
            },
        )
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, 76, "after TRANSFER_IN")

        # --- stock ledger & balances ---
        r = client.get(
            "/stock/stock-ledger",
            headers=auth_headers,
            params={"product_id": pack_id},
        )
        assert r.status_code == 200, r.text
        ledger = r.json()
        assert ledger, "ledger should have rows"
        assert ledger[-1]["running_balance"] == 76

        r = client.get("/stock/stock-balances", headers=auth_headers, params={"q": pack["name"][:6]})
        assert r.status_code == 200, r.text
        assert any(x["product_id"] == pack_id for x in r.json())

        r = client.get("/stock/stock-vouchers/types", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert "INWARD_DC" in r.json()["types"]

        # --- cancel voucher restores stock ---
        pack_before_cancel = product_stock(client, auth_headers, pack_id)
        r = client.post(
            "/stock/stock-vouchers",
            headers=auth_headers,
            json={
                "voucher_type": "EXCESS",
                "voucher_date": TODAY,
                "branch_id": main_branch_id,
                "items": [{"product_id": pack_id, "quantity": 4}],
            },
        )
        assert r.status_code == 200, r.text
        excess_voucher_id = r.json()["id"]
        assert_stock(client, auth_headers, pack_id, pack_before_cancel + 4, "after temp EXCESS")

        r = client.delete(f"/stock/stock-vouchers/{excess_voucher_id}", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert_stock(client, auth_headers, pack_id, pack_before_cancel, "after cancel EXCESS")

        # --- discount scheme CRUD + apply ---
        disc_code = uid("DISC")
        r = client.post(
            "/discounts/discount-schemes",
            headers=auth_headers,
            json={
                "code": disc_code,
                "name": f"Bill discount {disc_code}",
                "scope": "BILL",
                "discount_type": "PCT",
                "value": 10,
                "min_bill_amount": 100,
            },
        )
        assert r.status_code == 200, r.text
        scheme_id = r.json()["id"]

        r = client.get("/discounts/discount-schemes", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert any(x["id"] == scheme_id for x in r.json())

        r = client.put(
            f"/discounts/discount-schemes/{scheme_id}",
            headers=auth_headers,
            json={
                "code": disc_code,
                "name": f"Bill discount {disc_code} updated",
                "scope": "BILL",
                "discount_type": "PCT",
                "value": 10,
                "min_bill_amount": 100,
            },
        )
        assert r.status_code == 200, r.text

        r = client.post(
            "/discounts/discount-schemes/apply",
            headers=auth_headers,
            json={"scheme_id": scheme_id, "bill_amount": 1000, "voucher_type": "SALE"},
        )
        assert r.status_code == 200, r.text
        assert float(r.json()["discount_amount"]) == 100

        # --- parties for orders ---
        cust_code = uid("CUST")
        customer = client.post(
            "/parties",
            headers=auth_headers,
            json={
                "party_type": "customer",
                "code": cust_code,
                "name": f"Customer {cust_code}",
            },
        ).json()
        vend_code = uid("VEND")
        vendor = client.post(
            "/parties",
            headers=auth_headers,
            json={
                "party_type": "vendor",
                "code": vend_code,
                "name": f"Vendor {vend_code}",
            },
        ).json()

        pack_before_sale = product_stock(client, auth_headers, pack_id)

        # --- sales order + convert to SALE ---
        r = client.get("/orders/next-no", headers=auth_headers, params={"order_type": "SALES_ORDER"})
        assert r.status_code == 200, r.text

        r = client.post(
            "/orders",
            headers=auth_headers,
            json={
                "order_type": "SALES_ORDER",
                "order_date": TODAY,
                "party_id": customer["id"],
                "discount_amount": 0,
                "items": [{"product_id": pack_id, "quantity": 5, "rate": 60}],
            },
        )
        assert r.status_code == 200, r.text
        sales_order = r.json()
        assert sales_order["order_no"]

        r = client.post(
            f"/orders/{sales_order['id']}/convert",
            headers=auth_headers,
            json={"voucher_type": "SALE", "voucher_date": TODAY},
        )
        assert r.status_code == 200, r.text
        convert_out = r.json()
        assert convert_out["voucher_type"] == "SALE"
        assert convert_out["voucher_id"]

        assert_stock(client, auth_headers, pack_id, pack_before_sale - 5, "after SALE convert")

        r = client.get(f"/orders/{sales_order['id']}", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "FULFILLED"

        bag_before_po = product_stock(client, auth_headers, bag_id)

        # --- purchase order + convert to PURCHASE ---
        r = client.post(
            "/orders",
            headers=auth_headers,
            json={
                "order_type": "PURCHASE_ORDER",
                "order_date": TODAY,
                "party_id": vendor["id"],
                "items": [{"product_id": bag_id, "quantity": 20, "rate": 400}],
            },
        )
        assert r.status_code == 200, r.text
        po = r.json()

        r = client.post(
            f"/orders/{po['id']}/convert",
            headers=auth_headers,
            json={"voucher_type": "PURCHASE", "voucher_date": TODAY},
        )
        assert r.status_code == 200, r.text
        assert r.json()["voucher_type"] == "PURCHASE"

        assert_stock(client, auth_headers, bag_id, bag_before_po + 20, "after PURCHASE convert")

        # cleanup discount scheme
        r = client.delete(f"/discounts/discount-schemes/{scheme_id}", headers=auth_headers)
        assert r.status_code == 200, r.text

        # cleanup products
        client.delete(f"/products/{bag_id}", headers=auth_headers)
        client.delete(f"/products/{pack_id}", headers=auth_headers)
