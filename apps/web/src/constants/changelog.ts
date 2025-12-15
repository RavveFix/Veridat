export interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    changes: {
        type: 'new' | 'improved' | 'fixed';
        description: string;
    }[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.1.0',
        date: '2025-12-01',
        title: 'Inställningar & Juridisk Compliance',
        changes: [
            {
                type: 'new',
                description: 'Inställningssida där du kan redigera din profil och se legal information'
            },
            {
                type: 'new',
                description: 'Versionshantering av användarvillkor - du får notis vid uppdateringar'
            },
            {
                type: 'new',
                description: 'E-postbekräftelse när du godkänner villkor (GDPR-compliant)'
            },
            {
                type: 'improved',
                description: 'Rena URLs utan .html-tillägg (t.ex. /app istället för /app/index.html)'
            },
            {
                type: 'improved',
                description: 'Förbättrad säkerhet med nya HTTP-headers'
            }
        ]
    },
    {
        version: '1.0.0',
        date: '2025-11-26',
        title: 'Initial Release',
        changes: [
            {
                type: 'new',
                description: 'AI-driven chatt för bokföringsfrågor'
            },
            {
                type: 'new',
                description: 'Dokumentuppladdning och analys'
            },
            {
                type: 'new',
                description: 'Företagshantering och historik'
            },
            {
                type: 'new',
                description: 'Mörkt och ljust tema'
            },
            {
                type: 'new',
                description: 'Röststyrning för hands-free interaktion'
            }
        ]
    }
];

export function getLatestChangelog(): ChangelogEntry | undefined {
    return CHANGELOG[0];
}

export function getChangelogByVersion(version: string): ChangelogEntry | undefined {
    return CHANGELOG.find(entry => entry.version === version);
}
