import React, {
  useState, useMemo, useCallback, useEffect, useRef, createContext, useContext,
} from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Zap, LayoutDashboard, Cpu, BarChart3, SlidersHorizontal, Bell,
  Settings as SettingsIcon, Plus, Power, X, Leaf, AlertTriangle, WifiOff,
  CheckCircle2, Info, Menu, MoreVertical, Calendar, User, Wind, Snowflake,
  RotateCw, Flame, Tv, Monitor, Box, Lightbulb, Fan, Activity,
  ArrowUpRight, ArrowDownRight, Gauge, Sparkles, Pencil, Camera, Trash2,
  Mail, MapPin, Check, Loader2,
} from "lucide-react";

/* ============================== THEME TOKENS ============================== */
const COLORS = {
  bg: "#0A0F0D", panel: "#121815", panel2: "#161D19", border: "#1F2A24",
  green: "#22C55E", greenSoft: "rgba(34,197,94,0.15)",
  blue: "#3B82F6", blueSoft: "rgba(59,130,246,0.15)",
  amber: "#F59E0B", amberSoft: "rgba(245,158,11,0.15)",
  red: "#EF4444", redSoft: "rgba(239,68,68,0.12)",
  text: "#EDF2EF", muted: "#8B9A94", muted2: "#5E6E67",
};

/* ============================================================================
   CENTRAL ENERGY / TARIFF ENGINE — single source of truth for every number
   in the app. Every page calls these instead of doing its own math, so
   editing/adding a device (or changing currency/unit) updates everywhere.
============================================================================ */

// MSEDCL (Mahavitaran) LT-I Residential, Single Phase — Kalyan, Maharashtra
const MSEDCL_TARIFF = {
  location: "Kalyan, Maharashtra",
  provider: "MSEDCL (Mahavitaran)",
  category: "LT-I Residential, Single Phase",
  effectiveFrom: "April 1, 2026",
  slabs: [
    { upTo: 100, rate: 5.56 },
    { upTo: 300, rate: 12.40 },
    { upTo: 500, rate: 16.64 },
    { upTo: Infinity, rate: 19.13 },
  ],
};

/** Telescopic slab calculation: each slab's rate applies only to units within that slab. */
function calculateMSEDCLCost(totalKWh) {
  let remaining = Math.max(0, totalKWh);
  let prevCap = 0;
  let cost = 0;
  for (const slab of MSEDCL_TARIFF.slabs) {
    if (remaining <= 0) break;
    const slabSize = slab.upTo - prevCap;
    const unitsInSlab = Math.min(remaining, slabSize);
    cost += unitsInSlab * slab.rate;
    remaining -= unitsInSlab;
    prevCap = slab.upTo;
  }
  return cost;
}

/** Energy = Power(W) x Hours/day x 30 / 1000 */
function calculateDeviceMonthlyEnergy(powerW, hoursPerDay) {
  return (Math.max(0, powerW) * Math.max(0, hoursPerDay) * 30) / 1000;
}

function calculateDeviceMonthlyCost(monthlyKwh, blendedRate) {
  return monthlyKwh * blendedRate;
}

/** Aggregate a device list into household totals using the real telescopic slab cost. */
function calculateHouseholdTotals(devices) {
  const monthlyKwh = devices.reduce((s, d) => s + d.monthlyKwh, 0);
  const monthlyCostINR = calculateMSEDCLCost(monthlyKwh);
  const blendedRate = monthlyKwh > 0 ? monthlyCostINR / monthlyKwh : 0; // avg ₹/kWh, for per-device display only
  return { monthlyKwh, monthlyCostINR, blendedRate };
}

function deriveDevice(d) {
  const dailyKwh = calculateDeviceMonthlyEnergy(d.powerW, d.hoursPerDay) / 30;
  const monthlyKwh = calculateDeviceMonthlyEnergy(d.powerW, d.hoursPerDay);
  const weeklyKwh = dailyKwh * 7;
  return { ...d, dailyKwh, weeklyKwh, monthlyKwh };
}

/* --------------------------- Currency & unit formatting --------------------------- */
const CURRENCY_META = {
  INR: { symbol: "₹", rate: 1, locale: "en-IN", decimals: 0 },
  USD: { symbol: "$", rate: 1 / 83, locale: "en-US", decimals: 2 },
  EUR: { symbol: "€", rate: 1 / 90, locale: "en-IE", decimals: 2 },
};
function fmtCurrency(amountINR, currency) {
  const meta = CURRENCY_META[currency] || CURRENCY_META.INR;
  const val = amountINR * meta.rate;
  return `${meta.symbol}${val.toLocaleString(meta.locale, { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals })}`;
}
function fmtEnergy(kwh, unit) {
  if (unit === "Wh") return `${Math.round(kwh * 1000).toLocaleString("en-IN")} Wh`;
  return `${kwh.toFixed(1)} kWh`;
}
function fmtEnergyShort(kwh, unit) {
  if (unit === "Wh") return `${Math.round(kwh * 1000).toLocaleString("en-IN")}`;
  return kwh.toFixed(0);
}

/* ============================================================================
   PERSISTENCE (browser localStorage)
============================================================================ */
const STORAGE_KEY = "voltsmart:state";

async function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/* ============================== MOCK DEVICE DATA ============================== */
const ICONS = { Wind, Snowflake, RotateCw, Flame, Tv, Monitor, Box, Lightbulb, Fan };

const DEFAULT_DEVICES = [
  { id: 1, name: "Air Conditioner", type: "Cooling", icon: "Wind", status: "online", powerW: 1500, hoursPerDay: 8, efficiency: 78 },
  { id: 2, name: "Refrigerator", type: "Cooling", icon: "Snowflake", status: "online", powerW: 150, hoursPerDay: 24, efficiency: 88 },
  { id: 3, name: "Washing Machine", type: "Laundry", icon: "RotateCw", status: "online", powerW: 800, hoursPerDay: 1, efficiency: 81 },
  { id: 4, name: "Water Heater", type: "Heating", icon: "Flame", status: "online", powerW: 2000, hoursPerDay: 1.5, efficiency: 70 },
  { id: 5, name: "Television", type: "Entertainment", icon: "Tv", status: "online", powerW: 120, hoursPerDay: 5, efficiency: 92 },
  { id: 6, name: "Computer", type: "Electronics", icon: "Monitor", status: "online", powerW: 250, hoursPerDay: 6, efficiency: 85 },
  { id: 7, name: "Microwave", type: "Kitchen", icon: "Box", status: "offline", powerW: 1000, hoursPerDay: 0.3, efficiency: 90 },
  { id: 8, name: "Lights", type: "Lighting", icon: "Lightbulb", status: "online", powerW: 60, hoursPerDay: 6, efficiency: 95 },
  { id: 9, name: "Fan", type: "Cooling", icon: "Fan", status: "online", powerW: 75, hoursPerDay: 10, efficiency: 93 },
];

const DEFAULT_PROFILE = { name: "Alex Johnson", email: "alex@example.com", location: "Kalyan, Maharashtra, India", avatar: null };
const DEFAULT_SETTINGS = {
  notifs: { high: true, offline: true, weekly: false, tips: true },
  threshold: 3000,
  emailAlertsOn: true,
  currency: "INR",
  unit: "kWh",
};

function genSeries(n, base, amp, labelFn) {
  return Array.from({ length: n }, (_, i) => {
    const kwh = Math.max(2, base + amp * Math.sin(i / 1.8) + (i % 3) * 1.3 - (i % 5) * 0.6);
    const rounded = +kwh.toFixed(1);
    return { label: labelFn(i), kWh: rounded };
  });
}
const DAILY = genSeries(14, 9.5, 3.5, (i) => `${i + 1}`);
const WEEKLY = genSeries(8, 62, 14, (i) => `W${i + 1}`);
const MONTHLY = genSeries(12, 265, 60, (i) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]);
const SERIES = { Daily: DAILY, Weekly: WEEKLY, Monthly: MONTHLY };

const STATIC_ALERTS = [
  { id: 101, type: "high", title: "High Energy Usage", desc: "Air Conditioner consumed 32% more energy than usual.", time: "2 hours ago" },
  { id: 102, type: "offline", title: "Device Offline", desc: "Microwave has been offline for 2 days.", time: "1 day ago" },
  { id: 104, type: "high", title: "Unusual Spike", desc: "Water Heater usage spiked between 6–7 AM.", time: "2 days ago" },
  { id: 105, type: "info", title: "Efficiency Tip Applied", desc: "Lighting schedule optimized automatically.", time: "3 days ago" },
];

const PIE_COLORS = ["#22C55E", "#3B82F6", "#F59E0B", "#A855F7", "#EF4444", "#14B8A6", "#EAB308", "#6366F1", "#F472B6"];

const RECOMMENDATIONS = [
  { title: "Reduce AC usage by 1 hour/day", saveINR: 420, icon: Wind },
  { title: "Optimize refrigerator temperature", saveINR: 110, icon: Snowflake },
  { title: "Run washing machine during off-peak hours", saveINR: 95, icon: RotateCw },
  { title: "Turn off unused lights", saveINR: 75, icon: Lightbulb },
];

/* ============================== SETTINGS CONTEXT ============================== */
const SettingsCtx = createContext(null);
const useSettings = () => useContext(SettingsCtx);

/* ============================== SMALL UI PRIMITIVES ============================== */
function Card({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-2xl border ${className}`} style={{ background: COLORS.panel, borderColor: COLORS.border, ...style }}>
      {children}
    </div>
  );
}
function StatPill({ positive, children }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: positive ? COLORS.green : COLORS.red }}>
      {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {children}
    </span>
  );
}
function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="relative w-11 h-6 rounded-full transition-colors shrink-0"
      style={{ background: checked ? COLORS.green : "#2A3530" }}
    >
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }} />
    </button>
  );
}
function Slider({ value, min, max, step = 1, onChange, accent = COLORS.green }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(+e.target.value)}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer voltsmart-slider touch-none"
      style={{ background: `linear-gradient(to right, ${accent} ${pct}%, #232E29 ${pct}%)` }}
    />
  );
}
function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs" style={{ color: COLORS.muted }}>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
const inputStyle = { background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text };
function TextInput(props) {
  return <input {...props} className={`w-full rounded-lg px-3 py-2.5 text-sm outline-none ${props.className || ""}`} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

/** Modal shell: only closes via the X button or an explicit action — never from clicks inside. */
function ModalShell({ onClose, children, maxWidth = "max-w-md" }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.65)", paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`w-full ${maxWidth} my-auto`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 shadow-lg"
      style={{ background: COLORS.green, color: "#04140a" }}>
      <Check size={15} /> {message}
    </div>
  );
}

/* ============================== SIDEBAR ============================== */
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "devices", label: "Devices", icon: Cpu },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "whatif", label: "What-If Simulator", icon: SlidersHorizontal },
  { key: "alerts", label: "Alerts", icon: Bell },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function Avatar({ src, size = 36 }) {
  if (src) {
    return <img src={src} alt="Profile" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: size, height: size, background: COLORS.blueSoft }}>
      <User size={size * 0.45} style={{ color: COLORS.blue }} />
    </div>
  );
}

function Sidebar({ page, setPage, mobileOpen, setMobileOpen, alertCount, profile }) {
  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-8">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: COLORS.greenSoft }}>
          <Zap size={18} style={{ color: COLORS.green }} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight" style={{ color: COLORS.text }}>VoltSmart</div>
          <div className="text-[11px]" style={{ color: COLORS.muted2 }}>Smart IoT Energy Tracker</div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => { setPage(item.key); setMobileOpen(false); }}
              className="w-full flex items-center gap-3 px-3.5 py-3 sm:py-2.5 rounded-xl text-sm transition-colors relative"
              style={{ background: active ? COLORS.greenSoft : "transparent", color: active ? COLORS.green : COLORS.muted, fontWeight: active ? 600 : 500 }}
            >
              <Icon size={17} strokeWidth={2} />
              <span>{item.label}</span>
              {item.key === "alerts" && alertCount > 0 && (
                <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: active ? COLORS.green : COLORS.border, color: active ? "#04140a" : COLORS.muted }}>
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-5 pt-3" style={{ borderTop: `1px solid ${COLORS.border}` }}>
        <button onClick={() => { setPage("settings"); setMobileOpen(false); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl">
          <Avatar src={profile.avatar} size={36} />
          <div className="min-w-0 text-left">
            <div className="text-sm font-medium truncate" style={{ color: COLORS.text }}>{profile.name}</div>
            <div className="text-[11px] truncate" style={{ color: COLORS.muted2 }}>Home Energy User</div>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0" style={{ background: COLORS.panel, borderRight: `1px solid ${COLORS.border}` }}>
        {content}
      </aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] h-full flex flex-col animate-[slideIn_0.2s_ease-out]" style={{ background: COLORS.panel, borderRight: `1px solid ${COLORS.border}` }}>
            <button onClick={() => setMobileOpen(false)} className="absolute top-5 right-4 p-2 rounded-lg" style={{ color: COLORS.muted }}>
              <X size={20} />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

function MobileTopBar({ setMobileOpen }) {
  return (
    <div className="lg:hidden flex items-center justify-between px-4 py-3.5 sticky top-0 z-30" style={{ background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}` }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: COLORS.greenSoft }}>
          <Zap size={14} style={{ color: COLORS.green }} strokeWidth={2.5} />
        </div>
        <span className="text-sm font-semibold" style={{ color: COLORS.text }}>VoltSmart</span>
      </div>
      <button onClick={() => setMobileOpen(true)} className="p-2.5 rounded-lg" style={{ color: COLORS.text, background: COLORS.panel }}>
        <Menu size={18} />
      </button>
    </div>
  );
}

/* ============================== SUMMARY CARDS ============================== */
function SummaryCards({ totals, activeCount, offlineCount }) {
  const { currency, unit } = useSettings();
  const items = [
    { label: "Total Energy Used", value: fmtEnergy(totals.monthlyKwh, unit), delta: "+3.2% vs last month", positive: true, icon: Activity, color: COLORS.green },
    { label: "Estimated Energy Cost", value: fmtCurrency(totals.monthlyCostINR, currency), delta: "+1.8% vs last month", positive: true, icon: Zap, color: COLORS.blue },
    { label: "Estimated CO₂ Saved", value: `${Math.round(totals.monthlyKwh * 0.18)} kg CO₂`, delta: "+5.1% vs last month", positive: true, icon: Leaf, color: COLORS.green },
    { label: "Active Devices", value: `${activeCount}`, delta: `${offlineCount} offline`, positive: offlineCount === 0, icon: Cpu, color: COLORS.blue },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {items.map((it) => (
        <Card key={it.label} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium" style={{ color: COLORS.muted }}>{it.label}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${it.color}22` }}>
              <it.icon size={15} style={{ color: it.color }} />
            </div>
          </div>
          <div className="text-2xl font-semibold tracking-tight mb-1" style={{ color: COLORS.text }}>{it.value}</div>
          <StatPill positive={it.positive}>{it.delta}</StatPill>
        </Card>
      ))}
    </div>
  );
}

/* ============================== CONSUMPTION CHART ============================== */
function ConsumptionChart({ period, setPeriod }) {
  const data = SERIES[period];
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Energy Consumption</h3>
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: COLORS.panel2 }}>
          {["Daily", "Weekly", "Monthly"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{ background: period === p ? COLORS.green : "transparent", color: period === p ? "#04140a" : COLORS.muted }}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[11px] mb-2" style={{ color: COLORS.muted }}>kWh — {period.toLowerCase()} consumption</div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="gKwh" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.green} stopOpacity={0.35} />
                <stop offset="100%" stopColor={COLORS.green} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
            <XAxis dataKey="label" stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, 
