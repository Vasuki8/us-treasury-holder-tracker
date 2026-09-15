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

### Phase M1 — conversion foundation

- Product navigation and Treasury Pro positioning
- Live signal preview
- Monthly/annual pricing switch
- Free/Pro/API plan comparison
- Checkout URL hooks
- Clear distinction between free public data and paid automation

### Phase M2 — payments and entitlements

- Create Stripe products/prices
- Add monthly and annual Checkout links
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
