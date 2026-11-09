# Peggy reference — offline structural review

The supplied reference has 13 pages. The source PDF and customer-specific identifiers are not stored in this repository. This report is based on local text-label scanning, not on a GAS/Gemini extraction response. Labels may repeat in headers or navigation and do not by themselves establish policy grouping or coverage. No customer amounts, names or policy numbers appear below.

## Page-level comparison

| Page | Labels found in local text | Model / review comparison | Actual extraction accuracy |
|---|---|---|---|
| 1 | Holder, insured, rider, premium waiver, reserve, premium, deductible | Holder/person and structured riders are modelled; waiver is hidden but retained. Legacy rider strings lack structured terms. | Not measured |
| 2 | Holder, reserve, annual dividend, cash value, premium, deductible, annual/lifetime limit, effective date | Structured value and medical-limit fields exist. Legacy reserve ambiguity is retained as unclassified rather than guessed. | Not measured |
| 3 | Holder and insured | Full extracted names are shown; assignment requires Agent review. | Not measured |
| 4 | Holder, insured, rider, reserve, premium | Structured riders and reserve fields exist; legacy riders can preserve names only. | Not measured |
| 5 | Holder, insured, reserve, annual dividend, cash value, premium, effective date | Structured values and policy dates are modelled; value type and amount require review. | Not measured |
| 6 | Holder, insured, reserve, premium | Person assignment and values are modelled; assignment is not inferred across policies. | Not measured |
| 7 | Holder, insured, rider, reserve, annual dividend, cash value, premium, effective date | Structured riders, values and dates are modelled; source terms require review. | Not measured |
| 8 | Holder, insured, rider, premium waiver, reserve, premium | Structured riders are modelled; waiver is hidden but retained. | Not measured |
| 9 | Holder, rider, reserve, annual dividend, cash value, premium, deductible, annual/lifetime limit, effective date | Structured rider limits and values are modelled; legacy response cannot establish rider-specific limits. | Not measured |
| 10 | Holder, insured, premium, effective date | Customer, premium and date fields are modelled; extracted values require review. | Not measured |
| 11 | Holder, insured, reserve, premium | Person and value fields are modelled; legacy reserve ambiguity cannot establish a balance. | Not measured |
| 12 | Holder, rider, reserve, annual dividend, cash value, premium, effective date | Structured rider and value fields are modelled; source and component inclusion require review. | Not measured |
| 13 | Holder and insured | Person fields are modelled; policy assignment remains subject to review. | Not measured |

The text scan did not establish the exact independent policy boundaries, two-person assignment, the applicable medical limit values, or whether each of the four requested value types is absent, zero, included in another value or merely represented by different wording. Absence of a scanned label is not evidence of a contractual zero. These require page-level examination against the actual document and an actual extraction response.

## Five-policy extraction accuracy matrix

| Intended group | Original-to-extraction comparison |
|---|---|
| Policy 1 | Not measured — no real extraction response was generated. |
| Policy 2 | Not measured — no real extraction response was generated. |
| Policy 3 | Not measured — no real extraction response was generated. |
| Policy 4 | Not measured — no real extraction response was generated. |
| Policy 5 | Not measured — no real extraction response was generated. |

## Production compatibility and acceptance

The repository main GAS source emits rider-name strings and legacy `cashValues`; the PR source adds `structuredRiders`, `structuredValues` and `payoutScenario`. The actual deployed endpoint version and response were not independently established. New structured extraction requires a separately approved deployment and a verified compatible Gemini model/schema. The browser tests mock extraction and must not be described as real PDF accuracy evidence.

Before production use, compare each extracted policy and contract with the original, verify full person assignments and all currencies, dates, limits and value inclusion relationships, and check for duplicates. Any proposal to transmit the PDF to an external AI service requires a separately approved data-handling plan.
