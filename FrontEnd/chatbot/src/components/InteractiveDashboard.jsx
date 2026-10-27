import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Maximize2,
  Minimize2,
  X,
  BarChart2,
  Table as TableIcon,
  MapPin,
  SlidersHorizontal,
  FileSpreadsheet,
  Download,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileText,
  Presentation,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import PptxGenJS from "pptxgenjs";

/* ─── Fix Leaflet default marker icons (bundler breaks asset paths) ─── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/* ─── Chart color palette — refined enterprise analytics with green accent ─── */
const COLORS = [
  "#10B981", // Vibrant Emerald Green (accent)
  "#3B82F6", // Primary Electric Blue
  "#F59E0B", // Warm Amber
  "#6366F1", // Slate Indigo
  "#06B6D4", // Cyan
  "#F43F5E", // Rose
  "#84CC16", // Lime
  "#8B5CF6", // Violet
];

/* ─── Helpers for KPI and Label Formatting ─── */
export function formatKpiDisplay(val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "object") {
    const inner =
      val.value ??
      val.val ??
      val.amount ??
      val.total ??
      val.count ??
      val.score ??
      Object.values(val)[0];
    return formatKpiDisplay(inner);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("{'") && trimmed.endsWith("}"))
    ) {
      try {
        const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
        return formatKpiDisplay(parsed);
      } catch {
        /* ignore */
      }
    }
    return trimmed;
  }
  return String(val);
}

export function formatCellLabel(val, key = "") {
  if (val === null || val === undefined) return "—";
  const str = String(val);
  if (str.length >= 20 && !str.includes(" ") && /^[a-fA-F0-9-]+$/.test(str)) {
    const prefix = key.replace(/_id$/i, "").replace(/id$/i, "") || "Item";
    const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    return `${cap} #${str.slice(0, 8)}…`;
  }
  return str;
}

/* ─── Normalizer for Backward & Forward Compatibility ─── */
function normalizeDashboardSpec(spec) {
  if (!spec) return null;

  const normalizePage = (p, idx) => {
    const rawCharts = Array.isArray(p.charts) ? p.charts : [];
    const pageSliders = Array.isArray(p.sliders) ? [...p.sliders] : [];

    // Auto-promote any legacy chart with type: "slider" into a standalone slider
    const normalizedCharts = rawCharts.map((c, cIdx) => {
      const cId = c.id || `chart-${idx + 1}-${cIdx + 1}`;
      if (c.type === "slider") {
        const sliderId = `slider_${cId}`;
        if (!pageSliders.some((s) => s.id === sliderId)) {
          pageSliders.push({
            id: sliderId,
            label: `${c.title || "Metric"} Slider`,
            description: c.description || "Interactive threshold filter",
            filterKey: c.filterKey || c.dataKeys?.[0]?.key || "value",
            sliderMin: c.sliderMin ?? 0,
            sliderMax: c.sliderMax ?? 100,
            sliderStep: c.sliderStep ?? 1,
            defaultValue: c.sliderMin ?? 0,
            sliderUnit: c.sliderUnit || "",
            targetScope: "chart",
            targetChartIds: [cId],
            operator: ">=",
          });
        }
        return {
          ...c,
          id: cId,
          type: "bar", // Render as standard bar chart driven by the standalone slider
        };
      }
      return { ...c, id: cId };
    });

    return {
      id: p.id || `page-${idx + 1}`,
      name: p.name || `Page ${idx + 1}`,
      summary: p.summary || p.description || "",
      insights: Array.isArray(p.insights) ? p.insights : [],
      kpis: (Array.isArray(p.kpis) ? p.kpis : []).map((k) => ({
        ...k,
        value: formatKpiDisplay(k?.value),
      })),
      charts: normalizedCharts,
      sliders: pageSliders,
    };
  };

  const globalSliders = Array.isArray(spec.global_sliders)
    ? spec.global_sliders
    : Array.isArray(spec.sliders)
    ? spec.sliders
    : [];

  if (Array.isArray(spec.pages) && spec.pages.length > 0) {
    return {
      title: spec.title || "Business Intelligence Report",
      subtitle: spec.subtitle || spec.description || "",
      global_sliders: globalSliders,
      pages: spec.pages.map((p, idx) => normalizePage(p, idx)),
    };
  }

  const legacyCharts = Array.isArray(spec.charts) ? spec.charts : [];
  const legacyKpis = Array.isArray(spec.kpis) ? spec.kpis : [];
  const legacyInsights = Array.isArray(spec.insights) ? spec.insights : [];

  if (legacyCharts.length > 0 || legacyKpis.length > 0) {
    return {
      title: spec.title || "Analytical Summary",
      subtitle: spec.description || "",
      global_sliders: globalSliders,
      pages: [
        normalizePage(
          {
            id: "page-1",
            name: spec.title || "Overview",
            summary: spec.description || "",
            insights: legacyInsights,
            kpis: legacyKpis,
            charts: legacyCharts,
            sliders: spec.sliders,
          },
          0
        ),
      ],
    };
  }

  return null;
}

/* ─── Tooltip ─── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg bg-[#141822]/95 backdrop-blur-md border border-[#2B3547] px-3 py-2 shadow-xl text-[11px] min-w-[140px]">
      {label && (
        <p className="font-semibold text-[#F1F3F5] mb-1.5 pb-1 border-b border-[#222734]">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const val =
            typeof entry.value === "number"
              ? entry.value.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })
              : entry.value;
          return (
            <div key={idx} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      entry.color || entry.fill || COLORS[idx % COLORS.length],
                  }}
                />
                <span className="text-[#94A3B8]">{entry.name}</span>
              </div>
              <span className="font-mono font-bold text-[#FFFFFF]">
                {val}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Shared axis/grid props ─── */
const GRID_PROPS = {
  stroke: "#1F2533",
  strokeDasharray: "3 3",
  vertical: false,
};
const X_AXIS_PROPS = {
  stroke: "#262D3D",
  tick: { fill: "#94A3B8", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "#242C3C" },
  tickMargin: 8,
  tickFormatter: (v) => formatCellLabel(v),
};
const Y_AXIS_PROPS = {
  stroke: "#262D3D",
  tick: { fill: "#94A3B8", fontSize: 11 },
  tickLine: false,
  axisLine: false,
  width: 48,
  tickFormatter: (v) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
      ? `${(v / 1_000).toFixed(0)}k`
      : v,
};
const LEGEND_PROPS = {
  wrapperStyle: { fontSize: "11.5px", paddingTop: "12px", color: "#94A3B8" },
  iconType: "circle",
  iconSize: 7,
};
const MARGIN = { top: 12, right: 18, left: -6, bottom: 6 };

/* ─── Geographic Coordinate Resolution (Brazilian States/Cities, US, Global) ─── */
const BRAZIL_STATES_GEO = {
  SP: [-23.5505, -46.6333], RJ: [-22.9068, -43.1729], MG: [-18.5122, -44.5550],
  RS: [-30.0346, -51.2177], PR: [-25.2521, -52.0215], SC: [-27.2423, -50.2189],
  BA: [-12.5797, -41.7007], DF: [-15.7998, -47.8645], GO: [-15.8270, -49.8362],
  ES: [-19.1834, -40.3089], PE: [-8.8137, -36.9541],  CE: [-5.4984, -39.3206],
  PA: [-1.9981, -54.9306],  MT: [-12.6800, -56.9200], MA: [-5.4200, -45.4400],
  MS: [-20.7722, -54.7852], PB: [-7.2400, -36.7800],  RN: [-5.7945, -36.5654],
  PI: [-7.7183, -42.7289],  AL: [-9.5713, -36.7820],  SE: [-10.5741, -37.3857],
  TO: [-10.1753, -48.2982], RO: [-11.5057, -63.5806], AM: [-3.4168, -65.8561],
  AC: [-9.0238, -70.8120],  AP: [0.9020, -52.0030],   RR: [2.7376, -62.0751],
};

const BRAZIL_CITIES_GEO = {
  "sao paulo": [-23.5505, -46.6333], "rio de janeiro": [-22.9068, -43.1729],
  "belo horizonte": [-19.9167, -43.9345], "brasilia": [-15.7975, -47.8919],
  "salvador": [-12.9714, -38.5014], "curitiba": [-25.4284, -49.2733],
  "fortaleza": [-3.7319, -38.5267], "recife": [-8.0476, -34.8770],
  "porto alegre": [-30.0346, -51.2177], "manaus": [-3.1190, -60.0217],
  "belem": [-1.4558, -48.4902], "goiania": [-16.6869, -49.2648],
  "guarulhos": [-23.4542, -46.5333], "campinas": [-22.9099, -47.0626],
  "sao luis": [-2.5307, -44.3068], "maceio": [-9.6658, -35.7350],
  "duque de caxias": [-22.7858, -43.3117], "natal": [-5.7945, -35.2110],
  "campo grande": [-20.4697, -54.6201], "teresina": [-5.0892, -42.8016],
  "joao pessoa": [-7.1153, -34.8610], "florianopolis": [-27.5954, -48.5480],
  "santos": [-23.9608, -46.3336], "niteroi": [-22.8832, -43.1034],
  "joinville": [-26.3044, -48.8464], "londrina": [-23.3045, -51.1696],
  "caxias do sul": [-29.1678, -51.1794], "juiz de fora": [-21.7642, -43.3503],
  "maringa": [-23.4205, -51.9333], "blumenau": [-26.9194, -49.0661],
  "piracicaba": [-22.7253, -47.6492], "bauru": [-22.3147, -49.0606],
  "jundiai": [-23.1857, -46.8978], "sao carlos": [-22.0175, -47.8908],
};

const COUNTRIES_GEO = {
  US: [37.0902, -95.7129], USA: [37.0902, -95.7129], "UNITED STATES": [37.0902, -95.7129],
  GB: [55.3781, -3.4360],  UK: [55.3781, -3.4360],  "UNITED KINGDOM": [55.3781, -3.4360],
  CA: [56.1304, -106.3468], CANADA: [56.1304, -106.3468],
  DE: [51.1657, 10.4515],  GERMANY: [51.1657, 10.4515],
  FR: [46.2276, 2.2137],   FRANCE: [46.2276, 2.2137],
  BR: [-14.2350, -51.9253], BRAZIL: [-14.2350, -51.9253], BRASIL: [-14.2350, -51.9253],
  JP: [36.2048, 138.2529], JAPAN: [36.2048, 138.2529],
  CN: [35.8617, 104.1954], CHINA: [35.8617, 104.1954],
  IN: [20.5937, 78.9629],  INDIA: [20.5937, 78.9629],
  AU: [-25.2744, 133.7751], AUSTRALIA: [-25.2744, 133.7751],
  MX: [23.6345, -102.5528], MEXICO: [23.6345, -102.5528],
  ES: [40.4637, -3.7492],  SPAIN: [40.4637, -3.7492],
  IT: [41.8719, 12.5674],  ITALY: [41.8719, 12.5674],
  NL: [52.1326, 5.2913],   NETHERLANDS: [52.1326, 5.2913],
  SE: [60.1282, 18.6435],  SWEDEN: [60.1282, 18.6435],
  CH: [46.8182, 8.2275],   SWITZERLAND: [46.8182, 8.2275],
  BE: [50.5039, 4.4699],   BELGIUM: [50.5039, 4.4699],
  AT: [47.5162, 14.5501],  AUSTRIA: [47.5162, 14.5501],
  PL: [51.9194, 19.1451],  POLAND: [51.9194, 19.1451],
  NO: [60.4720, 8.4689],   NORWAY: [60.4720, 8.4689],
  DK: [56.2639, 9.5018],   DENMARK: [56.2639, 9.5018],
  FI: [61.9241, 25.7482],  FINLAND: [61.9241, 25.7482],
  IE: [53.1424, -7.6921],  IRELAND: [53.1424, -7.6921],
  PT: [39.3999, -8.2245],  PORTUGAL: [39.3999, -8.2245],
  GR: [39.0742, 21.8243],  GREECE: [39.0742, 21.8243],
  TR: [38.9637, 35.2433],  TURKEY: [38.9637, 35.2433],
  SA: [23.8859, 45.0792],  "SAUDI ARABIA": [23.8859, 45.0792],
  AE: [23.4241, 53.8478],  UAE: [23.4241, 53.8478],
  EG: [26.8206, 30.8025],  EGYPT: [26.8206, 30.8025],
  ZA: [-30.5595, 22.9375], "SOUTH AFRICA": [-30.5595, 22.9375],
  SG: [1.3521, 103.8198],  SINGAPORE: [1.3521, 103.8198],
  KR: [35.9078, 127.7669], "SOUTH KOREA": [35.9078, 127.7669],
  NZ: [-40.9006, 174.8860], "NEW ZEALAND": [-40.9006, 174.8860],
  AR: [-38.4161, -63.6167], ARGENTINA: [-38.4161, -63.6167],
  CL: [-35.6751, -71.5430], CHILE: [-35.6751, -71.5430],
  CO: [4.5709, -74.2973],  COLOMBIA: [4.5709, -74.2973],
};

const US_STATES_GEO = {
  AL: [32.8066, -86.7911], AK: [61.3707, -152.4044], AZ: [33.7297, -111.4312], AR: [34.9697, -92.3731],
  CA: [36.1162, -119.6815], CO: [39.0598, -105.3111], CT: [41.5977, -72.7553], DE: [39.3185, -75.5071],
  FL: [27.7662, -81.6867], GA: [33.0406, -83.6430], HI: [21.0943, -157.4983], ID: [44.2404, -114.4788],
  IL: [40.3494, -88.9861], IN: [39.8494, -86.2582], IA: [42.0115, -93.2105], KS: [38.5266, -96.7264],
  KY: [37.6681, -84.6700], LA: [31.1695, -91.8678], ME: [44.6939, -69.3819], MD: [39.0639, -76.8021],
  MA: [42.2301, -71.5301], MI: [43.3266, -84.5360], MN: [45.6944, -93.9001], MS: [32.7416, -89.6786],
  MO: [38.4560, -92.2883], MT: [46.9219, -110.4543], NE: [41.1253, -98.2680], NV: [38.3135, -117.0553],
  NH: [43.4524, -71.5638], NJ: [40.2989, -74.5210], NM: [34.8405, -106.2484], NY: [42.1657, -74.9480],
  NC: [35.6300, -79.8064], ND: [47.5289, -99.7840], OH: [40.3887, -82.7649], OK: [35.5653, -96.9289],
  OR: [44.5720, -122.0709], PA: [40.5907, -77.2097], RI: [41.6808, -71.5117], SC: [33.8568, -80.9450],
  SD: [44.2997, -99.4388], TN: [35.7478, -86.6923], TX: [31.0544, -97.5634], UT: [40.1500, -111.8624],
  VT: [44.0458, -72.7106], VA: [37.7693, -78.1699], WA: [47.4009, -121.4904], WV: [38.4912, -80.9544],
  WI: [44.2685, -89.6165], WY: [42.7559, -107.3024],
  CALIFORNIA: [36.1162, -119.6815], TEXAS: [31.0544, -97.5634], FLORIDA: [27.7662, -81.6867],
  "NEW YORK": [42.1657, -74.9480], ILLINOIS: [40.3494, -88.9861], PENNSYLVANIA: [40.5907, -77.2097],
  OHIO: [40.3887, -82.7649], GEORGIA: [33.0406, -83.6430], "NORTH CAROLINA": [35.6300, -79.8064],
  MICHIGAN: [43.3266, -84.5360], "NEW JERSEY": [40.2989, -74.5210], VIRGINIA: [37.7693, -78.1699],
  WASHINGTON: [47.4009, -121.4904], ARIZONA: [33.7297, -111.4312], MASSACHUSETTS: [42.2301, -71.5301],
};

const GLOBAL_CITIES_GEO = {
  // Global Metros
  london: [51.5074, -0.1278], paris: [48.8566, 2.3522], berlin: [52.5200, 13.4050],
  rome: [41.9028, 12.4964], madrid: [40.4168, -3.7038], amsterdam: [52.3676, 4.9041],
  tokyo: [35.6762, 139.6503], seoul: [37.5665, 126.9780], beijing: [39.9042, 116.4074],
  shanghai: [31.2304, 121.4737], "hong kong": [22.3193, 114.1694], singapore: [1.3521, 103.8198],
  sydney: [-33.8688, 151.2093], melbourne: [-37.8136, 144.9631], toronto: [43.6532, -79.3832],
  vancouver: [49.2827, -123.1207], "mexico city": [19.4326, -99.1332], "buenos aires": [-34.6037, -58.3816],
  dubai: [25.2048, 55.2708], "abu dhabi": [24.4539, 54.3773], riyadh: [24.7136, 46.6753],
  cairo: [30.0444, 31.2357], istanbul: [41.0082, 28.9784], mumbai: [19.0760, 72.8777],
  delhi: [28.6139, 77.2090], bangkok: [13.7563, 100.5018],
  // US Major Cities
  "new york": [40.7128, -74.0060], "los angeles": [34.0522, -118.2437], chicago: [41.8781, -87.6298],
  houston: [29.7604, -95.3698], "san francisco": [37.7749, -122.4194], seattle: [47.6062, -122.3321],
  miami: [25.7617, -80.1918], boston: [42.3601, -71.0589], atlanta: [33.7490, -84.3880],
  dallas: [32.7767, -96.7970], austin: [30.2672, -97.7431], denver: [39.7392, -104.9903],
};

function normalizeGeoStr(str) {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function lookupGeoCoordinates(val) {
  if (!val) return null;
  const raw = String(val).trim();
  const upper = raw.toUpperCase();

  // 1. Countries (ISO code or country name)
  if (COUNTRIES_GEO[upper]) return COUNTRIES_GEO[upper];

  // 2. Brazilian States (Olist)
  if (BRAZIL_STATES_GEO[upper]) return BRAZIL_STATES_GEO[upper];

  // 3. US States
  if (US_STATES_GEO[upper]) return US_STATES_GEO[upper];

  // 4. Global Cities
  const norm = normalizeGeoStr(raw);
  if (GLOBAL_CITIES_GEO[norm]) return GLOBAL_CITIES_GEO[norm];

  // 5. Brazilian Cities
  if (BRAZIL_CITIES_GEO[norm]) return BRAZIL_CITIES_GEO[norm];

  // 6. Fuzzy City Match
  for (const [cityName, coords] of Object.entries(GLOBAL_CITIES_GEO)) {
    if (norm.includes(cityName) || cityName.includes(norm)) return coords;
  }
  for (const [cityName, coords] of Object.entries(BRAZIL_CITIES_GEO)) {
    if (norm.includes(cityName) || cityName.includes(norm)) return coords;
  }

  // 7. Fuzzy Country Match
  for (const [countryName, coords] of Object.entries(COUNTRIES_GEO)) {
    const cNorm = normalizeGeoStr(countryName);
    if (cNorm.length > 3 && (norm.includes(cNorm) || cNorm.includes(norm))) {
      return coords;
    }
  }

  return null;
}

function resolveRowCoordinates(row, labelKey, latKey, lngKey) {
  // 1. Direct explicit coordinates
  if (latKey && lngKey && row[latKey] !== undefined && row[lngKey] !== undefined) {
    const lat = parseFloat(row[latKey]);
    const lng = parseFloat(row[lngKey]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lat, lng];
    }
  }

  // 2. Try candidate location keys
  const candidates = [
    labelKey,
    "customer_state",
    "seller_state",
    "state",
    "uf",
    "customer_city",
    "seller_city",
    "city",
    "cidade",
    "estado",
    "location",
    "country",
  ];

  for (const k of candidates) {
    const val = row[k];
    if (val !== undefined && val !== null) {
      const coords = lookupGeoCoordinates(val);
      if (coords) return coords;
    }
  }

  // 3. Fallback scan string values in row
  for (const v of Object.values(row)) {
    if (typeof v === "string" && v.length <= 40) {
      const coords = lookupGeoCoordinates(v);
      if (coords) return coords;
    }
  }

  return null;
}

/* ─── Map Controller (auto-fit & resize) ─── */
function MapController({ markers }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (markers.length > 0) {
        const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [25, 25], maxZoom: 8 });
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [map, markers]);

  return null;
}

/* ─── Map Chart Component ─── */
function MapChart({ chart, height = 260 }) {
  const [tileStyle, setTileStyle] = useState("dark");
  const cartoApiKey = import.meta.env?.VITE_CARTO_API_KEY;

  const latKey = chart.latKey || "lat";
  const lngKey = chart.lngKey || "lng";
  const labelKey = chart.markerLabel || chart.xAxisKey || "name";
  const valKey = chart.valueKey || chart.dataKeys?.[0]?.key;
  const data = Array.isArray(chart.data) ? chart.data : [];

  const markers = useMemo(() => {
    return data
      .map((row, idx) => {
        const coords = resolveRowCoordinates(row, labelKey, latKey, lngKey);
        if (!coords) return null;
        const displayLabel = row[labelKey] || row.customer_state || row.customer_city || `Location ${idx + 1}`;
        return {
          lat: coords[0],
          lng: coords[1],
          label: displayLabel,
          value: valKey ? row[valKey] : chart.dataKeys?.[0]?.key ? row[chart.dataKeys[0].key] : undefined,
          row,
          idx,
        };
      })
      .filter(Boolean);
  }, [data, latKey, lngKey, labelKey, valKey, chart.dataKeys]);

  if (markers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[12px] text-[#64748B] gap-1 px-4 text-center">
        <MapPin size={22} className="text-[#3A4559] mb-1" />
        <span className="text-[#94A3B8]">No geographic coordinates or recognized locations found</span>
        <span className="text-[10px] text-[#64748B]">Supported: Brazilian states (SP, RJ, MG...), major cities, and coordinate pairs</span>
      </div>
    );
  }

  const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
  const avgLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;

  return (
    <div style={{ height: `${height}px` }} className="w-full rounded-lg overflow-hidden relative border border-[#202734]">
      {/* Floating Basemap Style Switcher (all 100% free, no API key required) */}
      <div className="absolute top-2.5 right-2.5 z-[1000] flex items-center bg-[#131720]/90 backdrop-blur-md border border-[#242C3C] rounded-md p-0.5 shadow-lg pointer-events-auto">
        <button
          type="button"
          onClick={() => setTileStyle("dark")}
          className={`px-2 py-0.5 text-[10px] rounded transition-all font-medium ${
            tileStyle === "dark"
              ? "bg-[#242C3C] text-white shadow-xs"
              : "text-[#8C93A0] hover:text-[#F1F3F5]"
          }`}
          title="Dark Canvas (Free, No API key)"
        >
          Dark
        </button>
        <button
          type="button"
          onClick={() => setTileStyle("streets")}
          className={`px-2 py-0.5 text-[10px] rounded transition-all font-medium ${
            tileStyle === "streets"
              ? "bg-[#242C3C] text-white shadow-xs"
              : "text-[#8C93A0] hover:text-[#F1F3F5]"
          }`}
          title="OpenStreetMap Streets (Free, No API key)"
        >
          Streets
        </button>
        <button
          type="button"
          onClick={() => setTileStyle("satellite")}
          className={`px-2 py-0.5 text-[10px] rounded transition-all font-medium ${
            tileStyle === "satellite"
              ? "bg-[#242C3C] text-white shadow-xs"
              : "text-[#8C93A0] hover:text-[#F1F3F5]"
          }`}
          title="Satellite Imagery (Free, No API key)"
        >
          Satellite
        </button>
      </div>

      <MapContainer
        center={[avgLat, avgLng]}
        zoom={4}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", borderRadius: "6px" }}
      >
        <MapController markers={markers} />

        {/* Tile Layers: Zero-key defaults with optional CARTO fallback */}
        {tileStyle === "dark" && (
          cartoApiKey ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${cartoApiKey}`}
            />
          ) : (
            <>
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                maxZoom={16}
              />
              <TileLayer
                attribution='&copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
                maxZoom={16}
              />
            </>
          )
        )}

        {tileStyle === "streets" && (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        )}

        {tileStyle === "satellite" && (
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        )}

        {markers.map((m) => (
          <Marker key={m.idx} position={[m.lat, m.lng]}>
            <Popup>
              <div className="text-[12px] min-w-[140px] py-0.5">
                <div className="font-semibold text-white text-[12.5px] border-b border-[#2B3547] pb-1 mb-1">
                  {m.label}
                </div>
                {chart.dataKeys?.map((dk) => {
                  const rawVal = m.row[dk.key];
                  if (rawVal === undefined || rawVal === null) return null;
                  return (
                    <div key={dk.key} className="flex items-center justify-between gap-2 text-[11px] text-[#94A3B8] mt-0.5">
                      <span>{dk.name || dk.key}:</span>
                      <strong className="text-white font-mono font-semibold">
                        {typeof rawVal === "number" ? rawVal.toLocaleString() : rawVal}
                      </strong>
                    </div>
                  );
                })}
                {(!chart.dataKeys || chart.dataKeys.length === 0) && m.value !== undefined && (
                  <div className="text-[11px] text-[#94A3B8]">
                    Value: <b className="text-white font-mono font-semibold">{typeof m.value === "number" ? m.value.toLocaleString() : m.value}</b>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

/* ─── Chart Filter Helper (Driven by Sliders) ─── */
function getFilteredChart(chart, activeSliders, sliderValues) {
  if (!chart || !Array.isArray(chart.data)) return chart;
  const rawData = chart.data;

  // Find which sliders apply to this chart
  const applicableSliders = (activeSliders || []).filter((slider) => {
    // 1. Chart-specific scope
    if (slider.targetScope === "chart") {
      const targetIds = Array.isArray(slider.targetChartIds) ? slider.targetChartIds : [];
      return targetIds.includes(chart.id) || (targetIds.length === 0 && slider.targetChartId === chart.id);
    }
    // 2. Explicit targetChartIds override even on page/all scope
    if (Array.isArray(slider.targetChartIds) && slider.targetChartIds.length > 0) {
      return slider.targetChartIds.includes(chart.id);
    }
    // 3. Page or All scope: applies if chart rows contain the filterKey
    const fKey = slider.filterKey;
    if (!fKey) return false;
    return rawData.some((row) => row && row[fKey] !== undefined && row[fKey] !== null);
  });

  if (applicableSliders.length === 0) {
    return { ...chart, isFiltered: false, activeFilterText: null };
  }

  let filtered = [...rawData];
  const filterDescriptions = [];

  for (const s of applicableSliders) {
    const rawVal = sliderValues[s.id];
    const currentVal = rawVal !== undefined ? rawVal : (s.defaultValue !== undefined ? s.defaultValue : s.sliderMin);
    const key = s.filterKey;
    const op = s.operator || ">=";

    filtered = filtered.filter((row) => {
      if (!row || row[key] === undefined || row[key] === null) return true;
      const v = parseFloat(row[key]);
      if (isNaN(v)) return true;
      switch (op) {
        case ">=": return v >= currentVal;
        case "<=": return v <= currentVal;
        case ">": return v > currentVal;
        case "<": return v < currentVal;
        case "==": return v === currentVal;
        default: return v >= currentVal;
      }
    });

    filterDescriptions.push(
      `${s.label || key} ${op} ${currentVal.toLocaleString()}${s.sliderUnit ? ` ${s.sliderUnit}` : ""}`
    );
  }

  return {
    ...chart,
    data: filtered,
    originalCount: rawData.length,
    filteredCount: filtered.length,
    isFiltered: filtered.length !== rawData.length,
    activeFilterText: filterDescriptions.join(", "),
  };
}

/* ─── Standalone Dashboard Slider Control ─── */
function DashboardSliderControl({ slider, value, onChange, onReset, affectedChartsCount }) {
  const currentVal = value !== undefined ? value : (slider.defaultValue !== undefined ? slider.defaultValue : slider.sliderMin);
  const min = slider.sliderMin ?? 0;
  const max = slider.sliderMax ?? 100;
  const step = slider.sliderStep ?? Math.max(1, Math.round((max - min) / 50));
  const unit = slider.sliderUnit || "";
  const op = slider.operator || ">=";
  const pct = max > min ? Math.min(100, Math.max(0, ((currentVal - min) / (max - min)) * 100)) : 0;

  // Scope badge info
  const scopeBadge = useMemo(() => {
    if (slider.targetScope === "all") {
      return {
        label: "Entire Dashboard",
        cls: "text-[#A78BFA] bg-[#8B5CF6]/10 border-[#8B5CF6]/25",
        tooltip: "Filters matching data across all pages and charts in the dashboard",
      };
    }
    if (slider.targetScope === "chart") {
      const count = slider.targetChartIds?.length || 1;
      return {
        label: count === 1 ? "1 Chart" : `${count} Charts`,
        cls: "text-[#34D399] bg-[#10B981]/10 border-[#10B981]/25",
        tooltip: "Filters only specific targeted chart(s)",
      };
    }
    return {
      label: "Current Page",
      cls: "text-[#60A5FA] bg-[#3B82F6]/10 border-[#3B82F6]/25",
      tooltip: "Filters all matching charts on this page",
    };
  }, [slider.targetScope, slider.targetChartIds]);

  const isModified = value !== undefined && value !== (slider.defaultValue ?? slider.sliderMin);

  return (
    <div className="bg-[#151921] border border-[#222734] rounded-lg p-2.5 px-3 transition-all hover:border-[#2C3547]">
      {/* Header: Label, Scope Badge & Readout */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="flex items-center gap-1.5 text-[#E2E8F0] font-medium text-[12.5px] truncate">
            <SlidersHorizontal size={12} className="text-[#3B82F6] shrink-0" />
            <span className="truncate">{slider.label}</span>
          </div>
          <span
            className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${scopeBadge.cls}`}
            title={scopeBadge.tooltip}
          >
            {scopeBadge.label}
          </span>
        </div>

        {/* Value readout + Reset button */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <span className="font-mono font-semibold text-[12.5px] text-[#38BDF8]">
              {op} {currentVal.toLocaleString()}{unit && ` ${unit}`}
            </span>
          </div>
          {isModified && (
            <button
              type="button"
              onClick={() => onReset(slider.id)}
              className="text-[9.5px] text-[#94A3B8] hover:text-white px-1.5 py-0.5 rounded bg-[#1C2230] border border-[#283244] hover:bg-[#252E40] transition-colors cursor-pointer flex items-center gap-1"
              title="Reset slider to initial value"
            >
              <RotateCcw size={9} />
              Reset
            </button>
          )}
        </div>
      </div>

      {slider.description && (
        <p className="text-[11.5px] text-[#94A3B8] mb-2 leading-normal">
          {slider.description}
        </p>
      )}

      {/* Slider Track */}
      <div className="relative pt-0.5 pb-0.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentVal}
          onChange={(e) => onChange(slider.id, parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #10B981 0%, #10B981 ${pct}%, #1F2533 ${pct}%, #1F2533 100%)`,
          }}
        />
        <div className="flex justify-between items-center text-[9.5px] text-[#64748B] font-mono mt-1">
          <span>{min.toLocaleString()}{unit && ` ${unit}`}</span>
          {affectedChartsCount !== undefined && affectedChartsCount > 0 && (
            <span className="text-[#10B981] font-sans font-medium text-[10px]">
              Active on {affectedChartsCount} {affectedChartsCount === 1 ? "chart" : "charts"}
            </span>
          )}
          <span>{max.toLocaleString()}{unit && ` ${unit}`}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Slider Chart (Legacy Fallback) ─── */
function SliderChart({ chart, height = 290 }) {
  const filterKey = chart.filterKey || chart.dataKeys?.[0]?.key || "value";
  const xKey = chart.xAxisKey || "name";
  const allData = useMemo(() => (Array.isArray(chart.data) ? chart.data : []), [chart.data]);

  const numericValues = useMemo(
    () => allData.map((r) => parseFloat(r[filterKey])).filter((v) => !isNaN(v)),
    [allData, filterKey]
  );
  const dataMin = chart.sliderMin ?? (numericValues.length ? Math.min(...numericValues) : 0);
  const dataMax = chart.sliderMax ?? (numericValues.length ? Math.max(...numericValues) : 100);
  const step = chart.sliderStep ?? Math.max(1, Math.round((dataMax - dataMin) / 50));
  const unit = chart.sliderUnit || "";

  const [sliderValue, setSliderValue] = useState(dataMin);

  const filtered = useMemo(
    () => allData.filter((r) => parseFloat(r[filterKey]) >= sliderValue),
    [allData, filterKey, sliderValue]
  );

  const dataKeys =
    Array.isArray(chart.dataKeys) && chart.dataKeys.length > 0
      ? chart.dataKeys
      : [{ key: filterKey, name: filterKey.replace(/_/g, " "), color: COLORS[0] }];

  const pct = dataMax > dataMin ? ((sliderValue - dataMin) / (dataMax - dataMin)) * 100 : 0;

  return (
    <div className="flex flex-col gap-2.5" style={{ height: `${height}px` }}>
      {/* Slider control */}
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#8C93A0] flex items-center gap-1.5">
            <SlidersHorizontal size={11} className="text-[#10B981]" />
            Threshold: <span className="text-[#34D399] font-mono font-semibold">{sliderValue.toLocaleString()}{unit && ` ${unit}`}</span>
          </span>
          <span className="text-[#64748B] font-mono text-[10px]">
            {filtered.length}/{allData.length} items
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={dataMin}
            max={dataMax}
            step={step}
            value={sliderValue}
            onChange={(e) => setSliderValue(parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #10B981 0%, #10B981 ${pct}%, #1F2533 ${pct}%, #1F2533 100%)`,
            }}
          />
          <div className="flex justify-between text-[9.5px] text-[#64748B] mt-0.5 font-mono">
            <span>{dataMin.toLocaleString()}{unit && ` ${unit}`}</span>
            <span>{dataMax.toLocaleString()}{unit && ` ${unit}`}</span>
          </div>
        </div>
      </div>

      {/* Filtered bar chart */}
      <div className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-[#64748B]">
            No items match this threshold
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filtered} margin={MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey={xKey} {...X_AXIS_PROPS} />
              <YAxis {...Y_AXIS_PROPS} />
              <Tooltip content={<ChartTooltip />} />
              <Legend {...LEGEND_PROPS} />
              {dataKeys.map((dk, i) => (
                <Bar
                  key={dk.key}
                  dataKey={dk.key}
                  name={dk.name || dk.key}
                  fill={dk.color || COLORS[i % COLORS.length]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ─── Chart Card ─── */
function ChartCard({ chart, onExpand, expanded = false }) {
  const rawType = (chart.type || "bar").toLowerCase();
  const type = rawType === "distribution" ? "donut" : rawType;
  const [view, setView] = useState(type === "table" ? "table" : "chart");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc"); // "asc" | "desc"
  const rawData = Array.isArray(chart.data) ? chart.data : [];

  // Available column keys in the raw data
  const availableKeys = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    return Object.keys(rawData[0] || {});
  }, [rawData]);

  // Identify numeric vs text columns
  const { numericKeys, textKeys } = useMemo(() => {
    const nums = [];
    const texts = [];
    availableKeys.forEach((k) => {
      const sample = rawData.find((r) => r && r[k] !== null && r[k] !== undefined);
      if (!sample) return;
      const val = sample[k];
      if (typeof val === "number") {
        nums.push(k);
      } else if (
        typeof val === "string" &&
        val.trim() !== "" &&
        /^[\$€£¥]?\s*[\d,]+\.?\d*\s*%?$/.test(val.trim())
      ) {
        nums.push(k);
      } else {
        texts.push(k);
      }
    });
    return { numericKeys: nums, textKeys: texts };
  }, [availableKeys, rawData]);

  // Auto-resolve xKey (categorical dimension / label column)
  const xKey = useMemo(() => {
    const rawX = chart.xAxisKey;
    if (rawX && availableKeys.includes(rawX)) {
      // If rawX is a number and dataKey is a string, they were swapped
      const rawDataKey = chart.dataKeys?.[0]?.key;
      if (numericKeys.includes(rawX) && rawDataKey && textKeys.includes(rawDataKey)) {
        return rawDataKey;
      }
      return rawX;
    }
    if (rawX) {
      const fuzzy = availableKeys.find(
        (k) =>
          k.toLowerCase() === rawX.toLowerCase() ||
          k.toLowerCase().replace(/s$/, "") === rawX.toLowerCase().replace(/s$/, "")
      );
      if (fuzzy) return fuzzy;
    }
    if (textKeys.length > 0) return textKeys[0];
    return availableKeys[0] || "name";
  }, [chart.xAxisKey, chart.dataKeys, availableKeys, numericKeys, textKeys]);

  // Auto-resolve dataKeys (metric columns)
  const dataKeys = useMemo(() => {
    const rawDks =
      Array.isArray(chart.dataKeys) && chart.dataKeys.length > 0 ? chart.dataKeys : [];
    const valid = [];

    rawDks.forEach((dk, i) => {
      let k = dk.key;
      if (k === xKey && numericKeys.includes(chart.xAxisKey)) {
        k = chart.xAxisKey;
      }
      if (availableKeys.includes(k)) {
        valid.push({
          key: k,
          name: dk.name || k.replace(/_/g, " "),
          color: dk.color || COLORS[i % COLORS.length],
        });
        return;
      }
      const fuzzy = availableKeys.find(
        (ak) =>
          ak.toLowerCase() === k.toLowerCase() ||
          ak.toLowerCase().replace(/s$/, "") === k.toLowerCase().replace(/s$/, "")
      );
      if (fuzzy) {
        valid.push({
          key: fuzzy,
          name: dk.name || fuzzy.replace(/_/g, " "),
          color: dk.color || COLORS[i % COLORS.length],
        });
      }
    });

    if (valid.length > 0) return valid;

    const cand = numericKeys.filter((k) => k !== xKey);
    if (cand.length > 0) {
      return cand.map((k, i) => ({
        key: k,
        name: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        color: COLORS[i % COLORS.length],
      }));
    }

    const fallback = availableKeys.find((k) => k !== xKey) || "value";
    return [{ key: fallback, name: chart.metricName || "Value", color: COLORS[0] }];
  }, [chart.dataKeys, chart.xAxisKey, chart.metricName, xKey, availableKeys, numericKeys]);

  // Sanitize data: cast string-formatted numbers into genuine floats
  const data = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    const metricKeys = dataKeys.map((dk) => dk.key);

    return rawData.map((row) => {
      const copy = { ...row };
      if (copy[xKey] === undefined || copy[xKey] === null) {
        copy[xKey] = "—";
      } else {
        copy[xKey] = String(copy[xKey]);
      }
      metricKeys.forEach((mk) => {
        const val = copy[mk];
        if (typeof val === "number") {
          copy[mk] = isNaN(val) ? 0 : val;
        } else if (typeof val === "string") {
          const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
          copy[mk] = isNaN(num) ? 0 : num;
        } else {
          copy[mk] = 0;
        }
      });
      return copy;
    });
  }, [rawData, xKey, dataKeys]);

  // Clean data specifically for Pie / Donut
  const cleanPieData = useMemo(() => {
    if (type !== "pie" && type !== "donut") return data;
    const mKey = dataKeys[0]?.key;
    if (!mKey) return data;

    return data
      .filter((r) => r && r[mKey] > 0)
      .map((r) => ({
        ...r,
        name: formatCellLabel(r[xKey], xKey),
        value: r[mKey],
      }));
  }, [data, type, dataKeys, xKey]);

  const fullTableColumns =
    type === "table" && data.length > 0 ? Object.keys(data[0]) : null;

  const columns = useMemo(() => {
    if (fullTableColumns && fullTableColumns.length > 0) return fullTableColumns;
    if (data.length > 0) return Object.keys(data[0]);
    return [xKey, ...dataKeys.map((dk) => dk.key)];
  }, [fullTableColumns, data, xKey, dataKeys]);

  const colNameMap = useMemo(() => {
    const map = {};
    if (Array.isArray(chart.dataKeys)) {
      chart.dataKeys.forEach((dk) => {
        if (dk.key) map[dk.key] = dk.name || dk.key;
      });
    }
    return map;
  }, [chart.dataKeys]);

  const formatHeader = (col) => {
    if (colNameMap[col]) return colNameMap[col];
    if (col === xKey && chart.xAxisLabel) return chart.xAxisLabel;
    return col
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const isColNumeric = useMemo(() => {
    const map = {};
    columns.forEach((col) => {
      const sample = data.find((r) => r && r[col] !== null && r[col] !== undefined);
      if (!sample) {
        map[col] = false;
        return;
      }
      const val = sample[col];
      if (typeof val === "number") {
        map[col] = true;
      } else if (typeof val === "string") {
        map[col] = /^[\$€£¥]?\s*[\d,]+\.?\d*\s*%?$/.test(val.trim());
      } else {
        map[col] = false;
      }
    });
    return map;
  }, [columns, data]);

  const handleSort = (col) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedData = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb), undefined, { numeric: true })
        : String(vb).localeCompare(String(va), undefined, { numeric: true });
    });
  }, [data, sortCol, sortDir]);

  const renderCellContent = (val, col) => {
    if (val === null || val === undefined) {
      return <span className="text-[#64748B] italic">—</span>;
    }
    if (typeof val === "boolean") {
      return (
        <span
          className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold ${
            val
              ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/25"
              : "bg-[#EF4444]/15 text-[#F87171] border border-[#EF4444]/25"
          }`}
        >
          {val ? "Yes" : "No"}
        </span>
      );
    }
    if (typeof val === "number") {
      return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return formatCellLabel(val, col);
  };

  const h = expanded ? 420 : (type === "map" ? 310 : 290);

  return (
    <div className={`group flex flex-col ${view === "table" ? "h-auto" : "h-full justify-between"}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5 gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-[14px] font-semibold text-[#F8FAFC] tracking-tight leading-snug">
              {chart.title}
            </h4>
            {type === "table" && (
              <span className="text-[9.5px] font-mono text-[#34D399] bg-[#10B981]/10 border border-[#10B981]/25 px-1.5 py-0.5 rounded font-medium">
                Table
              </span>
            )}
            {chart.isFiltered && (
              <span
                className="text-[9.5px] font-mono text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/20 px-1.5 py-0.5 rounded font-medium"
                title={chart.activeFilterText || "Filtered by interactive slider"}
              >
                Filtered ({chart.filteredCount})
              </span>
            )}
          </div>
          {chart.description && (
            <p className="text-[12px] text-[#94A3B8] mt-1 leading-normal">
              {chart.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {type !== "table" && (
            <button
              onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              className={`p-1.5 rounded-md transition-colors ${
                view === "table"
                  ? "bg-[#1E2534] text-[#10B981]"
                  : "text-[#8C93A0] hover:text-[#F1F3F5] hover:bg-[#1E2534]/50"
              }`}
              title={view === "chart" ? "View data table" : "View chart"}
            >
              {view === "chart" ? (
                <TableIcon size={14} />
              ) : (
                <BarChart2 size={14} />
              )}
            </button>
          )}
          {onExpand && (
            <button
              onClick={() => onExpand(chart)}
              className="p-1.5 rounded-md text-[#8C93A0] hover:text-[#F1F3F5] hover:bg-[#1E2534]/50 transition-colors"
              title="Expand chart"
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {view === "table" ? (
        /* ── Data Table (Styled matching RAG Markdown Table) ── */
        <div className="w-full mt-2">
          {data.length === 0 ? (
            <div className="py-12 flex items-center justify-center text-[12px] text-[#64748B] rounded-lg border border-[#272B35] bg-[#10131B]">
              No data available
            </div>
          ) : (
            <div className="w-full rounded-lg border border-[#272B35] bg-[#10131B] shadow-sm overflow-hidden flex flex-col">
              <div
                className={`w-full overflow-auto ${
                  expanded ? "max-h-[620px]" : "max-h-[460px]"
                } scrollbar-thin scrollbar-thumb-[#272B35] scrollbar-track-transparent`}
              >
                <table className="w-full min-w-[500px] text-[13px] border-collapse text-left">
                  <thead className="bg-[#161922] sticky top-0 z-10 border-b border-[#272B35] text-[11.5px] uppercase font-semibold tracking-wider text-[#9CA3AF]">
                    <tr>
                      <th className="px-3.5 py-3 font-semibold text-[#6B7280] text-center w-12 select-none">
                        #
                      </th>
                      {columns.map((col) => {
                        const isNum = isColNumeric[col];
                        const isSorted = sortCol === col;
                        return (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            className={`px-4 py-3 font-semibold whitespace-nowrap text-[#9CA3AF] cursor-pointer hover:text-[#F3F4F6] hover:bg-[#1E2534]/60 select-none transition-colors group/th ${
                              isNum ? "text-right" : "text-left"
                            }`}
                            title="Click to sort"
                          >
                            <div
                              className={`inline-flex items-center gap-1.5 ${
                                isNum ? "flex-row-reverse" : "flex-row"
                              }`}
                            >
                              <span>{formatHeader(col)}</span>
                              {isSorted ? (
                                sortDir === "asc" ? (
                                  <ArrowUp size={12} className="text-[#10B981] shrink-0" />
                                ) : (
                                  <ArrowDown size={12} className="text-[#10B981] shrink-0" />
                                )
                              ) : (
                                <ArrowUpDown
                                  size={11}
                                  className="text-[#64748B] opacity-0 group-hover/th:opacity-75 transition-opacity shrink-0"
                                />
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2230] text-[#D1D5DB]">
                    {sortedData.map((row, ri) => (
                      <tr key={ri} className="hover:bg-[#1A1E29]/70 transition-colors">
                        <td className="px-3.5 py-2.5 text-center font-mono text-[11px] text-[#6B7280] select-none">
                          {ri + 1}
                        </td>
                        {columns.map((col) => {
                          const isNum = isColNumeric[col];
                          const val = row[col];
                          return (
                            <td
                              key={col}
                              className={`px-4 py-2.5 whitespace-nowrap ${
                                isNum
                                  ? "text-right tabular-nums font-mono text-[12.5px] text-[#F3F4F6]"
                                  : "text-left text-[#D1D5DB]"
                              }`}
                              title={val !== null && val !== undefined ? String(val) : ""}
                            >
                              {renderCellContent(val, col)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Footer status bar */}
              <div className="flex items-center justify-between px-4 py-2 text-[11px] text-[#8C93A0] font-mono border-t border-[#1E2230] bg-[#141822]">
                <span>{sortedData.length} records</span>
                <div className="flex items-center gap-3">
                  {sortedData.length > 8 && (
                    <span className="text-[10.5px] text-[#64748B]">Scroll to view all</span>
                  )}
                  {sortCol && (
                    <button
                      type="button"
                      onClick={() => {
                        setSortCol(null);
                        setSortDir("asc");
                      }}
                      className="text-[#10B981] hover:underline cursor-pointer transition-colors"
                    >
                      Reset sort ({formatHeader(sortCol)} {sortDir.toUpperCase()})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Standard Chart Canvas ── */
        <div style={{ height: `${h}px` }} className="w-full mt-1">
          {data.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-[#64748B]">
              No data available
            </div>
          ) : type === "table" ? (
            <div className="h-full flex items-center justify-center text-[12px] text-[#64748B]">
              Table view
            </div>
          ) : type === "line" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey={xKey} {...X_AXIS_PROPS} />
              <YAxis {...Y_AXIS_PROPS} />
              <Tooltip content={<ChartTooltip />} />
              <Legend {...LEGEND_PROPS} />
              {dataKeys.map((dk, i) => (
                <Line
                  key={dk.key}
                  type="monotone"
                  dataKey={dk.key}
                  name={dk.name || dk.key}
                  stroke={dk.color || COLORS[i % COLORS.length]}
                  strokeWidth={2.2}
                  dot={{ fill: dk.color || COLORS[i % COLORS.length], r: 2.5, strokeWidth: 0 }}
                  activeDot={{ r: 4.5, stroke: "#151921", strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : type === "area" ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={MARGIN}>
              <defs>
                {dataKeys.map((dk, i) => {
                  const c = dk.color || COLORS[i % COLORS.length];
                  return (
                    <linearGradient
                      key={`g_${dk.key}`}
                      id={`g_${dk.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={c} stopOpacity={0.24} />
                      <stop offset="95%" stopColor={c} stopOpacity={0.01} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey={xKey} {...X_AXIS_PROPS} />
              <YAxis {...Y_AXIS_PROPS} />
              <Tooltip content={<ChartTooltip />} />
              <Legend {...LEGEND_PROPS} />
              {dataKeys.map((dk, i) => {
                const c = dk.color || COLORS[i % COLORS.length];
                return (
                  <Area
                    key={dk.key}
                    type="monotone"
                    dataKey={dk.key}
                    name={dk.name || dk.key}
                    stroke={c}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill={`url(#g_${dk.key})`}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        ) : type === "pie" || type === "donut" ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
            <PieChart>
              <Tooltip content={<ChartTooltip />} />
              <Legend {...LEGEND_PROPS} />
              <Pie
                data={cleanPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="44%"
                innerRadius={type === "donut" ? "48%" : 0}
                outerRadius="75%"
                paddingAngle={2}
                stroke="#151921"
                strokeWidth={2}
              >
                {cleanPieData.map((_, index) => (
                  <Cell
                    key={`c-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : type === "map" ? (
          <MapChart chart={chart} height={h} />
        ) : type === "slider" ? (
          <SliderChart chart={chart} height={h} />
        ) : (
          /* Default: Bar */
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey={xKey} {...X_AXIS_PROPS} />
              <YAxis {...Y_AXIS_PROPS} />
              <Tooltip content={<ChartTooltip />} />
              <Legend {...LEGEND_PROPS} />
              {dataKeys.map((dk, i) => (
                <Bar
                  key={dk.key}
                  dataKey={dk.key}
                  name={dk.name || dk.key}
                  fill={dk.color || COLORS[i % COLORS.length]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    )}
  </div>
);
}

/* ─── Chart Expand Modal ─── */
function ChartModal({ chart, onClose }) {
  if (!chart) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#10131B] border border-[#222734] rounded-xl p-5 sm:p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg bg-[#161B24] border border-[#222734] text-[#8C93A0] hover:text-white hover:bg-[#1E2534] transition-all cursor-pointer"
          title="Close (Esc)"
        >
          <X size={15} />
        </button>
        <h3 className="text-[15px] font-semibold text-[#F1F3F5] mb-1">
          {chart.title}
        </h3>
        {chart.description && (
          <p className="text-[12px] text-[#8C93A0] mb-4">{chart.description}</p>
        )}
        <div className="w-full">
          <ChartCard chart={chart} expanded />
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── CSV Export ─── */
function exportPageToCsv(page, reportTitle) {
  if (!page || !Array.isArray(page.charts) || page.charts.length === 0) return;

  let csv = "";
  csv += `Report,${JSON.stringify(reportTitle || "Report")}\r\n`;
  csv += `Page,${JSON.stringify(page.name || "Overview")}\r\n\r\n`;

  page.charts.forEach((chart, idx) => {
    csv += `--- ${chart.title || `Chart ${idx + 1}`} ---\r\n`;
    const xKey = chart.xAxisKey || "name";
    const dks =
      Array.isArray(chart.dataKeys) && chart.dataKeys.length > 0
        ? chart.dataKeys
        : [{ key: "value", name: "Value" }];

    const headers = [xKey, ...dks.map((dk) => dk.name || dk.key)];
    csv += headers.map((h) => JSON.stringify(h)).join(",") + "\r\n";

    (Array.isArray(chart.data) ? chart.data : []).forEach((row) => {
      const line = [
        row[xKey],
        ...dks.map((dk) => (row[dk.key] !== undefined ? row[dk.key] : "")),
      ];
      csv +=
        line
          .map((v) => JSON.stringify(v !== undefined ? v : ""))
          .join(",") + "\r\n";
    });
    csv += "\r\n";
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (page.name || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
  a.download = `${safeName}_data.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─── XLSX Export (Power BI–compatible) ─── */
function exportPageToXlsx(page, reportTitle) {
  if (!page || !Array.isArray(page.charts) || page.charts.length === 0) return;

  const wb = XLSX.utils.book_new();

  /* Sheet for KPIs if present */
  if (Array.isArray(page.kpis) && page.kpis.length > 0) {
    const kpiRows = page.kpis.map((k) => ({
      Metric: k.label,
      Value: k.value,
      Change: k.change || "",
      Description: k.description || "",
    }));
    const kpiWs = XLSX.utils.json_to_sheet(kpiRows);
    XLSX.utils.book_append_sheet(wb, kpiWs, "KPIs");
  }

  /* One sheet per chart */
  const usedNames = new Set();
  page.charts.forEach((chart, idx) => {
    const xKey = chart.xAxisKey || "name";
    const dks =
      Array.isArray(chart.dataKeys) && chart.dataKeys.length > 0
        ? chart.dataKeys
        : [{ key: "value", name: "Value" }];

    const rows = (Array.isArray(chart.data) ? chart.data : []).map((row) => {
      const obj = {};
      obj[xKey] = row[xKey] ?? "";
      dks.forEach((dk) => {
        obj[dk.name || dk.key] = row[dk.key] ?? "";
      });
      /* Include map-specific columns if present */
      if (chart.latKey && row[chart.latKey] !== undefined) obj["Latitude"] = row[chart.latKey];
      if (chart.lngKey && row[chart.lngKey] !== undefined) obj["Longitude"] = row[chart.lngKey];
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    /* Generate a safe, unique sheet name (max 31 chars for Excel) */
    let sheetName = (chart.title || `Chart ${idx + 1}`)
      .replace(/[\\\/*?:\[\]]/g, "")
      .slice(0, 28);
    let suffix = 1;
    while (usedNames.has(sheetName)) {
      sheetName = sheetName.slice(0, 25) + ` (${suffix++})`;
    }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  /* Download */
  const safeName = (page.name || reportTitle || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
  XLSX.writeFile(wb, `${safeName}_data.xlsx`);
}

function exportReportToXlsx(report, activePage) {
  if (!report) return;

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();
  const isMultiPage = Array.isArray(report.pages) && report.pages.length > 1;
  const page = activePage || report.pages?.[0] || { charts: [] };
  const charts = Array.isArray(page.charts) ? page.charts : [];
  const kpis = Array.isArray(page.kpis) ? page.kpis : [];
  const insights = Array.isArray(page.insights) ? page.insights : [];

  /* ════════════════════════════════════════════════════════════════
     1. FRONT SHEET: EXECUTIVE SUMMARY & DIRECTORY (Recommended layout)
     ════════════════════════════════════════════════════════════════ */
  const overviewRows = [
    ["EXECUTIVE BI DASHBOARD REPORT", ""],
    ["Report Title", report.title || "Business Intelligence Dashboard"],
    ["Subtitle / Scope", report.subtitle || page.summary || "Executive Overview"],
    ["Active View / Tab", page.name || "Overview"],
    ["Export Date", new Date().toLocaleString()],
    ["Pages Available", (report.pages || []).map((p) => p.name).join(" | ") || "Single Page"],
    [],
  ];

  // Key Strategic Findings
  if (insights.length > 0) {
    overviewRows.push(["KEY STRATEGIC FINDINGS & BRIEFING", ""]);
    insights.forEach((ins, idx) => {
      overviewRows.push([`Takeaway ${idx + 1}`, ins]);
    });
    overviewRows.push([]);
  }

  // KPIs Summary Table
  if (kpis.length > 0) {
    overviewRows.push(["KEY PERFORMANCE INDICATORS (KPIs)", "", "", ""]);
    overviewRows.push(["Metric Label", "Primary Value", "Trajectory / Change", "Target / Context"]);
    kpis.forEach((k) => {
      overviewRows.push([
        k.label || "KPI",
        typeof k.value === "number" ? k.value : String(k.value ?? "—"),
        k.change || "—",
        k.description || "—",
      ]);
    });
    overviewRows.push([]);
  }

  // Dashboard Data Sheets Directory
  if (charts.length > 0) {
    overviewRows.push(["DASHBOARD VISUALIZATION & DATA DIRECTORY", "", "", "", ""]);
    overviewRows.push(["#", "Visualization Title", "Type", "Primary Dimension", "Data Tab Name"]);
    charts.forEach((c, idx) => {
      const cleanTitle = (c.title || `Chart ${idx + 1}`).replace(/[\\\/*?:\[\]]/g, "");
      const tabName = `Data - ${cleanTitle}`.slice(0, 31);
      overviewRows.push([
        idx + 1,
        c.title || `Chart ${idx + 1}`,
        (c.type || "bar").toUpperCase(),
        c.xAxisKey || "Category / Date",
        `'${tabName}'`,
      ]);
    });
  }

  const overviewWs = XLSX.utils.aoa_to_sheet(overviewRows);
  overviewWs["!cols"] = [
    { wch: 32 },
    { wch: 60 },
    { wch: 22 },
    { wch: 35 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, overviewWs, "Executive Summary");
  usedNames.add("Executive Summary");

  /* ════════════════════════════════════════════════════════════════
     2. DEDICATED DATA SHEETS FOR EVERY CHART & TABLE
     ════════════════════════════════════════════════════════════════ */
  const allPages = isMultiPage ? report.pages : [page];

  allPages.forEach((p, pIdx) => {
    const pagePrefix = isMultiPage ? `P${pIdx + 1} ` : "";
    const pCharts = p.id === activePage?.id ? charts : (Array.isArray(p.charts) ? p.charts : []);

    pCharts.forEach((chart, cIdx) => {
      const xKey = chart.xAxisKey || "name";
      const dks = Array.isArray(chart.dataKeys) && chart.dataKeys.length > 0
        ? chart.dataKeys
        : [{ key: "value", name: chart.metricName || "Value" }];

      const isTable = (chart.type || "").toLowerCase() === "table";
      const fullCols = isTable && chart.data?.length > 0 ? Object.keys(chart.data[0]) : null;

      const rows = (Array.isArray(chart.data) ? chart.data : []).map((row) => {
        const obj = {};
        if (fullCols) {
          fullCols.forEach((col) => {
            const cleanCol = col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            obj[cleanCol] = row[col] ?? "";
          });
        } else {
          obj[chart.xAxisLabel || xKey] = row[xKey] ?? "";
          dks.forEach((dk) => {
            obj[dk.name || dk.key] = row[dk.key] ?? "";
          });
          if (chart.type === "map") {
            const coords = resolveRowCoordinates(row, chart.markerLabel || xKey, chart.latKey, chart.lngKey);
            if (coords) {
              obj["Latitude"] = coords[0];
              obj["Longitude"] = coords[1];
            }
          }
        }
        return obj;
      });

      if (rows.length === 0) return;

      const ws = XLSX.utils.json_to_sheet(rows);

      // Auto-compute column widths to prevent ### truncation
      const colKeys = Object.keys(rows[0] || {});
      ws["!cols"] = colKeys.map((k) => {
        const maxLen = Math.max(
          k.length,
          ...rows.slice(0, 40).map((r) => String(r[k] ?? "").length)
        );
        return { wch: Math.min(Math.max(maxLen + 3, 12), 48) };
      });

      const cleanTitle = (chart.title || `Chart ${cIdx + 1}`).replace(/[\\\/*?:\[\]]/g, "");
      let sheetName = `${pagePrefix}Data - ${cleanTitle}`.slice(0, 31);
      let suffix = 1;
      while (usedNames.has(sheetName)) {
        sheetName = `${pagePrefix}Data - ${cleanTitle}`.slice(0, 26) + ` (${suffix++})`;
      }
      usedNames.add(sheetName);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  });

  const safeName = (report.title || page.name || "bi_report")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
  XLSX.writeFile(wb, `${safeName}_report.xlsx`);
}

/* ════════════════════════════════════════════════════════════════
   Shared html2canvas capture utility for PDF & PPTX exports.
   Uses the correct (clonedDoc, clonedElement) signature.
   ════════════════════════════════════════════════════════════════ */
async function captureElementToCanvas(el) {
  // Hide interactive buttons and tooltips for a clean capture
  const buttons = el.querySelectorAll("button");
  const tooltips = el.querySelectorAll(".recharts-tooltip-wrapper");
  buttons.forEach((btn) => { btn.dataset._origDisplay = btn.style.display; btn.style.display = "none"; });
  tooltips.forEach((tip) => { tip.dataset._origDisplay = tip.style.display; tip.style.display = "none"; });

  // Expand scrollable tables
  const scrollables = el.querySelectorAll(".overflow-auto, .overflow-y-auto, [class*='max-h-']");
  scrollables.forEach((s) => {
    s.dataset._origMaxH = s.style.maxHeight;
    s.dataset._origOverflow = s.style.overflow;
    s.style.maxHeight = "none";
    s.style.overflow = "visible";
  });

  const canvas = await html2canvas(el, {
    backgroundColor: "#0F1218",
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    // Correct html2canvas v1.x signature: (clonedDocument, clonedElement)
    onclone: (_clonedDoc, clonedEl) => {
      // Sync SVG dimensions from the live DOM into the clone
      const origSvgs = el.querySelectorAll("svg");
      const clonedSvgs = clonedEl.querySelectorAll("svg");
      origSvgs.forEach((orig, i) => {
        const cloned = clonedSvgs[i];
        if (cloned) {
          const rect = orig.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            cloned.setAttribute("width", String(w));
            cloned.setAttribute("height", String(h));
            cloned.style.width = `${w}px`;
            cloned.style.height = `${h}px`;
            if (!cloned.getAttribute("viewBox")) {
              cloned.setAttribute("viewBox", `0 0 ${w} ${h}`);
            }
          }
        }
      });
      // Sync Recharts wrapper dimensions
      const origWrappers = el.querySelectorAll(".recharts-wrapper, .recharts-responsive-container");
      const clonedWrappers = clonedEl.querySelectorAll(".recharts-wrapper, .recharts-responsive-container");
      origWrappers.forEach((orig, i) => {
        const cloned = clonedWrappers[i];
        if (cloned) {
          const rect = orig.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            cloned.style.width = `${Math.round(rect.width)}px`;
            cloned.style.height = `${Math.round(rect.height)}px`;
            cloned.style.minHeight = `${Math.round(rect.height)}px`;
          }
        }
      });
      // Sync canvas elements (Leaflet map tiles)
      const origCanvases = el.querySelectorAll("canvas");
      const clonedCanvases = clonedEl.querySelectorAll("canvas");
      origCanvases.forEach((orig, i) => {
        const cloned = clonedCanvases[i];
        if (cloned && orig.width && orig.height) {
          cloned.width = orig.width;
          cloned.height = orig.height;
          try { cloned.getContext("2d")?.drawImage(orig, 0, 0); } catch { /* cross-origin */ }
        }
      });
    },
  });

  // Restore original styles
  buttons.forEach((btn) => { btn.style.display = btn.dataset._origDisplay || ""; delete btn.dataset._origDisplay; });
  tooltips.forEach((tip) => { tip.style.display = tip.dataset._origDisplay || ""; delete tip.dataset._origDisplay; });
  scrollables.forEach((s) => {
    s.style.maxHeight = s.dataset._origMaxH || "";
    s.style.overflow = s.dataset._origOverflow || "";
    delete s.dataset._origMaxH;
    delete s.dataset._origOverflow;
  });

  return canvas;
}

/* ════════════════════════════════════════════════════════════════
   High-Fidelity PDF Export — html2canvas + jsPDF
   Captures ALL dashboard pages with chart data, properly scaled
   so each dashboard page fits exactly one PDF page (A4 landscape).
   ════════════════════════════════════════════════════════════════ */
async function exportReportToPdf(report, dashboardElement, currentPageIdx, setPageIdx, onProgress) {
  if (!report || !dashboardElement) return;

  const reportTitle = report.title || "Business Intelligence Report";
  const pages = report.pages || [];
  if (pages.length === 0) return;

  const origPageIdx = currentPageIdx;

  // A4 landscape in points: 841.89 x 595.28
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableW = pdfW - margin * 2;
  const usableH = pdfH - margin * 2 - 32;

  function addPageChrome(pageIdx, pageName, totalPages) {
    pdf.setFontSize(8);
    pdf.setTextColor(16, 185, 129);
    pdf.text("KADASH BI \u2022 EXECUTIVE REPORT", margin, margin - 6);
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(7.5);
    const headerRight = `${pageName}  \u2022  ${new Date().toLocaleDateString()}  \u2022  Confidential`;
    const rightW = pdf.getTextWidth(headerRight);
    pdf.text(headerRight, pdfW - margin - rightW, margin - 6);
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Generated by Kadash Enterprise Agent", margin, pdfH - 10);
    const footerRight = `Page ${pageIdx + 1} of ${totalPages}  \u2022  ${reportTitle}`;
    const footerRW = pdf.getTextWidth(footerRight);
    pdf.text(footerRight, pdfW - margin - footerRW, pdfH - 10);
  }

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    if (pIdx > 0) pdf.addPage();

    const pageName = pages[pIdx]?.name || `Page ${pIdx + 1}`;
    onProgress?.(`Capturing page ${pIdx + 1} of ${pages.length}: ${pageName}...`);

    // Switch to this page and wait for charts to render
    if (pages.length > 1) {
      setPageIdx(pIdx);
      await new Promise((r) => setTimeout(r, 900));
    }

    try {
      const canvas = await captureElementToCanvas(dashboardElement);
      const imgData = canvas.toDataURL("image/png");
      const imgW = canvas.width;
      const imgH = canvas.height;

      const scaleX = usableW / imgW;
      const scaleY = usableH / imgH;
      const scale = Math.min(scaleX, scaleY);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const offsetX = margin + (usableW - drawW) / 2;
      const offsetY = margin + 12 + (usableH - drawH) / 2;

      pdf.setFillColor(15, 18, 24);
      pdf.rect(0, 0, pdfW, pdfH, "F");
      pdf.addImage(imgData, "PNG", offsetX, offsetY, drawW, drawH);
      addPageChrome(pIdx, pageName, pages.length);
    } catch (err) {
      console.warn(`PDF capture failed for page ${pIdx}:`, err);
      pdf.setFillColor(15, 18, 24);
      pdf.rect(0, 0, pdfW, pdfH, "F");
      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(14);
      pdf.text(`Page "${pageName}" could not be captured`, pdfW / 2, pdfH / 2, { align: "center" });
      addPageChrome(pIdx, pageName, pages.length);
    }
  }

  // Restore original page
  if (pages.length > 1) setPageIdx(origPageIdx);

  onProgress?.("Saving PDF...");
  const safeName = (reportTitle || "bi_report").toLowerCase().replace(/[^a-z0-9]/g, "_");
  pdf.save(`${safeName}_report.pdf`);
}

/* ════════════════════════════════════════════════════════════════
   PowerPoint Export — pptxgenjs
   Captures ALL dashboard pages as high-res slides with charts.
   ════════════════════════════════════════════════════════════════ */
async function exportReportToPptx(report, dashboardElement, currentPageIdx, setPageIdx, onProgress) {
  if (!report || !dashboardElement) return;

  const reportTitle = report.title || "Business Intelligence Report";
  const reportSubtitle = report.subtitle || "Executive Analytics Briefing";
  const pages = report.pages || [];
  if (pages.length === 0) return;

  const origPageIdx = currentPageIdx;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "CUSTOM", width: 13.33, height: 7.5 });
  pptx.layout = "CUSTOM";
  pptx.author = "Kadash BI Agent";
  pptx.company = "Kadash";
  pptx.subject = reportTitle;
  pptx.title = reportTitle;

  // ── Title Slide ──
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "0F1218" };
  titleSlide.addText(reportTitle, {
    x: 0.8, y: 2.2, w: 11.7, h: 1.3,
    fontSize: 36, fontFace: "Segoe UI", bold: true,
    color: "F8FAFC", align: "center",
  });
  titleSlide.addText(reportSubtitle, {
    x: 1.5, y: 3.5, w: 10.3, h: 0.8,
    fontSize: 16, fontFace: "Segoe UI",
    color: "94A3B8", align: "center",
  });
  titleSlide.addText("Kadash BI \u2022 Executive Report", {
    x: 0.8, y: 5.5, w: 4, h: 0.4,
    fontSize: 10, fontFace: "Segoe UI Semibold",
    color: "10B981",
  });
  titleSlide.addText(new Date().toLocaleDateString(), {
    x: 8.5, y: 5.5, w: 4, h: 0.4,
    fontSize: 10, fontFace: "Segoe UI",
    color: "64748B", align: "right",
  });

  // ── Content Slides: one per page ──
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageName = pages[pIdx]?.name || `Page ${pIdx + 1}`;
    onProgress?.(`Capturing page ${pIdx + 1} of ${pages.length}: ${pageName}...`);

    if (pages.length > 1) {
      setPageIdx(pIdx);
      await new Promise((r) => setTimeout(r, 900));
    }

    try {
      const canvas = await captureElementToCanvas(dashboardElement);
      const imgBase64 = canvas.toDataURL("image/png");

      const slide = pptx.addSlide();
      slide.background = { color: "0F1218" };

      const slideW = 13.33;
      const slideH = 7.5;
      const maxImgW = slideW - 0.6;
      const maxImgH = slideH - 0.9;
      const aspectRatio = canvas.width / canvas.height;

      let drawW = maxImgW;
      let drawH = drawW / aspectRatio;
      if (drawH > maxImgH) {
        drawH = maxImgH;
        drawW = drawH * aspectRatio;
      }

      const offsetX = (slideW - drawW) / 2;
      const offsetY = 0.5 + (maxImgH - drawH) / 2;

      slide.addImage({ data: imgBase64, x: offsetX, y: offsetY, w: drawW, h: drawH });

      slide.addText(pageName, {
        x: 0.3, y: 0.08, w: 6, h: 0.35,
        fontSize: 11, fontFace: "Segoe UI Semibold", color: "94A3B8",
      });
      slide.addText(`Page ${pIdx + 1} of ${pages.length}  \u2022  ${reportTitle}`, {
        x: 7, y: slideH - 0.35, w: 6, h: 0.3,
        fontSize: 8, fontFace: "Segoe UI", color: "64748B", align: "right",
      });
    } catch (err) {
      console.warn(`PPTX capture failed for page ${pIdx}:`, err);
      const slide = pptx.addSlide();
      slide.background = { color: "0F1218" };
      slide.addText(`Page "${pageName}" could not be captured`, {
        x: 2, y: 3, w: 9, h: 1.5,
        fontSize: 18, fontFace: "Segoe UI", color: "94A3B8", align: "center",
      });
    }
  }

  // Restore original page
  if (pages.length > 1) setPageIdx(origPageIdx);

  onProgress?.("Saving PowerPoint...");
  const safeName = (reportTitle || "bi_report").toLowerCase().replace(/[^a-z0-9]/g, "_");
  await pptx.writeFile({ fileName: `${safeName}_report.pptx` });
}

/* ════════════════════════════════════════════════════════════════
   Main Dashboard Component
   ════════════════════════════════════════════════════════════════ */
export default function InteractiveDashboard({ spec }) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [modalChart, setModalChart] = useState(null);
  const [sliderValues, setSliderValues] = useState({});
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const dashboardRef = useRef(null);

  /* Wrapped export handlers: show overlay, run export, hide overlay */
  const handleExportPdf = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportMessage("Preparing PDF export...");
    try {
      await new Promise((r) => setTimeout(r, 100)); // let overlay paint
      await exportReportToPdf(
        normalizeDashboardSpec(spec),
        dashboardRef.current,
        activePageIndex,
        setActivePageIndex,
        setExportMessage
      );
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setIsExporting(false);
      setExportMessage("");
    }
  }, [spec, activePageIndex, isExporting]);

  const handleExportPptx = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportMessage("Preparing PowerPoint export...");
    try {
      await new Promise((r) => setTimeout(r, 100)); // let overlay paint
      await exportReportToPptx(
        normalizeDashboardSpec(spec),
        dashboardRef.current,
        activePageIndex,
        setActivePageIndex,
        setExportMessage
      );
    } catch (err) {
      console.error("PPTX export error:", err);
    } finally {
      setIsExporting(false);
      setExportMessage("");
    }
  }, [spec, activePageIndex, isExporting]);

  const handleSliderChange = (sliderId, val) => {
    setSliderValues((prev) => ({
      ...prev,
      [sliderId]: val,
    }));
  };

  const handleSliderReset = (sliderId) => {
    setSliderValues((prev) => {
      const next = { ...prev };
      delete next[sliderId];
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (modalChart) setModalChart(null);
        else if (isFullscreen) setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalChart, isFullscreen]);

  /* Lock body scroll while expanded in fullscreen or modal */
  useEffect(() => {
    if (isFullscreen || modalChart) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isFullscreen, modalChart]);

  const report = normalizeDashboardSpec(spec);
  if (!report || report.pages.length === 0) return null;

  const pages = report.pages;
  const page = pages[activePageIndex] || pages[0];
  const kpis = page.kpis || [];
  const charts = page.charts || [];
  const insights = page.insights || [];

  const globalSliders = report.global_sliders || [];
  const pageSliders = page.sliders || [];

  /* Combined active sliders for current view */
  const activeSliders = useMemo(() => {
    const list = [];
    const seen = new Set();

    globalSliders.forEach((s) => {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        list.push({ ...s, targetScope: s.targetScope || "all" });
      }
    });

    pageSliders.forEach((s) => {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        list.push({ ...s, targetScope: s.targetScope || "page" });
      }
    });

    return list;
  }, [globalSliders, pageSliders]);

  /* Filter charts in real-time according to slider values */
  const filteredCharts = useMemo(() => {
    return charts.map((c) => getFilteredChart(c, activeSliders, sliderValues));
  }, [charts, activeSliders, sliderValues]);

  const gridCols =
    filteredCharts.length === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2";

  /* ─── Dashboard body (shared between inline and fullscreen) ─── */
  const body = (fs = false) => (
    <div ref={dashboardRef} className="space-y-4 kadash-bi-dashboard">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-4 border-b border-[#202734]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[18px] sm:text-[19px] font-bold text-[#F8FAFC] tracking-tight leading-snug">
              {report.title}
            </h3>
            <span className="text-[9.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[#10B981]/10 text-[#34D399] border border-[#10B981]/25">
              BI Dashboard
            </span>
          </div>
          {(page.summary || report.subtitle) && (
            <p className="text-[12.5px] text-[#94A3B8] mt-1 leading-relaxed max-w-4xl">
              {page.summary || report.subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
          <button
            onClick={() => exportPageToCsv({ ...page, charts: filteredCharts }, report.title)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-[#151921] hover:bg-[#1E2534] border border-[#222734] hover:border-[#2E374A] text-[#CBD5E1] hover:text-white transition-all shadow-xs cursor-pointer"
            title="Export active page data as CSV"
          >
            <Download size={13} className="text-[#94A3B8]" />
            <span>CSV</span>
          </button>
          <button
            onClick={() => exportReportToXlsx(report, { ...page, charts: filteredCharts })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-[#151921] hover:bg-[#1E2534] border border-[#222734] hover:border-[#2E374A] text-[#CBD5E1] hover:text-white transition-all shadow-xs cursor-pointer"
            title="Export full report to Excel (.xlsx) — Executive Summary + Data Tabs"
          >
            <FileSpreadsheet size={13} className="text-[#10B981]" />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-[#151921] hover:bg-[#1E2534] border border-[#222734] hover:border-[#2E374A] text-[#CBD5E1] hover:text-white transition-all shadow-xs cursor-pointer ${isExporting ? 'opacity-50 pointer-events-none' : ''}`}
            title="Export all pages as PDF report with charts, KPIs & layout"
          >
            <FileText size={13} className="text-[#EF4444]" />
            <span>PDF</span>
          </button>
          <button
            onClick={handleExportPptx}
            disabled={isExporting}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-[#151921] hover:bg-[#1E2534] border border-[#222734] hover:border-[#2E374A] text-[#CBD5E1] hover:text-white transition-all shadow-xs cursor-pointer ${isExporting ? 'opacity-50 pointer-events-none' : ''}`}
            title="Export all pages as PowerPoint presentation"
          >
            <Presentation size={13} className="text-[#F59E0B]" />
            <span>PPTX</span>
          </button>
          <button
            onClick={() => setIsFullscreen(!fs)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium bg-[#151921] hover:bg-[#1E2534] border border-[#222734] hover:border-[#2E374A] text-[#CBD5E1] hover:text-white transition-all shadow-xs cursor-pointer"
            title={fs ? "Exit fullscreen" : "Expand to fullscreen"}
          >
            {fs ? (
              <Minimize2 size={13} className="text-[#10B981]" />
            ) : (
              <Maximize2 size={13} className="text-[#10B981]" />
            )}
            <span>{fs ? "Close" : "Expand"}</span>
          </button>
        </div>
      </div>

      {/* ── Page tabs ── */}
      {pages.length > 1 && (
        <div className="flex items-center gap-6 border-b border-[#202734] overflow-x-auto">
          {pages.map((p, idx) => {
            const active = idx === activePageIndex;
            return (
              <button
                key={p.id || idx}
                onClick={() => setActivePageIndex(idx)}
                className={`pb-2.5 text-[12.5px] font-medium transition-all whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 cursor-pointer ${
                  active
                    ? "text-[#10B981] border-[#10B981] font-semibold"
                    : "text-[#8C93A0] border-transparent hover:text-[#CBD5E1]"
                }`}
              >
                <span>{p.name}</span>
                {Array.isArray(p.charts) && p.charts.length > 0 && (
                  <span
                    className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-mono ${
                      active
                        ? "bg-[#10B981]/15 text-[#34D399]"
                        : "bg-[#1E2534] text-[#64748B]"
                    }`}
                  >
                    {p.charts.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── KPIs Row ── */}
      {kpis.length > 0 && (
        <div
          className={`grid gap-3.5 ${
            kpis.length === 1
              ? "grid-cols-1 max-w-sm"
              : kpis.length === 2
              ? "grid-cols-1 sm:grid-cols-2"
              : kpis.length === 3
              ? "grid-cols-1 sm:grid-cols-3"
              : kpis.length === 4
              ? "grid-cols-2 lg:grid-cols-4"
              : kpis.length === 5
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
          }`}
        >
          {kpis.map((kpi, idx) => {
            const changeStr = typeof kpi.change === "string" ? kpi.change.trim() : "";
            const isPos = changeStr.startsWith("+");
            const isNeg = changeStr.startsWith("-");
            const isFifthOfFive = kpis.length === 5 && idx === 4;

            return (
              <div
                key={idx}
                className={`bg-[#151921] border border-[#222734] rounded-lg p-3.5 sm:p-4 hover:border-[#2C3547] transition-all shadow-xs flex flex-col justify-between ${
                  isFifthOfFive ? "col-span-2 sm:col-span-1 lg:col-span-1" : ""
                }`}
              >
                <div className="text-[11px] text-[#94A3B8] font-semibold uppercase tracking-wider truncate mb-1">
                  {kpi.label}
                </div>
                <div className="text-[22px] sm:text-[25px] font-bold text-[#FFFFFF] tracking-tight font-mono my-1 leading-tight">
                  {formatKpiDisplay(kpi.value)}
                </div>
                {changeStr ? (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10.5px] font-semibold border ${
                        isPos
                          ? "text-[#10B981] bg-[#10B981]/10 border-[#10B981]/25"
                          : isNeg
                          ? "text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/25"
                          : "text-[#94A3B8] bg-[#1E2534] border-[#2A3446]"
                      }`}
                    >
                      {isPos ? (
                        <ArrowUpRight size={11} />
                      ) : isNeg ? (
                        <ArrowDownRight size={11} />
                      ) : null}
                      <span>{changeStr}</span>
                    </span>
                    {kpi.description && (
                      <span className="text-[11px] text-[#94A3B8] leading-tight">
                        {kpi.description}
                      </span>
                    )}
                  </div>
                ) : (
                  kpi.description && (
                    <div className="text-[11px] text-[#94A3B8] leading-tight mt-0.5">
                      {kpi.description}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Key Insights Banner ── */}
      {insights.length > 0 && (
        <div className="bg-[#131720]/80 border border-[#202734] rounded-lg p-3.5 px-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">
            <Sparkles size={12} className="text-[#10B981]" />
            <span>Key Findings</span>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5 text-[12px] text-[#E2E8F0]">
            {insights.map((insight, idx) => (
              <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Standalone Sliders Section ── */}
      {activeSliders.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10.5px] text-[#8C93A0] font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal size={12} className="text-[#10B981]" />
              <span>Interactive Filters</span>
            </div>
            {Object.keys(sliderValues).length > 0 && (
              <button
                type="button"
                onClick={() => setSliderValues({})}
                className="text-[10.5px] text-[#10B981] hover:underline cursor-pointer font-medium"
              >
                Reset All Filters
              </button>
            )}
          </div>
          <div
            className={
              activeSliders.length === 1
                ? "grid grid-cols-1"
                : "grid grid-cols-1 md:grid-cols-2 gap-3"
            }
          >
            {activeSliders.map((slider) => {
              const affectedCount = filteredCharts.filter((c) => {
                if (slider.targetScope === "chart") {
                  const targetIds = slider.targetChartIds || [];
                  return targetIds.includes(c.id);
                }
                return c.data?.some((r) => r && r[slider.filterKey] !== undefined);
              }).length;

              return (
                <DashboardSliderControl
                  key={slider.id}
                  slider={slider}
                  value={sliderValues[slider.id]}
                  onChange={handleSliderChange}
                  onReset={handleSliderReset}
                  affectedChartsCount={affectedCount}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Charts Grid ── */}
      {filteredCharts.length > 0 && (
        <div className={`grid gap-4 ${gridCols}`}>
          {filteredCharts.map((chart, idx) => {
            const isTable = (chart.type || "").toLowerCase() === "table";
            return (
              <div
                key={chart.id || idx}
                id={`chart-card-${chart.id || idx}`}
                className={`bg-[#151921] border border-[#222734] rounded-lg p-4 sm:p-4.5 hover:border-[#2C3547] transition-all shadow-xs ${
                  isTable ? "col-span-full" : ""
                }`}
              >
                <ChartCard
                  chart={chart}
                  onExpand={setModalChart}
                  expanded={fs}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Inline dashboard (only rendered when NOT expanded to avoid duplicate map instances) */}
      {!isFullscreen ? (
        <div className="my-5 pt-5 border-t border-[#202734]">{body(false)}</div>
      ) : (
        <div className="my-5 pt-5 border-t border-[#202734]">
          <div className="p-4 rounded-lg border border-dashed border-[#222734] bg-[#151921]/50 text-center text-[12px] text-[#8C93A0]">
            Dashboard is open in expanded view
          </div>
        </div>
      )}

      {/* Fullscreen overlay portaled to document.body */}
      {isFullscreen &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-[#0D1017] overflow-y-auto animate-in fade-in duration-150">
            <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-6 sm:py-8 relative">
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] border border-[#222734] text-[#8C93A0] hover:text-white hover:bg-[#1E2534] transition-all shadow-md cursor-pointer text-[12px] font-medium"
                  title="Close (Esc)"
                >
                  <X size={15} />
                  <span>Exit Fullscreen</span>
                </button>
              </div>
              {body(true)}
            </div>
          </div>,
          document.body
        )}

      {/* Export progress overlay — hides page switching from the user */}
      {isExporting &&
        createPortal(
          <div className="fixed inset-0 z-[99999] flex items-center justify-center" style={{ backgroundColor: "rgba(13, 16, 23, 0.92)", backdropFilter: "blur(8px)" }}>
            <div className="flex flex-col items-center gap-4 p-8 rounded-xl" style={{ backgroundColor: "#151921", border: "1px solid #222734", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.6)" }}>
              {/* Spinning indicator */}
              <div className="relative">
                <div style={{ width: 48, height: 48, border: "3px solid #222734", borderTopColor: "#10B981", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-[#F8FAFC] mb-1">Exporting Report</p>
                <p className="text-[12px] text-[#94A3B8] max-w-[300px]">{exportMessage || "Processing..."}</p>
              </div>
              <p className="text-[10px] text-[#64748B]">Please wait, do not close the window</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>,
          document.body
        )}

      {/* Chart expand modal (handled via portal inside ChartModal) */}
      {modalChart && (
        <ChartModal chart={modalChart} onClose={() => setModalChart(null)} />
      )}
    </>
  );
}
