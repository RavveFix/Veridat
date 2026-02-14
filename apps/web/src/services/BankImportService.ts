import type { BankImport } from '../types/bank';
import type { BankImportRecord } from '../types/finance';
import { logger } from './LoggerService';
import { financeAgentService } from './FinanceAgentService';

type BankImportStore = Record<string, BankImport[]>;

class BankImportService {
    private cache: BankImportStore = {};

    getImports(companyId: string): BankImport[] {
        return this.cache[companyId] ? [...this.cache[companyId]] : [];
    }

    async refreshImports(companyId: string): Promise<BankImport[]> {
        try {
            const imports = await financeAgentService.refreshBankImports(companyId);
            this.cache[companyId] = imports as unknown as BankImport[];
            return [...this.cache[companyId]];
        } catch (error) {
            logger.warn('Failed to refresh bank imports from finance-agent', error);
            return this.getImports(companyId);
        }
    }

    async saveImport(companyId: string, data: BankImport): Promise<BankImport> {
        await financeAgentService.importBankTransactions(companyId, data as unknown as BankImportRecord);
        const refreshed = await this.refreshImports(companyId);
        const saved = refreshed.find((entry) => entry.id === data.id) || data;
        logger.info('Bank import saved via finance-agent', { companyId, importId: saved.id, rows: saved.rowCount });
        return saved;
    }
}

export const bankImportService = new BankImportService();
