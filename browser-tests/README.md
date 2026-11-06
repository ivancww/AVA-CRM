# Browser workflow test

Run `npm ci`, install a Playwright Chromium build (`npx playwright install chromium`), then `npm run test:browser`. If using a compatible system Chromium, set `CRM_CHROMIUM_PATH` to its executable. The test uses a local HTTP server, mocked extraction response and a new isolated browser profile; no real customer data or external AI service is used.
