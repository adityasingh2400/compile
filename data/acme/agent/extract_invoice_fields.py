# Acme fixture call site #2 — should classify GREEN.
# response_format with pydantic schema, temperature=0, f-string parameterized.

from anthropic import Anthropic
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)
client = Anthropic()


class InvoiceFields(BaseModel):
    invoice_number: str
    total_usd: float
    due_date: str


def extract_invoice_fields(raw_text: str) -> InvoiceFields:
    logger.info("extract_invoice_fields")
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=512,
        temperature=0,
        response_format={"type": "json_schema", "json_schema": InvoiceFields.model_json_schema()},
        messages=[
            {"role": "user", "content": f"Extract invoice fields from:\n{raw_text}"},
        ],
    )
    return InvoiceFields.model_validate(response.content[0].text)
