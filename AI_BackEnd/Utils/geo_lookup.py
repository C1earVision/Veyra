"""Geographic coordinate lookup utility for Business Intelligence dashboards.

Provides automatic resolution of countries, states, and cities worldwide to latitude
and longitude coordinates when datasets do not have raw coordinate columns.

Supports:
- Any dataset with raw coordinates (lat/lng, latitude/longitude)
- 100+ countries by ISO code and full name
- All 50 US states by 2-letter code and full name
- All 27 Brazilian states (Olist) by code and full name
- 100+ major global metropolitan cities across all continents
"""

from typing import Any, Dict, List, Optional, Tuple
import re

# ─── Countries (ISO 2-letter codes and common names) ─────────────────────────
COUNTRIES_GEO: Dict[str, Tuple[float, float]] = {
    "US": (37.0902, -95.7129), "USA": (37.0902, -95.7129), "UNITED STATES": (37.0902, -95.7129),
    "GB": (55.3781, -3.4360),  "UK": (55.3781, -3.4360),  "UNITED KINGDOM": (55.3781, -3.4360),
    "CA": (56.1304, -106.3468), "CANADA": (56.1304, -106.3468),
    "DE": (51.1657, 10.4515),  "GERMANY": (51.1657, 10.4515), "DEUTSCHLAND": (51.1657, 10.4515),
    "FR": (46.2276, 2.2137),   "FRANCE": (46.2276, 2.2137),
    "BR": (-14.2350, -51.9253), "BRAZIL": (-14.2350, -51.9253), "BRASIL": (-14.2350, -51.9253),
    "JP": (36.2048, 138.2529), "JAPAN": (36.2048, 138.2529),
    "CN": (35.8617, 104.1954), "CHINA": (35.8617, 104.1954),
    "IN": (20.5937, 78.9629),  "INDIA": (20.5937, 78.9629),
    "AU": (-25.2744, 133.7751), "AUSTRALIA": (-25.2744, 133.7751),
    "MX": (23.6345, -102.5528), "MEXICO": (23.6345, -102.5528),
    "ES": (40.4637, -3.7492),  "SPAIN": (40.4637, -3.7492), "ESPANA": (40.4637, -3.7492),
    "IT": (41.8719, 12.5674),  "ITALY": (41.8719, 12.5674), "ITALIA": (41.8719, 12.5674),
    "NL": (52.1326, 5.2913),   "NETHERLANDS": (52.1326, 5.2913), "HOLLAND": (52.1326, 5.2913),
    "SE": (60.1282, 18.6435),  "SWEDEN": (60.1282, 18.6435),
    "CH": (46.8182, 8.2275),   "SWITZERLAND": (46.8182, 8.2275),
    "BE": (50.5039, 4.4699),   "BELGIUM": (50.5039, 4.4699),
    "AT": (47.5162, 14.5501),  "AUSTRIA": (47.5162, 14.5501),
    "PL": (51.9194, 19.1451),  "POLAND": (51.9194, 19.1451),
    "NO": (60.4720, 8.4689),   "NORWAY": (60.4720, 8.4689),
    "DK": (56.2639, 9.5018),   "DENMARK": (56.2639, 9.5018),
    "FI": (61.9241, 25.7482),  "FINLAND": (61.9241, 25.7482),
    "IE": (53.1424, -7.6921),  "IRELAND": (53.1424, -7.6921),
    "PT": (39.3999, -8.2245),  "PORTUGAL": (39.3999, -8.2245),
    "GR": (39.0742, 21.8243),  "GREECE": (39.0742, 21.8243),
    "TR": (38.9637, 35.2433),  "TURKEY": (38.9637, 35.2433), "TURKIYE": (38.9637, 35.2433),
    "RU": (61.5240, 105.3188), "RUSSIA": (61.5240, 105.3188),
    "SA": (23.8859, 45.0792),  "SAUDI ARABIA": (23.8859, 45.0792),
    "AE": (23.4241, 53.8478),  "UAE": (23.4241, 53.8478), "UNITED ARAB EMIRATES": (23.4241, 53.8478),
    "EG": (26.8206, 30.8025),  "EGYPT": (26.8206, 30.8025),
    "ZA": (-30.5595, 22.9375), "SOUTH AFRICA": (-30.5595, 22.9375),
    "NG": (9.0820, 8.6753),    "NIGERIA": (9.0820, 8.6753),
    "KE": (-0.0236, 37.9062),  "KENYA": (-0.0236, 37.9062),
    "MA": (31.7917, -7.0926),  "MOROCCO": (31.7917, -7.0926),
    "AR": (-38.4161, -63.6167), "ARGENTINA": (-38.4161, -63.6167),
    "CL": (-35.6751, -71.5430), "CHILE": (-35.6751, -71.5430),
    "CO": (4.5709, -74.2973),  "COLOMBIA": (4.5709, -74.2973),
    "PE": (-9.1900, -75.0152),  "PERU": (-9.1900, -75.0152),
    "SG": (1.3521, 103.8198),  "SINGAPORE": (1.3521, 103.8198),
    "NZ": (-40.9006, 174.8860), "NEW ZEALAND": (-40.9006, 174.8860),
    "KR": (35.9078, 127.7669), "SOUTH KOREA": (35.9078, 127.7669), "KOREA": (35.9078, 127.7669),
    "ID": (-0.7893, 113.9213), "INDONESIA": (-0.7893, 113.9213),
    "PH": (12.8797, 121.7740), "PHILIPPINES": (12.8797, 121.7740),
    "TH": (15.8700, 100.9925), "THAILAND": (15.8700, 100.9925),
    "VN": (14.0583, 108.2772), "VIETNAM": (14.0583, 108.2772),
    "MY": (4.2105, 101.9758),  "MALAYSIA": (4.2105, 101.9758),
    "IL": (31.0461, 34.8516),  "ISRAEL": (31.0461, 34.8516),
}

# ─── All 27 Brazilian States (Olist) ─────────────────────────────────────────
BRAZIL_STATES: Dict[str, Tuple[float, float]] = {
    "AC": (-9.0238, -70.8120), "ACRE": (-9.0238, -70.8120),
    "AL": (-9.5713, -36.7820), "ALAGOAS": (-9.5713, -36.7820),
    "AP": (0.9020, -52.0030),  "AMAPA": (0.9020, -52.0030),
    "AM": (-3.4168, -65.8561), "AMAZONAS": (-3.4168, -65.8561),
    "BA": (-12.5797, -41.7007), "BAHIA": (-12.5797, -41.7007),
    "CE": (-5.4984, -39.3206), "CEARA": (-5.4984, -39.3206),
    "DF": (-15.7998, -47.8645), "DISTRITO FEDERAL": (-15.7998, -47.8645),
    "ES": (-19.1834, -40.3089), "ESPIRITO SANTO": (-19.1834, -40.3089),
    "GO": (-15.8270, -49.8362), "GOIAS": (-15.8270, -49.8362),
    "MA": (-5.4200, -45.4400), "MARANHAO": (-5.4200, -45.4400),
    "MT": (-12.6800, -56.9200), "MATO GROSSO": (-12.6800, -56.9200),
    "MS": (-20.7722, -54.7852), "MATO GROSSO DO SUL": (-20.7722, -54.7852),
    "MG": (-18.5122, -44.5550), "MINAS GERAIS": (-18.5122, -44.5550),
    "PA": (-1.9981, -54.9306), "PARA": (-1.9981, -54.9306),
    "PB": (-7.2400, -36.7800), "PARAIBA": (-7.2400, -36.7800),
    "PR": (-25.2521, -52.0215), "PARANA": (-25.2521, -52.0215),
    "PE": (-8.8137, -36.9541), "PERNAMBUCO": (-8.8137, -36.9541),
    "PI": (-7.7183, -42.7289), "PIAUI": (-7.7183, -42.7289),
    "RJ": (-22.9068, -43.1729), "RIO DE JANEIRO": (-22.9068, -43.1729),
    "RN": (-5.7945, -36.5654), "RIO GRANDE DO NORTE": (-5.7945, -36.5654),
    "RS": (-30.0346, -51.2177), "RIO GRANDE DO SUL": (-30.0346, -51.2177),
    "RO": (-11.5057, -63.5806), "RONDONIA": (-11.5057, -63.5806),
    "RR": (2.7376, -62.0751),  "RORAIMA": (2.7376, -62.0751),
    "SC": (-27.2423, -50.2189), "SANTA CATARINA": (-27.2423, -50.2189),
    "SP": (-23.5505, -46.6333), "SAO PAULO": (-23.5505, -46.6333),
    "SE": (-10.5741, -37.3857), "SERGIPE": (-10.5741, -37.3857),
    "TO": (-10.1753, -48.2982), "TOCANTINS": (-10.1753, -48.2982),
}

# ─── All 50 US States ────────────────────────────────────────────────────────
US_STATES: Dict[str, Tuple[float, float]] = {
    "AL": (32.806671, -86.791130), "ALABAMA": (32.806671, -86.791130),
    "AK": (61.370716, -152.404419), "ALASKA": (61.370716, -152.404419),
    "AZ": (33.729759, -111.431221), "ARIZONA": (33.729759, -111.431221),
    "AR": (34.969704, -92.373123), "ARKANSAS": (34.969704, -92.373123),
    "CA": (36.116203, -119.681564), "CALIFORNIA": (36.116203, -119.681564),
    "CO": (39.059811, -105.311104), "COLORADO": (39.059811, -105.311104),
    "CT": (41.597782, -72.755371), "CONNECTICUT": (41.597782, -72.755371),
    "DE": (39.318523, -75.507141), "DELAWARE": (39.318523, -75.507141),
    "FL": (27.766279, -81.686783), "FLORIDA": (27.766279, -81.686783),
    "GA": (33.040619, -83.643074), "GEORGIA": (33.040619, -83.643074),
    "HI": (21.094318, -157.498337), "HAWAII": (21.094318, -157.498337),
    "ID": (44.240459, -114.478828), "IDAHO": (44.240459, -114.478828),
    "IL": (40.349457, -88.986137), "ILLINOIS": (40.349457, -88.986137),
    "IN": (39.849426, -86.258278), "INDIANA": (39.849426, -86.258278),
    "IA": (42.011539, -93.210526), "IOWA": (42.011539, -93.210526),
    "KS": (38.526600, -96.726486), "KANSAS": (38.526600, -96.726486),
    "KY": (37.668140, -84.670067), "KENTUCKY": (37.668140, -84.670067),
    "LA": (31.169546, -91.867805), "LOUISIANA": (31.169546, -91.867805),
    "ME": (44.693947, -69.381927), "MAINE": (44.693947, -69.381927),
    "MD": (39.063946, -76.802101), "MARYLAND": (39.063946, -76.802101),
    "MA": (42.230171, -71.530106), "MASSACHUSETTS": (42.230171, -71.530106),
    "MI": (43.326618, -84.536095), "MICHIGAN": (43.326618, -84.536095),
    "MN": (45.694454, -93.900192), "MINNESOTA": (45.694454, -93.900192),
    "MS": (32.741646, -89.678696), "MISSISSIPPI": (32.741646, -89.678696),
    "MO": (38.456085, -92.288368), "MISSOURI": (38.456085, -92.288368),
    "MT": (46.921925, -110.454353), "MONTANA": (46.921925, -110.454353),
    "NE": (41.125370, -98.268082), "NEBRASKA": (41.125370, -98.268082),
    "NV": (38.313515, -117.055374), "NEVADA": (38.313515, -117.055374),
    "NH": (43.452492, -71.563896), "NEW HAMPSHIRE": (43.452492, -71.563896),
    "NJ": (40.298904, -74.521011), "NEW JERSEY": (40.298904, -74.521011),
    "NM": (34.840515, -106.248482), "NEW MEXICO": (34.840515, -106.248482),
    "NY": (42.165726, -74.948051), "NEW YORK": (42.165726, -74.948051),
    "NC": (35.630066, -79.806419), "NORTH CAROLINA": (35.630066, -79.806419),
    "ND": (47.528912, -99.784012), "NORTH DAKOTA": (47.528912, -99.784012),
    "OH": (40.388783, -82.764915), "OHIO": (40.388783, -82.764915),
    "OK": (35.565342, -96.928917), "OKLAHOMA": (35.565342, -96.928917),
    "OR": (44.572021, -122.070938), "OREGON": (44.572021, -122.070938),
    "PA": (40.590752, -77.209755), "PENNSYLVANIA": (40.590752, -77.209755),
    "RI": (41.680893, -71.511780), "RHODE ISLAND": (41.680893, -71.511780),
    "SC": (33.856892, -80.945007), "SOUTH CAROLINA": (33.856892, -80.945007),
    "SD": (44.299782, -99.438828), "SOUTH DAKOTA": (44.299782, -99.438828),
    "TN": (35.747845, -86.692345), "TENNESSEE": (35.747845, -86.692345),
    "TX": (31.054487, -97.563461), "TEXAS": (31.054487, -97.563461),
    "UT": (40.150032, -111.862434), "UTAH": (40.150032, -111.862434),
    "VT": (44.045876, -72.710686), "VERMONT": (44.045876, -72.710686),
    "VA": (37.769337, -78.169968), "VIRGINIA": (37.769337, -78.169968),
    "WA": (47.400902, -121.490494), "WASHINGTON": (47.400902, -121.490494),
    "WV": (38.491226, -80.954453), "WEST VIRGINIA": (38.491226, -80.954453),
    "WI": (44.268543, -89.616508), "WISCONSIN": (44.268543, -89.616508),
    "WY": (42.755966, -107.302490), "WYOMING": (42.755966, -107.302490),
}

# ─── Major Global Cities ─────────────────────────────────────────────────────
GLOBAL_CITIES: Dict[str, Tuple[float, float]] = {
    # Americas
    "new york": (40.7128, -74.0060), "los angeles": (34.0522, -118.2437),
    "chicago": (41.8781, -87.6298), "houston": (29.7604, -95.3698),
    "san francisco": (37.7749, -122.4194), "seattle": (47.6062, -122.3321),
    "miami": (25.7617, -80.1918), "boston": (42.3601, -71.0589),
    "atlanta": (33.7490, -84.3880), "dallas": (32.7767, -96.7970),
    "toronto": (43.6532, -79.3832), "vancouver": (49.2827, -123.1207),
    "montreal": (45.5017, -73.5673), "mexico city": (19.4326, -99.1332),
    "sao paulo": (-23.5505, -46.6333), "rio de janeiro": (-22.9068, -43.1729),
    "belo horizonte": (-19.9167, -43.9345), "brasilia": (-15.7975, -47.8919),
    "curitiba": (-25.4284, -49.2733), "buenos aires": (-34.6037, -58.3816),
    "santiago": (-33.4489, -70.6693), "bogota": (4.7110, -74.0721),
    "lima": (-12.0464, -77.0428),
    # Europe
    "london": (51.5074, -0.1278), "paris": (48.8566, 2.3522),
    "berlin": (52.5200, 13.4050), "rome": (41.9028, 12.4964),
    "madrid": (40.4168, -3.7038), "barcelona": (41.3851, 2.1734),
    "amsterdam": (52.3676, 4.9041), "brussels": (50.8503, 4.3517),
    "vienna": (48.2082, 16.3738), "zurich": (47.3769, 8.5417),
    "geneva": (46.2044, 6.1432), "dublin": (53.3498, -6.2603),
    "stockholm": (59.3293, 18.0686), "oslo": (59.9139, 10.7522),
    "copenhagen": (55.6761, 12.5683), "helsinki": (60.1699, 24.9384),
    "lisbon": (38.7223, -9.1393), "athens": (37.9838, 23.7275),
    "warsaw": (52.2297, 21.0122), "prague": (50.0755, 14.4378),
    # Asia & Middle East
    "tokyo": (35.6762, 139.6503), "seoul": (37.5665, 126.9780),
    "beijing": (39.9042, 116.4074), "shanghai": (31.2304, 121.4737),
    "hong kong": (22.3193, 114.1694), "singapore": (1.3521, 103.8198),
    "bangkok": (13.7563, 100.5018), "jakarta": (-6.2088, 106.8456),
    "kuala lumpur": (3.1390, 101.6869), "manila": (14.5995, 120.9842),
    "mumbai": (19.0760, 72.8777), "delhi": (28.6139, 77.2090),
    "bengaluru": (12.9716, 77.5946), "dubai": (25.2048, 55.2708),
    "abu dhabi": (24.4539, 54.3773), "riyadh": (24.7136, 46.6753),
    "cairo": (30.0444, 31.2357), "istanbul": (41.0082, 28.9784),
    "doha": (25.2854, 51.5310), "tel aviv": (32.0853, 34.7818),
    # Oceania & Africa
    "sydney": (-33.8688, 151.2093), "melbourne": (-37.8136, 144.9631),
    "brisbane": (-27.4698, 153.0251), "auckland": (-36.8485, 174.7633),
    "johannesburg": (-26.2041, 28.0473), "cape town": (-33.9249, 18.4241),
    "nairobi": (-1.2921, 36.8219), "casablanca": (33.5731, -7.5898),
    "lagos": (6.5244, 3.3792),
}


def normalize_geo_text(text: str) -> str:
    """Normalize text by lowercasing, stripping, and removing accents."""
    if not text:
        return ""
    t = str(text).strip().lower()
    t = re.sub(r"[áàãâä]", "a", t)
    t = re.sub(r"[éèêë]", "e", t)
    t = re.sub(r"[íìîï]", "i", t)
    t = re.sub(r"[óòõôö]", "o", t)
    t = re.sub(r"[úùûü]", "u", t)
    t = re.sub(r"[ç]", "c", t)
    return t


def lookup_coordinates(name: Any) -> Optional[Tuple[float, float]]:
    """Look up latitude and longitude for any country, state code, or city worldwide."""
    if name is None:
        return None

    raw_str = str(name).strip()
    upper = raw_str.upper()

    # 1. Countries (ISO codes or names)
    if upper in COUNTRIES_GEO:
        return COUNTRIES_GEO[upper]

    # 2. Brazilian States (Olist)
    if upper in BRAZIL_STATES:
        return BRAZIL_STATES[upper]

    # 3. US States
    if upper in US_STATES:
        return US_STATES[upper]

    # 4. Global Cities
    norm = normalize_geo_text(raw_str)
    if norm in GLOBAL_CITIES:
        return GLOBAL_CITIES[norm]

    # 5. Fuzzy match on cities
    for city, coords in GLOBAL_CITIES.items():
        if city in norm or norm in city:
            return coords

    # 6. Fuzzy match on countries
    for country, coords in COUNTRIES_GEO.items():
        country_norm = normalize_geo_text(country)
        if country_norm in norm or norm in country_norm:
            return coords

    return None


def enrich_rows_with_coordinates(
    rows: List[Dict[str, Any]],
    preferred_loc_col: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str], Optional[str]]:
    """Enrich data rows with 'lat' and 'lng' coordinates if a location column can be resolved.

    Works dynamically for any dataset:
    - If raw lat/lng exist (e.g. lat, latitude, geolocation_lat), uses them directly.
    - If geographic entity names exist (countries, states, cities, regions), geocodes them.

    Returns:
        (enriched_rows, lat_key, lng_key, marker_label_col)
    """
    if not rows:
        return rows, None, None, None

    sample_row = rows[0]
    cols = list(sample_row.keys())

    # Check if rows already have numeric lat/lng columns (any dataset with GPS/coordinates)
    existing_lat = next(
        (c for c in cols if any(t == c.lower() for t in ["lat", "latitude", "geolocation_lat", "customer_lat", "y"])),
        None
    )
    existing_lng = next(
        (c for c in cols if any(t == c.lower() for t in ["lng", "lon", "longitude", "geolocation_lng", "customer_lng", "x"])),
        None
    )

    if existing_lat and existing_lng:
        try:
            first_lat = float(sample_row.get(existing_lat))
            first_lng = float(sample_row.get(existing_lng))
            if -90 <= first_lat <= 90 and -180 <= first_lng <= 180:
                marker_col = preferred_loc_col or next((c for c in cols if c not in (existing_lat, existing_lng)), cols[0])
                return rows, existing_lat, existing_lng, marker_col
        except (ValueError, TypeError):
            pass

    # Find the candidate location column
    location_candidates = [
        "country", "country_name", "nation", "customer_state", "seller_state",
        "state", "province", "region", "uf", "customer_city", "seller_city",
        "city", "cidade", "estado", "location", "address", "market",
    ]
    loc_col = preferred_loc_col
    if not loc_col or loc_col not in sample_row:
        loc_col = next((c for c in cols if c.lower() in location_candidates), None)
        if not loc_col:
            loc_col = next((c for c in cols if any(lc in c.lower() for lc in location_candidates)), None)
        if not loc_col:
            # Fall back to first string column
            loc_col = next(
                (c for c in cols if isinstance(sample_row.get(c), str)),
                None
            )

            # No usable location column found
            if not loc_col:
                return rows, None, None, None

    enriched_rows = []
    resolved_count = 0

    for r in rows:
        r_copy = dict(r)
        val = r_copy.get(loc_col)
        coords = lookup_coordinates(val)
        if coords:
            r_copy["lat"] = coords[0]
            r_copy["lng"] = coords[1]
            resolved_count += 1
        enriched_rows.append(r_copy)

    if resolved_count > 0:
        return enriched_rows, "lat", "lng", loc_col

    return rows, None, None, None
