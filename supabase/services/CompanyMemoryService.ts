// Company Memory Service for Supabase Edge Functions
// Stores small per-company summaries to improve AI continuity across chats.
/// <reference path="../types/deno.d.ts" />

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type CompanyVatMemory = {
    period: string | null;
    total_sales: number | null;
    total_costs: number | null;
    result: number | null;
    outgoing_vat: number | null;
    incoming_vat: number | null;
    net_vat: number | null;
    updated_at: string;
};

export type CompanyMemory = {
    company_name?: string;
    org_number?: string;
    last_vat_report?: CompanyVatMemory;
    notes?: string;
};

type CompanyMemoryRow = {
    memory: CompanyMemory;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function toNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function sumNumbers(values: Array<number | null>): number | null {
    const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (filtered.length === 0) return null;
    return filtered.reduce((sum, v) => sum + v, 0);
}

export function mergeCompanyMemory(existing: CompanyMemory | null, patch: CompanyMemory): CompanyMemory {
    const merged: CompanyMemory = { ...(existing || {}), ...patch };
    if (patch.last_vat_report) {
        merged.last_vat_report = { ...(existing?.last_vat_report || {}), ...patch.last_vat_report };
    }
    return merged;
}

export function buildMemoryPatchFromVatReport(
    reportData: unknown,
    fallback: { period?: string | null; companyName?: string | null; orgNumber?: string | null } = {},
): CompanyMemory {
    if (!isRecord(reportData)) {
        return {};
    }

    const period = toNonEmptyString(reportData.period) || fallback.period || null;

    const companyFromReport = isRecord(reportData.company) ? reportData.company : null;
    const companyName = toNonEmptyString(reportData.company_name)
        || toNonEmptyString(companyFromReport?.name)
        || fallback.companyName
        || undefined;
    const orgNumber = toNonEmptyString(reportData.org_number)
        || toNonEmptyString(companyFromReport?.org_number)
        || fallback.orgNumber
        || undefined;

    const summary = isRecord(reportData.summary) ? reportData.summary : null;
    const totalSales = toNumber(summary?.total_income) ?? toNumber(summary?.total_sales) ?? null;
    const totalCosts = toNumber(summary?.total_costs) ?? null;
    const result = toNumber(summary?.result) ?? null;

    const vat = isRecord(reportData.vat) ? reportData.vat : null;
    const outgoingFromVat = sumNumbers([
        toNumber(vat?.outgoing_25),
        toNumber(vat?.outgoing_12),
        toNumber(vat?.outgoing_6),
    ]);
    const incomingFromVat = toNumber(vat?.incoming);
    const netFromVat = toNumber(vat?.net);

    const outgoingFromSummary = toNumber(summary?.total_sales_vat) ?? null;
    const incomingFromSummary = toNumber(summary?.total_costs_vat) ?? null;

    const outgoingVat = outgoingFromVat ?? outgoingFromSummary;
    const incomingVat = incomingFromVat ?? incomingFromSummary;
    const netVat = netFromVat ?? (
        typeof outgoingVat === "number" && typeof incomingVat === "number"
            ? outgoingVat - incomingVat
            : null
    );

    const hasVat = !!period || !!companyName || !!orgNumber
        || typeof totalSales === "number"
        || typeof totalCosts === "number"
        || typeof result === "number"
        || typeof outgoingVat === "number"
        || typeof incomingVat === "number"
        || typeof netVat === "number";

    if (!hasVat) {
        return {};
    }

    return {
        ...(companyName ? { company_name: companyName } : {}),
        ...(orgNumber ? { org_number: orgNumber } : {}),
        last_vat_report: {
            period,
            total_sales: totalSales,
            total_costs: totalCosts,
            result,
            outgoing_vat: outgoingVat,
            incoming_vat: incomingVat,
            net_vat: netVat,
            updated_at: new Date().toISOString(),
        },
    };
}

export class CompanyMemoryService {
    constructor(private supabase: SupabaseClient) { }

    async get(userId: string, companyId: string): Promise<CompanyMemory | null> {
        const { data, error } = await this.supabase
            .from("company_memory")
            .select("memory")
            .eq("user_id", userId)
            .eq("company_id", companyId)
            .maybeSingle() as { data: CompanyMemoryRow | null; error: Error | null };

        if (error) {
            throw error;
        }

        return data?.memory ?? null;
    }

    async upsert(userId: string, companyId: string, memory: CompanyMemory): Promise<void> {
        const { error } = await this.supabase
            .from("company_memory")
            .upsert(
                {
                    user_id: userId,
                    company_id: companyId,
                    memory,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id,company_id" },
            ) as { error: Error | null };

        if (error) {
            throw error;
        }
    }

    async merge(userId: string, companyId: string, patch: CompanyMemory): Promise<CompanyMemory> {
        const existing = await this.get(userId, companyId);
        const merged = mergeCompanyMemory(existing, patch);
        await this.upsert(userId, companyId, merged);
        return merged;
    }
}

