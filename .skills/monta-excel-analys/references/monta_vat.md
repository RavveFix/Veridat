# Monta VAT and Export Notes

Use these official sources to validate VAT treatment before posting journal entries.

## Monta VAT behavior (official)
- Monta uses an automated VAT model based on transaction data (service type, location, VAT status). The VAT outcome is not meant to be edited manually.
- Accurate VAT numbers in Monta Hub are required to avoid incorrect VAT handling.
- Monta treats roaming eMSPs as taxable dealers buying electricity for resale; VAT is typically 0% reverse charge when VAT numbers are provided.
- If a roaming setup deviates, contact Monta to confirm the VAT handling for that configuration.

Source:
- https://monta.com/en/legal-risk-compliance/information-about-vat/

## Monta invoice and activity report
- The account activity report separates: Invoiced items, Marketplace activity, Transfers.
- Amount due = Invoice total + Marketplace activity (Transfers are excluded from amount due).

Source:
- https://monta.com/en/help-center/understand-monta-invoice/

## VAT number settings
- Monta team settings include VAT number management for correct invoicing.

Source:
- https://monta.com/en/help-center/update-your-vat-number/

## Swedish rule of thumb (EU reverse charge)
- For B2B services purchased from another EU country, the main rule is reverse charge: the seller invoices without VAT and the buyer accounts for VAT in Sweden. Verify with Skatteverket and your accountant.

Source:
- https://www.skatteverket.se/foretag/moms/internationellhandel/omvandskattskyldighet.4.361dc8c15312eff6fd1d5e5.html
