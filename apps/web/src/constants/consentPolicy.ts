import type { LegalDocType } from './legalDocs';

export const DPA_ENFORCEMENT_START_ISO = '2026-02-17T00:00:00Z';

const LEGACY_REQUIRED_DOCS: LegalDocType[] = ['terms', 'privacy'];
const NEW_COHORT_REQUIRED_DOCS: LegalDocType[] = ['terms', 'privacy', 'dpa'];

function toTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
}

export function isNewCohort(userCreatedAt: string | null | undefined): boolean {
    const createdAtTs = toTimestamp(userCreatedAt);
    const enforcementTs = toTimestamp(DPA_ENFORCEMENT_START_ISO);

    if (createdAtTs === null || enforcementTs === null) {
        return false;
    }

    return createdAtTs >= enforcementTs;
}

export function getRequiredDocsForUser(userCreatedAt: string | null | undefined): LegalDocType[] {
    return isNewCohort(userCreatedAt) ? NEW_COHORT_REQUIRED_DOCS : LEGACY_REQUIRED_DOCS;
}
