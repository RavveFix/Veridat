/**
 * Swedish BAS Chart of Accounts (Kontoplan)
 *
 * Standard accounts for Swedish bookkeeping used by Veridat.
 * Based on BAS 2024 with focus on EV charging/CPO operations.
 *
 * Account ranges:
 * - 1xxx: Assets (Tillgångar)
 * - 2xxx: Liabilities (Skulder)
 * - 3xxx: Revenue (Intäkter)
 * - 4xxx: Costs of goods sold (Varuinköp)
 * - 5-6xxx: Operating expenses (Övriga kostnader)
 * - 7xxx: Personnel costs (Personal)
 * - 8xxx: Financial items (Finansiella poster)
 */

export interface BASAccount {
    account: string;
    name: string;
    description?: string;
}

// Comprehensive BAS accounts for Swedish small businesses (BAS 2024)
export const BAS_ACCOUNTS = {

    // =========================================================================
    // 1xxx — TILLGÅNGAR (Assets)
    // =========================================================================
    BUILDINGS: {
        account: '1110',
        name: 'Byggnader',
        description: 'Kontor, lager, fabrik (avskrivning 2-4%)',
    },
    LAND_IMPROVEMENTS: {
        account: '1150',
        name: 'Markanläggningar',
        description: 'Parkering, vägar, inhägnader på mark',
    },
    COMPUTERS: {
        account: '1210',
        name: 'Maskiner och inventarier',
        description: 'Datorer, servrar och IT-utrustning (tillgångar > halvårsgräns)',
    },
    FURNITURE: {
        account: '1220',
        name: 'Inventarier och verktyg',
        description: 'Kontorsmöbler, verktyg, inredning (tillgångar > halvårsgräns)',
    },
    INSTALLATIONS: {
        account: '1230',
        name: 'Installationer',
        description: 'El, VVS, hiss, ventilation i annans fastighet',
    },
    VEHICLES: {
        account: '1240',
        name: 'Bilar och transportmedel',
        description: 'Företagsbilar, lastbilar, transportfordon (tillgång)',
    },
    LEASED_ASSETS: {
        account: '1260',
        name: 'Leasade tillgångar',
        description: 'Finansiell leasing (K3), kapitaliserade leasingavtal',
    },
    WIP_ASSETS: {
        account: '1280',
        name: 'Pågående nyanläggningar',
        description: 'Investeringar under uppförande',
    },
    SHARES_GROUP: {
        account: '1310',
        name: 'Andelar i koncernföretag',
        description: 'Aktier i dotterbolag',
    },
    RECEIVABLES_GROUP: {
        account: '1320',
        name: 'Fordringar på koncernföretag',
        description: 'Långfristiga fordringar inom koncernen',
    },
    OTHER_LT_RECEIVABLES: {
        account: '1380',
        name: 'Andra långfristiga fordringar',
        description: 'Depositioner, kautioner',
    },
    TAX_RECEIVABLES: {
        account: '1460',
        name: 'Skattefordringar',
        description: 'Tillgodo hos Skatteverket',
    },
    OTHER_ST_RECEIVABLES: {
        account: '1480',
        name: 'Övriga kortfristiga fordringar',
        description: 'Diverse kortfristiga fordringar',
    },
    ACCOUNTS_RECEIVABLE: {
        account: '1510',
        name: 'Kundfordringar',
        description: 'Utestående kundfordringar',
    },
    EMPLOYEE_RECEIVABLES: {
        account: '1610',
        name: 'Fordringar hos anställda',
        description: 'Reseförskott, lån till personal',
    },
    TAX_ACCOUNT: {
        account: '1630',
        name: 'Skattekonto',
        description: 'Avräkning med Skatteverket',
    },
    PREPAID_RENT: {
        account: '1710',
        name: 'Förutbetalda hyreskostnader',
        description: 'Förskottsbetalda hyror',
    },
    PREPAID_INSURANCE: {
        account: '1720',
        name: 'Förutbetalda försäkringspremier',
        description: 'Förskottsbetalda försäkringar',
    },
    OTHER_PREPAID: {
        account: '1790',
        name: 'Övriga förutbetalda kostnader',
        description: 'Förutbetalda licenser, abonnemang, interimsfordringar',
    },
    CASH_REGISTER: {
        account: '1910',
        name: 'Kassa',
        description: 'Kontantkassa',
    },
    BANK: {
        account: '1930',
        name: 'Företagskonto',
        description: 'Huvudkonto för affärsverksamhet',
    },

    // =========================================================================
    // 2xxx — SKULDER & EGET KAPITAL (Liabilities & Equity)
    // =========================================================================
    SHARE_CAPITAL: {
        account: '2081',
        name: 'Aktiekapital',
        description: 'Aktiekapital (AB)',
    },
    RETAINED_EARNINGS: {
        account: '2091',
        name: 'Balanserad vinst eller förlust',
        description: 'Ackumulerat resultat från tidigare år',
    },
    PREV_YEAR_RESULT: {
        account: '2098',
        name: 'Vinst eller förlust föregående år',
        description: 'Föregående års resultat (omförs till 2091)',
    },
    CURRENT_YEAR_RESULT: {
        account: '2099',
        name: 'Årets resultat',
        description: 'Årets resultat (bokslutskonto)',
    },
    OVERDRAFT: {
        account: '2220',
        name: 'Checkräkningskredit',
        description: 'Beviljad kredit på bankkonto',
    },
    LONG_TERM_LOANS: {
        account: '2350',
        name: 'Övriga långfristiga skulder',
        description: 'Banklån, företagslån (> 1 år)',
    },
    ACCOUNTS_PAYABLE: {
        account: '2440',
        name: 'Leverantörsskulder',
        description: 'Skulder till leverantörer',
    },
    TAX_LIABILITIES: {
        account: '2510',
        name: 'Skatteskulder',
        description: 'F-skatt, preliminärskatt att betala',
    },
    VAT_OUT_25: {
        account: '2611',
        name: 'Utgående moms 25%',
        description: 'Moms att betala på försäljning 25%',
    },
    VAT_OUT_12: {
        account: '2621',
        name: 'Utgående moms 12%',
        description: 'Moms att betala på försäljning 12%',
    },
    VAT_OUT_6: {
        account: '2631',
        name: 'Utgående moms 6%',
        description: 'Moms att betala på försäljning 6%',
    },
    VAT_IN: {
        account: '2641',
        name: 'Ingående moms',
        description: 'Avdragsgill moms på inköp',
    },
    VAT_SETTLEMENT: {
        account: '2650',
        name: 'Momsredovisning',
        description: 'Avräkningskonto för moms',
    },
    PERSONNEL_TAX: {
        account: '2710',
        name: 'Personalskatt',
        description: 'Innehållen preliminärskatt på löner',
    },
    SOCIAL_CHARGES_PAYABLE: {
        account: '2731',
        name: 'Avräkning sociala avgifter',
        description: 'Arbetsgivaravgifter att betala',
    },
    ACCRUED_VACATION: {
        account: '2920',
        name: 'Upplupna semesterlöner',
        description: 'Semesterlöneskuld till anställda',
    },
    ACCRUED_SOCIAL_CHARGES: {
        account: '2940',
        name: 'Upplupna sociala avgifter',
        description: 'Semesterlöner × 31,42% arbetsgivaravgifter',
    },
    OTHER_ACCRUED: {
        account: '2990',
        name: 'Övriga upplupna kostnader',
        description: 'Upplupna räntor, arvoden, interimsskulder',
    },

    // =========================================================================
    // 3xxx — INTÄKTER (Revenue)
    // =========================================================================
    SALES_25: {
        account: '3010',
        name: 'Försäljning tjänster 25% moms',
        description: 'Laddningsintäkter med 25% moms',
    },
    SALES_12: {
        account: '3011',
        name: 'Försäljning tjänster 12% moms',
        description: 'Tjänster med 12% moms (restaurang, hotell). OBS: Livsmedel 6% fr.o.m. 2026-04-01.',
    },
    SALES_6: {
        account: '3012',
        name: 'Försäljning tjänster 6% moms',
        description: 'Tjänster med 6% moms (kultur, böcker)',
    },
    SALES_0: {
        account: '3013',
        name: 'Försäljning momsfri',
        description: 'Momsfri försäljning (omvänd skattskyldighet)',
    },
    SALES_ROAMING: {
        account: '3014',
        name: 'Roamingintäkter',
        description: 'Intäkter från roaming-laddning (OCPI)',
    },
    SALES_GOODS_25: {
        account: '3040',
        name: 'Försäljning varor 25% moms',
        description: 'Varuförsäljning med 25% moms',
    },
    SERVICE_EXPORT_EU: {
        account: '3305',
        name: 'Tjänsteförsäljning inom EU',
        description: 'Momsfri tjänsteexport inom EU (omvänd skattskyldighet)',
    },
    SERVICE_EXPORT_NON_EU: {
        account: '3308',
        name: 'Tjänsteförsäljning utanför EU',
        description: 'Momsfri tjänsteexport utanför EU',
    },
    GOODS_EXPORT_EU: {
        account: '3105',
        name: 'Varuförsäljning EU',
        description: 'Momsfri varuförsäljning inom EU (gemenskapsintern)',
    },
    GOODS_EXPORT_NON_EU: {
        account: '3106',
        name: 'Varuförsäljning export',
        description: 'Momsfri export utanför EU',
    },
    OTHER_OPERATING_INCOME: {
        account: '3900',
        name: 'Övriga rörelseintäkter',
        description: 'Vinst vid försäljning av inventarier, periodiseringsfonder, mm',
    },
    RENTAL_INCOME: {
        account: '3910',
        name: 'Hyresintäkter',
        description: 'Intäkter från uthyrning',
    },
    ROUNDING: {
        account: '3740',
        name: 'Öresavrundning',
        description: 'Öresavrundning vid betalning',
    },

    // =========================================================================
    // 4xxx — VARUINKÖP / COGS
    // =========================================================================
    PURCHASES: {
        account: '4010',
        name: 'Varuinköp',
        description: 'Varor för återförsäljning',
    },
    PURCHASES_EU: {
        account: '4515',
        name: 'Inköp varor EU',
        description: 'Varuinköp inom EU (gemenskapsinterna förvärv)',
    },
    PURCHASES_NON_EU: {
        account: '4516',
        name: 'Inköp varor utanför EU',
        description: 'Import av varor från tredjeland',
    },
    SERVICE_IMPORT: {
        account: '4531',
        name: 'Import av tjänster',
        description: 'Tjänsteinköp utanför Sverige (omvänd skattskyldighet)',
    },
    MATERIALS: {
        account: '4400',
        name: 'Förbrukningsinventarier och förbrukningsmaterial',
        description: 'Material, verktyg, tillbehör i produktion',
    },
    SUBCONTRACTED_WORK: {
        account: '4600',
        name: 'Legoarbeten',
        description: 'Underentreprenader, legotillverkning',
    },

    // =========================================================================
    // 5xxx — LOKALKOSTNADER & RÖRELSEKOSTNADER
    // =========================================================================
    RENT: {
        account: '5010',
        name: 'Lokalhyra',
        description: 'Hyra för kontors-/affärslokaler',
    },
    ELECTRICITY: {
        account: '5020',
        name: 'El',
        description: 'Elkostnader för lokaler',
    },
    HEATING: {
        account: '5030',
        name: 'Värme',
        description: 'Uppvärmningskostnader',
    },
    WATER: {
        account: '5040',
        name: 'Vatten och avlopp',
        description: 'Vatten- och avloppsavgifter',
    },
    CLEANING: {
        account: '5060',
        name: 'Städning och renhållning',
        description: 'Städtjänster, renhållning, sophämtning',
    },
    REPAIR_MAINTENANCE: {
        account: '5070',
        name: 'Reparation och underhåll',
        description: 'Reparation och underhåll av lokaler/inventarier',
    },
    CONSUMABLES: {
        account: '5400',
        name: 'Förbrukningsinventarier',
        description: 'Inventarier under halvårsgräns (tangentbord, stolar, etc.)',
    },
    CONSUMABLE_MATERIALS: {
        account: '5460',
        name: 'Förbrukningsmaterial',
        description: 'Material som förbrukas (ej inventarier)',
    },
    FUEL: {
        account: '5611',
        name: 'Drivmedel personbilar',
        description: 'Bensin, diesel, el-laddning för personbilar',
    },
    VEHICLE_LEASE: {
        account: '5615',
        name: 'Leasing personbilar',
        description: 'Leasingavgifter för personbilar',
    },
    TRAVEL: {
        account: '5800',
        name: 'Resekostnader',
        description: 'Tjänsteresor, flyg, tåg, hotell',
    },
    TRAVEL_ALLOWANCE: {
        account: '5810',
        name: 'Biljetter',
        description: 'Flyg, tåg, buss, taxi',
    },
    ACCOMMODATION: {
        account: '5820',
        name: 'Hotell och logi',
        description: 'Boende vid tjänsteresor',
    },
    PER_DIEM_DOMESTIC: {
        account: '5831',
        name: 'Traktamenten inrikes',
        description: 'Traktamente vid inrikes tjänsteresor',
    },
    PER_DIEM_ABROAD: {
        account: '5832',
        name: 'Traktamenten utrikes',
        description: 'Traktamente vid utrikes tjänsteresor',
    },
    ADVERTISING: {
        account: '5910',
        name: 'Annonsering',
        description: 'Reklam, PR, digital marknadsföring',
    },
    PRINTED_MARKETING: {
        account: '5930',
        name: 'Reklamtrycksaker',
        description: 'Tryckt marknadsföringsmaterial, visitkort',
    },

    // =========================================================================
    // 6xxx — ÖVRIGA EXTERNA KOSTNADER
    // =========================================================================
    ENTERTAINMENT_DEDUCTIBLE: {
        account: '6071',
        name: 'Representation, avdragsgill',
        description: 'Representation med momsavdrag',
    },
    ENTERTAINMENT_NON_DEDUCTIBLE: {
        account: '6072',
        name: 'Representation, ej avdragsgill',
        description: 'Representation utan momsavdrag',
    },
    OFFICE_SUPPLIES: {
        account: '6110',
        name: 'Kontorsmaterial',
        description: 'Kontorsmaterial och förbrukningsinventarier',
    },
    TELEPHONE: {
        account: '6211',
        name: 'Telefon',
        description: 'Fast telefoni',
    },
    MOBILE_PHONE: {
        account: '6212',
        name: 'Mobiltelefon',
        description: 'Mobiltelefonkostnader',
    },
    DATA_COMMUNICATIONS: {
        account: '6230',
        name: 'Datakommunikation',
        description: 'Internet, fiber, bredband',
    },
    POSTAGE: {
        account: '6250',
        name: 'Porto',
        description: 'Porto och fraktavgifter (brev)',
    },
    INSURANCE: {
        account: '6310',
        name: 'Företagsförsäkringar',
        description: 'Sakförsäkringar, ansvarsförsäkringar',
    },
    VEHICLE_INSURANCE: {
        account: '6350',
        name: 'Bilförsäkring',
        description: 'Försäkring för företagsbilar',
    },
    LEASING: {
        account: '6340',
        name: 'Leasingavgifter',
        description: 'Leasing av utrustning (ej fordon)',
    },
    FREIGHT: {
        account: '6420',
        name: 'Frakter och transporter',
        description: 'Fraktkostnader',
    },
    PAYROLL_ADMIN: {
        account: '6423',
        name: 'Löneadministration',
        description: 'Lönehantering, lönebyrå',
    },
    ACCOUNTING_SERVICES: {
        account: '6530',
        name: 'Redovisningstjänster',
        description: 'Löpande bokföring, bokslut, deklarationer, revision, ekonomibyrå',
    },
    SUBSCRIPTION: {
        account: '6540',
        name: 'IT-tjänster, abonnemang',
        description: 'Programvara, SaaS, hosting, abonnemang',
    },
    CONSULTANCY: {
        account: '6550',
        name: 'Konsultarvoden',
        description: 'Övriga konsulter (management, strategi, teknik) — EJ redovisning/juridik/IT',
    },
    SERVICE_FEES: {
        account: '6560',
        name: 'Serviceavgifter',
        description: 'Swish, Klarna, Stripe, betalningsförmedling',
    },
    BANK_FEES: {
        account: '6570',
        name: 'Bankavgifter, transaktionsavgifter',
        description: 'Bank- och betalningsavgifter',
    },
    LEGAL_FEES: {
        account: '6580',
        name: 'Advokat- och rättegångskostnader',
        description: 'Juridisk rådgivning, advokat, rättegångskostnader',
    },
    EXTERNAL_SERVICES: {
        account: '6590',
        name: 'Övriga externa tjänster',
        description: 'Tjänster som inte passar ovan',
    },
    PLATFORM_FEES: {
        account: '6591',
        name: 'Plattformsavgifter',
        description: 'Avgifter till Monta och andra plattformar',
    },
    OPERATOR_FEES: {
        account: '6592',
        name: 'Operatörsavgifter',
        description: 'Avgifter till elnätsoperatörer',
    },
    TEMP_STAFF: {
        account: '6800',
        name: 'Inhyrd personal',
        description: 'Bemanningsföretag, tillfällig personal',
    },
    EDUCATION: {
        account: '6910',
        name: 'Utbildning',
        description: 'Kurser, konferenser, vidareutbildning',
    },
    MEMBERSHIP_FEES: {
        account: '6980',
        name: 'Föreningsavgifter',
        description: 'Branschorganisationer, fackförbund, nätverk',
    },

    // =========================================================================
    // 7xxx — PERSONALKOSTNADER
    // =========================================================================
    SALARIES: {
        account: '7010',
        name: 'Löner till tjänstemän',
        description: 'Bruttolöner till tjänstemän/kontorsanställda',
    },
    SALARIES_WORKERS: {
        account: '7210',
        name: 'Löner till kollektivanställda',
        description: 'Bruttolöner till produktions-/lagerarbetare',
    },
    BOARD_FEES: {
        account: '7240',
        name: 'Styrelsearvoden',
        description: 'Arvoden till styrelseledamöter',
    },
    SICK_PAY: {
        account: '7081',
        name: 'Sjuklöner',
        description: 'Sjuklön dag 1-14',
    },
    VACATION_PAY: {
        account: '7082',
        name: 'Semesterlöner',
        description: 'Utbetalda semesterlöner',
    },
    BENEFITS_TAXABLE: {
        account: '7385',
        name: 'Förmånsvärde, bil/bostad',
        description: 'Skattepliktigt förmånsvärde (kvittning med 7385K)',
    },
    SOCIAL_CHARGES: {
        account: '7510',
        name: 'Arbetsgivaravgifter',
        description: 'Lagstadgade sociala avgifter (31,42%)',
    },
    SPECIAL_PAYROLL_TAX: {
        account: '7530',
        name: 'Särskild löneskatt pension',
        description: 'Löneskatt 24,26% på pensionskostnader',
    },
    PENSION: {
        account: '7533',
        name: 'Avtalspension',
        description: 'Pensionspremier, ITP/SAF-LO',
    },
    PERSONNEL_INSURANCE: {
        account: '7570',
        name: 'Personalförsäkringar',
        description: 'TGL, sjukförsäkring, olycksfallsförsäkring',
    },
    HEALTHCARE: {
        account: '7620',
        name: 'Sjuk- och hälsovård',
        description: 'Friskvård, företagshälsovård',
    },
    STAFF_ENTERTAINMENT_DED: {
        account: '7631',
        name: 'Personalrepresentation, avdragsgill',
        description: 'Intern representation med avdragsrätt',
    },
    STAFF_ENTERTAINMENT_NON_DED: {
        account: '7632',
        name: 'Personalrepresentation, ej avdragsgill',
        description: 'Intern representation utan avdragsrätt',
    },
    OTHER_PERSONNEL: {
        account: '7690',
        name: 'Övriga personalkostnader',
        description: 'Arbetskläder, rekrytering, personalfester',
    },

    // =========================================================================
    // 8xxx — FINANSIELLA POSTER
    // =========================================================================
    DIVIDENDS: {
        account: '8010',
        name: 'Utdelning andelar i koncernföretag',
        description: 'Utdelning från dotterbolag',
    },
    GROUP_RESULT: {
        account: '8070',
        name: 'Resultat vid försäljning av andelar i koncernföretag',
        description: 'Vinst/förlust vid avyttring av koncernbolag',
    },
    INTEREST_INCOME: {
        account: '8300',
        name: 'Ränteintäkter',
        description: 'Ränta på bankkonto, placeringar',
    },
    INTEREST_EXPENSE: {
        account: '8400',
        name: 'Räntekostnader',
        description: 'Ränta på lån, krediter',
    },
    LATE_PAYMENT_INTEREST: {
        account: '8420',
        name: 'Dröjsmålsräntor',
        description: 'Dröjsmålsränta på leverantörsfakturor',
    },
    EXCHANGE_GAINS: {
        account: '8330',
        name: 'Valutakursvinster',
        description: 'Realiserade valutakursvinster',
    },
    EXCHANGE_LOSSES: {
        account: '8430',
        name: 'Valutakursförluster',
        description: 'Realiserade valutakursförluster',
    },
    OTHER_FINANCIAL_EXPENSE: {
        account: '8490',
        name: 'Övriga finansiella kostnader',
        description: 'Garantiavgifter, borgensavgifter, övriga finansiella kostnader',
    },
} as const;

export type BASAccountKey = keyof typeof BAS_ACCOUNTS;

/**
 * Get cost account based on VAT rate and transaction description.
 * Uses intelligent routing to categorize costs.
 */
export function getCostAccount(vatRate: number, description: string): BASAccount {
    const desc = description.toLowerCase();

    // --- Accounting & related (6530 — must check before generic "konsult") ---
    if (
        desc.includes('redovisning') || desc.includes('bokföring') ||
        desc.includes('ekonomibyrå') || desc.includes('deklaration') ||
        desc.includes('bokslut') || desc.includes('årsredovisning') ||
        desc.includes('revision') || desc.includes('revisor')
    ) {
        return BAS_ACCOUNTS.ACCOUNTING_SERVICES;
    }
    if (desc.includes('löneadmin') || desc.includes('lönebyrå') || desc.includes('payroll')) {
        return BAS_ACCOUNTS.PAYROLL_ADMIN;
    }

    // --- IT / Subscriptions ---
    if (
        desc.includes('abonnemang') || desc.includes('subscription') ||
        desc.includes('månadsavgift') || desc.includes('programvara') ||
        desc.includes('saas') || desc.includes('hosting') || desc.includes('licens')
    ) {
        return BAS_ACCOUNTS.SUBSCRIPTION;
    }

    // --- Payment & bank ---
    if (desc.includes('swish') || desc.includes('klarna') || desc.includes('stripe')) {
        return BAS_ACCOUNTS.SERVICE_FEES;
    }
    if (
        desc.includes('transaktionsavgift') || desc.includes('transaction fee') ||
        desc.includes('bankavgift') || desc.includes('kortavgift')
    ) {
        return BAS_ACCOUNTS.BANK_FEES;
    }

    // --- Premises ---
    if (desc.includes('hyra') || desc.includes('lokalhyra')) {
        return BAS_ACCOUNTS.RENT;
    }
    if (desc.includes('städ') || desc.includes('renhållning') || desc.includes('sophämtning')) {
        return BAS_ACCOUNTS.CLEANING;
    }
    if (desc.includes('reparation') || desc.includes('underhåll')) {
        return BAS_ACCOUNTS.REPAIR_MAINTENANCE;
    }

    // --- Vehicles ---
    if (desc.includes('drivmedel') || desc.includes('bensin') || desc.includes('diesel') || desc.includes('tankning')) {
        return BAS_ACCOUNTS.FUEL;
    }
    if (desc.includes('bilförsäkring') || desc.includes('fordonsförsäkring')) {
        return BAS_ACCOUNTS.VEHICLE_INSURANCE;
    }
    if (desc.includes('billeasing') || (desc.includes('leasing') && desc.includes('bil'))) {
        return BAS_ACCOUNTS.VEHICLE_LEASE;
    }

    // --- Insurance (generic, after vehicle) ---
    if (desc.includes('försäkring')) {
        return BAS_ACCOUNTS.INSURANCE;
    }

    // --- Travel ---
    if (desc.includes('traktamente') && desc.includes('utrikes')) {
        return BAS_ACCOUNTS.PER_DIEM_ABROAD;
    }
    if (desc.includes('traktamente')) {
        return BAS_ACCOUNTS.PER_DIEM_DOMESTIC;
    }
    if (desc.includes('resa') || desc.includes('tjänsteresa') || desc.includes('resekostnad')) {
        return BAS_ACCOUNTS.TRAVEL;
    }
    if (desc.includes('hotell') || desc.includes('logi') || desc.includes('boende')) {
        return BAS_ACCOUNTS.ACCOMMODATION;
    }
    if (desc.includes('flyg') || desc.includes('tåg') || desc.includes('biljett') || desc.includes('taxi')) {
        return BAS_ACCOUNTS.TRAVEL_ALLOWANCE;
    }

    // --- Communication ---
    if (desc.includes('internet') || desc.includes('bredband') || desc.includes('fiber') || desc.includes('datakommunikation')) {
        return BAS_ACCOUNTS.DATA_COMMUNICATIONS;
    }
    if (desc.includes('telefon')) {
        return BAS_ACCOUNTS.TELEPHONE;
    }
    if (desc.includes('mobil')) {
        return BAS_ACCOUNTS.MOBILE_PHONE;
    }

    // --- Freight ---
    if (desc.includes('frakt') || desc.includes('transport')) {
        return BAS_ACCOUNTS.FREIGHT;
    }

    // --- Marketing ---
    if (desc.includes('reklam') || desc.includes('annons') || desc.includes('marknadsföring')) {
        return BAS_ACCOUNTS.ADVERTISING;
    }

    // --- Education ---
    if (desc.includes('utbildning') || desc.includes('kurs') || desc.includes('konferens')) {
        return BAS_ACCOUNTS.EDUCATION;
    }

    // --- Membership ---
    if (desc.includes('medlemsavgift') || desc.includes('föreningsavgift')) {
        return BAS_ACCOUNTS.MEMBERSHIP_FEES;
    }

    // --- Leasing (generic, after vehicle) ---
    if (desc.includes('leasing')) {
        return BAS_ACCOUNTS.LEASING;
    }

    // --- Operator fees (EV/CPO) ---
    if (desc.includes('operator fee') || desc.includes('operatörsavgift')) {
        return BAS_ACCOUNTS.OPERATOR_FEES;
    }

    // --- Temp staff (6800) ---
    if (desc.includes('bemanning') || desc.includes('inhyrd') || desc.includes('tillfällig personal')) {
        return BAS_ACCOUNTS.TEMP_STAFF;
    }

    // --- Healthcare / friskvård ---
    if (desc.includes('friskvård') || desc.includes('företagshälsovård') || desc.includes('hälsovård')) {
        return BAS_ACCOUNTS.HEALTHCARE;
    }

    // --- Legal (6580) ---
    if (desc.includes('advokat') || desc.includes('juridisk') || desc.includes('rättegång')) {
        return BAS_ACCOUNTS.LEGAL_FEES;
    }

    // --- Consultancy generic (6550 — after all specific types) ---
    if (desc.includes('konsult')) {
        return BAS_ACCOUNTS.CONSULTANCY;
    }

    // --- Late payment interest (8420) ---
    if (desc.includes('dröjsmålsränta') || desc.includes('förseningsavgift')) {
        return BAS_ACCOUNTS.LATE_PAYMENT_INTEREST;
    }

    // --- Currency gains/losses ---
    if (desc.includes('valutakursvinst') || desc.includes('kursvinst')) {
        return BAS_ACCOUNTS.EXCHANGE_GAINS;
    }
    if (desc.includes('valutakursförlust') || desc.includes('kursförlust')) {
        return BAS_ACCOUNTS.EXCHANGE_LOSSES;
    }

    // --- Platform fees (Monta, etc.) - often 0% VAT ---
    if (
        desc.includes('platform') || desc.includes('plattform') || desc.includes('monta')
    ) {
        return BAS_ACCOUNTS.PLATFORM_FEES;
    }

    // --- Purchases (VAT 0% for platform fees handled above) ---
    if (vatRate === 0) {
        return BAS_ACCOUNTS.PLATFORM_FEES;
    }

    // Default to external services
    return BAS_ACCOUNTS.EXTERNAL_SERVICES;
}

/**
 * Get sales account based on VAT rate and roaming status.
 */
export function getSalesAccount(vatRate: number, isRoaming: boolean = false): BASAccount {
    if (isRoaming) {
        return BAS_ACCOUNTS.SALES_ROAMING;
    }

    switch (vatRate) {
        case 25:
            return BAS_ACCOUNTS.SALES_25;
        case 12:
            return BAS_ACCOUNTS.SALES_12;
        case 6:
            return BAS_ACCOUNTS.SALES_6;
        default:
            return BAS_ACCOUNTS.SALES_0;
    }
}

/**
 * Get VAT account based on rate and direction (in/out).
 */
export function getVATAccount(vatRate: number, isOutgoing: boolean): BASAccount {
    if (!isOutgoing) {
        return BAS_ACCOUNTS.VAT_IN;
    }

    switch (vatRate) {
        case 25:
            return BAS_ACCOUNTS.VAT_OUT_25;
        case 12:
            return BAS_ACCOUNTS.VAT_OUT_12;
        case 6:
            return BAS_ACCOUNTS.VAT_OUT_6;
        default:
            return BAS_ACCOUNTS.VAT_OUT_25; // Default to 25% if rate unknown
    }
}

/**
 * Get account by number
 */
export function getAccountByNumber(accountNumber: string): BASAccount | undefined {
    return Object.values(BAS_ACCOUNTS).find((acc) => acc.account === accountNumber);
}
