import type { FortnoxInvoiceListResponse } from "./types.ts";

export interface CustomerInvoiceNormalizationDiagnostics {
    filledFromDocumentNumber: number;
    missingInvoiceIdCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toPositiveInteger(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        const rounded = Math.round(value);
        return rounded > 0 ? rounded : null;
    }
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            const rounded = Math.round(parsed);
            return rounded > 0 ? rounded : null;
        }
    }
    return null;
}

export function normalizeCustomerInvoiceListResponse(
    response: FortnoxInvoiceListResponse
): {
    response: FortnoxInvoiceListResponse;
    diagnostics: CustomerInvoiceNormalizationDiagnostics;
} {
    const diagnostics: CustomerInvoiceNormalizationDiagnostics = {
        filledFromDocumentNumber: 0,
        missingInvoiceIdCount: 0,
    };

    const normalizedInvoices = response.Invoices.map((invoice) => {
        const record = asRecord(invoice);
        if (!record) return invoice;

        const invoiceNumber = toPositiveInteger(record.InvoiceNumber);
        const documentNumber = toPositiveInteger(record.DocumentNumber);

        if (invoiceNumber === null && documentNumber !== null) {
            diagnostics.filledFromDocumentNumber += 1;
            return {
                ...invoice,
                InvoiceNumber: documentNumber,
            };
        }

        if (invoiceNumber === null && documentNumber === null) {
            diagnostics.missingInvoiceIdCount += 1;
        }

        return invoice;
    });

    return {
        response: {
            ...response,
            Invoices: normalizedInvoices,
        },
        diagnostics,
    };
}
