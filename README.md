# AIFA Italy Drug Prices — Generic & Equivalent Medicines Database 💊

**The only Apify actor for Italy's official pharmaceutical price database.**

Extracts the complete AIFA Transparency List (*Lista di Trasparenza*) — the official monthly dataset published by Italy's **Agenzia Italiana del Farmaco** listing all generic and equivalent medicines with NHS reference prices.

Data license: **CC-BY** (open data, free to reuse commercially).

---

## What you get

Each record contains:

| Field | Description |
|---|---|
| `principioAttivo` | Active substance / INN generic name |
| `denominazione` | Brand / commercial name |
| `ditta` | Manufacturer / marketing authorisation holder |
| `confezione` | Packaging (e.g. "30 cpr 500mg") |
| `aic` | AIC — Italian marketing authorisation code |
| `atc` | ATC code (WHO Anatomical Therapeutic Chemical) |
| `classe` | NHS reimbursement class: **A** (fully reimbursed), **H** (hospital only), **C** (patient pays) |
| `ricetta` | Prescription type (RR, RNR, SOP, OTC, etc.) |
| `prezzoAlPubblicoEur` | Retail price in EUR |
| `prezzoDiRiferimentoEur` | NHS reference price (maximum reimbursed) |
| `differenzaEur` | Price gap patient must pay (retail − reference) |
| `differenzaPercent` | Price gap as % of reference price |
| `nota` | AIFA prescribing note (Nota 4, Nota 75, etc.) |
| `dataAggiornamento` | Date of the AIFA list update |
| `fonte` | Direct URL of the source CSV |
| `previousPriceEur` | Previous month's retail price *(optional)* |
| `priceChange` | Month-over-month price change *(optional)* |

---

## Input options

| Parameter | Default | Description |
|---|---|---|
| `searchQuery` | `""` | Filter by active substance or brand name (partial match) |
| `atcCode` | `""` | Filter by ATC prefix, e.g. `N02` (analgesics), `A10` (diabetes) |
| `classeSSN` | `""` | Filter by NHS class: `A`, `H`, or `C` |
| `onlyWithPriceGap` | `false` | Only medicines where retail > reference (patient pays extra) |
| `maxItems` | `0` | Max records (0 = full database, ~10–15K records) |
| `includeHistoric` | `false` | Add previous month's price + month-over-month change |

---

## Example use cases

**Pharma & health-tech companies**
- Build Italian drug price comparison tools
- Monitor monthly price changes across the generic drug market
- Cross-reference with EMA/EU databases for pan-European pricing

**Healthcare researchers**
- Analyse NHS cost exposure by ATC category
- Track price competition in off-patent drug segments
- Study the gap between retail prices and NHS reimbursement rates

**Patients & consumer advocates**
- Find the cheapest equivalent for any active substance
- Identify medicines where patients are paying above NHS reference price

**Data providers / aggregators**
- Enrich proprietary pharma databases with official Italian pricing
- Build scheduled pipelines for monthly price monitoring

---

## ATC code examples

| ATC prefix | Therapeutic area |
|---|---|
| `A10` | Diabetes (insulins, metformin, etc.) |
| `C10` | Cholesterol (statins) |
| `J01` | Antibiotics |
| `N02` | Analgesics (paracetamol, ibuprofen, etc.) |
| `N06` | Antidepressants |
| `C09` | ACE inhibitors / ARBs (hypertension) |
| `R03` | Respiratory / asthma |

---

## Source & update schedule

- **Source:** [AIFA Liste di Trasparenza](https://www.aifa.gov.it/liste-di-trasparenza)
- **Updated:** Monthly, typically around the 15th of each month
- **License:** [CC-BY](https://creativecommons.org/licenses/by/4.0/) — Italian Medicines Agency
- **Format:** CSV/XLS (this actor downloads the CSV version)

Schedule this actor monthly (cron: `0 8 16 * *`) to keep your dataset current.

---

## Author

**Francesco Davoli** — [ayrtondavoli97](https://apify.com/ayrtondavoli97)  
Italian public data scrapers and investment analysis tools.
