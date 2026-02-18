import { assertEquals } from "jsr:@std/assert";
import { normalizeCustomerInvoiceListResponse } from "./customer-invoice-normalization.ts";

Deno.test("normalizeCustomerInvoiceListResponse fyller InvoiceNumber från DocumentNumber", () => {
    const response = {
        Invoices: [
            {
                DocumentNumber: 4123,
                CustomerNumber: "100",
                DueDate: "2026-02-10",
                Total: 1250,
                Balance: 0,
                Booked: true,
            },
        ],
    } as any;

    const normalized = normalizeCustomerInvoiceListResponse(response);
    const invoice = normalized.response.Invoices[0] as unknown as Record<string, unknown>;

    assertEquals(invoice.InvoiceNumber, 4123);
    assertEquals(invoice.DocumentNumber, 4123);
    assertEquals(normalized.diagnostics.filledFromDocumentNumber, 1);
    assertEquals(normalized.diagnostics.missingInvoiceIdCount, 0);
});

Deno.test("normalizeCustomerInvoiceListResponse logik markerar rader utan InvoiceNumber och DocumentNumber", () => {
    const response = {
        Invoices: [
            {
                CustomerNumber: "101",
                DueDate: "2026-02-11",
                Total: 950,
                Balance: 950,
                Booked: false,
            },
        ],
    } as any;

    const normalized = normalizeCustomerInvoiceListResponse(response);
    const invoice = normalized.response.Invoices[0] as unknown as Record<string, unknown>;

    assertEquals(invoice.InvoiceNumber, undefined);
    assertEquals(invoice.DocumentNumber, undefined);
    assertEquals(normalized.diagnostics.filledFromDocumentNumber, 0);
    assertEquals(normalized.diagnostics.missingInvoiceIdCount, 1);
});
