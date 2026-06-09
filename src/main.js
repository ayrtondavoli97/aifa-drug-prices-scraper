/**
 * AIFA Italy Drug Prices Scraper v1.1.0
 *
 * Downloads the official monthly AIFA Transparency List (Lista di Trasparenza)
 * published by the Italian Medicines Agency (Agenzia Italiana del Farmaco).
 *
 * Source: https://www.aifa.gov.it/liste-di-trasparenza
 * License: CC-BY (open data, free to reuse)
 * Update frequency: monthly (typically 15th of each month)
 *
 * The CSV (labelled "Elenco in formato .csv del DD/MM/YYYY") contains:
 * - Principio Attivo, Denominazione, Ditta, AIC, ATC, Confezione
 * - Classe SSN (A/H/C), Ricetta, Nota
 * - Prezzo al Pubblico (retail), Prezzo di Riferimento (NHS max reimbursed)
 *
 * IMPORTANT: this is different from "Lista_farmaci_equivalenti.csv" which is
 * a bare list without prices. We specifically target the labelled link.
 */

import { Actor, log } from 'apify';
import { gotScraping } from 'crawlee';

const AIFA_BASE      = 'https://www.aifa.gov.it';
const AIFA_LIST_PAGE = `${AIFA_BASE}/liste-di-trasparenza`;

// ─── URL discovery ────────────────────────────────────────────────────────────

/**
 * Fetch the AIFA transparency list page and extract the URL of the CSV
 * labelled "Elenco in formato .csv del DD/MM/YYYY" (with prices).
 */
async function fetchLatestCsvUrl(headers) {
    log.info('Fetching AIFA transparency list page...');
    const res = await gotScraping({
        url: AIFA_LIST_PAGE,
        headers,
        timeout: { request: 30000 },
        throwHttpErrors: false,
    });
    if (res.statusCode !== 200) throw new Error(`AIFA list page HTTP ${res.statusCode}`);

    const html = res.body;

    // Strategy 1: anchor whose TEXT contains "Elenco in formato .csv"
    // Pattern: href="...csv...">...Elenco...formato...csv...
    const labelled = html.match(
        /href="([^"]+\.csv(?:[^"]*)?)"[^>]*>[^<]*Elenco[^<]*formato[^<]*\.csv/i
    ) || html.match(
        /href="([^"]+\.csv(?:[^"]*)?)"[^>]*>[^<]*formato\s+\.csv/i
    );
    if (labelled) {
        const url = labelled[1].startsWith('http') ? labelled[1] : AIFA_BASE + labelled[1];
        log.info(`Found labelled CSV URL: ${url}`);
        return url;
    }

    // Strategy 2: find text label first, search nearby for href
    const idx = html.search(/Elenco\s+in\s+formato\s+\.csv\s+del\s+\d{2}\/\d{2}\/\d{4}/i);
    if (idx > -1) {
        const slice = html.slice(Math.max(0, idx - 600), idx + 300);
        const m = slice.match(/href="([^"]+\.csv[^"]*)"/i);
        if (m) {
            const url = m[1].startsWith('http') ? m[1] : AIFA_BASE + m[1];
            log.info(`Found CSV URL via proximity search: ${url}`);
            return url;
        }
    }

    // Strategy 3: construct from date in label
    const dm = html.match(/formato\s+\.csv\s+del\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dm) {
        const url = `${AIFA_BASE}/documents/20142/0/Lista_di_Trasparenza_${dm[1]}${dm[2]}${dm[3]}.csv`;
        log.warning(`Constructed URL from date: ${url}`);
        return url;
    }

    throw new Error('Could not locate Lista di Trasparenza CSV on AIFA page.');
}

/** Previous month URL for historic comparison */
function previousMonthUrl(url) {
    const m = url.match(/(\d{2})(\d{2})(\d{4})\.csv/i);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    d.setMonth(d.getMonth() - 1);
    const pd = String(d.getDate()).padStart(2,'0');
    const pm = String(d.getMonth()+1).padStart(2,'0');
    return url.replace(/\d{8}\.csv/i, `${pd}${pm}${d.getFullYear()}.csv`);
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse AIFA CSV.
 * - Delimiter: semicolon (;)
 * - Encoding: UTF-8 or Latin-1 (handled at download)
 * - Quirk: some cells are double-quoted AND the content itself has extra quotes
 *   e.g.  ""10 MG COMPRESSE"" -> should be  10 MG COMPRESSE
 */
function parseCsv(rawText) {
    const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const delim = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, '').trim());

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(delim);
        if (cells.every(c => !c.trim())) continue;
        const row = {};
        headers.forEach((h, idx) => {
            let val = (cells[idx] || '').trim();
            // Strip outer quotes (single or double)
            val = val.replace(/^"|"$/g, '').trim();
            // Strip residual inner double-quotes that AIFA uses for emphasis: ""text"" -> text
            val = val.replace(/^"+|"+$/g, '').trim();
            row[h] = val;
        });
        rows.push(row);
    }
    return rows;
}

/** Parse Italian price "3,50" / "€ 3,50" / "3.50" -> number */
function parsePrice(raw) {
    if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
    const n = parseFloat(raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/** Normalise a raw AIFA row to output schema */
function normalise(raw, dataDate, sourceUrl) {
    // Helper: try multiple possible column names
    const get = (...keys) => {
        for (const k of keys) {
            for (const rk of Object.keys(raw)) {
                if (rk.trim().toLowerCase() === k.toLowerCase()) {
                    const v = raw[rk];
                    if (v !== undefined && v !== '') return v.trim();
                }
            }
        }
        return null;
    };

    const prezzoRaw = get('Prezzo al Pubblico', 'Prezzo Pubblico', 'PREZZO AL PUBBLICO');
    const riferRaw  = get('Prezzo di Riferimento', 'Prezzo Riferimento', 'PREZZO DI RIFERIMENTO', 'Prezzo Rif.');
    const prezzoEur = parsePrice(prezzoRaw);
    const riferEur  = parsePrice(riferRaw);

    const differenzaEur     = (prezzoEur !== null && riferEur !== null)
        ? Math.round((prezzoEur - riferEur) * 100) / 100 : null;
    const differenzaPercent = (differenzaEur !== null && riferEur > 0)
        ? Math.round((differenzaEur / riferEur) * 10000) / 100 : null;

    return {
        principioAttivo:        get('Principio Attivo', 'PRINCIPIO ATTIVO', 'Principio attivo') || null,
        denominazione:          get('Denominazione', 'DENOMINAZIONE', 'Nome Commerciale') || null,
        ditta:                  get('Ditta', 'DITTA', 'Titolare AIC', 'Azienda') || null,
        confezione:             get('Confezione', 'CONFEZIONE') || null,
        aic:                    get('AIC', 'Codice AIC', 'Cod. AIC') || null,
        atc:                    get('ATC', 'Codice ATC', 'Cod. ATC') || null,
        classe:                 get('Classe', 'CLASSE', 'Classe SSN', 'Fascia') || null,
        ricetta:                get('Ricetta', 'RICETTA', 'Tipo Ricetta', 'Modalità') || null,
        prezzoAlPubblico:       prezzoRaw || null,
        prezzoAlPubblicoEur:    prezzoEur,
        prezzoDiRiferimento:    riferRaw || null,
        prezzoDiRiferimentoEur: riferEur,
        differenzaEur,
        differenzaPercent,
        nota:                   get('Nota', 'NOTA', 'Note', 'Nota AIFA') || null,
        dataAggiornamento:      dataDate,
        fonte:                  sourceUrl,
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
    if (res.statusCode !== 200) throw new Error(`CSV download HTTP ${res.statusCode} — ${url}`);

    // Decode: try UTF-8 first, fall back to Latin-1 if replacement chars appear
    if (Buffer && Buffer.from) {
        const buf = Buffer.from(res.rawBody || res.body, 'binary');
        const utf8 = buf.toString('utf8');
        if (!utf8.includes('\uFFFD')) return utf8;
        return buf.toString('latin1');
    }
    return res.body;
}

function extractDateFromUrl(url) {
    const m = url.match(/(\d{2})(\d{2})(\d{4})\.csv/i);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toISOString().split('T')[0];
}

// ─── debug: log column names of first row ─────────────────────────────────────
function logColumns(rows) {
    if (rows.length > 0) {
        log.info(`CSV columns detected: ${Object.keys(rows[0]).join(' | ')}`);
        log.info(`Sample row: ${JSON.stringify(rows[0])}`);
    }
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
    'Accept': 'text/html,application/xhtml+xml,*/*',
};

// 1 — Discover CSV URL
let csvUrl;
try {
    csvUrl = await fetchLatestCsvUrl(headers);
} catch (err) {
    const now = new Date();
    csvUrl = `${AIFA_BASE}/documents/20142/0/Lista_di_Trasparenza_15${String(now.getMonth()+1).padStart(2,'0')}${now.getFullYear()}.csv`;
    log.warning(`Page scrape failed (${err.message}), fallback URL: ${csvUrl}`);
}

const dataDate = extractDateFromUrl(csvUrl);

// 2 — Download & parse
const csvText  = await downloadCsv(csvUrl, headers);
const rawRows  = parseCsv(csvText);
log.info(`Parsed ${rawRows.length} rows from AIFA list dated ${dataDate}`);
logColumns(rawRows);

// 3 — Historic (optional)
const prevPriceMap = new Map();
if (includeHistoric) {
    const prevUrl = previousMonthUrl(csvUrl);
    if (prevUrl) {
        try {
            const prevText = await downloadCsv(prevUrl, headers);
            for (const r of parseCsv(prevText)) {
                const aic = (r['AIC'] || r['Codice AIC'] || '').trim();
                const p   = parsePrice(r['Prezzo al Pubblico'] || r['PREZZO AL PUBBLICO'] || '');
                if (aic && p !== null) prevPriceMap.set(aic, p);
            }
            log.info(`Loaded ${prevPriceMap.size} previous-month prices`);
        } catch (e) {
            log.warning(`Previous month unavailable: ${e.message}`);
        }
    }
}

// 4 — Filter + push
const searchLower = searchQuery.toLowerCase().trim();
const atcUpper    = atcCode.toUpperCase().trim();
const classFilter = classeSSN.toUpperCase().trim();
const limit       = maxItems > 0 ? maxItems : Infinity;
let saved = 0;

for (const raw of rawRows) {
    if (saved >= limit) break;
    const rec = normalise(raw, dataDate, csvUrl);

    if (searchLower) {
        const hay = `${rec.principioAttivo||''} ${rec.denominazione||''}`.toLowerCase();
        if (!hay.includes(searchLower)) continue;
    }
    if (atcUpper    && !(rec.atc||'').toUpperCase().startsWith(atcUpper)) continue;
    if (classFilter && (rec.classe||'').toUpperCase() !== classFilter) continue;
    if (onlyWithPriceGap && (rec.differenzaEur === null || rec.differenzaEur <= 0)) continue;

    if (includeHistoric && rec.aic) {
        const prev = prevPriceMap.get(rec.aic) ?? null;
        rec.previousPriceEur = prev;
        rec.priceChange = (prev !== null && rec.prezzoAlPubblicoEur !== null)
            ? Math.round((rec.prezzoAlPubblicoEur - prev) * 100) / 100 : null;
    }

    await Actor.pushData(rec);
    saved++;
}

log.info(`Done. Saved ${saved} records.`);
await Actor.exit();
