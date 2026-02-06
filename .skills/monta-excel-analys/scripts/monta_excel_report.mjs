#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

function usage() {
    console.log(`Usage: node .skills/monta-excel-analys/scripts/monta_excel_report.mjs <file.xlsx|file.csv> [--out report.json] [--sheet "Sheet name"]`);
}

function parseArgs(argv) {
    const args = [...argv];
    const inputPath = args.shift();
    let outPath = null;
    let sheet = null;

    while (args.length > 0) {
        const arg = args.shift();
        if (arg === "--out") {
            outPath = args.shift() || null;
            continue;
        }
        if (arg === "--sheet") {
            sheet = args.shift() || null;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        }
    }

    return { inputPath, outPath, sheet };
}

function parseNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    let raw = String(value).replace(/\u00A0/g, " ").trim();
    if (!raw) return null;

    let isNegative = false;
    if (raw.startsWith("(") && raw.endsWith(")")) {
        isNegative = true;
        raw = raw.slice(1, -1);
    }
    if (raw.trim().startsWith("-")) {
        isNegative = true;
    }

    let cleaned = raw.replace(/[^\d.,-]/g, "");
    if (!cleaned) return null;

    let s = cleaned.replace(/-/g, "");
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");

    let decimalSep = null;
    if (hasDot && hasComma) {
        decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    } else if (hasComma) {
        decimalSep = ",";
    } else if (hasDot) {
        decimalSep = ".";
    }

    let normalized = s;
    if (decimalSep) {
        const thousandsSep = decimalSep === "." ? "," : ".";
        normalized = normalized.split(thousandsSep).join("");
        normalized = normalized.replace(decimalSep, ".");
    }

    const num = Number.parseFloat(normalized);
    if (!Number.isFinite(num)) return null;
    return isNegative ? -num : num;
}

function safeString(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function categorizeRow(row, amount) {
    const name = safeString(row.transactionName).toLowerCase();
    const note = safeString(row.note).toLowerCase();
    const reference = safeString(row.reference).toLowerCase();

    if (name.includes("transaktionsavgifter") || note.includes("platform fee")) {
        return { category: "platform_fee", label: "Transaktionsavgifter (Monta)", direction: "cost" };
    }
    if (name.includes("laddningsavgift") || note.includes("percentage operator fee")) {
        return { category: "operator_fee", label: "Laddningsavgift (%)", direction: "cost" };
    }
    if (name.includes("abonnemang") || reference.includes("subscription_purchase") || note.includes("subscription")) {
        return { category: "subscription", label: "Operatörsabonnemang", direction: "cost" };
    }
    if (name.includes("inkommande roaming")) {
        return { category: "roaming_revenue", label: "Inkommande roaming (CPO)", direction: "revenue" };
    }
    if (name.includes("laddningssessioner")) {
        return { category: "charging_revenue", label: "Laddningssessioner", direction: "revenue" };
    }

    const inferredDirection = amount < 0 ? "cost" : "revenue";
    return { category: "uncategorized", label: "Okänd", direction: inferredDirection };
}

function ensureStats(map, key, label, direction) {
    if (!map.has(key)) {
        map.set(key, {
            category: key,
            label,
            direction,
            rows: 0,
            net: 0,
            vat: 0,
            gross: 0,
            net_abs: 0,
            vat_abs: 0,
            gross_abs: 0,
            vat_rates: {}
        });
    }
    return map.get(key);
}

function addVatRate(stats, vatRate, net, vat, gross) {
    const rateKey = vatRate === null || vatRate === undefined ? "unknown" : String(vatRate);
    if (!stats.vat_rates[rateKey]) {
        stats.vat_rates[rateKey] = { rows: 0, net_abs: 0, vat_abs: 0, gross_abs: 0 };
    }
    const entry = stats.vat_rates[rateKey];
    entry.rows += 1;
    entry.net_abs += Math.abs(net);
    entry.vat_abs += Math.abs(vat);
    entry.gross_abs += Math.abs(gross);
}

function round2(value) {
    return Number(value.toFixed(2));
}

const { inputPath, outPath, sheet } = parseArgs(process.argv.slice(2));
if (!inputPath) {
    usage();
    process.exit(1);
}

const ext = path.extname(inputPath).toLowerCase();
if (ext === ".numbers") {
    console.error(".numbers files are not supported. Export as .xlsx or .csv and try again.");
    process.exit(2);
}

if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
}

const workbook = XLSX.readFile(inputPath, { raw: true, cellDates: false });
const sheetName = sheet || workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
if (!worksheet) {
    console.error(`Sheet not found: ${sheetName}`);
    process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
const categoryStats = new Map();
const vatRateStats = new Map();
const warnings = [];
const unknownRows = [];
const currencies = new Set();

let totalRows = 0;
let emptyRows = 0;

const totals = {
    costs: { net: 0, vat: 0, gross: 0, net_abs: 0, vat_abs: 0, gross_abs: 0, rows: 0 },
    revenues: { net: 0, vat: 0, gross: 0, net_abs: 0, vat_abs: 0, gross_abs: 0, rows: 0 }
};

const zeroVatTotals = { rows: 0, net_abs: 0, vat_abs: 0, gross_abs: 0, categories: {} };

for (const row of rows) {
    const isEmpty = Object.values(row).every((value) => value === "" || value === null || value === undefined);
    if (isEmpty) {
        emptyRows += 1;
        continue;
    }

    totalRows += 1;

    const amount = parseNumber(row.amount) ?? 0;
    const subAmountRaw = parseNumber(row.subAmount);
    const vatRaw = parseNumber(row.vat);
    let vatRateRaw = parseNumber(row.vatRate);

    const net = subAmountRaw ?? (vatRaw !== null ? amount - vatRaw : amount);
    const vat = vatRaw ?? (subAmountRaw !== null ? amount - subAmountRaw : 0);
    const gross = Number.isFinite(amount) ? amount : net + vat;

    const normalizedRate = vatRateRaw === null || vatRateRaw === undefined ? null : Math.abs(vatRateRaw);
    const knownRates = [0, 6, 12, 25];
    const isKnownRate = normalizedRate !== null && knownRates.some((rate) => Math.abs(normalizedRate - rate) <= 0.5);

    if (vatRateRaw === null || !isKnownRate) {
        if (net !== 0) {
            const inferred = Math.abs((vat / net) * 100);
            if (Number.isFinite(inferred)) {
                vatRateRaw = round2(inferred);
            }
        }
    } else if (normalizedRate !== null) {
        vatRateRaw = round2(normalizedRate);
    }

    const currency = safeString(row.currency);
    if (currency) {
        const normalizedCurrency = currency.toUpperCase();
        if (/^[A-Z]{3}$/.test(normalizedCurrency)) {
            currencies.add(normalizedCurrency);
        }
    }

    const { category, label, direction } = categorizeRow(row, gross);
    const stats = ensureStats(categoryStats, category, label, direction);

    stats.rows += 1;
    stats.net += net;
    stats.vat += vat;
    stats.gross += gross;
    stats.net_abs += Math.abs(net);
    stats.vat_abs += Math.abs(vat);
    stats.gross_abs += Math.abs(gross);
    addVatRate(stats, vatRateRaw, net, vat, gross);

    const directionTotals = direction === "revenue" ? totals.revenues : totals.costs;
    directionTotals.rows += 1;
    directionTotals.net += net;
    directionTotals.vat += vat;
    directionTotals.gross += gross;
    directionTotals.net_abs += Math.abs(net);
    directionTotals.vat_abs += Math.abs(vat);
    directionTotals.gross_abs += Math.abs(gross);

    const vatKey = vatRateRaw === null || vatRateRaw === undefined ? "unknown" : String(vatRateRaw);
    if (!vatRateStats.has(vatKey)) {
        vatRateStats.set(vatKey, { vat_rate: vatKey, rows: 0, net_abs: 0, vat_abs: 0, gross_abs: 0 });
    }
    const vatStats = vatRateStats.get(vatKey);
    vatStats.rows += 1;
    vatStats.net_abs += Math.abs(net);
    vatStats.vat_abs += Math.abs(vat);
    vatStats.gross_abs += Math.abs(gross);

    if (Number(vatRateRaw) === 0 || Math.abs(vat) < 0.0001) {
        zeroVatTotals.rows += 1;
        zeroVatTotals.net_abs += Math.abs(net);
        zeroVatTotals.vat_abs += Math.abs(vat);
        zeroVatTotals.gross_abs += Math.abs(gross);
        zeroVatTotals.categories[category] = (zeroVatTotals.categories[category] || 0) + Math.abs(net);
    }

    if (category === "uncategorized") {
        if (unknownRows.length < 20) {
            unknownRows.push({
                id: safeString(row.id),
                transactionName: safeString(row.transactionName),
                amount: gross,
                vatRate: vatRateRaw,
                note: safeString(row.note)
            });
        }
    }
}

if (currencies.size > 1) {
    warnings.push(`Multiple currencies detected: ${Array.from(currencies).join(", ")}`);
}

const categories = Array.from(categoryStats.values()).map((stats) => ({
    ...stats,
    net: round2(stats.net),
    vat: round2(stats.vat),
    gross: round2(stats.gross),
    net_abs: round2(stats.net_abs),
    vat_abs: round2(stats.vat_abs),
    gross_abs: round2(stats.gross_abs)
})).sort((a, b) => b.net_abs - a.net_abs);

const vatRates = Array.from(vatRateStats.values()).map((stats) => ({
    ...stats,
    net_abs: round2(stats.net_abs),
    vat_abs: round2(stats.vat_abs),
    gross_abs: round2(stats.gross_abs)
})).sort((a, b) => b.gross_abs - a.gross_abs);

const getCategorySummary = (key) => {
    const stats = categoryStats.get(key);
    if (!stats) {
        return { rows: 0, net_abs: 0, vat_abs: 0, gross_abs: 0 };
    }
    return {
        rows: stats.rows,
        net_abs: round2(stats.net_abs),
        vat_abs: round2(stats.vat_abs),
        gross_abs: round2(stats.gross_abs)
    };
};

const report = {
    generated_at: new Date().toISOString(),
    input: {
        file: path.basename(inputPath),
        sheet: sheetName,
        rows_total: rows.length,
        rows_used: totalRows,
        rows_empty: emptyRows,
        currencies: Array.from(currencies)
    },
    totals: {
        costs: {
            ...totals.costs,
            net: round2(totals.costs.net),
            vat: round2(totals.costs.vat),
            gross: round2(totals.costs.gross),
            net_abs: round2(totals.costs.net_abs),
            vat_abs: round2(totals.costs.vat_abs),
            gross_abs: round2(totals.costs.gross_abs)
        },
        revenues: {
            ...totals.revenues,
            net: round2(totals.revenues.net),
            vat: round2(totals.revenues.vat),
            gross: round2(totals.revenues.gross),
            net_abs: round2(totals.revenues.net_abs),
            vat_abs: round2(totals.revenues.vat_abs),
            gross_abs: round2(totals.revenues.gross_abs)
        }
    },
    vat_rates: vatRates,
    categories,
    monta_fees: {
        platform_fee: getCategorySummary("platform_fee"),
        operator_fee: getCategorySummary("operator_fee"),
        subscription: getCategorySummary("subscription")
    },
    zero_vat: {
        ...zeroVatTotals,
        net_abs: round2(zeroVatTotals.net_abs),
        vat_abs: round2(zeroVatTotals.vat_abs),
        gross_abs: round2(zeroVatTotals.gross_abs)
    },
    unknown_rows: unknownRows,
    warnings
};

const output = JSON.stringify(report, null, 2);
if (outPath) {
    fs.writeFileSync(outPath, output);
    console.log(`Report written to ${outPath}`);
} else {
    console.log(output);
}
