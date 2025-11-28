"""
Pydantic response models that match TypeScript interfaces EXACTLY.
Must match /Users/ravonstrawder/Desktop/Britta/src/types/vat.ts
"""
from pydantic import BaseModel
from typing import List, Optional


class SalesTransaction(BaseModel):
    description: str
    net: float
    vat: float
    rate: float  # 25, 12, 6, 0


class CostTransaction(BaseModel):
    description: str
    net: float
    vat: float
    rate: float


class VATSummary(BaseModel):
    outgoing_25: float
    outgoing_12: Optional[float] = 0
    outgoing_6: Optional[float] = 0
    incoming: float
    net: float
    to_pay: Optional[float] = 0
    to_refund: Optional[float] = 0


class JournalEntry(BaseModel):
    account: str
    name: str
    debit: float
    credit: float


class ValidationResult(BaseModel):
    is_valid: bool
    errors: List[str]
    warnings: List[str]


class ChargingSession(BaseModel):
    id: str
    kwh: float
    amount: float


class VATReportData(BaseModel):
    type: str = "vat_report"
    period: str
    company: dict  # {name: str, org_number: str}
    summary: dict  # {total_income: float, total_costs: float, result: float}
    sales: List[SalesTransaction]
    costs: List[CostTransaction]
    vat: VATSummary
    journal_entries: List[JournalEntry]
    validation: ValidationResult
    charging_sessions: Optional[List[ChargingSession]] = None


class VATReportResponse(BaseModel):
    type: str = "vat_report"
    data: VATReportData
