import { CURRENT_TERMS_VERSION } from "./termsVersion";

export type LegalDocType = "terms" | "privacy" | "security" | "dpa" | "systemdoc";

export const LEGAL_DOCS: Record<LegalDocType, {
    label: string;
    url: string;
    version: string;
    requiresSigner?: boolean;
}> = {
    terms: {
        label: "Användarvillkor",
        url: "/terms",
        version: CURRENT_TERMS_VERSION
    },
    privacy: {
        label: "Integritetspolicy",
        url: "/privacy",
        version: CURRENT_TERMS_VERSION
    },
    security: {
        label: "Säkerhetspolicy",
        url: "/security",
        version: CURRENT_TERMS_VERSION
    },
    dpa: {
        label: "DPA",
        url: "/dpa",
        version: CURRENT_TERMS_VERSION
    },
    systemdoc: {
        label: "Systemdokumentation",
        url: "/systemdokumentation",
        version: "1.1"
    }
};

// Legacy baseline. Use consentPolicy.getRequiredDocsForUser(...) for runtime requirements.
export const REQUIRED_LEGAL_DOCS: LegalDocType[] = ["terms", "privacy"];
export const OPTIONAL_LEGAL_DOCS: LegalDocType[] = ["security", "dpa"];
