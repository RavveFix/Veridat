import { FunctionComponent } from 'preact';
import type { VATSummary } from '../../types/vat';

export const VATDetails: FunctionComponent<{ vat: VATSummary }> = ({ vat }) => {
    return (
        <div class="vat-details">
            <div class="vat-row">
                <span>Utgående moms 25%:</span>
                <span>{(vat.outgoing_25 ?? 0).toFixed(2)} SEK</span>
            </div>
            {(vat.outgoing_12 ?? 0) > 0 && (
                <div class="vat-row">
                    <span>Utgående moms 12%:</span>
                    <span>{vat.outgoing_12!.toFixed(2)} SEK</span>
                </div>
            )}
            {(vat.outgoing_6 ?? 0) > 0 && (
                <div class="vat-row">
                    <span>Utgående moms 6%:</span>
                    <span>{vat.outgoing_6!.toFixed(2)} SEK</span>
                </div>
            )}
            <div class="vat-row">
                <span>Ingående moms:</span>
                <span>{(vat.incoming ?? 0).toFixed(2)} SEK</span>
            </div>
            <div class="vat-row vat-total">
                <span>Att {vat.net >= 0 ? 'betala' : 'återfå'}:</span>
                <span class="vat-net-amount">{Math.abs(vat.net).toFixed(2)} SEK</span>
            </div>
        </div>
    );
};
