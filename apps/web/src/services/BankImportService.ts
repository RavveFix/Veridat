import type { BankImport } from '../types/bank';
import { logger } from './LoggerService';

const STORAGE_KEY = 'bankImports';

type BankImportStore = Record<string, BankImport[]>;

class BankImportService {
    private readStore(): BankImportStore {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            if (parsed && typeof parsed === 'object') {
                return parsed as BankImportStore;
            }
        } catch (error) {
            logger.warn('Failed to read bank import store', error);
        }
        return {};
    }

    private writeStore(store: BankImportStore): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (error) {
            logger.warn('Failed to persist bank import store', error);
        }
    }

    getImports(companyId: string): BankImport[] {
        const store = this.readStore();
        return store[companyId] ? [...store[companyId]] : [];
    }

    saveImport(companyId: string, data: BankImport): BankImport {
        const store = this.readStore();
        const imports = store[companyId] ? [...store[companyId]] : [];
        imports.unshift(data);
        store[companyId] = imports;
        this.writeStore(store);
        logger.info('Bank import saved', { companyId, importId: data.id, rows: data.rowCount });
        return data;
    }
}

export const bankImportService = new BankImportService();
