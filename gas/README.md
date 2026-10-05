# AVA-CRM Official Configuration backend

This source is intended for the confirmed existing Google Apps Script project **AVA-CRM**, which owns the production Official Data API. It is the CRM-owned boundary for a future authorized Admin surface. It is deliberately separate from the customer Frontstage and User Layer. It does not read or write IndexedDB, customer records, policies, User Overrides, backups, or uploaded documents.

## Confirmed production target

- Existing Apps Script project: `AVA-CRM`
- Existing production endpoint: `https://script.google.com/macros/s/AKfycbyvGzKK5v9VEXyTeCmGUKhnVXgO6eh7Hg6FDEfwEIfsd58SCtPdNQvW21wTp9J5FfAX/exec`
- Deployment method after approval: **edit existing deployment**
- Do not create another GAS project or a second CRM Official API.

## Recovered current read contract

Repository evidence shows the production CRM calls the endpoint with a plain
`GET` and no query parameters. The frontend expects JSON shaped as
`{ success: true, data: { '頁面設定': [], 'Review問題': [], '保障分類': [], '產品資料': [], '系統設定': [] } }`.
The current source contains no evidence of sheet-specific read actions,
product-lookup actions, health/version actions, or an existing `doPost` API.
Those portions of the historical GAS source are not recoverable from this
repository and must not be invented. The `doGet` above remains public/read-only;
Admin authorization applies only to the new recognized write routes.

## Mother contract consumed

The backend uses the merged AVA Platform contract:

1. AVA Studio issues a two-minute, one-time, App-bound `avaAdminLaunch` ticket for App ID `crm`.
2. CRM sends that ticket to `exchangeAppLaunch`; the backend calls Platform GAS with `action: exchangeAppLaunch`, the ticket, and `appId: crm`.
3. Platform returns an opaque, session-bound `appGrant`.
4. Every Official write calls Platform GAS with `action: verifyAppGrant`, the grant, `appId: crm`, and the exact allowlisted operation.
5. Only after successful verification and local payload validation does CRM write the mapped Official sheet.

The grant is transport data, not a CRM login. A future browser client must keep it in memory only; this backend does not accept `avaEntry=admin`, browser storage flags, User sessions, or arbitrary client authorization.

## Fixed write allowlist

`replaceOfficialArea` accepts only these operation-to-sheet mappings:

- `replacePageSettings` → `頁面設定`
- `replaceReviewQuestions` → `Review問題`
- `replaceCoverageCategories` → `保障分類`
- `replaceProductDefinitions` → `產品資料`
- `replaceSystemSettings` → `系統設定`

The request cannot choose a sheet, range, or spreadsheet. Payload fields are checked against the existing first-row headers of the mapped sheet. Before replacement, the backend fails closed if the target has sheet/range protection, active filters, merged cells, hidden rows/columns, or formulas. Product Feature Registry records remain part of the verified `產品資料` area; AI/customer policy data is not accepted by this API. Live deployment still requires an authorized operator to verify the real tabs and headers.

## Deployment requirements

These are deployment requirements, not proof of deployment:

| Setting | Where | Required value | Owner | Purpose |
|---|---|---|---|---|
| Spreadsheet binding | GAS project | Existing CRM Official Sheet | CRM owner | Supplies the five existing Official tabs |
| Web App deployment | GAS Deploy → Manage deployments | Edit the existing deployment, execute as owner | CRM owner | Preserves the existing `/exec` URL |
| CRM backend URL | Deployment output / future Admin client configuration | The HTTPS `/exec` URL of this deployment | CRM owner | Routes ticket exchange and Official writes to this backend |
| `CRM_APP_ID` | `gas/Code.gs` | `crm` | Repository + Platform owner | Matches the canonical Platform registry ID |
| `PLATFORM_ADMIN_ENDPOINT` | `gas/Code.gs` | Current AVA Platform Admin GAS endpoint | Repository owner | Ticket exchange and grant verification |
| `AVA_ADMIN_APP_IDS` | AVA Platform GAS Script Properties | Must include `crm` | Platform owner | Allows Platform to issue CRM tickets |

No password, session secret, Platform session token, or Google credential belongs in this repository or frontend. Before deployment, verify the actual live tabs and headers and confirm the fail-closed sheet-safety checks are compatible with the production structure. Live GAS deployment and Platform Script Properties require the respective authorized owners and must be verified before `admin:true` or an Admin UI is enabled.
