"""
VAT Routes - Endpoints for VAT analysis and processing.
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
import logging

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
