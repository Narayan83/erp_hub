import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Building2, Users, Printer, CreditCard, UserRound,
  ListOrdered, Stethoscope, Network, Receipt, ReceiptText, ChevronDown,
  Search, PanelLeftClose, PanelLeftOpen, LogOut, HeartPulse,
  BookOpen, Wallet, ArrowLeftRight, Scale, UserCog, BedDouble,
  FlaskConical, Pill, ClipboardList, Package, ShoppingCart, Boxes,
  DoorOpen, CalendarCheck, FileText, BadgeDollarSign, Contact, Circle,
  LayoutTemplate, Landmark, Sprout,
} from "lucide-react";
import "./sidebar.css";

/* Hospital keeps a preferred group order. Other products use the API order. */
const TOP_LEVEL_ORDER = ["dashboard", "transactions", "reports", "accounts", "masters"];

function orderTopLevel(nodes) {
  const byCode = new Map((nodes || []).map((n) => [n.code, n]));
  const used = new Set();
  const out = [];
  for (const code of TOP_LEVEL_ORDER) {
    const node = byCode.get(code);
    if (node) {
      out.push(node);
      used.add(code);
    }
  }
  for (const node of nodes || []) {
    if (!used.has(node.code)) out.push(node);
  }
  return out;
}

const ICONS = {
  dashboard: LayoutDashboard,
  company_profile: Building2,
  hospital_profile: Building2,
  party_master: Users,
  print_master: Printer,
  print_template_designer: LayoutTemplate,
  payment_mode_creation: CreditCard,
  patient_master: UserRound,
  patient_list: ListOrdered,
  doctor_master: Stethoscope,
  department_master: Network,
  opd_bill: Receipt,
  opd_bill_reprint: ReceiptText,
  ipd_bill: Receipt,
  in_patient_admission: BedDouble,
  ledger_master: BookOpen,
  advance_collection: Wallet,
  adjustment_entry: ArrowLeftRight,
  receipt_voucher_adjustment_entry: ArrowLeftRight,
  daybook: ClipboardList,
  balance_sheet: Scale,
  user_addition_modification: UserCog,
  pathology_placeholder: FlaskConical,
  pharmacy_placeholder: Pill,
  product_creation: Package,
  customer_master: Contact,
  vendor_master: Contact,
  sale_bill: ShoppingCart,
  purchase_bill: BadgeDollarSign,
  stock_balances: Boxes,
  room_check_in: DoorOpen,
  room_booking: CalendarCheck,
  final_bill: FileText,
  room_type_master: BedDouble,
  room_master: DoorOpen,
  staff_master: UserCog,
};

function iconFor(code) {
  if (ICONS[code]) return ICONS[code];
  if (code.includes("bill")) return Receipt;
  if (code.includes("patient") || code.includes("party")) return UserRound;
  if (code.includes("doctor")) return Stethoscope;
  if (code.includes("user")) return UserCog;
  return Circle;
}

function isGroup(node) {
  return node.type === "group" || (node.children && node.children.length > 0);
}

/* Turn the API menu tree ({ code, label, children }) into sidebar entries.
   A node with children is a collapsible group; a leaf links to /code. */
function menusToEntries(nodes) {
  return (nodes || []).map((node) => {
    const children = node.children || [];
    if (children.length > 0) {
      return {
        type: "group",
        code: node.code,
        label: node.label,
        children: menusToEntries(children),
      };
    }
    return {
      type: "item",
      code: node.code,
      label: node.label,
      to: `/${node.code}`,
      icon: iconFor(node.code),
    };
  });
}

function subtreeMatches(node, q) {
  if (node.label.toLowerCase().includes(q)) return true;
  return (node.children || []).some((child) => subtreeMatches(child, q));
}

function prune(nodes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const kept = [];
  for (const node of nodes) {
    if (!subtreeMatches(node, q)) continue;
    if (isGroup(node) && !node.label.toLowerCase().includes(q)) {
      kept.push({ ...node, children: prune(node.children, query) });
    } else {
      kept.push(node);
    }
  }
  return kept;
}

function Group({ group, collapsed, query }) {
  const [open, setOpen] = useState(false);
  const expanded = open || collapsed || Boolean(query.trim());
  if (!group.children?.length) return null;

  return (
    <div className="sb-group">
      {!collapsed && (
        <button className="sb-group-title" onClick={() => setOpen(!open)} type="button">
          <span>{group.label}</span>
          <ChevronDown size={12} className={expanded ? "" : "sb-rot"} />
        </button>
      )}
      <div className={`sb-group-body ${expanded ? "open" : ""}`}>
        <div>
          {group.children.map((child) =>
            isGroup(child) ? (
              <Group key={child.code || child.label} group={child} collapsed={collapsed} query={query} />
            ) : (
              <NavLink key={child.to} to={child.to} title={child.label}
                className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}>
                <span className="sb-icon"><child.icon size={14} /></span>
                {!collapsed && <span className="sb-label">{child.label}</span>}
              </NavLink>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function brandIcon(product) {
  if (product === "hospital") return HeartPulse
  if (product === "lodge") return BedDouble
  if (product === "kramcop") return Landmark
  if (product === "contract_farming") return Sprout
  return Boxes
}

export default function Sidebar({
  user = "Admin",
  product = "erp",
  displayName = "ERP",
  theme = "slate",
  onLogout,
  menus,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  const initials = useMemo(
    () => user.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
    [user]
  );

  const items = useMemo(() => {
    const entries = menusToEntries(Array.isArray(menus) ? menus : [])
    const source = product === "hospital" ? orderTopLevel(entries) : entries
    return prune(source, query);
  }, [menus, product, query]);

  return (
    <aside className={`sb ${theme === "light" ? "sb-light" : ""} ${collapsed ? "sb-collapsed" : ""}`}>
      <div className="sb-brand">
        <div className="sb-logo">{(() => { const Logo = brandIcon(product); return <Logo size={18} /> })()}</div>
        {!collapsed && (
          <div>
            <h1>{displayName || "ERP"}</h1>
            <p>{product}</p>
          </div>
        )}
        <button className="sb-toggle" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar" type="button">
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="sb-search">
          <Search size={14} />
          <input placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      <nav className="sb-nav">
        {items.map((m) =>
          isGroup(m) ? (
            <Group key={m.code || m.label} group={m} collapsed={collapsed} query={query} />
          ) : (
            <NavLink key={m.to} to={m.to} title={m.label}
              className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}>
              <span className="sb-icon"><m.icon size={14} /></span>
              {!collapsed && <span className="sb-label">{m.label}</span>}
            </NavLink>
          )
        )}
      </nav>

      <div className="sb-user">
        <div className="sb-avatar">{initials}</div>
        {!collapsed && (
          <>
            <div className="sb-user-info">
              <strong>{user}</strong>
              <span>Administrator</span>
            </div>
            <button className="sb-logout" onClick={onLogout} title="Sign out" type="button"><LogOut size={14} /></button>
          </>
        )}
      </div>
    </aside>
  );
}
