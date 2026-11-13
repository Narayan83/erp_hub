# Migration map (old screen → new place)

Sources:
- Hospital: `D:\fullstack\others\hospital`
- GenERP: `D:\fullstack\others\generp`
- Lodge: `D:\fullstack\others\lodge`

## Shared → `core/`

| Old location | New place | Status |
|---|---|---|
| GenERP/Lodge `models/auth.py`, Hospital `models/user.py`+roles | `core/erp_core/models/auth.py` | Done |
| GenERP `CompanyProfile` / Hospital `HospitalProfile` | `core/erp_core/models/masters.py` `CompanyProfile` | Done (hospital extras → `extra` JSON) |
| GenERP/Hospital/Lodge `PrintConfig` | `core/erp_core/models/masters.py` + `/print-configs` | Stub API |
| GenERP/Lodge `Party` | `core/erp_core/models/masters.py` `Party` | Done |
| Hospital Patient (no Party) | `modules/hospital` Patient **+** linked Party | Done (1:1) |
| Ledger / PaymentMode / Cashbook | `core/erp_core` accounts | Stub (advance/payment/contra) |
| GenERP financial reports (TB/P&L/BS) | `core` `/accounts/balance-sheet` | Stub |
| Auth login / menus / users | `core` `/auth`, seed menus | Done |

## Hospital → `modules/hospital/`

Full HMS backend vendored under `modules/hospital/hms/` (same APIs as
`D:\fullstack\others\hospital`), mounted at `/api/v1/hospital/*`.

| Old (Qt desktop / API) | New | Status |
|---|---|---|
| Patient Master / List | `/hospital/patients` + web Patient Master | Done |
| Doctor Master | `/hospital/doctors` | Done |
| Department Master | `/hospital/departments` | Done |
| OPD Bill (+ cashbook post) | `/hospital/opd-bills` + web OPD Bill | Done |
| OPD Bill Reprint | same web page | Partial |
| IPD Admission | `/hospital/ipd-admissions` + web | Done |
| IPD Bill / Discharge / Summary | API mounted; web pending | API Done |
| Pathology stack | `/hospital/pathology*` API + bill web | API Done / UI Partial |
| Medical Shop / Pharmacy | `/hospital/pharmacy` API + item masters web | API Done / UI Partial |
| Billing masters (services, packages, wards, …) | API + code/name web masters | API Done / UI Partial |
| Reports (Form 3C, doctor collection) | `/hospital/reports` API | API Done / UI Pending |
| Full menu tree | `menus.py` ← hospital `MENU_DEFINITIONS` | Done |
| Qt desktop UI | React web (local browser) | In progress |

## GenERP → `modules/generp/`

| Old | New | Status |
|---|---|---|
| Product / Category / GST / Barcode | `modules/generp` | Stub menu + `/generp/status` |
| Stock vouchers / lots | `modules/generp` | Pending |
| Sale / Purchase / Returns vouchers | `modules/generp` | Pending |
| Shopping cart | `modules/generp` | Pending |
| Party / Ledger / Cashbook / Print | stay in `core` | Done (shared) |

## Lodge → `modules/lodge/`

| Old | New | Status |
|---|---|---|
| Room / RoomType / Guest / Stay | `modules/lodge` | Stub menu + `/lodge/status` |
| Check-in / Booking / Final bill | `modules/lodge` | Pending |
| Staff attendance | `modules/lodge` | Pending |
| Party hall / Food / Extra bed | `modules/lodge` | Pending |
| Accounts / Company / Print | `core` | Done (shared) |

## Label remaps (product config)

| Concept | hospital | generp | lodge |
|---|---|---|---|
| party | Patient | Customer | Guest |
| company | Hospital | Company | Lodge |
| deposit | Patient Deposit | Customer Deposit | Guest Deposit |

Set via `ERP_PRODUCT=hospital|generp|lodge` and `config/products/*.json`.
