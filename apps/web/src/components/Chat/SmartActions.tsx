/**
 * SmartActions - Contextual action buttons under AI messages
 *
 * Renders action buttons based on detected Fortnox entities in AI responses.
 * Clicking a button populates the chat input with a relevant prompt.
 * Adapts to user skill level (beginner gets "Förklara" buttons).
 */

import { FunctionComponent } from 'preact';
import type { DetectedEntity } from '../../services/EntityDetectionService';
import type { SkillLevel } from '../../services/SkillDetectionService';
import { skillDetectionService } from '../../services/SkillDetectionService';
import { fortnoxContextService } from '../../services/FortnoxContextService';

interface SmartActionsProps {
    entities: DetectedEntity[];
}

interface ActionItem {
    label: string;
    icon: string;
    prompt: string;
}

function getActionsForEntity(entity: DetectedEntity, skillLevel: SkillLevel): ActionItem[] {
    const actions: ActionItem[] = [];

    switch (entity.type) {
        case 'customer':
            actions.push({
                label: 'Skapa faktura',
                icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                prompt: `Skapa en faktura till ${entity.name}${entity.fortnoxId ? ` (kundnr ${entity.fortnoxId})` : ''}`
            });
            break;
        case 'supplier':
            actions.push({
                label: 'Ny leverantörsfaktura',
                icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
                prompt: `Registrera en leverantörsfaktura från ${entity.name}${entity.fortnoxId ? ` (lev.nr ${entity.fortnoxId})` : ''}`
            });
            break;
        case 'invoice':
            actions.push({
                label: 'Bokför faktura',
                icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
                prompt: `Bokför faktura ${entity.fortnoxId}`
            });
            actions.push({
                label: 'Exportera till Fortnox',
                icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
                prompt: `Exportera faktura ${entity.fortnoxId} till Fortnox`
            });
            break;
        case 'account':
            if (skillLevel !== 'beginner') {
                actions.push({
                    label: 'Visa kontohistorik',
                    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
                    prompt: `Visa transaktioner på konto ${entity.fortnoxId}`
                });
            }
            break;
        case 'voucher':
            actions.push({
                label: 'Visa verifikat',
                icon: 'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
                prompt: `Visa detaljer för verifikat ${entity.fortnoxId}`
            });
            break;
    }

    if (skillLevel === 'beginner' && entity.type !== 'customer') {
        actions.push({
            label: 'Förklara',
            icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
            prompt: `Förklara vad ${entity.name} betyder i bokföring`
        });
    }

    return actions;
}

function ActionIcon({ path }: { path: string }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d={path} />
        </svg>
    );
}

export const SmartActions: FunctionComponent<SmartActionsProps> = ({ entities }) => {
    if (!entities.length) return null;

    const isConnected = fortnoxContextService.getConnectionStatus() === 'connected';
    const skillLevel = skillDetectionService.getLevel();

    const allActions: (ActionItem & { entityName: string })[] = [];
    const seen = new Set<string>();

    for (const entity of entities) {
        if (entity.confidence < 0.5 && !isConnected) continue;

        const actions = getActionsForEntity(entity, skillLevel);
        for (const action of actions) {
            if (!seen.has(action.label)) {
                seen.add(action.label);
                allActions.push({ ...action, entityName: entity.name });
            }
        }
    }

    if (!allActions.length) return null;

    const visibleActions = allActions.slice(0, 4);

    const handleAction = (prompt: string) => {
        const input = document.getElementById('message-input') as HTMLTextAreaElement;
        if (input) {
            input.value = prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        }

        // Update sidebar with first high-confidence entity
        const primary = entities.find(e => e.fortnoxId && e.confidence >= 0.5);
        if (primary && isConnected) {
            fortnoxContextService.setActiveEntity({
                type: primary.type,
                id: primary.fortnoxId || '',
                name: primary.name,
                data: {},
                confidence: primary.confidence
            });
        }
    };

    return (
        <div class="smart-actions">
            {visibleActions.map((action) => (
                <button
                    key={action.label}
                    class="smart-action-btn"
                    onClick={() => handleAction(action.prompt)}
                    title={action.prompt}
                >
                    <ActionIcon path={action.icon} />
                    <span>{action.label}</span>
                </button>
            ))}
        </div>
    );
};
