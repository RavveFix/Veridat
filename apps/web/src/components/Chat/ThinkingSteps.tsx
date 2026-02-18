import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

export interface ThinkingStep {
    id: string;
    title: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    duration?: number; // milliseconds
}

interface ThinkingStepsProps {
    steps: ThinkingStep[];
    defaultExpanded?: boolean;
    onStepClick?: (step: ThinkingStep) => void;
}

function getConfidenceFillStyle(confidence: number) {
    return {
        width: `${confidence}%`
    };
}

/**
 * ThinkingSteps - Claude.ai-inspired expandable thinking process display
 *
 * Shows the AI's analysis steps in a collapsible format, allowing users
 * to see the reasoning behind the AI's conclusions.
 */
export const ThinkingSteps: FunctionComponent<ThinkingStepsProps> = ({
    steps,
    defaultExpanded = false,
    onStepClick,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const totalSteps = steps.length;
    const isAllCompleted = completedSteps === totalSteps;
    const totalDuration = steps.reduce((sum, s) => sum + (s.duration || 0), 0);

    const toggleStep = (stepId: string) => {
        const newExpanded = new Set(expandedSteps);
        if (newExpanded.has(stepId)) {
            newExpanded.delete(stepId);
        } else {
            newExpanded.add(stepId);
        }
        setExpandedSteps(newExpanded);

        const step = steps.find(s => s.id === stepId);
        if (step && onStepClick) {
            onStepClick(step);
        }
    };

    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const getStatusIcon = (status: ThinkingStep['status']) => {
        switch (status) {
            case 'completed': return '✓';
            case 'in_progress': return '○';
            case 'error': return '!';
            default: return '·';
        }
    };

    return (
        <div class={`thinking-steps ${expanded ? 'expanded' : ''}`}>
            {/* Header - Always visible */}
            <div
                class="thinking-header"
                onClick={() => setExpanded(!expanded)}
                role="button"
                aria-expanded={expanded}
            >
                <div class="thinking-header-left">
                    <span class="thinking-icon">
                        {isAllCompleted ? '✨' : '🔍'}
                    </span>
                    <span class="thinking-title">
                        {isAllCompleted
                            ? 'Analyserat'
                            : `Analyserar... (${completedSteps}/${totalSteps})`
                        }
                    </span>
                    {totalDuration > 0 && (
                        <span class="thinking-duration">
                            {formatDuration(totalDuration)}
                        </span>
                    )}
                </div>
                <svg
                    class="thinking-chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>

            {/* Steps - Expandable */}
            <div class="thinking-body">
                <div class="thinking-steps-list">
                    {steps.map((step, index) => (
                        <div
                            key={step.id}
                            class={`thinking-step ${step.status} ${expandedSteps.has(step.id) ? 'step-expanded' : ''}`}
                        >
                            <div
                                class="thinking-step-header"
                                onClick={() => toggleStep(step.id)}
                            >
                                <div class="step-indicator">
                                    <span class={`step-status ${step.status}`}>
                                        {getStatusIcon(step.status)}
                                    </span>
                                    {index < steps.length - 1 && (
                                        <div class="step-connector" />
                                    )}
                                </div>
                                <div class="step-info">
                                    <span class="step-title">{step.title}</span>
                                    {step.duration && (
                                        <span class="step-duration">
                                            {formatDuration(step.duration)}
                                        </span>
                                    )}
                                </div>
                                {step.content && (
                                    <svg
                                        class="step-chevron"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                    >
                                        <polyline points="9 6 15 12 9 18"></polyline>
                                    </svg>
                                )}
                            </div>

                            {step.content && expandedSteps.has(step.id) && (
                                <div class="thinking-step-content">
                                    <div class="step-content-text">
                                        {step.content}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

/**
 * AIQuestion - Component for AI clarification questions
 *
 * When the AI needs more information, it can present questions
 * to the user for clarification.
 */
export interface AIQuestionOption {
    id: string;
    label: string;
    description?: string;
    icon?: string;
}

export interface AIQuestion {
    id: string;
    question: string;
    context?: string;
    options?: AIQuestionOption[];
    allowFreeText?: boolean;
    placeholder?: string;
}

interface AIQuestionCardProps {
    question: AIQuestion;
    onAnswer: (questionId: string, answer: string | string[]) => void;
    isLoading?: boolean;
}

export const AIQuestionCard: FunctionComponent<AIQuestionCardProps> = ({
    question,
    onAnswer,
    isLoading = false,
}) => {
    const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
    const [freeText, setFreeText] = useState('');

    const handleOptionClick = (optionId: string) => {
        const newSelected = new Set(selectedOptions);
        if (newSelected.has(optionId)) {
            newSelected.delete(optionId);
        } else {
            newSelected.add(optionId);
        }
        setSelectedOptions(newSelected);
    };

    const handleSubmit = () => {
        if (selectedOptions.size > 0) {
            onAnswer(question.id, Array.from(selectedOptions));
        } else if (freeText.trim()) {
            onAnswer(question.id, freeText.trim());
        }
    };

    const canSubmit = selectedOptions.size > 0 || freeText.trim().length > 0;

    return (
        <div class="ai-question-card">
            <div class="question-header">
                <span class="question-icon">❓</span>
                <span class="question-label">AI behöver mer information</span>
            </div>

            <div class="question-body">
                <p class="question-text">{question.question}</p>

                {question.context && (
                    <p class="question-context">{question.context}</p>
                )}

                {question.options && question.options.length > 0 && (
                    <div class="question-options">
                        {question.options.map(option => (
                            <button
                                key={option.id}
                                class={`question-option ${selectedOptions.has(option.id) ? 'selected' : ''}`}
                                onClick={() => handleOptionClick(option.id)}
                                disabled={isLoading}
                            >
                                {option.icon && <span class="option-icon">{option.icon}</span>}
                                <div class="option-content">
                                    <span class="option-label">{option.label}</span>
                                    {option.description && (
                                        <span class="option-description">{option.description}</span>
                                    )}
                                </div>
                                {selectedOptions.has(option.id) && (
                                    <span class="option-check">✓</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}

                {question.allowFreeText && (
                    <div class="question-freetext">
                        <textarea
                            value={freeText}
                            onInput={(e) => setFreeText((e.target as HTMLTextAreaElement).value)}
                            placeholder={question.placeholder || 'Skriv ditt svar här...'}
                            disabled={isLoading}
                            rows={2}
                        />
                    </div>
                )}
            </div>

            <div class="question-actions">
                <button
                    class="question-submit"
                    onClick={handleSubmit}
                    disabled={!canSubmit || isLoading}
                >
                    {isLoading ? (
                        <>
                            <span class="loading-spinner" />
                            Bearbetar...
                        </>
                    ) : (
                        <>
                            Svara
                            <span class="submit-arrow">→</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

/**
 * ConfidenceIndicator - Shows AI confidence level
 */
interface ConfidenceIndicatorProps {
    confidence: number; // 0-100
    showLabel?: boolean;
}

export const ConfidenceIndicator: FunctionComponent<ConfidenceIndicatorProps> = ({
    confidence,
    showLabel = true,
}) => {
    const getConfidenceLevel = () => {
        if (confidence >= 90) return { label: 'Hög säkerhet', class: 'high' };
        if (confidence >= 70) return { label: 'Medelhög säkerhet', class: 'medium' };
        if (confidence >= 50) return { label: 'Låg säkerhet', class: 'low' };
        return { label: 'Mycket låg säkerhet', class: 'very-low' };
    };

    const level = getConfidenceLevel();

    return (
        <div class={`confidence-indicator ${level.class}`}>
            <div class="confidence-bar">
                <div
                    class="confidence-fill"
                    style={getConfidenceFillStyle(confidence)}
                />
            </div>
            {showLabel && (
                <span class="confidence-label">
                    {level.label} ({confidence}%)
                </span>
            )}
        </div>
    );
};
