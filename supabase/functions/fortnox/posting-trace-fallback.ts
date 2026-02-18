import type {
    FortnoxVoucherListResponse,
    FortnoxVoucherResponse,
} from "./types.ts";
import {
    FortnoxApiError,
    FortnoxClientError,
} from "../../services/FortnoxErrors.ts";

export interface VoucherListPagination {
    page?: number;
    limit?: number;
    allPages?: boolean;
}

export interface VoucherListSearch {
    fromDate?: string;
    toDate?: string;
}

type VoucherListService = {
    getVouchers(
        financialYear?: number,
        voucherSeries?: string,
        pagination?: VoucherListPagination,
        search?: VoucherListSearch
    ): Promise<FortnoxVoucherListResponse>;
};

type VoucherDetailService = {
    getVoucher(
        voucherSeries: string,
        voucherNumber: number,
        financialYear?: number
    ): Promise<FortnoxVoucherResponse>;
};

export interface VoucherListFallbackResult {
    response: FortnoxVoucherListResponse;
    usedFallback: boolean;
    initialStatusCode?: number;
}

export interface VoucherDetailFallbackResult {
    response: FortnoxVoucherResponse;
    usedFallback: boolean;
    initialStatusCode?: number;
}

export function getFortnoxStatusCode(error: unknown): number | undefined {
    if (error instanceof FortnoxApiError) {
        return error.statusCode;
    }
    return undefined;
}

export function shouldPropagatePostingTraceError(error: unknown): boolean {
    const statusCode = getFortnoxStatusCode(error);
    return statusCode === 401 || statusCode === 403;
}

export async function getVouchersWithYearFallback(
    service: VoucherListService,
    financialYear: number | undefined,
    pagination: VoucherListPagination,
    search?: VoucherListSearch
): Promise<VoucherListFallbackResult> {
    if (financialYear === undefined) {
        return {
            response: await service.getVouchers(undefined, undefined, pagination, search),
            usedFallback: false,
        };
    }

    try {
        return {
            response: await service.getVouchers(financialYear, undefined, pagination, search),
            usedFallback: false,
        };
    } catch (error) {
        if (!(error instanceof FortnoxClientError)) {
            throw error;
        }

        const initialStatusCode = getFortnoxStatusCode(error);
        const response = await service.getVouchers(undefined, undefined, pagination, search);
        return {
            response,
            usedFallback: true,
            initialStatusCode,
        };
    }
}

export async function getVoucherWithYearFallback(
    service: VoucherDetailService,
    voucherSeries: string,
    voucherNumber: number,
    financialYear?: number
): Promise<VoucherDetailFallbackResult> {
    if (financialYear === undefined) {
        return {
            response: await service.getVoucher(voucherSeries, voucherNumber),
            usedFallback: false,
        };
    }

    try {
        return {
            response: await service.getVoucher(voucherSeries, voucherNumber, financialYear),
            usedFallback: false,
        };
    } catch (error) {
        if (!(error instanceof FortnoxClientError)) {
            throw error;
        }

        const initialStatusCode = getFortnoxStatusCode(error);
        const response = await service.getVoucher(voucherSeries, voucherNumber);
        return {
            response,
            usedFallback: true,
            initialStatusCode,
        };
    }
}
