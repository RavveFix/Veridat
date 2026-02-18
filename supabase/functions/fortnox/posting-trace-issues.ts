export type InvoiceType = "supplier" | "customer";
export type PostingStatus = "booked" | "unbooked" | "unknown";
export type PostingSource = "explicit" | "heuristic" | "none";
export type PostingIssueSeverity = "info" | "warning" | "critical";

export interface PostingCheckResult {
    balanced: boolean;
    total_match: boolean;
    vat_match: boolean;
    control_account_present: boolean;
    row_account_consistency: boolean;
}

export interface PostingIssue {
    code: string;
    severity: PostingIssueSeverity;
    message: string;
    suggestion: string;
}

interface PostingIssueInvoice {
    booked: boolean | null;
}

export function buildPostingIssues(
    invoiceType: InvoiceType,
    invoice: PostingIssueInvoice,
    checks: PostingCheckResult,
    postingStatus: PostingStatus,
    postingSource: PostingSource,
    confidence: number
): PostingIssue[] {
    const issues: PostingIssue[] = [];

    if (invoice.booked !== true && postingStatus !== "booked") {
        issues.push({
            code: "ACTUAL_POSTING_UNAVAILABLE",
            severity: "info",
            message: "Faktisk kontering är inte tillgänglig ännu.",
            suggestion: "Bokför fakturan i Fortnox och öppna konteringen igen.",
        });
    }

    if (postingSource === "heuristic" && confidence < 0.8) {
        issues.push({
            code: "HEURISTIC_MATCH_UNCERTAIN",
            severity: "warning",
            message: "Verifikationsmatchningen är osäker.",
            suggestion: "Verifiera verifikationsnummer manuellt i Fortnox innan attest.",
        });
    }

    if (postingSource === "none" && invoice.booked === true) {
        issues.push({
            code: "VOUCHER_LINK_MISSING",
            severity: "warning",
            message: "Fakturan är bokförd men verifikationen kunde inte kopplas automatiskt.",
            suggestion: "Verifiera serie/nummer i Fortnox. Om felet kvarstår: kontrollera behörighet för Bokföring/Verifikationer och koppla om Fortnox-integrationen.",
        });
    }

    if (!checks.balanced) {
        issues.push({
            code: "UNBALANCED_POSTING",
            severity: "critical",
            message: "Debet och kredit är inte balanserade.",
            suggestion: "Kontrollera konteringsrader och skapa korrigeringsverifikation vid behov.",
        });
    }

    if (!checks.total_match) {
        issues.push({
            code: "TOTAL_MISMATCH",
            severity: "warning",
            message: "Konteringens total matchar inte fakturans totalbelopp.",
            suggestion: "Kontrollera totalbelopp, rabatt och avrundning i fakturan.",
        });
    }

    if (!checks.vat_match) {
        issues.push({
            code: "VAT_MISMATCH",
            severity: "warning",
            message: "Momsen i konteringen matchar inte fakturans moms.",
            suggestion: "Kontrollera momskonto och momssats på fakturan.",
        });
    }

    if (!checks.control_account_present) {
        issues.push({
            code: "CONTROL_ACCOUNT_MISSING",
            severity: "warning",
            message: invoiceType === "supplier"
                ? "Kontrollkonto 2440 saknas i konteringen."
                : "Kontrollkonto 1510/1930 saknas i konteringen.",
            suggestion: "Lägg till korrekt kontrollkonto innan bokföring.",
        });
    }

    if (!checks.row_account_consistency) {
        issues.push({
            code: "ROW_ACCOUNT_CONSISTENCY",
            severity: "warning",
            message: "Kontona avviker från fakturans förväntade rader.",
            suggestion: "Granska kontoval på raderna och justera vid behov.",
        });
    }

    return issues;
}
