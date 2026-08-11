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
            <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 12 }} labelStyle={{ color: COLORS.text }} />
            <Area type="monotone" dataKey="kWh" stroke={COLORS.green} strokeWidth={2} fill="url(#gKwh)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ============================== TOP CONSUMERS ============================== */
function DeviceIcon({ name, size = 16, color }) {
  const Icon = ICONS[name] || Box;
  return <Icon size={size} style={{ color }} />;
}

function TopConsumers({ devices, totals }) {
  const { currency, unit } = useSettings();
  const sorted = [...devices].sort((a, b) => b.monthlyKwh - a.monthlyKwh).slice(0, 6);
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-4" style={{ color: COLORS.text }}>Top Energy Consumers</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {sorted.map((d) => {
          const pct = totals.monthlyKwh ? (d.monthlyKwh / totals.monthlyKwh) * 100 : 0;
          const deviceCost = calculateDeviceMonthlyCost(d.monthlyKwh, totals.blendedRate);
          return (
            <div key={d.id} className="rounded-xl p-3.5" style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: COLORS.greenSoft }}>
                  <DeviceIcon name={d.icon} color={COLORS.green} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate" style={{ color: COLORS.text }}>{d.name}</div>
                  <div className="text-[11px]" style={{ color: COLORS.muted2 }}>{d.hoursPerDay}h/day</div>
                </div>
              </div>
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-base font-semibold" style={{ color: COLORS.text }}>{fmtEnergy(d.monthlyKwh, unit)}</div>
                  <div className="text-[11px]" style={{ color: COLORS.muted }}>{fmtCurrency(deviceCost, currency)}</div>
                </div>
                <div className="text-xs font-medium" style={{ color: COLORS.green }}>{pct.toFixed(0)}%</div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.border }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS.green }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ============================== DASHBOARD MINI SIMULATOR ============================== */
function MiniSimulator({ sim, setSim, result }) {
  const { currency } = useSettings();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <SlidersHorizontal size={15} style={{ color: COLORS.green }} />
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>What-If Simulator</h3>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: COLORS.muted }}>Adjust AC Usage (Hours/Day)</span>
          <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.acHours}h</span>
        </div>
        <Slider value={sim.acHours} min={1} max={12} onChange={(v) => setSim((s) => ({ ...s, acHours: v }))} />
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: COLORS.muted }}>Adjust Lighting Usage</span>
          <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.lightingPct}%</span>
        </div>
        <Slider value={sim.lightingPct} min={20} max={100} onChange={(v) => setSim((s) => ({ ...s, lightingPct: v }))} accent={COLORS.blue} />
      </div>

      <div className="mb-5">
        <div className="text-xs mb-2" style={{ color: COLORS.muted }}>Shift Washing Machine (Time)</div>
        <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: COLORS.panel2 }}>
          <span className="text-[11px]" style={{ color: sim.offPeak ? COLORS.muted2 : COLORS.text }}>Peak</span>
          <Toggle checked={sim.offPeak} onChange={() => setSim((s) => ({ ...s, offPeak: !s.offPeak }))} />
          <span className="text-[11px]" style={{ color: sim.offPeak ? COLORS.green : COLORS.muted2 }}>Off-Peak</span>
        </div>
      </div>

      <div className="text-[11px] mb-1.5" style={{ color: COLORS.muted2 }}>Instantly updated results:</div>
      <div className="rounded-xl p-3.5" style={{ background: COLORS.greenSoft, border: `1px solid ${COLORS.green}33` }}>
        <div className="text-sm font-semibold" style={{ color: COLORS.green }}>
          Est. Savings: {fmtCurrency(result.moneySaved, currency)} / -{result.energySaved.toFixed(0)} kWh
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.muted }}>Monthly, based on MSEDCL slab rates</div>
      </div>
    </Card>
  );
}

/* ============================== RECOMMENDATIONS ============================== */
function Recommendations() {
  const { currency } = useSettings();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={15} style={{ color: COLORS.green }} />
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Smart Recommendations</h3>
      </div>
      <div className="space-y-2.5">
        {RECOMMENDATIONS.map((r) => (
          <div key={r.title} className="flex items-center gap-3 rounded-xl p-3" style={{ background: COLORS.panel2 }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.greenSoft }}>
              <r.icon size={15} style={{ color: COLORS.green }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium leading-snug" style={{ color: COLORS.text }}>{r.title}</div>
              <div className="text-[11px] font-medium" style={{ color: COLORS.green }}>Save {fmtCurrency(r.saveINR, currency)}/mo</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ============================== DASHBOARD PAGE ============================== */
function Dashboard({ devices, totals, activeCount, offlineCount, sim, setSim, simResult, profile }) {
  const [period, setPeriod] = useState("Daily");
  const now = new Date();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>Welcome back, {profile.name.split(" ")[0] || profile.name}!</h1>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>Monitor your home's energy consumption and find ways to save.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-3.5 py-2" style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}` }}>
          <Calendar size={14} style={{ color: COLORS.muted }} />
          <div className="text-xs" style={{ color: COLORS.text }}>
            <div className="font-medium">Today</div>
            <div style={{ color: COLORS.muted2 }}>
              {now.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </div>

      <SummaryCards totals={totals} activeCount={activeCount} offlineCount={offlineCount} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <ConsumptionChart period={period} setPeriod={setPeriod} />
          <TopConsumers devices={devices} totals={totals} />
        </div>
        <div className="space-y-6">
          <MiniSimulator sim={sim} setSim={setSim} result={simResult} />
          <Recommendations />
        </div>
      </div>
    </div>
  );
}

/* ============================== DEVICE FORM (shared by Add & Edit) ============================== */
function DeviceForm({ initial, onCancel, onSubmit, submitLabel }) {
  const [form, setForm] = useState(initial);
  const canSubmit = form.name.trim().length > 0 && form.powerW > 0 && form.hoursPerDay >= 0;
  return (
    <Card className="w-full p-5 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>{submitLabel === "Add Device" ? "Add New Device" : "Edit Device"}</h3>
        <button type="button" onClick={onCancel} style={{ color: COLORS.muted }}><X size={18} /></button>
      </div>
      <div className="space-y-3">
        <Field label="Device Name">
          <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Smart Speaker" />
        </Field>
        <Field label="Device Type">
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          >
            {["Cooling", "Heating", "Laundry", "Entertainment", "Electronics", "Kitchen", "Lighting"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Power (W)">
            <TextInput type="number" inputMode="decimal" min="0" value={form.powerW} onChange={(e) => setForm((f) => ({ ...f, powerW: +e.target.value }))} />
          </Field>
          <Field label="Hours/Day">
            <TextInput type="number" inputMode="decimal" min="0" max="24" step="0.5" value={form.hoursPerDay} onChange={(e) => setForm((f) => ({ ...f, hoursPerDay: +e.target.value }))} />
          </Field>
        </div>
        {"status" in initial && (
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            >
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
          </Field>
        )}
        <div className="rounded-lg p-3 text-xs" style={{ background: COLORS.panel2, color: COLORS.muted }}>
          Estimated monthly energy: <span style={{ color: COLORS.text, fontWeight: 600 }}>{calculateDeviceMonthlyEnergy(form.powerW || 0, form.hoursPerDay || 0).toFixed(1)} kWh</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-5">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => canSubmit && onSubmit(form)}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
          style={{ background: COLORS.green, color: "#04140a" }}
        >
          {submitLabel}
        </button>
      </div>
    </Card>
  );
}

function DeviceDetailsModal({ device, onClose, onEdit }) {
  const history = useMemo(() => genSeries(7, device.dailyKwh, device.dailyKwh * 0.3, (i) => ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]), [device]);
  const { currency, unit } = useSettings();
  return (
    <ModalShell onClose={onClose} maxWidth="max-w-lg">
      <Card className="w-full p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: COLORS.greenSoft }}>
              <DeviceIcon name={device.icon} size={18} color={COLORS.green} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: COLORS.text }}>{device.name}</div>
              <div className="text-[11px] flex items-center gap-1.5" style={{ color: device.status === "online" ? COLORS.green : COLORS.muted2 }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: device.status === "online" ? COLORS.green : COLORS.muted2 }} />
                {device.status === "online" ? "Online" : "Offline"}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ color: COLORS.muted }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          {[
            ["Power Rating", `${device.powerW} W`],
            ["Today's Use", fmtEnergy(device.dailyKwh, unit)],
            ["Weekly", fmtEnergy(device.weeklyKwh, unit)],
            ["Monthly", fmtEnergy(device.monthlyKwh, unit)],
            ["Est. Cost", `${fmtCurrency(device.deviceCost, currency)}/mo`],
            ["Usage", `${device.hoursPerDay}h/day`],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg p-2.5" style={{ background: COLORS.panel2 }}>
              <div className="text-[10px]" style={{ color: COLORS.muted2 }}>{label}</div>
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: COLORS.text }}>{val}</div>
            </div>
          ))}
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium" style={{ color: COLORS.text }}>Energy Efficiency</span>
            <span className="text-xs font-semibold" style={{ color: COLORS.green }}>{device.efficiency}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: COLORS.border }}>
            <div className="h-full rounded-full" style={{ width: `${device.efficiency}%`, background: COLORS.green }} />
          </div>
        </div>

        <div className="text-xs font-medium mb-2" style={{ color: COLORS.text }}>Usage History (7 days)</div>
        <div style={{ width: "100%", height: 160 }}>
          <ResponsiveContainer>
            <BarChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" stroke={COLORS.muted2} fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke={COLORS.muted2} fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 12 }} />
              <Bar dataKey="kWh" fill={COLORS.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <button onClick={onEdit} className="w-full mt-5 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          <Pencil size={14} /> Edit Device
        </button>
      </Card>
    </ModalShell>
  );
}

/* ============================== DEVICES PAGE ============================== */
function DevicesPage({ devices, totals, toggleDevice, addDevice, updateDevice, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const [editId, setEditId] = useState(null);
  const { currency, unit } = useSettings();

  const withCost = devices.map((d) => ({ ...d, deviceCost: calculateDeviceMonthlyCost(d.monthlyKwh, totals.blendedRate) }));
  const detailsDevice = withCost.find((d) => d.id === detailsId);
  const editDevice = devices.find((d) => d.id === editId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>Devices</h1>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>{devices.length} connected appliances · {devices.filter((d) => d.status === "online").length} online</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-xl text-sm font-semibold" style={{ background: COLORS.green, color: "#04140a" }}>
          <Plus size={16} /> Add Device
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {withCost.map((d) => (
          <Card key={d.id} className="p-4 flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: d.status === "online" ? COLORS.greenSoft : "rgba(255,255,255,0.05)" }}>
                  <DeviceIcon name={d.icon} color={d.status === "online" ? COLORS.green : COLORS.muted2} />
                </div>
                <div>
                  <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>{d.name}</div>
                  <div className="text-[11px]" style={{ color: COLORS.muted2 }}>{d.type}</div>
                </div>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full"
                style={{ background: d.status === "online" ? COLORS.greenSoft : "rgba(255,255,255,0.06)", color: d.status === "online" ? COLORS.green : COLORS.muted2 }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.status === "online" ? COLORS.green : COLORS.muted2 }} />
                {d.status === "online" ? "Online" : "Offline"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
              <div className="rounded-lg p-2" style={{ background: COLORS.panel2 }}>
                <div style={{ color: COLORS.muted2 }}>Daily</div>
                <div className="font-semibold" style={{ color: COLORS.text }}>{fmtEnergy(d.dailyKwh, unit)}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: COLORS.panel2 }}>
                <div style={{ color: COLORS.muted2 }}>Monthly</div>
                <div className="font-semibold" style={{ color: COLORS.text }}>{fmtEnergy(d.monthlyKwh, unit)}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: COLORS.panel2 }}>
                <div style={{ color: COLORS.muted2 }}>Est. Cost</div>
                <div className="font-semibold" style={{ color: COLORS.text }}>{fmtCurrency(d.deviceCost, currency)}</div>
              </div>
              <div className="rounded-lg p-2" style={{ background: COLORS.panel2 }}>
                <div style={{ color: COLORS.muted2 }}>Power</div>
                <div className="font-semibold" style={{ color: COLORS.text }}>{d.powerW} W</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-auto">
              <button onClick={() => setDetailsId(d.id)} className="flex-1 py-2.5 rounded-lg text-xs font-medium" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                View Details
              </button>
              <button onClick={() => setEditId(d.id)} className="flex items-center justify-center py-2.5 px-3 rounded-lg" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                <Pencil size={14} />
              </button>
              <button
                onClick={() => toggleDevice(d.id)}
                className="flex items-center justify-center gap-1 py-2.5 px-3 rounded-lg text-xs font-medium"
                style={{ background: d.status === "online" ? "rgba(239,68,68,0.12)" : COLORS.greenSoft, color: d.status === "online" ? COLORS.red : COLORS.green }}
              >
                <Power size={13} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {showAdd && (
        <ModalShell onClose={() => setShowAdd(false)}>
          <DeviceForm
            initial={{ name: "", type: "Electronics", powerW: 100, hoursPerDay: 2 }}
            submitLabel="Add Device"
            onCancel={() => setShowAdd(false)}
            onSubmit={(form) => { addDevice(form); setShowAdd(false); showToast("Device added successfully."); }}
          />
        </ModalShell>
      )}

      {editDevice && (
        <ModalShell onClose={() => setEditId(null)}>
          <DeviceForm
            initial={{ name: editDevice.name, type: editDevice.type, powerW: editDevice.powerW, hoursPerDay: editDevice.hoursPerDay, status: editDevice.status }}
            submitLabel="Save Changes"
            onCancel={() => setEditId(null)}
            onSubmit={(form) => { updateDevice(editDevice.id, form); setEditId(null); showToast("Device updated successfully."); }}
          />
        </ModalShell>
      )}

      {detailsDevice && (
        <DeviceDetailsModal
          device={detailsDevice}
          onClose={() => setDetailsId(null)}
          onEdit={() => { setDetailsId(null); setEditId(detailsDevice.id); }}
        />
      )}
    </div>
  );
}

/* ============================== ANALYTICS PAGE ============================== */
function AnalyticsPage({ devices, totals }) {
  const [period, setPeriod] = useState("Daily");
  const [showCost, setShowCost] = useState(false);
  const { currency, unit } = useSettings();
  const data = SERIES[period];

  const stats = useMemo(() => {
    const vals = data.map((d) => d.kWh);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    return { avg, maxDay: data[vals.indexOf(max)], minDay: data[vals.indexOf(min)] };
  }, [data]);

  const pieData = devices.map((d) => ({ name: d.name, value: +d.monthlyKwh.toFixed(1) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>Analytics</h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>Deep dive into your energy usage patterns.</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Energy Usage Overview</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: COLORS.panel2 }}>
              {["Daily", "Weekly", "Monthly"].map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 text-xs font-medium rounded-md" style={{ background: period === p ? COLORS.green : "transparent", color: period === p ? "#04140a" : COLORS.muted }}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: COLORS.panel2 }}>
              {[{ k: false, l: "kWh" }, { k: true, l: `Cost (${CURRENCY_META[currency].symbol})` }].map((u) => (
                <button key={u.l} onClick={() => setShowCost(u.k)} className="px-3 py-1.5 text-xs font-medium rounded-md" style={{ background: showCost === u.k ? COLORS.blue : "transparent", color: showCost === u.k ? "#04140a" : COLORS.muted }}>
                  {u.l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) => showCost ? Math.round(calculateMSEDCLCost(v) * CURRENCY_META[currency].rate) : v} />
              <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 12 }}
                formatter={(v) => showCost ? fmtCurrency(calculateMSEDCLCost(v), currency) : `${v} kWh`} />
              <Line type="monotone" dataKey="kWh" stroke={showCost ? COLORS.blue : COLORS.green} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          ["Average", fmtEnergy(stats.avg, unit)],
          ["Highest", `${stats.maxDay?.label}`],
          ["Lowest", `${stats.minDay?.label}`],
          ["Monthly Total", fmtEnergy(totals.monthlyKwh, unit)],
          ["Est. Energy Cost", fmtCurrency(totals.monthlyCostINR, currency)],
        ].map(([label, val]) => (
          <Card key={label} className="p-3.5">
            <div className="text-[11px]" style={{ color: COLORS.muted2 }}>{label}</div>
            <div className="text-base font-semibold mt-1" style={{ color: COLORS.text }}>{val}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: COLORS.text }}>Consumption by Device</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {pieData.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2" style={{ color: COLORS.text }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  {p.name}
                </span>
                <span style={{ color: COLORS.muted }}>{fmtEnergy(p.value, unit)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================== WHAT-IF SIMULATOR PAGE ============================== */
function WhatIfPage({ sim, setSim, simResult, devices }) {
  const { currency, unit } = useSettings();
  const findKwh = (name, breakdown) => breakdown[name] ?? 0;
  const comparisonData = [
    { name: "AC", Current: simResult.currentBreakdown.ac, Optimized: simResult.newBreakdown.ac },
    { name: "Lighting", Current: simResult.currentBreakdown.lighting, Optimized: simResult.newBreakdown.lighting },
    { name: "Washer", Current: simResult.currentBreakdown.washer, Optimized: simResult.newBreakdown.washer },
    { name: "Heater", Current: simResult.currentBreakdown.heater, Optimized: simResult.newBreakdown.heater },
    { name: "Fan", Current: simResult.currentBreakdown.fan, Optimized: simResult.newBreakdown.fan },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>What If? Energy Savings Simulator</h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>Adjust your appliance usage and see live savings, calculated on real MSEDCL slab rates.</p>
      </div>

      <div className="rounded-2xl p-6" style={{ background: `linear-gradient(135deg, ${COLORS.greenSoft}, rgba(59,130,246,0.08))`, border: `1px solid ${COLORS.green}44` }}>
        <div className="flex items-center gap-2 mb-1">
          <Gauge size={16} style={{ color: COLORS.green }} />
          <span className="text-xs font-medium" style={{ color: COLORS.muted }}>Live Simulation Result</span>
        </div>
        <div className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: COLORS.green }}>
          You could save {fmtCurrency(simResult.moneySaved, currency)}/month
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm" style={{ color: COLORS.text }}>
          <span>{simResult.energySaved.toFixed(0)} kWh less energy usage</span>
          <span>{fmtCurrency(simResult.yearlySaved, currency)} estimated yearly savings</span>
        </div>
        <div className="text-[11px] mt-2" style={{ color: COLORS.muted }}>
          Household: {simResult.currentKwh.toFixed(0)} kWh ({fmtCurrency(simResult.currentCost, currency)}) → {simResult.newKwh.toFixed(0)} kWh ({fmtCurrency(simResult.newCost, currency)}), telescopic MSEDCL slabs
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 space-y-6">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Adjust Usage</h3>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: COLORS.muted }}>AC Usage (hours/day)</span>
              <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.acHours}h</span>
            </div>
            <Slider value={sim.acHours} min={1} max={12} onChange={(v) => setSim((s) => ({ ...s, acHours: v }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: COLORS.muted }}>Lighting Usage (%)</span>
              <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.lightingPct}%</span>
            </div>
            <Slider value={sim.lightingPct} min={20} max={100} onChange={(v) => setSim((s) => ({ ...s, lightingPct: v }))} accent={COLORS.blue} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: COLORS.muted }}>Water Heater Usage (hours/day)</span>
              <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.heaterHours}h</span>
            </div>
            <Slider value={sim.heaterHours} min={0.5} max={4} step={0.5} onChange={(v) => setSim((s) => ({ ...s, heaterHours: v }))} accent={COLORS.amber} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: COLORS.muted }}>Fan Usage (hours/day)</span>
              <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{sim.fanHours}h</span>
            </div>
            <Slider value={sim.fanHours} min={2} max={16} onChange={(v) => setSim((s) => ({ ...s, fanHours: v }))} />
          </div>

          <div>
            <div className="text-xs mb-2" style={{ color: COLORS.muted }}>Washing Machine Schedule</div>
            <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: COLORS.panel2 }}>
              <span className="text-xs" style={{ color: sim.offPeak ? COLORS.muted2 : COLORS.text }}>Peak Hours</span>
              <Toggle checked={sim.offPeak} onChange={() => setSim((s) => ({ ...s, offPeak: !s.offPeak }))} />
              <span className="text-xs" style={{ color: sim.offPeak ? COLORS.green : COLORS.muted2 }}>Off-Peak Hours</span>
            </div>
          </div>

          <button onClick={() => setSim({ acHours: 8, lightingPct: 100, offPeak: false, heaterHours: 1.5, fanHours: 10 })} className="text-xs font-medium underline" style={{ color: COLORS.muted }}>
            Reset to current usage
          </button>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: COLORS.text }}>Current vs Optimized Usage (kWh/month)</h3>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={COLORS.muted2} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Current" fill={COLORS.muted2} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Optimized" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="rounded-xl p-3 text-center" style={{ background: COLORS.panel2 }}>
              <div className="text-[10px]" style={{ color: COLORS.muted2 }}>Current</div>
              <div className="text-sm font-semibold mt-1" style={{ color: COLORS.text }}>{simResult.currentKwh.toFixed(0)} kWh</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: COLORS.greenSoft }}>
              <div className="text-[10px]" style={{ color: COLORS.muted }}>New</div>
              <div className="text-sm font-semibold mt-1" style={{ color: COLORS.green }}>{simResult.newKwh.toFixed(0)} kWh</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: COLORS.blueSoft }}>
              <div className="text-[10px]" style={{ color: COLORS.muted }}>Saved</div>
              <div className="text-sm font-semibold mt-1" style={{ color: COLORS.blue }}>{simResult.energySaved.toFixed(0)} kWh</div>
            </div>
          </div>
        </Card>
      </div>

      <Recommendations />
    </div>
  );
}

/* ============================== ALERTS PAGE ============================== */
function AlertsPage({ totals, settings }) {
  const { currency } = useSettings();
  const cfg = {
    high: { icon: AlertTriangle, color: COLORS.red, bg: COLORS.redSoft },
    offline: { icon: WifiOff, color: COLORS.amber, bg: COLORS.amberSoft },
    budget: { icon: Zap, color: COLORS.blue, bg: COLORS.blueSoft },
    info: { icon: CheckCircle2, color: COLORS.green, bg: COLORS.greenSoft },
  };
  const overBudget = totals.monthlyCostINR > settings.threshold;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>Alerts</h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>Stay informed about unusual activity and budget status.</p>
      </div>

      {overBudget && (
        <Card className="p-4" style={{ borderColor: `${COLORS.blue}55` }}>
          <div className="flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: cfg.budget.bg }}>
              <Zap size={16} style={{ color: cfg.budget.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium" style={{ color: COLORS.text }}>Monthly Budget Exceeded</div>
              <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
                Estimated monthly cost of {fmtCurrency(totals.monthlyCostINR, currency)} has crossed your {fmtCurrency(settings.threshold, currency)} budget.
              </p>
              {settings.emailAlertsOn ? (
                <div className="mt-3 rounded-lg p-3 text-xs space-y-1" style={{ background: COLORS.panel2 }}>
                  <div className="font-medium flex items-center gap-1.5" style={{ color: COLORS.blue }}><Mail size={12} /> Email alert triggered (prototype simulation)</div>
                  <div style={{ color: COLORS.muted }}>Recipient: {settings.profileEmail}</div>
                  <div style={{ color: COLORS.muted }}>Reason: Estimated monthly cost exceeded {fmtCurrency(settings.threshold, currency)}</div>
                  <div style={{ color: COLORS.muted2 }}>No email server is connected — this is a frontend-only simulation for the prototype.</div>
                </div>
              ) : (
                <div className="mt-3 text-[11px]" style={{ color: COLORS.muted2 }}>Email alerts are turned off in Settings.</div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {STATIC_ALERTS.map((a) => {
          const c = cfg[a.type];
          return (
            <Card key={a.id} className="p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bg }}>
                <c.icon size={16} style={{ color: c.color }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: COLORS.text }}>{a.title}</span>
                  <span className="text-[11px] shrink-0" style={{ color: COLORS.muted2 }}>{a.time}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: COLORS.muted }}>{a.desc}</p>
              </div>
              <button style={{ color: COLORS.muted2 }}><MoreVertical size={15} /></button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== PROFILE EDIT MODAL ============================== */
function ProfileEditModal({ profile, onClose, onSave }) {
  const [form, setForm] = useState(profile);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatar: reader.result }));
    reader.readAsDataURL(file);
  };

  return (
    <ModalShell onClose={onClose}>
      <Card className="w-full p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Edit Profile</h3>
          <button onClick={onClose} style={{ color: COLORS.muted }}><X size={18} /></button>
        </div>

        <div className="flex flex-col items-center mb-5">
          <Avatar src={form.avatar} size={72} />
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              <Camera size={13} /> Upload Photo
            </button>
            {form.avatar && (
              <button onClick={() => setForm((f) => ({ ...f, avatar: null }))} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.redSoft, color: COLORS.red }}>
                <Trash2 size={13} /> Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Full Name">
            <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Email Address">
            <TextInput type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Location">
            <TextInput value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          </Field>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>Cancel</button>
          <button onClick={() => onSave(form)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: COLORS.green, color: "#04140a" }}>Save Changes</button>
        </div>
      </Card>
    </ModalShell>
  );
}

/* ============================== SETTINGS PAGE ============================== */
function SettingsPage({ profile, setProfile, settings, setSettings, showToast }) {
  const [editingProfile, setEditingProfile] = useState(false);

  const setNotif = (key) => setSettings((s) => ({ ...s, notifs: { ...s.notifs, [key]: !s.notifs[key] } }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: COLORS.text }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>Manage your account, notifications and preferences.</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>Profile</h3>
          <button onClick={() => setEditingProfile(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            <Pencil size={13} /> Edit Profile
          </button>
        </div>
        <div className="flex items-center gap-4">
          <Avatar src={profile.avatar} size={56} />
          <div>
            <div className="text-sm font-medium" style={{ color: COLORS.text }}>{profile.name}</div>
            <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: COLORS.muted2 }}><Mail size={11} /> {profile.email}</div>
            <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: COLORS.muted2 }}><MapPin size={11} /> {profile.location}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Email Alerts</h3>
        <p className="text-xs mb-3" style={{ color: COLORS.muted2 }}>Prototype simulation — no real email is sent; shown for demo purposes.</p>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs" style={{ color: COLORS.text }}>Send alerts to {profile.email}</span>
          <Toggle checked={settings.emailAlertsOn} onChange={() => setSettings((s) => ({ ...s, emailAlertsOn: !s.emailAlertsOn }))} />
        </div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: COLORS.muted }}>Monthly budget alert threshold</span>
          <span className="text-xs font-semibold" style={{ color: COLORS.text }}>{fmtCurrency(settings.threshold, settings.currency)}</span>
        </div>
        <Slider value={settings.threshold} min={1000} max={8000} step={100} onChange={(v) => setSettings((s) => ({ ...s, threshold: v }))} accent={COLORS.blue} />
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: COLORS.text }}>Notifications</h3>
        <div className="space-y-3">
          {[["high", "High energy usage alerts"], ["offline", "Device offline alerts"], ["weekly", "Weekly summary email"], ["tips", "Smart saving tips"]].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs" style={{ color: COLORS.text }}>{label}</span>
              <Toggle checked={settings.notifs[key]} onChange={() => setNotif(key)} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Currency & Units</h3>
        <p className="text-xs mb-3" style={{ color: COLORS.muted2 }}>Applied across every page of the dashboard.</p>
        <div className="mb-3">
          <div className="text-[11px] mb-1.5" style={{ color: COLORS.muted }}>Currency</div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(CURRENCY_META).map(([code, meta]) => (
              <button key={code} onClick={() => setSettings((s) => ({ ...s, currency: code }))}
                className="px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: settings.currency === code ? COLORS.greenSoft : COLORS.panel2, color: settings.currency === code ? COLORS.green : COLORS.muted, border: `1px solid ${settings.currency === code ? COLORS.green + "55" : COLORS.border}` }}>
                {meta.symbol} {code}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: COLORS.muted }}>Energy Unit</div>
          <div className="flex items-center gap-2">
            {["kWh", "Wh"].map((u) => (
              <button key={u} onClick={() => setSettings((s) => ({ ...s, unit: u }))}
                className="px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: settings.unit === u ? COLORS.blueSoft : COLORS.panel2, color: settings.unit === u ? COLORS.blue : COLORS.muted, border: `1px solid ${settings.unit === u ? COLORS.blue + "55" : COLORS.border}` }}>
                {u}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Electricity Tariff</h3>
        <p className="text-xs mb-3" style={{ color: COLORS.muted2 }}>Used for all estimated energy-cost calculations. Not editable — sourced from the utility's published tariff.</p>
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div><div style={{ color: COLORS.muted2 }}>Location</div><div className="font-medium mt-0.5" style={{ color: COLORS.text }}>{MSEDCL_TARIFF.location}</div></div>
          <div><div style={{ color: COLORS.muted2 }}>Provider</div><div className="font-medium mt-0.5" style={{ color: COLORS.text }}>{MSEDCL_TARIFF.provider}</div></div>
          <div><div style={{ color: COLORS.muted2 }}>Category</div><div className="font-medium mt-0.5" style={{ color: COLORS.text }}>{MSEDCL_TARIFF.category}</div></div>
          <div><div style={{ color: COLORS.muted2 }}>Effective From</div><div className="font-medium mt-0.5" style={{ color: COLORS.text }}>{MSEDCL_TARIFF.effectiveFrom}</div></div>
        </div>
        <div className="space-y-1.5 mb-3">
          {[["0–100 units", 5.56], ["101–300 units", 12.40], ["301–500 units", 16.64], ["Above 500 units", 19.13]].map(([label, rate]) => (
            <div key={label} className="flex items-center justify-between text-xs rounded-lg px-3 py-2" style={{ background: COLORS.panel2 }}>
              <span style={{ color: COLORS.text }}>{label}</span>
              <span className="font-semibold" style={{ color: COLORS.green }}>₹{rate.toFixed(2)}/unit</span>
            </div>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: COLORS.muted2 }}>
          Estimated energy charge based on MSEDCL LT-I residential tariff, calculated on a telescopic slab basis. Actual bill may include fixed charges, wheeling charges, FAC, electricity duty and other applicable components.
        </p>
      </Card>

      {editingProfile && (
        <ProfileEditModal
          profile={profile}
          onClose={() => setEditingProfile(false)}
          onSave={(form) => { setProfile(form); setEditingProfile(false); showToast("Profile updated successfully."); }}
        />
      )}
    </div>
  );
}

/* ============================== APP ============================== */
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rawDevices, setRawDevices] = useState(DEFAULT_DEVICES);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sim, setSim] = useState({ acHours: 8, lightingPct: 100, offPeak: false, heaterHours: 1.5, fanHours: 10 });
  const [toast, setToast] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  const showToast = useCallback((msg) => setToast(msg), []);

  // Load persisted state once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadState();
      if (!cancelled && saved) {
        if (saved.devices) setRawDevices(saved.devices);
        if (saved.profile) setProfile(saved.profile);
        if (saved.settings) setSettings((s) => ({ ...s, ...saved.settings }));
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on change (debounced), skipped until initial load completes.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => { saveState({ devices: rawDevices, profile, settings }); }, 500);
    return () => clearTimeout(t);
  }, [rawDevices, profile, settings, hydrated]);

  const devices = useMemo(() => rawDevices.map(deriveDevice), [rawDevices]);
  const totals = useMemo(() => calculateHouseholdTotals(devices), [devices]);

  const activeCount = devices.filter((d) => d.status === "online").length;
  const offlineCount = devices.length - activeCount;

  const toggleDevice = useCallback((id) => {
    setRawDevices((ds) => ds.map((d) => d.id === id ? { ...d, status: d.status === "online" ? "offline" : "online" } : d));
  }, []);

  const addDevice = useCallback((form) => {
    setRawDevices((ds) => [...ds, { id: Date.now(), name: form.name, type: form.type, icon: "Box", status: "online", powerW: form.powerW, hoursPerDay: form.hoursPerDay, efficiency: 80 }]);
  }, []);

  const updateDevice = useCallback((id, form) => {
    setRawDevices((ds) => ds.map((d) => d.id === id ? { ...d, ...form } : d));
  }, []);

  const simResult = useMemo(() => {
    const ac = devices.find((d) => d.name === "Air Conditioner");
    const lights = devices.find((d) => d.name === "Lights");
    const washer = devices.find((d) => d.name === "Washing Machine");
    const heater = devices.find((d) => d.name === "Water Heater");
    const fan = devices.find((d) => d.name === "Fan");
    const others = devices.filter((d) => !["Air Conditioner", "Lights", "Washing Machine", "Water Heater", "Fan"].includes(d.name));
    const othersKwh = others.reduce((s, d) => s + d.monthlyKwh, 0);

    const currentBreakdown = {
      ac: ac?.monthlyKwh ?? 0,
      lighting: lights?.monthlyKwh ?? 0,
      washer: washer?.monthlyKwh ?? 0,
      heater: heater?.monthlyKwh ?? 0,
      fan: fan?.monthlyKwh ?? 0,
    };
    const newBreakdown = {
      ac: ac ? calculateDeviceMonthlyEnergy(ac.powerW, sim.acHours) : 0,
      lighting: lights ? currentBreakdown.lighting * (sim.lightingPct / 100) : 0,
      washer: washer?.monthlyKwh ?? 0, // off-peak affects the rate slab timing story, not raw kWh
      heater: heater ? calculateDeviceMonthlyEnergy(heater.powerW, sim.heaterHours) : 0,
      fan: fan ? calculateDeviceMonthlyEnergy(fan.powerW, sim.fanHours) : 0,
    };

    const currentKwh = othersKwh + Object.values(currentBreakdown).reduce((a, b) => a + b, 0);
    const newKwh = othersKwh + Object.values(newBreakdown).reduce((a, b) => a + b, 0);

    // Real telescopic MSEDCL slab cost for both scenarios — not a flat rate.
    const currentCost = calculateMSEDCLCost(currentKwh);
    let newCost = calculateMSEDCLCost(newKwh);
    if (sim.offPeak && washer) {
      // Off-peak scheduling is modeled as a modest additional discount on the washer's share of the bill.
      const washerShare = washer.monthlyKwh > 0 ? (washer.monthlyKwh / Math.max(newKwh, 1)) * newCost : 0;
      newCost -= washerShare * 0.15;
    }

    const energySaved = Math.max(0, currentKwh - newKwh);
    const moneySaved = Math.max(0, currentCost - newCost);

    return { currentKwh, newKwh, currentCost, newCost, energySaved, moneySaved, yearlySaved: moneySaved * 12, newBreakdown, currentBreakdown };
  }, [sim, devices]);

  const settingsCtxValue = useMemo(() => ({ currency: settings.currency, unit: settings.unit }), [settings.currency, settings.unit]);

  const pages = {
    dashboard: <Dashboard devices={devices} totals={totals} activeCount={activeCount} offlineCount={offlineCount} sim={sim} setSim={setSim} simResult={simResult} profile={profile} />,
    devices: <DevicesPage devices={devices} totals={totals} toggleDevice={toggleDevice} addDevice={addDevice} updateDevice={updateDevice} showToast={showToast} />,
    analytics: <AnalyticsPage devices={devices} totals={totals} />,
    whatif: <WhatIfPage sim={sim} setSim={setSim} simResult={simResult} devices={devices} />,
    alerts: <AlertsPage totals={totals} settings={{ threshold: settings.threshold, emailAlertsOn: settings.emailAlertsOn, profileEmail: profile.email }} />,
    settings: <SettingsPage profile={profile} setProfile={setProfile} settings={settings} setSettings={setSettings} showToast={showToast} />,
  };

  return (
    <SettingsCtx.Provider value={settingsCtxValue}>
      <div className="flex min-h-screen w-full" style={{ background: COLORS.bg }}>
        <style>{`
          @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
          .voltsmart-slider::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 18px; height: 18px; border-radius: 9999px;
            background: #fff; border: 3px solid ${COLORS.green};
            cursor: pointer; margin-top: -1px;
          }
          .voltsmart-slider::-moz-range-thumb {
            width: 18px; height: 18px; border-radius: 9999px;
            background: #fff; border: 3px solid ${COLORS.green}; cursor: pointer;
          }
          * { scrollbar-width: thin; scrollbar-color: ${COLORS.border} transparent; }
          html, body { overflow-x: hidden; }
          select { -webkit-appearance: none; appearance: none; }
        `}</style>

        <Sidebar page={page} setPage={setPage} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} alertCount={STATIC_ALERTS.length + (totals.monthlyCostINR > settings.threshold ? 1 : 0)} profile={profile} />

        <div className="flex-1 min-w-0 flex flex-col">
          <MobileTopBar setMobileOpen={setMobileOpen} />
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto overflow-x-hidden">
            {pages[page]}
          </main>
        </div>

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    </SettingsCtx.Provider>
  );
}
