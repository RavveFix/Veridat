/**
 * SkillDetectionService - Automatic user skill level detection
 *
 * Analyzes user messages to determine accounting expertise level.
 * Score builds cumulatively over time, stored in localStorage.
 * The level affects sidebar detail, AI response depth, and smart action options.
 */

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

// --- Scoring patterns ---

const ADVANCED_TERMS = [
    // BAS account numbers (4 digits)
    { pattern: /\b[12345678]\d{3}\b/g, score: 5, label: 'BAS-konto' },

    // Legal references
    { pattern: /\b(?:ML|BFL|ÅRL|IL)\s*\d+\s*(?:kap|§|:)/gi, score: 3, label: 'lagreferens' },

    // Professional terms (Swedish)
    { pattern: /\b(?:verifikation|kontering|huvudbok|dagbok|balansräkning|resultaträkning|avskrivning|periodisering|bokslut|årsbokslut|räkenskapsår|avdragsgill|ingående\s+moms|utgående\s+moms|leverantörsskuld|kundfordran|skattefordran|momsdeklaration|skattedeklaration|eget\s+kapital|obeskattade\s+reserver|avsättning|avräkningskonto)\b/gi, score: 3, label: 'fackterm' },

    // Fortnox-specific
    { pattern: /\b(?:voucher\s*series|finansår|verifikatserie|bokföringsorder)\b/gi, score: 2, label: 'Fortnox-term' },

    // Tax categories
    { pattern: /\b(?:omvänd\s+skattskyldighet|trepartshandel|unionsinterna|EU-handel|frivillig\s+skattskyldighet|jämkning)\b/gi, score: 3, label: 'skattekategori' },
];

const BEGINNER_SIGNALS = [
    // Asking basic questions
    { pattern: /\b(?:vad\s+(?:är|innebär|menas?\s+med)\s+(?:moms|bokföring|debet|kredit|verifikation|kontoplan|BAS))\b/gi, score: -3, label: 'grundfråga' },

    // Needs explanation
    { pattern: /\b(?:förklara|vad\s+betyder|hur\s+fungerar|kan\s+du\s+förklara)\b/gi, score: -2, label: 'förklaring' },

    // Casual language about accounting
    { pattern: /\b(?:hur\s+gör\s+(?:jag|man)\s+(?:en|ett)?\s*(?:bokföring|faktura|moms))\b/gi, score: -2, label: 'nybörjarfras' },
];

const STORAGE_KEY = 'veridat_skill_score';
const DEFAULT_SCORE = 20;
const MAX_DELTA_PER_MESSAGE = 5;
const MIN_SCORE = 0;
const MAX_SCORE = 100;

// Thresholds
const INTERMEDIATE_THRESHOLD = 34;
const ADVANCED_THRESHOLD = 67;

class SkillDetectionServiceClass {
    private score: number;

    constructor() {
        this.score = this.loadScore();
    }

    /**
     * Analyze a user message and update the skill score.
     * Returns the new skill level.
     */
    analyzeMessage(message: string): SkillLevel {
        let delta = 0;

        // Check advanced signals
        for (const term of ADVANCED_TERMS) {
            term.pattern.lastIndex = 0;
            const matches = message.match(term.pattern);
            if (matches) {
                delta += term.score * matches.length;
            }
        }

        // Check beginner signals
        for (const signal of BEGINNER_SIGNALS) {
            signal.pattern.lastIndex = 0;
            const matches = message.match(signal.pattern);
            if (matches) {
                delta += signal.score * matches.length;
            }
        }

        // Clamp delta to prevent sudden jumps
        delta = Math.max(-MAX_DELTA_PER_MESSAGE, Math.min(MAX_DELTA_PER_MESSAGE, delta));

        // Apply delta
        if (delta !== 0) {
            this.score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, this.score + delta));
            this.saveScore();
        }

        return this.getLevel();
    }

    /**
     * Get the current skill level based on score.
     */
    getLevel(): SkillLevel {
        if (this.score >= ADVANCED_THRESHOLD) return 'advanced';
        if (this.score >= INTERMEDIATE_THRESHOLD) return 'intermediate';
        return 'beginner';
    }

    /**
     * Get the raw score (0-100).
     */
    getScore(): number {
        return this.score;
    }

    /**
     * Check if an explanation should be shown for a topic.
     * Beginners get explanations, advanced users don't.
     */
    shouldShowExplanation(topic: 'account' | 'vat' | 'journal' | 'general'): boolean {
        const level = this.getLevel();
        if (level === 'advanced') return false;
        if (level === 'intermediate' && topic === 'general') return false;
        return true;
    }

    /**
     * Get a label for the current skill level (Swedish).
     */
    getLevelLabel(): string {
        switch (this.getLevel()) {
            case 'beginner': return 'Nybörjare';
            case 'intermediate': return 'Mellanliggande';
            case 'advanced': return 'Avancerad';
        }
    }

    /**
     * Reset the skill score to default.
     */
    reset(): void {
        this.score = DEFAULT_SCORE;
        this.saveScore();
    }

    private loadScore(): number {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) {
                const parsed = parseInt(stored, 10);
                if (!isNaN(parsed) && parsed >= MIN_SCORE && parsed <= MAX_SCORE) {
                    return parsed;
                }
            }
        } catch {
            // localStorage may not be available
        }
        return DEFAULT_SCORE;
    }

    private saveScore(): void {
        try {
            localStorage.setItem(STORAGE_KEY, String(this.score));
        } catch {
            // Ignore storage errors
        }
    }
}

export const skillDetectionService = new SkillDetectionServiceClass();
