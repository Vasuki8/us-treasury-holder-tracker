# Treasury Tracker Monetization

The monetization strategy is **free public Treasury intelligence + paid workflow automation**.

## Product principles

1. Keep core official-source Treasury data public.
2. Charge for monitoring, delivery, persistence, authenticated access and time savings.
3. Never imply that a paid plan provides personalized investment advice.
4. Preserve source dates, methodology caveats and the existing data-validation chain.
5. Do not attempt to hide premium secrets or entitlements in static GitHub Pages JavaScript.

## Launch plans

### Free — $0

- Public Treasury dashboard
- Official source dates and methodology notes
- Yield curve, maturities, auctions, ownership and debt-cost analytics
- Manual JSON/CSV downloads
- Historical range controls

### Treasury Pro — $15/month or $150/year

- Everything in Free
- Condition-based alerts
- Daily/weekly scheduled briefs
- Saved workspaces and preferred views
- Scheduled exports
- Priority access to new analytics

### Data API — pilot at $99/month

- Authenticated normalized endpoints
- Higher request limits
- Historical datasets
- Scheduled bulk exports
- Source lineage/reporting dates
- Commercial-use tiering as usage grows

Pricing should be revisited after real conversion, retention and infrastructure-cost data exists.

## Secure architecture

The current website is static GitHub Pages. Static JavaScript cannot securely protect paid content, Stripe secrets, API keys or entitlements.

Recommended architecture:

- **GitHub Actions** — continue official-source ingestion and validation.
- **GitHub Pages** — continue serving the free dashboard and public marketing/pricing surfaces.
- **Stripe** — products, prices, Checkout/Payment Links, subscriptions and billing portal.
- **Authentication + database** — store users, plans, saved views, alert rules and delivery preferences.
- **Serverless API** — validate sessions/API keys, enforce plan entitlements and rate limits, receive Stripe webhooks and run premium endpoints.
- **Scheduled delivery worker** — evaluate alert rules and send daily/weekly briefs.

The authentication/database and serverless pieces can be added without moving the public dashboard away from GitHub Pages.

## Rollout

### Phase M1 — conversion foundation — complete

- Product navigation and Treasury Pro positioning
- Live signal preview
- Monthly/annual pricing switch
- Free/Pro/API plan comparison
- Checkout URL hooks
- Clear distinction between free public data and paid automation

### Phase M1.5 — commercial launch readiness — complete

- Interactive alert-builder preview driven by the live official-data payload
- Public billing configuration isolated from the product UI
- Checkout success and cancellation return pages
- Terms of Service, Privacy Policy and Refund Policy
- robots.txt and sitemap.xml
- CI checks for pricing, product IDs, legal pages, checkout pages and accidental secret exposure
- Product-event hooks ready for conversion analytics

The public `billing-config.js` may contain prices and Stripe Payment Link URLs, but **never** Stripe secret keys, webhook secrets or entitlement logic.

### Phase M2 — payments and entitlements — next

- Create Stripe products/prices
- Add monthly and annual Checkout or Payment Links to `billing-config.js`
- Add customer billing portal
- Deploy authenticated backend
- Process Stripe webhooks
- Store subscription entitlement state

### Phase M3 — first paid feature

Launch **Treasury Alerts** first because it creates obvious recurring value.

Initial alert rules:

- 10Y−2Y crosses a threshold
- 10Y−3M crosses a threshold
- 10Y yield moves N basis points over N sessions
- auction demand score falls below a threshold
- 30D/90D principal due exceeds a threshold
- foreign holdings change exceeds a threshold
- primary-dealer position changes exceed a threshold

The public alert builder is only a preview. Real monitoring, notification delivery and persisted rules must run behind the authenticated backend.

### Phase M4 — scheduled brief

Deliver a concise daily/weekly brief with:

- latest yield-curve state
- major spread changes
- upcoming maturity/funding pressure
- latest auction demand
- primary-dealer positioning
- foreign/institution ownership changes
- data-source freshness notes

### Phase M5 — saved workspaces

Sync selected series, ranges, preferred panels and alert rules across devices.

### Phase M6 — authenticated API

Start with normalized read-only endpoints. Add rate limits, usage metering and API-key rotation before selling production access.

## Payment activation checklist

Before turning on real checkout:

1. Connect Stripe.
2. Create Treasury Pro monthly ($15) and annual ($150) recurring products/prices.
3. Create Data API pilot ($99/month) only when the authenticated API is actually available.
4. Configure checkout success/cancel redirects to the existing return pages.
5. Put only the public Payment Link URLs in `billing-config.js`.
6. Deploy a private webhook endpoint and keep the signing secret outside the repository.
7. Do not unlock paid access from a success-page redirect alone; verify entitlement server-side from Stripe state.
8. Add a customer billing portal and a private support contact before accepting real payments.
9. Test successful payment, failed payment, cancellation, renewal and refund flows in Stripe test mode before going live.

## Metrics to measure

- visitor → pricing view
- pricing view → checkout start
- checkout start → paid conversion
- monthly vs annual mix
- paid churn
- alert creation per paid user
- brief open/click rate
- API usage and cost per customer
- free-to-paid conversion by acquisition source

Do not add advertising clutter before subscription conversion has been tested. Sponsorships can be considered later if they fit the institutional tone of the product.
