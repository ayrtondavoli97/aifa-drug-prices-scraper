/**
 * AIFA Italy Drug Prices Scraper v1.2.0
 *
 * Downloads the official monthly AIFA Transparency List (Lista di Trasparenza)
 * published by the Italian Medicines Agency (Agenzia Italiana del Farmaco).
 *
 * Source: https://www.aifa.gov.it/liste-di-trasparenza
 * License: CC-BY (open data, free to reuse commercially)
 * Update frequency: monthly (~15th of each month)
 *
 * Confirmed CSV columns (from live file):
 *   Principio attivo | Confezione di riferimento | ATC | AIC | Farmaco |
 *   Confezione | Ditta | Prezzo riferimento SSN | Prezzo Pubblico DD mese YYYY |
 *   Differenza | Nota | Codice gruppo equivalenza
 */

import { Actor, log } from 'apify';
import { gotScraping } from 'crawlee';

const AIFA_BASE      = 'https://www.aifa.gov.it';
const AIFA_LIST_PAGE = `${AIFA_BASE}/liste-di-trasparenza`;

// ─── URL discovery ────────────────────────────────────────────────────────────

/**
 * Fetch the AIFA transparency list page and extract the URL of the correct CSV.
 *
 * The target link is labelled "Elenco in formato .csv del DD/MM/YYYY".
 * Strategy: find that label text in HTML, then extract the href from
 * the nearest preceding <a> tag (AIFA renders: <a href="...csv">label</a>).
 *
 * Fallback: construct URL from current month using known AIFA path pattern.
 */
async function fetchLatestCsvUrl(headers) {
    log.info('Fetching AIFA transparency list page...');
    const res = await gotScraping({
        url: AIFA_LIST_PAGE,
        headers,
        timeout: { request: 30000 },
        throwHttpErrors: false,
    });
    if (res.statusCode !== 200) throw new Error(`AIFA page HTTP ${res.statusCode}`);

    const html = res.body;

    // Find all CSV hrefs on the page
    const allCsvHrefs = [...html.matchAll(/href="([^"]*\.csv[^"]*)"/gi)].map(m => m[1]);
    log.info(`CSV hrefs found on page: ${allCsvHrefs.length} — ${JSON.stringify(allCsvHrefs.slice(0,5))}`);

    // The transparency list CSV has a label "Elenco in formato .csv del DD/MM/YYYY"
    // Find that label and extract the href from a window around it
    const labelIdx = html.search(/Elenco\s+in\s+formato\s+\.csv\s+del\s+\d{2}\/\d{2}\/\d{4}/i);
    if (labelIdx > -1) {
        // Search up to 600 chars before the label for an href
        const window = html.slice(Math.max(0, labelIdx - 600), labelIdx + 50);
        // Get the LAST href in this window (closest preceding anchor)
        const hrefs = [...window.matchAll(/href="([^"]+\.csv[^"]*)"/gi)].map(m => m[1]);
        if (hrefs.length > 0) {
            const href = hrefs[hrefs.length - 1];
            const url = href.startsWith('http') ? href : AIFA_BASE + href;
            log.info(`Found labelled CSV URL: ${url}`);
            return url;
        }
    }

    // Fallback: look for CSV href that contains "Trasparenza" or date pattern
    const trasparenzaHref = allCsvHrefs.find(h =>
        /trasparenza/i.test(h) || /lista_di/i.test(h) || /\d{8}\.csv/i.test(h)
    );
    if (trasparenzaHref) {
        const url = trasparenzaHref.startsWith('http') ? trasparenzaHref : AIFA_BASE + trasparenzaHref;
        log.warning(`Using fallback CSV href: ${url}`);
        return url;
    }

    // Last resort: construct from date in label
    const dm = html.match(/formato\s+\.csv\s+del\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dm) {
        const url = `${AIFA_BASE}/documents/20142/0/Lista_di_Trasparenza_${dm[1]}${dm[2]}${dm[3]}.csv`;
        log.warning(`Constructed URL from date: ${url}`);
        return url;
    }

    throw new Error('Could not locate Lista di Trasparenza CSV on AIFA page.');
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Parse AIFA CSV (semicolon-delimited).
 *
 * AIFA quirk: the Confezione field uses "" around content AND is quoted by CSV,
 * resulting in  "\"\"10 MG COMPRESSE\"\"" in raw text.
 * After outer quote stripping we get:  ""10 MG COMPRESSE""
 * We then strip residual "" to get:    10 MG COMPRESSE
 */
function parseCsv(rawText) {
    const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const delim = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delim).map(h =>
        h.trim().replace(/^"+|"+$/g, '').trim()
    );

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i], delim);
        if (cells.every(c => !c.trim())) continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = cleanCell(cells[idx] || '');
        });
        rows.push(row);
    }
    return rows;
}

/** Split a CSV line respecting quoted fields */
function splitCsvLine(line, delim) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

/** Strip outer/inner quotes and whitespace from a CSV cell value */
function cleanCell(val) {
    let s = val.trim();
    // Strip outer double-quotes
    s = s.replace(/^"+|"+$/g, '').trim();
    // Strip residual inner double-double-quotes (AIFA quirk: ""text"")
    s = s.replace(/^"+|"+$/g, '').trim();
    return s;
}

/** Parse Italian price "5,63 " / "€ 3,50" → number */
function parsePrice(raw) {
    if (!raw || raw.trim() === '' || raw.trim() === '-' || raw.trim() === '0,00') return null;
    const n = parseFloat(
        raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
    );
    return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/**
 * Normalise a raw AIFA row to the output schema.
 *
 * Confirmed column names from live CSV:
 *   "Principio attivo", "Confezione di riferimento", "ATC", "AIC",
 *   "Farmaco", "Confezione", "Ditta",
 *   "Prezzo riferimento SSN", "Prezzo Pubblico DD mese YYYY",
 *   "Differenza", "Nota", "Codice gruppo equivalenza"
 */
function normalise(raw, dataDate, sourceUrl) {
    // Get value by exact key, case-insensitive
    const get = (...keys) => {
        for (const k of keys) {
            for (const rk of Object.keys(raw)) {
                if (rk.trim().toLowerCase() === k.toLowerCase()) {
                    const v = (raw[rk] || '').trim();
                    if (v !== '') return v;
                }
            }
            // Partial match fallback for "Prezzo Pubblico DD mese YYYY" (date varies)
            for (const rk of Object.keys(raw)) {
                if (rk.trim().toLowerCase().startsWith(k.toLowerCase())) {
                    const v = (raw[rk] || '').trim();
                    if (v !== '') return v;
                }
            }
        }
        return null;
    };

    const prezzoRaw = get('Prezzo Pubblico');   // partial match: "Prezzo Pubblico 15 maggio 2026"
    const riferRaw  = get('Prezzo riferimento SSN');
    const diffRaw   = get('Differenza');

    const prezzoEur = parsePrice(prezzoRaw);
    const riferEur  = parsePrice(riferRaw);
    const diffEur   = parsePrice(diffRaw);

    // Compute differenza independently (diffRaw may be "0,00" = same price)
    const differenzaEur = (diffEur !== null) ? diffEur
        : (prezzoEur !== null && riferEur !== null)
            ? Math.round((prezzoEur - riferEur) * 100) / 100
            : null;

    const differenzaPercent = (differenzaEur !== null && riferEur !== null && riferEur > 0)
        ? Math.round((differenzaEur / riferEur) * 10000) / 100
        : null;

    return {
        principioAttivo:            get('Principio attivo', 'PRINCIPIO ATTIVO') || null,
        denominazione:              get('Farmaco', 'Denominazione', 'DENOMINAZIONE', 'Nome Commerciale') || null,
        ditta:                      get('Ditta', 'DITTA') || null,
        confezione:                 get('Confezione', 'CONFEZIONE') || null,
        confezioneDiRiferimento:    get('Confezione di riferimento') || null,
        codiceGruppoEquivalenza:    get('Codice gruppo equivalenza') || null,
        aic:                        get('AIC', 'Codice AIC') || null,
        atc:                        get('ATC', 'Codice ATC') || null,
        classe:                     get('Classe', 'CLASSE', 'Fascia') || null,
        ricetta:                    get('Ricetta', 'RICETTA') || null,
        prezzoAlPubblico:           prezzoRaw || null,
        prezzoAlPubblicoEur:        prezzoEur,
        prezzoDiRiferimento:        riferRaw || null,
        prezzoDiRiferimentoEur:     riferEur,
        differenzaEur,
        differenzaPercent,
        nota:                       get('Nota', 'NOTA') || null,
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

function previousMonthUrl(url) {
    const m = url.match(/(\d{2})(\d{2})(\d{4})\.csv/i);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    d.setMonth(d.getMonth() - 1);
    const pd = String(d.getDate()).padStart(2,'0');
    const pm = String(d.getMonth()+1).padStart(2,'0');
    return url.replace(/\d{8}\.csv/i, `${pd}${pm}${d.getFullYear()}.csv`);
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
    log.warning(`Page scrape failed (${err.message}), fallback: ${csvUrl}`);
}

const dataDate = extractDateFromUrl(csvUrl);

// 2 — Download & parse
const csvText = await downloadCsv(csvUrl, headers);
const rawRows = parseCsv(csvText);
log.info(`Parsed ${rawRows.length} rows — columns: ${Object.keys(rawRows[0] || {}).join(' | ')}`);
log.info(`Sample: ${JSON.stringify(rawRows[0] || {})}`);

// 3 — Historic (optional)
const prevPriceMap = new Map();
if (includeHistoric) {
    const prevUrl = previousMonthUrl(csvUrl);
    if (prevUrl) {
        try {
            const prevRows = parseCsv(await downloadCsv(prevUrl, headers));
            for (const r of prevRows) {
                const aic = cleanCell(r['AIC'] || r['Codice AIC'] || '');
                const p   = parsePrice(Object.keys(r).find(k => k.startsWith('Prezzo Pubblico'))
                    ? r[Object.keys(r).find(k => k.startsWith('Prezzo Pubblico'))] : '');
                if (aic && p !== null) prevPriceMap.set(aic, p);
            }
            log.info(`Previous month: ${prevPriceMap.size} prices loaded`);
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
