
// Test script for Monta Parser Logic
// Run with: deno run test_monta_parser.ts

console.log("🧪 Starting Monta Parser Test...\n");

// 1. Define Mapping (Same as in analyze-excel-ai/index.ts)
const MONTA_MAPPING = {
    amount: 'amount',           // Brutto (inkl moms)
    net_amount: 'subAmount',    // Netto (exkl moms)
    vat_amount: 'vat',          // Momsbelopp
    vat_rate: 'vatRate',        // Momssats %
    kwh: 'kWh',                 // Energimängd
    date: 'startTime',          // Datum
    description: 'chargePointName', // Beskrivning
    roaming_operator: 'roamingOperator', // Identifierar roaming
    roaming_price_group: 'roamingPriceGroupName'
};

// 2. Mock Data (Simulating Excel rows)
// Row 1: Regular Charging (25% VAT)
// Row 2: Roaming Charging (0% VAT, has roamingOperator)
const columns = [
    'transactionId', 'startTime', 'endTime', 'kWh',
    'subAmount', 'vat', 'vatRate', 'amount',
    'chargePointName', 'roamingOperator', 'roamingPriceGroupName'
];

const mockRows = [
    // Row 1: Regular (Net: 100, VAT: 25, Gross: 125)
    [
        '123', '2025-10-01T10:00:00Z', '2025-10-01T11:00:00Z', '20.5',
        '100.00', '25.00', '25', '125.00',
        'Hemma Laddare', '', '' // Empty roaming operator
    ],
    // Row 2: Roaming (Net: 200, VAT: 0, Gross: 200)
    [
        '456', '2025-10-02T12:00:00Z', '2025-10-02T13:00:00Z', '40.0',
        '200.00', '0.00', '0', '200.00',
        'Publik Laddare', 'Ionity', 'Roaming Group A' // Has roaming operator
    ]
];

// 3. Parsing Logic
console.log("🔍 Parsing mock data...");

const colIdx = (name: string) => columns.indexOf(name);

const normalizedTransactions = mockRows.map((row, index) => {
    const r = row as any[];
    const roamingOp = r[colIdx(MONTA_MAPPING.roaming_operator)];
    const isRoaming = !!roamingOp;

    return {
        id: index + 1,
        amount: parseFloat(r[colIdx(MONTA_MAPPING.amount)] || 0),
        net_amount: parseFloat(r[colIdx(MONTA_MAPPING.net_amount)] || 0),
        vat_amount: parseFloat(r[colIdx(MONTA_MAPPING.vat_amount)] || 0),
        vat_rate: parseFloat(r[colIdx(MONTA_MAPPING.vat_rate)] || 0),
        description: r[colIdx(MONTA_MAPPING.description)] || 'Laddning',
        date: r[colIdx(MONTA_MAPPING.date)],
        kwh: parseFloat(r[colIdx(MONTA_MAPPING.kwh)] || 0),
        is_roaming: isRoaming,
        roaming_operator: roamingOp
    };
});

// 4. Verification
console.log("\n📊 Results:");

let passed = true;

// Check Row 1 (Regular)
const t1 = normalizedTransactions[0];
console.log("\nTransaction 1 (Regular):");
console.log(`  Amount: ${t1.amount} (Expected: 125)`);
console.log(`  Net: ${t1.net_amount} (Expected: 100)`);
console.log(`  VAT: ${t1.vat_amount} (Expected: 25)`);
console.log(`  Roaming: ${t1.is_roaming} (Expected: false)`);

if (t1.amount !== 125 || t1.net_amount !== 100 || t1.vat_amount !== 25 || t1.is_roaming !== false) {
    console.error("❌ Transaction 1 FAILED");
    passed = false;
} else {
    console.log("✅ Transaction 1 PASSED");
}

// Check Row 2 (Roaming)
const t2 = normalizedTransactions[1];
console.log("\nTransaction 2 (Roaming):");
console.log(`  Amount: ${t2.amount} (Expected: 200)`);
console.log(`  Net: ${t2.net_amount} (Expected: 200)`);
console.log(`  VAT: ${t2.vat_amount} (Expected: 0)`);
console.log(`  Roaming: ${t2.is_roaming} (Expected: true)`);
console.log(`  Operator: ${t2.roaming_operator} (Expected: Ionity)`);

if (t2.amount !== 200 || t2.net_amount !== 200 || t2.vat_amount !== 0 || t2.is_roaming !== true) {
    console.error("❌ Transaction 2 FAILED");
    passed = false;
} else {
    console.log("✅ Transaction 2 PASSED");
}

console.log("\n-----------------------------------");
if (passed) {
    console.log("🎉 ALL TESTS PASSED! Parser logic is correct.");
} else {
    console.error("💥 SOME TESTS FAILED.");
}
