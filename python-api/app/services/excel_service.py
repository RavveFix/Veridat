"""
Excel Service - Handles Excel file parsing and validation.
"""
import base64
import io
import pandas as pd
from fastapi import UploadFile
import logging

logger = logging.getLogger(__name__)


class FileProcessingError(Exception):
    """Custom exception for file processing errors."""
    pass


class ExcelService:
    """Handles Excel file parsing and validation."""

    REQUIRED_COLUMNS = ['amount', 'subAmount', 'vat', 'vatRate', 'transactionName']

    async def parse_base64_excel(self, file_data: str, filename: str) -> pd.DataFrame:
        """Parse base64 encoded Excel file into DataFrame."""
        try:
            file_bytes = base64.b64decode(file_data)
            df = pd.read_excel(io.BytesIO(file_bytes))
            logger.info(f"Parsed Excel: {len(df)} rows, columns: {list(df.columns)}")
            return df
        except Exception as e:
            logger.error(f"Error parsing Excel: {str(e)}")
            raise FileProcessingError(f"Failed to parse Excel file: {str(e)}")

    async def parse_uploaded_file(self, file: UploadFile) -> pd.DataFrame:
        """Parse uploaded Excel file into DataFrame."""
        try:
            content = await file.read()
            df = pd.read_excel(io.BytesIO(content))
            logger.info(f"Parsed uploaded file: {len(df)} rows")
            return df
        except Exception as e:
            logger.error(f"Error parsing uploaded file: {str(e)}")
            raise FileProcessingError(f"Failed to parse uploaded file: {str(e)}")

    def validate_dataframe_structure(self, df: pd.DataFrame) -> None:
        """Validate that DataFrame has required columns."""
        missing_cols = [col for col in self.REQUIRED_COLUMNS if col not in df.columns]

        if missing_cols:
            raise FileProcessingError(
                f"Excel missing columns: {', '.join(missing_cols)}. "
                f"Required: {', '.join(self.REQUIRED_COLUMNS)}"
            )

        if len(df) == 0:
            raise FileProcessingError("Excel file contains no data rows")

        logger.debug(f"DataFrame validation passed: {len(df)} rows")
