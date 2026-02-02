import { FunctionComponent } from 'preact';
import type { ValidationResult } from '../../types/vat';

export const ValidationBadges: FunctionComponent<{ validation: ValidationResult }> = ({ validation }) => {
    if (!validation) return <div class="validation-badges"></div>;

    return (
        <div class="validation-badges">
            {validation.is_valid && <span class="badge success">✓ Validerad</span>}
            {validation.errors && validation.errors.length > 0 && (
                <span class="badge error">{validation.errors.length} fel</span>
            )}
            {validation.warnings && validation.warnings.length > 0 && (
                <span class="badge warning">{validation.warnings.length} varningar</span>
            )}
        </div>
    );
};
