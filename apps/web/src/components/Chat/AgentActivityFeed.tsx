import { FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export interface AgentStep {
    id: string;
    type: 'tool_call' | 'thinking' | 'memory_lookup' | 'search';
    tool: string;
    label: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt: number | null;
    resultSummary: string | null;
}

export interface UsedMemoryChip {
    id: string;
    category: string;
    preview: string;
}

interface AgentActivityFeedProps {
    steps: AgentStep[];
    usedMemories?: UsedMemoryChip[];
    isStreaming: boolean;
}

export const AgentActivityFeed: FunctionComponent<AgentActivityFeedProps> = ({
    steps,
    usedMemories,
    isStreaming,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    // Auto-collapse when text streaming starts and all steps are done
    useEffect(() => {
        if (isStreaming && steps.length > 0 && steps.every(s => s.status !== 'running')) {
            // Delay auto-collapse so user sees the feed
            const timer = setTimeout(() => setCollapsed(true), 3000);
            return () => clearTimeout(timer);
        }
    }, [isStreaming, steps]);

    // Reset collapsed state when steps are cleared (new message)
    useEffect(() => {
        if (steps.length === 0) setCollapsed(false);
    }, [steps.length]);

    if (steps.length === 0) return null;

    const completedCount = steps.filter(s => s.status === 'completed').length;
    const totalDuration = steps.reduce((sum, s) => {
        if (s.completedAt && s.startedAt) return sum + (s.completedAt - s.startedAt);
        return sum;
    }, 0);

    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const getStepIcon = (status: AgentStep['status']) => {
        switch (status) {
            case 'completed': return '\u2713';
            case 'failed': return '\u2715';
            case 'running': return '\u25CF';
        }
    };

    if (collapsed) {
        return (
            <div class="agent-feed agent-feed--collapsed" onClick={() => setCollapsed(false)}>
                <span class="agent-feed__summary-icon">{'\u2728'}</span>
                <span class="agent-feed__summary-text">
                    {completedCount} steg utf\u00f6rda p\u00e5 {formatDuration(totalDuration)}
                </span>
                <svg class="agent-feed__expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>
        );
    }

    return (
        <div class="agent-feed">
            <div class="agent-feed__header">
                <span class="agent-feed__title">Agent</span>
                {completedCount === steps.length && steps.length > 0 && (
                    <button class="agent-feed__collapse-btn" onClick={() => setCollapsed(true)} aria-label="Minimera">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="18 15 12 9 6 15" />
                        </svg>
                    </button>
                )}
            </div>

            <div class="agent-feed__steps">
                {steps.map((step, i) => (
                    <div key={step.id} class={`agent-step agent-step--${step.status}`}>
                        <div class="agent-step__indicator">
                            <span class={`agent-step__icon agent-step__icon--${step.status}`}>
                                {getStepIcon(step.status)}
                            </span>
                            {i < steps.length - 1 && <div class="agent-step__connector" />}
                        </div>
                        <div class="agent-step__content">
                            <span class="agent-step__label">{step.label}</span>
                            {step.resultSummary && (
                                <span class="agent-step__result">{step.resultSummary}</span>
                            )}
                        </div>
                        <div class="agent-step__time">
                            {step.status === 'running' ? (
                                <span class="agent-step__running">p\u00e5g\u00e5r</span>
                            ) : step.completedAt && step.startedAt ? (
                                <span class="agent-step__duration">
                                    {formatDuration(step.completedAt - step.startedAt)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>

            {usedMemories && usedMemories.length > 0 && (
                <div class="agent-feed__memories">
                    <span class="agent-feed__memories-label">{'\u2139\uFE0F'} {usedMemories.length} {' minnen använda'}</span>
                </div>
            )}
        </div>
    );
};
