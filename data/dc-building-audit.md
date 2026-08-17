# DC building audit — Arena providers

Source list: Postgres `providers` × `locations` (438 rows, 98 providers).
Rule: name a building only if a public official/trade page lists it. Otherwise **Unknown Building**.

| | rows |
|---|---|
| Total location rows | 438 |
| Building listed | 22 |
| Unknown Building | 416 |
| Local ASEAN listed | 22 |
| Local ASEAN unknown | 40 |

## Named buildings (local ASEAN)

| Provider | City | Building |
|---|---|---|
| BiznetGio | Jakarta | MidPlaza |
| CloudKilat | Jakarta | NEX Data Center (Cyber 2 Tower) |
| IDCloudHost | Jakarta (Cibitung) | DCI Indonesia H1 Campus |
| IDCloudHost | Jakarta | AtriaDC / IDC 3D (Duren 3) |
| Qwords | Jakarta | Cyber 1 / Menara Tendean / Wisma BBU |
| Qwords | Yogyakarta | Qwords Yogyakarta POP |
| Rumahweb | Jakarta | Gedung Cyber |
| Lintasarta Cloudeka | Jakarta | BDx CGK1 / Technopark BSD / CGK3 Simatupang / CGK4 Jatiluhur |
| Telkomsigma Cloud | Jakarta | NeutraDC Sentul / NeutraDC HDC Cikarang |
| Herza Cloud | Jakarta | Area31 Data Center |
| Exabytes | Cyberjaya | CJ1 Data Centre |
| Exabytes | Penang | Suntech @ Penang Cybercity |
| Shinjiru / Shinjiru VPS | Kuala Lumpur | Menara AIMS |
| FPT Smart Cloud | Hanoi | Fornix HN01 / HN02 |
| FPT Smart Cloud | Ho Chi Minh | Fornix HCM01 / HCM02 |
| VNG Cloud / GreenNode | Ho Chi Minh | STT VNG HCMC 1 (Tan Thuan EPZ) |
| Viettel IDC | Ho Chi Minh | Hoa Tham / Phu Trung |
| VNPT | Hanoi | VNPT IDC Hoa Lac |

Biznet Technovillage (Cimanggis) is official for BiznetGio but **Cimanggis is not a city row** in the current DB (Bekasi/Cibitung/Surabaya/Denpasar stay Unknown Building).

Hyperscalers (AWS/Azure/Alibaba/Tencent/Oracle/DO/Vultr/Linode): city/region only. No first-party building name used. All **Unknown Building**.

CSV: `data/dc-building-audit.csv`
