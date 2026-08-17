export type DcSite = {
  key: string;
  building: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
};

/** Known ASEAN DC campuses. Building names are public facility labels, not pins-as-radius. */
export const DC_SITES: DcSite[] = [
  { key: "jakarta", building: "Jakarta metro", city: "Jakarta", country: "Indonesia", lat: -6.2088, lng: 106.8456 },
  { key: "cibitung", building: "DCI Indonesia — Cibitung", city: "Cibitung", country: "Indonesia", lat: -6.2635, lng: 107.0834 },
  { key: "bekasi", building: "Bekasi DC", city: "Bekasi", country: "Indonesia", lat: -6.2383, lng: 106.9756 },
  { key: "surabaya", building: "Surabaya DC", city: "Surabaya", country: "Indonesia", lat: -7.2575, lng: 112.7521 },
  { key: "bandung", building: "Bandung DC", city: "Bandung", country: "Indonesia", lat: -6.9175, lng: 107.6191 },
  { key: "yogyakarta", building: "Yogyakarta DC", city: "Yogyakarta", country: "Indonesia", lat: -7.7956, lng: 110.3695 },
  { key: "denpasar", building: "Denpasar / Bali DC", city: "Denpasar", country: "Indonesia", lat: -8.6705, lng: 115.2126 },
  { key: "medan", building: "Medan DC", city: "Medan", country: "Indonesia", lat: 3.5952, lng: 98.6722 },
  { key: "makassar", building: "Makassar DC", city: "Makassar", country: "Indonesia", lat: -5.1477, lng: 119.4327 },
  { key: "manado", building: "Manado DC", city: "Manado", country: "Indonesia", lat: 1.4748, lng: 124.8421 },
  { key: "balikpapan", building: "Balikpapan DC", city: "Balikpapan", country: "Indonesia", lat: -1.2379, lng: 116.8529 },
  { key: "singapore", building: "Singapore DC campus", city: "Singapore", country: "Singapore", lat: 1.321, lng: 103.695 },
  { key: "kualalumpur", building: "Kuala Lumpur DC", city: "Kuala Lumpur", country: "Malaysia", lat: 3.139, lng: 101.6869 },
  { key: "cyberjaya", building: "Cyberjaya DC", city: "Cyberjaya", country: "Malaysia", lat: 2.9213, lng: 101.6559 },
  { key: "penang", building: "Penang DC", city: "Penang", country: "Malaysia", lat: 5.4141, lng: 100.3288 },
  { key: "hanoi", building: "Hanoi DC", city: "Hanoi", country: "Vietnam", lat: 21.0278, lng: 105.8342 },
  { key: "hcmc", building: "Ho Chi Minh City DC", city: "Ho Chi Minh City", country: "Vietnam", lat: 10.7769, lng: 106.7009 },
  { key: "danang", building: "Da Nang DC", city: "Da Nang", country: "Vietnam", lat: 16.0544, lng: 108.2022 },
  { key: "bangkok", building: "Bangkok DC", city: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018 },
  { key: "manila", building: "Manila DC", city: "Manila", country: "Philippines", lat: 14.5995, lng: 120.9842 },
];

export function siteKeyFromCity(city: string) {
  const s = city.toLowerCase();
  if (/cibitung/.test(s)) return "cibitung";
  if (/bekasi/.test(s)) return "bekasi";
  if (/jakarta/.test(s)) return "jakarta";
  if (/surabaya/.test(s)) return "surabaya";
  if (/bandung/.test(s)) return "bandung";
  if (/yogyakarta|jogja/.test(s)) return "yogyakarta";
  if (/denpasar|bali/.test(s)) return "denpasar";
  if (/medan/.test(s)) return "medan";
  if (/makassar/.test(s)) return "makassar";
  if (/manado/.test(s)) return "manado";
  if (/balikpapan/.test(s)) return "balikpapan";
  if (/singapore/.test(s)) return "singapore";
  if (/cyberjaya/.test(s)) return "cyberjaya";
  if (/kuala lumpur/.test(s)) return "kualalumpur";
  if (/penang|pulau pinang/.test(s)) return "penang";
  if (/hanoi|ha noi/.test(s)) return "hanoi";
  if (/ho chi minh|hcmc|saigon/.test(s)) return "hcmc";
  if (/da nang|danang/.test(s)) return "danang";
  if (/bangkok/.test(s)) return "bangkok";
  if (/manila/.test(s)) return "manila";
  return "";
}
