.\run.ps1 -Product hospital -Web
.\run.ps1 -Product generp -Web
.\run.ps1 -Product lodge -Web
.\run.ps1 -Product kramcop -Web
.\run.ps1 -Product contract_farming -Web


.\scripts\build_hospital_web_exe.ps1
.\scripts\build_generp_web_exe.ps1
.\scripts\build_lodge_web_exe.ps1
.\scripts\build_kramcop_web_exe.ps1
.\scripts\build_contract_farming_web_exe.ps1




# ERP Platform

From the repo root (`erp_hub`). Password for every product is `admin123`.

## Build EXE (client)





Skip web rebuild when `apps\web\dist` is already built (any product):

```powershell
.\scripts\build_hospital_web_exe.ps1 -SkipWeb
.\scripts\build_generp_web_exe.ps1 -SkipWeb
.\scripts\build_lodge_web_exe.ps1 -SkipWeb
.\scripts\build_kramcop_web_exe.ps1 -SkipWeb
.\scripts\build_contract_farming_web_exe.ps1 -SkipWeb
```

Needs Python 3.12+, Node 20+, and PyInstaller (scripts install PyInstaller into `apps\api\.venv`).

## Run (development)

| Product | Command | Username |
|---------|---------|----------|
| hospital | `.\run.ps1 -Product hospital -Web` | `hospital` |
| generp | `.\run.ps1 -Product generp -Web` | `generp` |
| lodge | `.\run.ps1 -Product lodge -Web` | `lodge` |
| kramcop | `.\run.ps1 -Product kramcop -Web` | `kramcop` |
| contract_farming | `.\run.ps1 -Product contract_farming -Web` | `contract_farming` |

---

One install, five products. Shared **core**, product chosen by `ERP_PRODUCT` (same PostgreSQL database).

## Run a product (development)

Install PostgreSQL 16+ locally first. Create database `erp_platform` (user `postgres` / password `postpass`, or edit `DATABASE_URL` in `apps\api\.env`).

`-Web` opens the React UI in a second window. API only (no Vite window) — drop `-Web`:

```powershell
.\run.ps1 -Product hospital
```

`.\run.ps1` with no `-Product` keeps whatever is already in `apps\api\.env`. Double-click `RUN.bat` does the same (API only).

- Web: http://127.0.0.1:5173
- Health: http://127.0.0.1:8030/health
- Docs: http://127.0.0.1:8030/docs

Web UI alone, when the API is already running:

```powershell
cd apps\web
npm install
npm run dev
```

PowerShell 5 does not support `&&`. Use `.\run.ps1`, or separate commands with `;`.

---

## EXE on a client PC

PostgreSQL is **not** inside the EXE. Install PostgreSQL 16+ first.

1. Copy the product EXE from `installer\release\` anywhere and double-click it.
2. First run creates `config\<product>.env` next to the EXE and a database named after the product (e.g. `hospital`, `kramcop`) with user `postgres` / password `postpass`. Edit `DATABASE_URL` if the password differs.
3. Browser opens http://127.0.0.1:8030 — login with that product username / `admin123`.
4. Logs: `logs\backend.log` next to the EXE.

| Product | EXE | Database | Login |
|---------|-----|----------|-------|
| hospital | `Hospital.exe` | `hospital` | `hospital` / `admin123` |
| generp | `Generp.exe` | `generp` | `generp` / `admin123` |
| lodge | `Lodge.exe` | `lodge` | `lodge` / `admin123` |
| kramcop | `Kramcop.exe` | `kramcop` | `kramcop` / `admin123` |
| contract_farming | `ContractFarming.exe` | `contract_farming` | `contract_farming` / `admin123` |

No dump restore is required — the EXE creates tables on first start.

---

## What each product loads

`-Product` writes `ERP_PRODUCT` in `apps\api\.env`. Restart the API after a change. Menus and labels come from `config/products/<product>.json`.

| Product | Modules | Party label |
|---------|---------|-------------|
| hospital | core + hospital | Patient |
| generp | core + generp | Customer |
| lodge | core + lodge | Guest |
| kramcop | core + kramcop | Party |
| contract_farming | core + contract_farming | Partner |

One PostgreSQL database per install (`erp_platform` in development). Tables are split by schema for clarity:

| Schema | Contents |
|--------|----------|
| `core` | Shared auth, company, party, ledgers, cashbook, menus |
| `hospital` | Hospital / HMS tables |
| `generp` | GenERP tables |
| `lodge` | Lodge tables (when added) |
| `kramcop` | Kramcop tables |
| `contract_farming` | Contract farming tables |

Created automatically on API / EXE startup. Existing `public` tables are moved into these schemas on first run after upgrade.

Kramcop first start imports `modules/kramcop/data/kram.xlsx` when that file is present. Contract farming seeds from the Excel sheets under `modules/contract_farming/data/`.

You can also set the product by hand:

```env
ERP_PRODUCT=hospital
```

Allowed values: `hospital`, `generp`, `lodge`, `kramcop`, `contract_farming`.

---

## Folder layout

```
erp_hub/
  core/erp_core/          # auth, company, print, party, accounts
  modules/
    hospital/
    generp/
    lodge/
    kramcop/
    contract_farming/
  apps/
    api/                  # FastAPI
    web/                  # React (Vite)
  config/products/        # one JSON per product
  scripts/
    build_hospital_web_exe.ps1
    build_generp_web_exe.ps1
    build_lodge_web_exe.ps1
    build_kramcop_web_exe.ps1
    build_contract_farming_web_exe.ps1
```

## Printing (all products)

Print Master, Bill Template Designer, per-PC printers (`config/print.ini`), and designed layouts live in **core**. Every product — including a new `config/products/*.json` with `menu_mode=extend` — gets Print Master menus, `/print-configs`, and the shared print preview. Report HTML should call `erp_core.services.designed_print.render_designed_or_fallback` so a saved design is used when present.

## Prerequisites

- Python 3.12+
- Node 20+
- PostgreSQL 16+ (local install)

## Stack

- PostgreSQL
- FastAPI + SQLAlchemy (async) + Alembic
- React + Vite (dev UI, or packaged inside each product EXE)

## Source apps (read-only)

- `D:\fullstack\others\hospital`
- `D:\fullstack\others\generp`
- `D:\fullstack\others\lodge`
- `D:\fullstack\others\kramcop`

See [docs/MIGRATION_MAP.md](docs/MIGRATION_MAP.md).
