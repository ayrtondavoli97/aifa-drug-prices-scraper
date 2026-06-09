/**
 * AIFA Italy Drug Prices Scraper v1.0.0
 *
 * Downloads the official monthly AIFA Transparency List (Lista di Trasparenza)
 * published by the Italian Medicines Agency (Agenzia Italiana del Farmaco).
 *
 * Source: https://www.aifa.gov.it/liste-di-trasparenza
 * License: CC-BY (open data, free to reuse)
 * Update frequency: monthly (typically 15th of each month)
 *
 * The CSV contains all generic/equivalent medicines available in Italy with:
 * - Active substance (principio attivo)
 * - Brand name (denominazione)
 * - AIC code, ATC code
 * - NHS reimbursement class (A/H/C)
 * - Retail price (prezzo al pubblico)
 * - NHS reference price (prezzo di riferimento = max reimbursed)
 * - Manufacturer, packaging, prescription type
 */

import { Actor, log } from 'apify';
import { gotScraping } from 'crawlee';

// ─── AIFA URL helpers ─────────────────────────────────────────────────────────

const AIFA_BASE = 'https://www.aifa.gov.it';
const AIFA_LIST_PAGE = `${AIFA_BASE}/liste-di-trasparenza`;

/**
 * Scrape the AIFA transparency list page to find the latest CSV download URL.
 * The page contains links like:
 *   "Elenco in formato .csv del 15/05/2026 [1.65 Mb] [CSV]"
 * pointing to paths like:
 *   /documents/20142/0/Lista_di_Trasparenza_15052026.csv/...
 */
async function fetchLatestCsvUrl(headers) {
    log.info('Fetching AIFA list page to find latest CSV URL...');
    const res = await gotScraping({
        url: AIFA_LIST_PAGE,
        headers,
        timeout: { request: 30000 },
        throwHttpErrors: false,
    });

    if (res.statusCode !== 200) {
        throw new Error(`AIFA list page returned HTTP ${res.statusCode}`);
    }

    const html = res.body;

    // Extract CSV link — matches href containing "Lista" and ending with ".csv"
    const csvMatch = html.match(/href="([^"]*Lista[^"]*\.csv[^"]*)"/i)
        || html.match(/href="([^"]*liste[^"]*trasparenza[^"]*\.csv[^"]*)"/i)
        || html.match(/href="([^"]*\.csv[^"]*)"/i);

    if (csvMatch) {
        const href = csvMatch[1];
        const url = href.startsWith('http') ? href : AIFA_BASE + href;
        log.info(`Found CSV URL: ${url}`);
        return url;
    }

    // Fallback: try to find by pattern in text
    const dateMatch = html.match(/formato\s+\.csv\s+del\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch) {
        const [d, m, y] = dateMatch[1].split('/');
        const filename = `Lista_di_Trasparenza_${d}${m}${y}.csv`;
        log.warning(`Could not find href, trying constructed filename: ${filename}`);
        return `${AIFA_BASE}/documents/20142/0/${filename}`;
    }

    throw new Error('Could not find CSV download URL on AIFA page');
}

/**
 * Build the URL for the previous month's CSV for historic comparison.
 */
function previousMonthUrl(currentUrl) {
    const dateMatch = currentUrl.match(/(\d{2})(\d{2})(\d{4})\.csv/i);
    if (!dateMatch) return null;
    const [, dd, mm, yyyy] = dateMatch;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    date.setMonth(date.getMonth() - 1);
    const pd = String(date.getDate()).padStart(2, '0');
    const pm = String(date.getMonth() + 1).padStart(2, '0');
    const py = date.getFullYear();
    return currentUrl.replace(/\d{8}\.csv/i, `${pd}${pm}${py}.csv`);
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse AIFA CSV (semicolon-separated, Windows-1252 or UTF-8, with BOM).
 * Returns array of raw row objects keyed by column header.
 */
function parseCsv(rawText) {
    // Normalise line endings, strip BOM
    const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length < 2) return [];

    // Detect delimiter: AIFA uses semicolon
    const delimiter = lines[0].includes(';') ? ';' : ',';

    // Parse header
    const headers = lines[0].split(delimiter).map(h =>
        h.trim().replace(/^["']|["']$/g, '')
    );

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(delimiter);
        if (cells.every(c => !c.trim())) continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = (cells[idx] || '').trim().replace(/^["']|["']$/g, '');
        });
        rows.push(row);
    }
    return rows;
}

/**
 * Parse Italian price format "€ 3,50" or "3,50" or "3.50" → number
 */
function parsePrice(raw) {
    if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
    const cleaned = raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : Math.round(val * 100) / 100;
}

/**
 * Normalise a raw AIFA row to the output schema.
 */
function normaliseRow(raw, dataDate, sourceUrl) {
    // AIFA CSV column names vary slightly between versions — handle both
    const get = (...keys) => {
        for (const k of keys) {
            const val = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
            if (val !== undefined && val !== '') return val.trim();
        }
        return null;
    };

    const prezzoRaw     = get('Prezzo al Pubblico', 'PREZZO AL PUBBLICO', 'Prezzo_Pubblico');
    const riferRaw      = get('Prezzo di Riferimento', 'PREZZO DI RIFERIMENTO', 'Prezzo_Riferimento', 'Prezzo Riferimento');
    const prezzoEur     = parsePrice(prezzoRaw);
    const riferEur      = parsePrice(riferRaw);

    let differenzaEur     = null;
    let differenzaPercent = null;
    if (prezzoEur !== null && riferEur !== null) {
        differenzaEur     = Math.round((prezzoEur - riferEur) * 100) / 100;
        differenzaPercent = riferEur > 0
            ? Math.round((differenzaEur / riferEur) * 10000) / 100
            : null;
    }

    return {
        principioAttivo:        get('Principio Attivo', 'PRINCIPIO ATTIVO', 'Principio attivo') || null,
        denominazione:          get('Denominazione', 'DENOMINAZIONE') || null,
        ditta:                  get('Ditta', 'DITTA', 'Titolare AIC') || null,
        confezione:             get('Confezione', 'CONFEZIONE') || null,
        aic:                    get('AIC', 'Codice AIC') || null,
        atc:                    get('ATC', 'Codice ATC') || null,
        classe:                 get('Classe', 'CLASSE', 'Classe SSN') || null,
        ricetta:                get('Ricetta', 'RICETTA', 'Tipo Ricetta') || null,
        prezzoAlPubblico:       prezzoRaw || null,
        prezzoAlPubblicoEur:    prezzoEur,
        prezzoDiRiferimento:    riferRaw || null,
        prezzoDiRiferimentoEur: riferEur,
        differenzaEur,
        differenzaPercent,
        nota:                   get('Nota', 'NOTA', 'Note') || null,
        dataAggiornamento:      dataDate,
        fonte:                  sourceUrl,
    };
}

// ─── download helper ──────────────────────────────────────────────────────────

async function downloadCsv(url, headers) {
    log.info(`Downloading CSV: ${url}`);
    const res = await gotScraping({
        url,
        headers,
        timeout: { request: 60000 },
        throwHttpErrors: false,
        encoding: 'binary',   // raw bytes, handle encoding ourselves
    });
    if (res.statusCode !== 200) {
        throw new Error(`CSV download returned HTTP ${res.statusCode} for ${url}`);
    }

    // AIFA files are sometimes Windows-1252 encoded — decode properly
    let text = res.body;
    // If Buffer available, try to decode as latin1/utf8
    if (Buffer && typeof Buffer.from === 'function') {
        const buf = Buffer.from(res.rawBody || res.body, 'binary');
        text = buf.toString('utf8');
        if (text.includes('\uFFFD')) {
            text = buf.toString('latin1');
        }
    }
    return text;
}

// ─── extract date from URL ────────────────────────────────────────────────────

function extractDateFromUrl(url) {
    const m = url.match(/(\d{2})(\d{2})(\d{4})\.csv/i);
    if (!m) return new Date().toISOString().split('T')[0];
    return `${m[3]}-${m[2]}-${m[1]}`;
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

// 1 — Find latest CSV URL
let csvUrl;
try {
    csvUrl = await fetchLatestCsvUrl(headers);
} catch (err) {
    // Hard-fallback: construct current month URL
    const now = new Date();
    const dd  = String(15).padStart(2, '0');
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    const yy  = now.getFullYear();
    csvUrl = `${AIFA_BASE}/documents/20142/0/Lista_di_Trasparenza_${dd}${mm}${yy}.csv`;
    log.warning(`Could not parse AIFA page (${err.message}), trying constructed URL: ${csvUrl}`);
}

const dataDate = extractDateFromUrl(csvUrl);

// 2 — Download & parse current list
const csvText = await downloadCsv(csvUrl, { ...headers, Accept: 'text/csv,*/*' });
const rawRows = parseCsv(csvText);
log.info(`Parsed ${rawRows.length} rows from AIFA list (${dataDate})`);

// 3 — Optionally download previous month for historic comparison
let prevPriceMap = new Map(); // aic → price
if (includeHistoric) {
    const prevUrl = previousMonthUrl(csvUrl);
    if (prevUrl) {
        try {
            const prevText = await downloadCsv(prevUrl, { ...headers, Accept: 'text/csv,*/*' });
            const prevRows = parseCsv(prevText);
            for (const r of prevRows) {
                const aic = (r['AIC'] || r['Codice AIC'] || '').trim();
                const p   = parsePrice(r['Prezzo al Pubblico'] || r['PREZZO AL PUBBLICO'] || '');
                if (aic && p !== null) prevPriceMap.set(aic, p);
            }
            log.info(`Loaded ${prevPriceMap.size} prices from previous month for comparison`);
        } catch (e) {
            log.warning(`Could not load previous month data: ${e.message}`);
        }
    }
}

// 4 — Normalise, filter, push
const searchLower = searchQuery.toLowerCase().trim();
const atcLower    = atcCode.toUpperCase().trim();
const classFilter = classeSSN.toUpperCase().trim();

let savedCount = 0;
const limit = maxItems > 0 ? maxItems : Infinity;

for (const raw of rawRows) {
    if (savedCount >= limit) break;

    const record = normaliseRow(raw, dataDate, csvUrl);

    // ── Filters ──────────────────────────────────────────────────────────
    if (searchLower) {
        const hay = `${record.principioAttivo || ''} ${record.denominazione || ''}`.toLowerCase();
        if (!hay.includes(searchLower)) continue;
    }
    if (atcLower && !(record.atc || '').toUpperCase().startsWith(atcLower)) continue;
    if (classFilter && (record.classe || '').toUpperCase() !== classFilter) continue;
    if (onlyWithPriceGap && (record.differenzaEur === null || record.differenzaEur <= 0)) continue;

    // ── Historic enrichment ───────────────────────────────────────────────
    if (includeHistoric && record.aic) {
        const prev = prevPriceMap.get(record.aic) ?? null;
        record.previousPriceEur = prev;
        record.priceChange = (prev !== null && record.prezzoAlPubblicoEur !== null)
            ? Math.round((record.prezzoAlPubblicoEur - prev) * 100) / 100
            : null;
    }

    await Actor.pushData(record);
    savedCount++;
}

log.info(`Done. Saved ${savedCount} records.`);
await Actor.exit();
