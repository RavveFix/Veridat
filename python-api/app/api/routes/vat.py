"""
VAT Routes - Endpoints for VAT analysis and processing.
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import List, Literal, Optional
import logging
import pandas as pd

from app.api.models.response import VATReportResponse
from app.services.vat_service import VATService
from app.services.excel_service import ExcelService, FileProcessingError
from app.core.security import verify_api_key

router = APIRouter()
logger = logging.getLogger(__name__)


class ExcelAnalysisRequest(BaseModel):
    file_data: str  # Base64 encoded
    filename: str
    company_name: str = ""
    org_number: str = ""
    period: str = ""


class NormalizedTransaction(BaseModel):
    """Transaction normalized by Gemini AI"""
    amount: float           # Gross amount (incl VAT)
    net_amount: float       # Net amount (excl VAT)
    vat_amount: float       # VAT amount
    vat_rate: float         # VAT rate (25, 12, 6, 0)
    description: str = ""
    date: Optional[str] = None
    type: Literal["sale", "cost"] = "sale"


class NormalizedDataRequest(BaseModel):
    """Request for pre-normalized transaction data (from Gemini AI)"""
    transactions: List[NormalizedTransaction]
    company_name: str = ""
    org_number: str = ""
    period: str = ""
    ai_analysis: Optional[dict] = None  # Gemini's analysis metadata


@router.post("/analyze", response_model=VATReportResponse)
async def analyze_excel(
    request: ExcelAnalysisRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Analyze Excel file and generate Swedish VAT report.
    Requires X-API-Key header if PYTHON_API_KEY is configured.
    """
    try:
        logger.info(f"VAT analysis request for file: {request.filename}")

        # Parse Excel
        excel_service = ExcelService()
        df = await excel_service.parse_base64_excel(request.file_data, request.filename)
        excel_service.validate_dataframe_structure(df)

        # Process VAT
        vat_service = VATService()
        report = vat_service.process_transactions(
            df=df,
            company_name=request.company_name,
            org_number=request.org_number,
            period=request.period
        )

        logger.info(f"Analysis complete: period={report['period']}, valid={report['validation']['is_valid']}")

        return VATReportResponse(type="vat_report", data=report)

    except FileProcessingError as e:
        logger.error(f"File processing error: {str(e)}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in VAT analysis")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )


@router.post("/calculate-normalized", response_model=VATReportResponse)
async def calculate_normalized(
    request: NormalizedDataRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Calculate VAT from pre-normalized transaction data.

    This endpoint receives data already normalized by Gemini AI,
    allowing Python to do precise mathematical calculations without
    needing to understand arbitrary Excel column formats.

    Pipeline: Excel → Gemini (normalize) → Python (calculate) → Claude (validate)
    """
    try:
        logger.info(f"Normalized VAT calculation: {len(request.transactions)} transactions")

        if not request.transactions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No transactions provided"
            )

        # Convert normalized transactions to DataFrame format expected by VATProcessor
        # VATProcessor expects: amount, subAmount, vat, vatRate, transactionName
        data = []
        for i, t in enumerate(request.transactions):
            # Determine sign based on transaction type
            sign = 1 if t.type == "sale" else -1

            data.append({
                "id": f"tx_{i}",
                "amount": t.amount * sign,           # Gross (signed)
                "subAmount": t.net_amount * sign,    # Net (signed)
                "vat": t.vat_amount * sign,          # VAT (signed)
                "vatRate": t.vat_rate,
                "transactionName": t.description,
                "date": t.date
            })

        df = pd.DataFrame(data)

        logger.info(f"DataFrame created: {len(df)} rows, columns: {list(df.columns)}")
        logger.debug(f"Sample data:\n{df.head()}")

        # Process with VATService
        vat_service = VATService()
        report = vat_service.process_transactions(
            df=df,
            company_name=request.company_name,
            org_number=request.org_number,
            period=request.period
        )

        # Add AI analysis metadata if provided
        if request.ai_analysis:
            report["ai_analysis"] = request.ai_analysis

        logger.info(f"Calculation complete: period={report['period']}, valid={report['validation']['is_valid']}")

        return VATReportResponse(type="vat_report", data=report)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in normalized VAT calculation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Calculation error: {str(e)}"
        )
