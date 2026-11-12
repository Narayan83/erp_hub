# ERP Platform (monorepo)

One installable ERP with shared **core** and product modules **hospital | generp | lodge | kramcop**.  
Product is selected by config (`ERP_PRODUCT`), not by separate databases.

## Folder layout

```
erp_hub/
  core/erp_core/          # auth, company, print, party, accounts
  modules/
    hospital/             # full HMS (ported from others/hospital)
    generp/               # stub — trading/stock next
    lodge/                # stub — rooms/stays next
    kramcop/              # society members, shares, address labels (from others/kramcop)
  apps/
    api/                  # FastAPI entry
    web/                  # React (Vite) local UI
  config/products/        # hospital.json | generp.json | lodge.json | kramcop.json
  docs/MIGRATION_MAP.md
  docker-compose.yml      # PostgreSQL
```

## Prerequisites

- Python 3.12+
- Node 20+
- Docker (for Postgres) **or** local PostgreSQL

## Run (first pass)

### 1. Database

```bash
docker compose up -d
```

Creates DB `erp_platform` on `localhost:5432` (`postgres` / `postpass`).

### 2. Start (Windows — recommended)

From the repo root (`erp_hub`):

```powershell
.\run.ps1
```

API + Vite web in a second window:

```powershell
.\run.ps1 -Web
```

Switch product for this run (also writes `apps\api\.env`):

```powershell
.\run.ps1 -Product hospital
.\run.ps1 -Product generp -Web
.\run.ps1 -Product kramcop -Web
```

Or double-click `RUN.bat`.

> PowerShell older than 7 does not support `&&`. Prefer `.\run.ps1`, or use `;` instead:
> `cd apps\api; .\.venv\Scripts\Activate.ps1; python run_server.py`

- Health: http://127.0.0.1:8030/health  
- Docs: http://127.0.0.1:8030/docs  
- Web: http://127.0.0.1:5173  

Default admin (hospital product): `admin@hospital.example.com` / `admin123`

### 3. Web only (if API already running)

```powershell
cd apps\web
npm install
npm run dev
```

## Product switching

Edit `apps/api/.env`:

```env
ERP_PRODUCT=hospital   # or generp | lodge | kramcop
```

Restart the API. Menus, seed ledgers, and UI labels come from `config/products/<product>.json`.

| Product | Modules enabled | Party label |
|---------|-----------------|-------------|
| hospital | core + hospital | Patient |
| generp | core + generp | Customer |
| lodge | core + lodge | Guest |
| kramcop | core + kramcop | Party (members, shares, and labels are the Kramcop screens) |

One PostgreSQL database per customer install; module tables live in the same schema.

## Stack

- PostgreSQL
- FastAPI + SQLAlchemy (async) + Alembic
- React + Vite (local browser only; optional `.exe` launcher later)

## Migration order

1. Skeleton + **Hospital** main flows (this pass)
2. **GenERP** trading/stock into `modules/generp`
3. **Lodge** rooms/stays into `modules/lodge`

See [docs/MIGRATION_MAP.md](docs/MIGRATION_MAP.md).

## Source apps (read-only references)

- `D:\fullstack\others\hospital`
- `D:\fullstack\others\generp`
- `D:\fullstack\others\lodge`
- `D:\fullstack\others\kramcop`


.\run.ps1 -Product generp -Web

admin@generp.example.com
admin123

Kramcop (society members and shares):

```powershell
.\run.ps1 -Product kramcop -Web
```

admin@kramcop.example.com / admin123

Login, users, company, and accounts are the shared platform screens. Customer master, share entry, labels, and the Kannada society master come from Kramcop. The first start imports `modules/kramcop/data/kram.xlsx` when that file is present.