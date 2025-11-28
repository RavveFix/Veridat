"""
VAT Service - Wrapper around svensk-ekonomi VATProcessor with format transformation.

CRITICAL: This module transforms the Python vat_processor.py output format
to match the TypeScript VATReportData interface exactly.
"""
import sys
from pathlib import Path
import pandas as pd
from decimal import Decimal
import logging

# Add svensk-ekonomi to path
SKILL_PATH = Path(__file__).parent.parent.parent.parent / ".skills" / "svensk-ekonomi" / "scripts"
sys.path.insert(0, str(SKILL_PATH))

from vat_processor import VATProcessor

logger = logging.getLogger(__name__)


class VATService:
    """Wrapper around svensk-ekonomi VATProcessor with format transformation."""

    def __init__(self):
        self.processor = VATProcessor()

    def process_transactions(
        self,
        df: pd.DataFrame,
        company_name: str = "",
        org_number: str = "",
        period: str = ""
    ) -> dict:
        """
        Process transactions and return VAT report.
        Returns dict matching TypeScript VATReportData structure.
        """
        # Call Python processor
        report = self.processor.process_transactions(
            df=df,
            company_name=company_name,
            org_number=org_number,
            period=period
        )

        # Transform to match TypeScript interface
        transformed = self._transform_to_frontend_format(report)

        logger.info(f"VAT processing complete: {len(transformed['sales'])} sales, {len(transformed['costs'])} costs")

        return transformed

    def _transform_to_frontend_format(self, report: dict) -> dict:
        """
        Transform Python vat_processor output to TypeScript VATReportData format.

        Python format (input):
        {
          "sales": {
            "vat_25_percent": {"net": 1000, "vat": 250},
            "vat_12_percent": {"net": 0, "vat": 0},
            ...
          }
        }

        TypeScript format (output):
        {
          "sales": [
            {"description": "...", "net": 1000, "vat": 250, "rate": 25}
          ]
        }
        """

        # Build sales transactions array
        sales = []
        if report['sales']['vat_25_percent']['net'] > 0:
            sales.append({
                "description": "Försäljning 25% moms",
                "net": report['sales']['vat_25_percent']['net'],
                "vat": report['sales']['vat_25_percent']['vat'],
                "rate": 25
            })
        if report['sales']['vat_12_percent']['net'] > 0:
            sales.append({
                "description": "Försäljning 12% moms",
                "net": report['sales']['vat_12_percent']['net'],
                "vat": report['sales']['vat_12_percent']['vat'],
                "rate": 12
            })
        if report['sales']['vat_6_percent']['net'] > 0:
            sales.append({
                "description": "Försäljning 6% moms",
                "net": report['sales']['vat_6_percent']['net'],
                "vat": report['sales']['vat_6_percent']['vat'],
                "rate": 6
            })
        if report['sales']['vat_0_percent']['net'] > 0:
            sales.append({
                "description": "Försäljning momsfri (roaming)",
                "net": report['sales']['vat_0_percent']['net'],
                "vat": 0,
                "rate": 0
            })

        # Build costs transactions array
        costs = []
        total_cost_net = report['purchases']['total_net']
        if total_cost_net > 0:
            costs.append({
                "description": "Kostnader 25% moms",
                "net": total_cost_net,
                "vat": report['purchases']['incoming_vat'],
                "rate": 25
            })

        # Calculate summary
        total_income = report['sales']['total_net']
        total_costs = report['purchases']['total_net']

        return {
            "type": "vat_report",
            "period": report['period'],
            "company": report['company'],
            "summary": {
                "total_income": total_income,
                "total_costs": total_costs,
                "result": total_income - total_costs
            },
            "sales": sales,
            "costs": costs,
            "vat": {
                "outgoing_25": report['vat_summary']['outgoing_vat'],
                "outgoing_12": 0,
                "outgoing_6": 0,
                "incoming": report['vat_summary']['incoming_vat'],
                "net": report['vat_summary']['net_vat'],
                "to_pay": report['vat_summary'].get('to_pay', 0),
                "to_refund": report['vat_summary'].get('to_refund', 0)
            },
            "journal_entries": [
                {
                    "account": entry['account'],
                    "name": entry['account_name'],
                    "debit": entry['debit'],
                    "credit": entry['credit']
                }
                for entry in report['journal_entries']
            ],
            "validation": report['validation']
        }
