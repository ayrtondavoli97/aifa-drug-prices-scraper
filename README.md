# AIFA Italy Drug Prices — Generic & Equivalent Medicines Database 💊

**The only Apify actor for Italy's official pharmaceutical price database.**

Extracts the complete AIFA Transparency List (*Lista di Trasparenza*) — the official monthly dataset published by Italy's **Agenzia Italiana del Farmaco** listing all generic and equivalent medicines with official reference prices.

**~8,500 records per run. Runs in under 5 seconds. Data license: CC-BY.**

---

## What you get

Each record contains:

| Field | Description |
|---|---|
| `principioAttivo` | Active substance / INN generic name (e.g. "Paracetamolo") |
| `denominazione` | Brand / commercial name (e.g. "TACHIPIRINA", "TACHIDOL") |
| `ditta` | Manufacturer / marketing authorisation holder |
| `confezione` | Packaging description (e.g. "30 CPR 500MG") |
| `confezioneDiRiferimento` | Reference packaging for the equivalence group |
| `codiceGruppoEquivalenza` | AIFA equivalence group code (groups interchangeable medicines) |
| `aic` | AIC — Italian marketing authorisation number |
| `atc` | ATC code (WHO Anatomical Therapeutic Chemical classification) |
| `prezzoAlPubblicoEur` | Retail price in EUR |
| `prezzoDiRiferimentoEur` | NHS reference price in EUR (maximum reimbursed by SSN) |
| `differenzaEur` | Extra cost patient pays if retail > reference (€) |
| `differenzaPercent` | Extra cost as % of reference price |
| `nota` | AIFA prescribing/dispensing note (Nota 4, Nota 75, etc.) |
| `dataAggiornamento` | Date of this AIFA list update (YYYY-MM-DD) |
| `fonte` | Direct URL of the AIFA source CSV |

---

## Input options

| Parameter | Default | Description |
|---|---|---|
| `searchQuery` | `""` | Filter by active substance or brand name (partial match). E.g. `paracetamolo`, `ibuprofene`, `metformina`, `tachipirina` |
| `atcCode` | `""` | Filter by ATC code prefix. E.g. `N02` (analgesics), `A10` (diabetes), `C10` (cholesterol), `J01` (antibiotics) |
| `classeSSN` | `""` | Filter by NHS class: `A` (reimbursed), `H` (hospital only), `C` (patient pays) |
| `onlyWithPriceGap` | `false` | Only return medicines where retail > reference — patients pay extra |
| `maxItems` | `0` | Max records to return. `0` = full database |

---

## Example use cases

**Pharma & health-tech companies**
- Build Italian drug price comparison tools
- Monitor monthly price changes across the generic drug market
- Cross-reference with EMA/EU databases for pan-European pricing analysis

**Healthcare researchers**
- Analyse NHS cost exposure by ATC therapeutic category
- Study price competition in off-patent drug segments
- Identify medicines with the largest brand-vs-generic price gaps

**Patients & consumer advocates**
- Find the cheapest equivalent for any active substance
- Identify brand medicines where patients pay above the NHS reference price

**Data providers / aggregators**
- Enrich pharma databases with official Italian pricing (CC-BY licence)
- Build monthly scheduled pipelines for price monitoring

---

## Price gap example

Running with `onlyWithPriceGap: true` returns medicines like:

| Brand | Generic | Retail | Reference | Gap |
|---|---|---|---|---|
| COEFFERALGAN | Paracetamolo+Codeina | €3.96 | €3.16 | +€0.80 (+25%) |
| TACHIDOL | Paracetamolo+Codeina | €3.96 | €3.16 | +€0.80 (+25%) |

Patients choosing the brand over the generic pay the difference out of pocket.

---

## ATC code reference

| ATC prefix | Therapeutic area |
|---|---|
| `A10` | Diabetes (metformin, insulins, GLP-1) |
| `C10` | Cholesterol (statins) |
| `C09` | ACE inhibitors / ARBs (hypertension) |
| `J01` | Antibiotics |
| `N02` | Analgesics (paracetamol, ibuprofen, codeine) |
| `N06` | Antidepressants (SSRIs, SNRIs) |
| `R03` | Respiratory / asthma (salbutamol, beclometasone) |

---

## Source & scheduling

- **Source:** [AIFA Liste di Trasparenza](https://www.aifa.gov.it/liste-di-trasparenza)
- **Updated:** Monthly, around the 15th of each month
- **License:** [CC-BY](https://creativecommons.org/licenses/by/4.0/) — Agenzia Italiana del Farmaco
- **Records:** ~8,500 per run (full database)
- **Runtime:** < 5 seconds

Schedule monthly: `0 8 16 * *` to keep your dataset current.

---

## Author

**Francesco Davoli** — [ayrtondavoli97](https://apify.com/ayrtondavoli97)
Italian public data scrapers and investment analysis tools.
