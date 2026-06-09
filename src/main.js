/**
 * AIFA Italy Drug Prices Scraper v1.3.0
 *
 * Downloads the official monthly AIFA Transparency List (Lista di Trasparenza)
 * published by the Italian Medicines Agency (Agenzia Italiana del Farmaco).
 *
 * Source: https://www.aifa.gov.it/liste-di-trasparenza
 * License: CC-BY (open data, free to reuse commercially)
 * Update frequency: monthly (~15th of each month)
 *
 * The CSV is served at a permanent Liferay URL that gets overwritten each month:
 *   https://www.aifa.gov.it/documents/20142/825643/Lista_farmaci_equivalenti.csv
 *
 * Confirmed CSV columns (live):
 *   Principio attivo | Confezione di riferimento | ATC | AIC | Farmaco |
 *   Confezione | Ditta | Prezzo riferimento SSN |
 *   Prezzo Pubblico DD mese YYYY | Differenza | Nota | Codice gruppo equivalenza
 */

import { Actor, log } from 'apify';
import { gotScraping } from 'crawlee';

const AIFA_BASE = 'https://www.aifa.gov.it';

// Permanent URL for the transparency list CSV (Liferay CMS — overwritten monthly)
const AIFA_CSV_URL = `${AIFA_BASE}/documents/20142/825643/Lista_farmaci_equivalenti.csv`;

// ─── CSV parser ───────────────────────────────────────────────────────────────

/** Split a CSV line respecting RFC-4180 quoted fields */
function splitCsvLine(line, delim) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === delim && !inQuotes) { cells.push(current); current = ''; }
        else { current += ch; }
    }
    cells.push(current);
    return cells;
}

/** Strip outer and residual inner quotes + whitespace from a cell */
function cleanCell(val) {
    let s = (val || '').trim();
    s = s.replace(/^"+|"+$/g, '').trim(); // outer quotes
    s = s.replace(/^"+|"+$/g, '').trim(); // residual inner (AIFA quirk: ""text"")
    return s;
}

/** Parse AIFA semicolon-delimited CSV */
function parseCsv(rawText) {
    const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const delim = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delim).map(h => cleanCell(h));

    return lines.slice(1).map(line => {
        const cells = splitCsvLine(line, delim);
        const row = {};
        headers.forEach((h, i) => { row[h] = cleanCell(cells[i] || ''); });
        return row;
    }).filter(row => Object.values(row).some(v => v.trim()));
}

/** Parse Italian price "5,63 " / "€ 3,50" → number, null if zero or empty */
function parsePrice(raw) {
    if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
    const n = parseFloat(raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/** Get value from row by trying multiple possible column names (case-insensitive, partial ok) */
function getCol(row, ...keys) {
    const rowKeys = Object.keys(row);
    for (const k of keys) {
        // Exact match first
        const exact = rowKeys.find(rk => rk.toLowerCase() === k.toLowerCase());
        if (exact && row[exact].trim()) return row[exact].trim();
        // Starts-with match (for date-suffixed columns like "Prezzo Pubblico 15 maggio 2026")
        const partial = rowKeys.find(rk => rk.toLowerCase().startsWith(k.toLowerCase()));
        if (partial && row[partial].trim()) return row[partial].trim();
    }
    return null;
}

/** Normalise raw AIFA row to output schema */
function normalise(raw, dataDate, sourceUrl) {
    const prezzoRaw = getCol(raw, 'Prezzo Pubblico');        // "Prezzo Pubblico 15 maggio 2026"
    const riferRaw  = getCol(raw, 'Prezzo riferimento SSN');
    const diffRaw   = getCol(raw, 'Differenza');

    const prezzoEur = parsePrice(prezzoRaw);
    const riferEur  = parsePrice(riferRaw);

    // Use Differenza from CSV directly when available, otherwise compute
    const diffFromCsv = parsePrice(diffRaw);
    const differenzaEur = diffFromCsv !== null ? diffFromCsv
        : (prezzoEur !== null && riferEur !== null)
            ? Math.round((prezzoEur - riferEur) * 100) / 100
            : null;

    const differenzaPercent = (differenzaEur !== null && riferEur !== null && riferEur > 0)
        ? Math.round((differenzaEur / riferEur) * 10000) / 100
        : null;

    return {
        principioAttivo:            getCol(raw, 'Principio attivo')             || null,
        denominazione:              getCol(raw, 'Farmaco', 'Denominazione')      || null,
        ditta:                      getCol(raw, 'Ditta')                         || null,
        confezione:                 getCol(raw, 'Confezione')                    || null,
        confezioneDiRiferimento:    getCol(raw, 'Confezione di riferimento')     || null,
        codiceGruppoEquivalenza:    getCol(raw, 'Codice gruppo equivalenza')     || null,
        aic:                        getCol(raw, 'AIC')                           || null,
        atc:                        getCol(raw, 'ATC')                           || null,
        classe:                     getCol(raw, 'Classe', 'Fascia')              || null,
        ricetta:                    getCol(raw, 'Ricetta')                       || null,
        prezzoAlPubblico:           prezzoRaw                                    || null,
        prezzoAlPubblicoEur:        prezzoEur,
        prezzoDiRiferimento:        riferRaw                                     || null,
        prezzoDiRiferimentoEur:     riferEur,
        differenzaEur,
        differenzaPercent,
        nota:                       getCol(raw, 'Nota')                          || null,
        dataAggiornamento:          dataDate,
        fonte:                      sourceUrl,
    };
}

// ─── download ─────────────────────────────────────────────────────────────────

async function downloadCsv(url, headers) {
    log.info(`Downloading: ${url}`);
    const res = await gotScraping({
        url,
        headers: { ...headers, Accept: 'text/csv,*/*' },
        timeout: { request: 60000 },
        throwHttpErrors: false,
    });
    if (res.statusCode !== 200) throw new Error(`CSV HTTP ${res.statusCode} — ${url}`);

    // Decode: UTF-8 first, fall back to Latin-1
    if (Buffer?.from) {
        const buf = Buffer.from(res.rawBody || res.body, 'binary');
        const utf8 = buf.toString('utf8');
        if (!utf8.includes('\uFFFD')) return utf8;
        return buf.toString('latin1');
    }
    return res.body;
}

/** Extract update date from "Prezzo Pubblico DD mese YYYY" column name */
function extractDateFromColumns(row) {
    const key = Object.keys(row).find(k => /prezzo pubblico/i.test(k));
    if (!key) return new Date().toISOString().split('T')[0];
    // e.g. "Prezzo Pubblico 15 maggio 2026"
    const months = { gennaio:1,febbraio:2,marzo:3,aprile:4,maggio:5,giugno:6,
                     luglio:7,agosto:8,settembre:9,ottobre:10,novembre:11,dicembre:12 };
    const m = key.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (m) {
        const mm = months[m[2].toLowerCase()];
        if (mm) return `${m[3]}-${String(mm).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
    return new Date().toISOString().split('T')[0];
}

// ─── main ─────────────────────────────────────────────────────────────────────

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    searchQuery      = '',
    atcCode          = '',
    classeSSN        = '',
    onlyWithPriceGap = false,
    maxItems         = 0,
    includeHistoric  = false,
} = input;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
};

// 1 — Download CSV (permanent Liferay URL, overwritten monthly by AIFA)
const csvText = await downloadCsv(AIFA_CSV_URL, headers);
const rawRows = parseCsv(csvText);
if (rawRows.length === 0) throw new Error('CSV parsed 0 rows — file may be empty or format changed');

const dataDate = extractDateFromColumns(rawRows[0]);
log.info(`Parsed ${rawRows.length} rows — date: ${dataDate}`);
log.info(`Columns: ${Object.keys(rawRows[0]).join(' | ')}`);
log.info(`Sample: ${JSON.stringify(rawRows[0])}`);

// 2 — Historic (optional — previous month uses same URL since it's overwritten,
//     so we load storico ZIP instead if needed)
const prevPriceMap = new Map();
if (includeHistoric) {
    // The storico page has ZIP files per month. For now, skip and log warning.
    log.warning('includeHistoric=true: previous month data not available via permanent URL (AIFA overwrites monthly). Skipping price comparison.');
}

// 3 — Filter + push
const searchLower = searchQuery.toLowerCase().trim();
const atcUpper    = atcCode.toUpperCase().trim();
const classFilter = classeSSN.toUpperCase().trim();
const limit       = maxItems > 0 ? maxItems : Infinity;
let saved = 0;

for (const raw of rawRows) {
    if (saved >= limit) break;

    const rec = normalise(raw, dataDate, AIFA_CSV_URL);

    // Filters
    if (searchLower) {
        const hay = `${rec.principioAttivo||''} ${rec.denominazione||''}`.toLowerCase();
        if (!hay.includes(searchLower)) continue;
    }
    if (atcUpper    && !(rec.atc||'').toUpperCase().startsWith(atcUpper)) continue;
    if (classFilter && (rec.classe||'').toUpperCase() !== classFilter) continue;
    if (onlyWithPriceGap && (rec.differenzaEur === null || rec.differenzaEur <= 0)) continue;

    await Actor.pushData(rec);
    saved++;
}

log.info(`Done. Saved ${saved} records.`);
await Actor.exit();
