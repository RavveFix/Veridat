import { FunctionComponent } from 'preact';
import type { ValidationResult, ZeroVATWarning } from '../../types/vat';

const WarningItem: FunctionComponent<{ warning: ZeroVATWarning }> = ({ warning }) => (
    <div class={`warning-item ${warning.level}`}>
        <span class="warning-code">{warning.code}</span>
        <p>{warning.message}</p>
        {warning.suggestion && (
            <p class="suggestion">{warning.suggestion}</p>
        )}
        {warning.transaction_id && (
            <span class="transaction-ref">ID: {warning.transaction_id}</span>
        )}
    </div>
);

export const WarningsPanel: FunctionComponent<{ validation: ValidationResult }> = ({ validation }) => {
    const zeroVatWarnings = validation?.zero_vat_warnings || [];
    const hasWarnings = (validation?.warnings?.length || 0) > 0 || zeroVatWarnings.length > 0;
    const hasErrors = (validation?.errors?.length || 0) > 0;

    if (!hasWarnings && !hasErrors) return null;

    const grouped = {
        error: zeroVatWarnings.filter(w => w.level === 'error'),
        warning: zeroVatWarnings.filter(w => w.level === 'warning'),
        info: zeroVatWarnings.filter(w => w.level === 'info')
    };

    return (
        <div class="warnings-panel">
            <h4>Granskningsresultat</h4>

            {hasErrors && (
                <div class="warning-section error">
                    <h5>Fel ({validation.errors.length})</h5>
                    {validation.errors.map((err, i) => (
                        <div key={i} class="warning-item error">
                            <p>{typeof err === 'string' ? err : JSON.stringify(err)}</p>
                        </div>
                    ))}
                </div>
            )}

            {grouped.warning.length > 0 && (
                <div class="warning-section warning">
                    <h5>Varningar ({grouped.warning.length})</h5>
                    {grouped.warning.map((w, i) => (
                        <WarningItem key={i} warning={w} />
                    ))}
                </div>
            )}

            {grouped.info.length > 0 && (
                <div class="warning-section info">
                    <h5>Information ({grouped.info.length})</h5>
                    {grouped.info.map((w, i) => (
                        <WarningItem key={i} warning={w} />
                    ))}
                </div>
            )}

            {(validation?.warnings?.length || 0) > 0 && (
                <div class="warning-section warning">
                    <h5>Beräkningsvarningar ({validation.warnings.length})</h5>
                    {validation.warnings.map((warn, i) => (
                        <div key={i} class="warning-item warning">
                            <p>{typeof warn === 'string' ? warn : JSON.stringify(warn)}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
