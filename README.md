11Play Web

Production-oriented static web platform built with GitHub Pages, Firebase Authentication, and Cloud Firestore, designed to operate within the Firebase Spark plan without Cloud Functions, Firebase Storage, or a traditional backend server.

Canonical website:
https://11play.github.io/11play/

---

1. Project Overview

11Play is a static web application that combines public content, account features, referral tracking, activity qualification, wallet management, withdrawal requests, an administrative review system, and a static website-review publishing system.

The production architecture intentionally keeps infrastructure minimal:

- GitHub Pages hosts the web application.
- Firebase Authentication handles Google sign-in.
- Cloud Firestore stores application data.
- Firestore Security Rules are the primary authorization and integrity boundary.
- Browser JavaScript communicates directly with Firestore.
- No deployed Cloud Functions are required.
- No Firebase Storage dependency is required.
- Review pages are statically generated during the build process.
- GitHub Actions validates and deploys the public web artifact.

The application currently uses Schema Version 3 for the main account/referral/wallet data contract.

---

2. Core Architecture

User Browser
    |
    |-- Static HTML / CSS / JavaScript
    |       hosted on GitHub Pages
    |
    |-- Firebase Authentication
    |       Google authentication
    |
    |-- Cloud Firestore
            |
            |-- Profiles
            |-- Referral identities
            |-- Mobile reservations
            |-- Web-device reservations
            |-- Referral records
            |-- Activity progress
            |-- Wallets
            |-- Wallet ledger
            |-- Withdrawals
            |-- Reward events
            |-- Admin audit logs

There is intentionally no trusted application server between the browser and Firestore.

Therefore:

«Firestore Security Rules are not a secondary validation layer. They are the application's primary server-side security boundary.»

Client-side JavaScript improves UX and coordinates transactions, but must never be treated as sufficient authorization.

---

3. Hosting

The public application is hosted using GitHub Pages.

Canonical base URL:

https://11play.github.io/11play/

All production canonical URLs, referral URLs, sitemap URLs, structured-data URLs, and social metadata should use this base.

The repository is deployed as a GitHub Project Pages site, so root-relative paths such as:

/assets/file.webp

can be unsafe.

Repository-relative or "/11play/..." paths should be used where appropriate.

---

4. Firebase Model

11Play is designed for:

Firebase Spark Plan

Primary Firebase services:

- Firebase Authentication
- Cloud Firestore

Not required by the current architecture:

- Cloud Functions
- Firebase Storage
- Firebase Hosting
- Cloud Run
- Custom backend server

The JavaScript compatibility facade remains:

window.FunctionsClient

Despite its historical name, it no longer represents deployed Firebase callable functions.

It performs application operations directly against Firestore.

Main implementation:

js/account/firebase/functions.client.js

---

5. Authentication Model

Protected account functionality requires:

1. Firebase authenticated user
2. Google authentication provider
3. Verified Google email/account

The client additionally checks the authentication provider before allowing protected operations.

Firestore Security Rules must independently enforce the same security contract.

Guest users can browse public content without authentication.

---

6. Profile Model

The primary user document is stored under:

profileUsers/{uid}

A signed-in Google user receives a profile containing identity, account state, referral identity, mobile state, device state, and schema metadata.

Important profile properties include:

uid
email
emailVerified
providerIds
googleConnected
isGoogleConnected
mobileNumber
mobileAdded
mobileLocked
deviceId
deviceAdded
deviceLocked
referralCode
referralLink
referredByUid
referredByCode
status
schemaVersion

Supported account statuses:

active
suspended
blocked

Users cannot directly convert a suspended or blocked profile back to active unless allowed by the Admin contract.

Protected profile records must not be deletable by normal users.

---

7. Referral Identity

Every eligible authenticated user receives a unique referral code.

Referral-code format:

^[A-HJ-NP-Z2-9]{8}$

Characters that are easily confused visually are intentionally excluded.

Example:

ABCDEFGH

Authenticated referral URL format:

https://11play.github.io/11play/?ref=ABCDEFGH

Referral-code reservations are stored under:

profileReferralCodes/{referralCode}

These reservations prevent two users from owning the same referral identity.

---

8. Guest Referral / Share Policy

Guest users do not receive a private or Admin-owned referral code.

Guest sharing uses only:

https://11play.github.io/11play/

The historical public Admin referral endpoint remains only as a compatibility API and returns the main-site URL.

It must not expose a privileged Admin referral identity to guests.

---

9. Referral Qualification Model

A referral is not rewarded merely because a referred user signs up.

The referred account must satisfy four qualification pillars.

Pillar 1 — Verified Google Account

The referred user must use a valid Google-connected Firebase account.

Pillar 2 — Unique Bangladesh Mobile

A valid Bangladesh mobile number must be permanently registered.

Accepted normalized format:

+8801[3-9]XXXXXXXX

Example:

+8801712345678

A successful registration creates an immutable reservation:

profileMobiles/{normalizedMobile}

The same number cannot qualify multiple user accounts.

The current system does not use OTP verification.

Therefore the mobile mechanism proves:

«uniqueness inside 11Play»

It does not prove:

«physical SIM ownership»

---

10. Unique Web Device Binding

Referral qualification also requires a browser installation binding.

Storage key:

11play:web-device:v1

The device identifier is:

- generated using "crypto.getRandomValues"
- generated from 32 cryptographically random bytes
- encoded as lowercase hexadecimal
- exactly 64 hexadecimal characters

Format:

^[a-f0-9]{64}$

A reservation is stored in:

profileDevices/{deviceId}

One saved Web Device ID may belong to only one UID.

The Web Device ID is not:

- IMEI
- Android serial number
- hardware serial number
- MAC address
- physical device fingerprint

It represents one browser/site-data installation.

The implementation must fail closed when:

- secure Web Crypto is unavailable
- localStorage cannot be read
- localStorage cannot persist the generated identifier
- persisted ID verification fails

The application must never use "Math.random()" as a fallback for Web Device identity.

Browser limitation

Clearing browser data, using another browser, private/incognito browsing, or otherwise creating a new browser storage environment may result in a new Web Device ID.

This is an inherent limitation of a browser-only architecture.

---

11. Activity Qualification

Referral activity qualification uses:

7 different Bangladesh calendar dates
×
minimum 2 eligible hours per date

A user cannot satisfy the requirement by accumulating fourteen hours in one day.

Required values:

requiredActiveDays = 7
requiredDailySeconds = 7200
activityPolicyVersion = 2
schemaVersion = 3

Primary activity document:

profileActivity/{uid}

Expected fields include:

uid
userId
deviceId

activeDays
requiredActiveDays

currentDaySeconds
requiredDailySeconds

currentDayStartedAt
currentDayCompleted

lastCheckpointAt
lastActiveAt

completed
completedAt

activityPolicyVersion
schemaVersion

createdAt
updatedAt

---

12. Activity Checkpoint Model

Activity uses server-authorized checkpoints instead of trusting arbitrary client-supplied elapsed time.

Checkpoint duration:

15 minutes
=
900 seconds

Valid checkpoint interval:

15–20 minutes

Rules:

- Before 15 minutes → no credit.
- Between 15 and 20 minutes → exactly 900 seconds may be credited.
- More than 20 minutes → the gap receives no credit.
- A gap over 20 minutes creates a new anchor.
- Reaching 7200 seconds completes one eligible day.
- The same Bangladesh date cannot produce another eligible day.
- Once "activeDays == 7", activity becomes complete.
- "force=true" must never bypass elapsed-time validation.

Client-side visibility checks may consider:

- page visibility
- window focus
- network status
- recent interaction

However Firestore server time remains authoritative for security-sensitive checkpoint validation.

---

13. Referral Status Lifecycle

Current referral lifecycle:

pending
   |
   v
qualified
   |
   +------> rejected
   |
   v
rewarded

Historical compatibility may include:

captured
approved

New reward issuance occurs only after Admin approval.

A referral becomes "qualified" only after all required conditions are satisfied:

- verified Google account
- valid locked mobile
- valid locked Web Device
- completed activity policy

Qualified referrals wait for manual Admin review.

---

14. Referral Reward

Reward amount:

৳1000

A referral reward may be credited exactly once.

Admin approval must revalidate qualification before creating the reward.

A successful approval updates multiple related records atomically, including:

profileReferrals
profileReferralStats
profileWallets
profileWalletTransactions
profileRewardEvents
profileAuditLogs

The reward should create an immutable wallet ledger entry such as:

referral_reward_{referralId}

and a reward event such as:

referral_{referralId}

Duplicate approval must never credit another ৳1000.

---

15. Wallet Model

Primary wallet location:

profileWallets/{uid}

Important balances:

availableBalance
heldBalance
totalEarned
totalWithdrawn

Sensitive balance transitions must be paired with immutable ledger records.

Ledger collection:

profileWalletTransactions

Important operation types include:

referral_reward
withdraw_hold
withdraw_success
withdraw_refund
admin_adjustment

The wallet also tracks revision and last-operation information so rules can validate coordinated balance transitions.

---

16. Withdrawal Rules

Supported providers:

bkash
nagad
rocket

Minimum withdrawal:

৳1000

Withdrawal amount must also be an exact multiple of:

৳1000

Valid examples:

৳1000
৳2000
৳3000
৳5000

Invalid examples:

৳500
৳1500
৳2500

---

17. Withdrawal Lifecycle

Submission:

Available Balance
      |
      v
Held Balance
      |
      v
Pending Withdrawal

Admin then makes one final decision.

Approve

Held Balance decreases
Total Withdrawn increases

Ledger type:

withdraw_success

Reject

Held Balance decreases
Available Balance is refunded

Ledger type:

withdraw_refund

Final states:

approved
rejected

---

18. User Withdrawal Restrictions

After submission, users cannot:

- edit the withdrawal
- delete the withdrawal
- cancel the withdrawal
- change amount
- change destination number
- change provider
- force status changes

The compatibility method:

cancelWithdrawal()

remains available only to prevent older UI code from breaking.

It always rejects the operation and performs zero Firestore writes.

---

19. Historical Withdrawal Fields

Some fields remain in the schema for compatibility with historical data:

paymentConfirmed
paymentConfirmedAt
paymentReference
cancelledAt

New Admin approval does not require:

paymentConfirmed
paymentReference

These fields should not become prerequisites for the current approval flow.

Historical "cancelled" records may still be displayed, but new user cancellation is disabled.

---

20. Administration

Administrative operations are restricted to the configured permanent verified Google Admin account.

Admin capabilities include:

- Admin session verification
- dashboard statistics
- user listing
- user detail inspection
- profile status management
- referral approval
- referral rejection
- withdrawal approval
- withdrawal rejection
- wallet adjustment
- wallet transaction review
- audit-log review

Admin-side write operations must still be validated by Firestore Security Rules.

The browser UI itself is not considered an authorization boundary.

---

21. Admin Notes

Referral approval/rejection:

Admin note optional

Withdrawal approval/rejection:

Admin note optional

Profile status change:

Admin note required

Manual Admin wallet adjustment:

Admin note required

This allows sensitive manual interventions to remain auditable.

---

22. Audit Trail

Important privileged operations generate immutable audit records under:

profileAuditLogs

Examples:

referral_approved
referral_rejected
withdrawal_approved
withdrawal_rejected
profile_status_changed
wallet_adjusted

Audit records should contain enough context to reconstruct:

- acting Admin
- target user
- operation
- previous state
- resulting state
- amount where applicable
- associated ledger transaction
- Admin note
- timestamp

Audit logs must not be editable or deletable by normal users.

---

23. Main Firestore Collections

Core collections currently include:

profileUsers
profileReferralCodes
profileMobiles
profileDevices
profileReferrals
profileReferralStats
profileActivity
profileActivitySessions
profileRewardEvents
profileWallets
profileWalletTransactions
profileWithdrawals
profileAuditLogs
profileSettings

Some collections exist for legacy/read-only compatibility.

"profileActivitySessions", for example, is retained for historical reads even though the current activity model no longer depends on session records.

---

24. Public Collections

Public site/content collections may include:

sites
news
banners
siteClicks

The manual Popular-ranking model intentionally keeps:

siteClicks

publicly readable but browser writes disabled.

Current intended rule:

match /siteClicks/{siteId} {
  allow read: if true;
  allow write: if false;
}

A client-side click write failure here is intentional and must not automatically be treated as a bug.

---

25. Static Review System

The project contains a static review publishing subsystem under:

reviews/

Published review pages live under:

reviews/sites/[slug]/index.html

The review builder:

scripts/build-reviews.js

performs tasks including:

- scanning review folders
- reading review metadata
- validating published reviews
- injecting shared header/features/footer
- updating SEO metadata
- generating Review structured data
- generating Breadcrumb structured data
- generating "reviews/index.html"
- generating ItemList structured data
- updating review entries in "sitemap.xml"

---

26. Review Image Validation

A published review with a local image must reference an existing non-empty file.

The build must fail when a required local image:

- does not exist
- is empty
- resolves outside the reviews directory
- uses an unsafe root-relative Project Pages path

This prevents broken review assets from reaching production.

Example review asset:

reviews/assets/megacricketworld.webp

---

27. Production Validator

Production validation is implemented in:

scripts/validate-production.js

Its responsibility is to detect problems before GitHub Pages deployment.

Validation areas include:

- required production files
- JSON parsing
- Firebase configuration
- manifest configuration
- robots.txt sitemap declaration
- menu production URLs
- placeholder social links
- local HTML href/src targets
- JSON-LD validity
- unresolved template placeholders
- canonical URL domain
- legacy production URLs
- generated review output
- review assets
- sitemap entries
- sitemap "lastmod" consistency

The deferred APK is intentionally excluded from validator inspection.

---

28. Automated Firestore Security Tests

Rules tests are located at:

tests/firestore.rules.test.js

The test suite uses the Firebase Local Emulator Suite and Firebase Rules Unit Testing library.

Important scenarios include:

Authentication

- verified Google account succeeds where expected
- unverified account rejected
- non-Google provider rejected
- stranger cannot read another user's private records

Mobile

- valid unique mobile binding succeeds
- duplicate mobile across UIDs fails
- mobile reservation is immutable

Web Device

- unique device binding succeeds
- same device on another UID fails
- reservation is immutable

Activity

- activity day initialization
- checkpoint under 15 minutes rejected
- 15–20 minute checkpoint credits exactly 900 seconds
- gap over 20 minutes receives no activity credit
- 7200 seconds completes one eligible day
- same day cannot increment active days again
- missing mobile/device blocks activity qualification

Referral

- referred user cannot self-reward
- Admin approval credits exactly ৳1000
- reward ledger/event/audit are required
- missing device reservation blocks reward
- Admin rejection creates no wallet reward

Withdrawal

- Available → Held submission transaction
- submitted request cannot be cancelled
- direct wallet mutation rejected
- Admin approval clears Held and increments withdrawn total
- Admin rejection refunds Held
- non-Admin final decision rejected
- final decision cannot be reversed

Privacy

- owner can read own wallet/withdrawal
- stranger cannot
- Admin can inspect protected records

The test suite must pass against the actual "firestore.rules" file before the deployment can be considered security-verified.

---

29. Development Tooling

Root development configuration:

package.json

The package is private and exists only for:

- validation
- review building
- Firebase CLI
- Firestore emulator testing

The public website remains a static application and does not require Node.js in the visitor's browser.

Common scripts include:

npm run check:js
npm run build:reviews
npm run validate:production
npm run test:rules
npm run validate
npm run deploy:firestore

---

30. JavaScript Syntax Validation

Production JavaScript should pass:

node --check

The CI workflow is intended to check JavaScript sources before deployment.

Syntax success is necessary but not sufficient.

It does not replace:

- Firestore Rules testing
- emulator testing
- live E2E testing

---

31. GitHub Actions Deployment

Workflow:

.github/workflows/build-reviews.yml

The intended production pipeline is:

Checkout
   ↓
Node / Java setup
   ↓
Install validation dependencies
   ↓
JavaScript syntax validation
   ↓
Build review pages
   ↓
Production validation
   ↓
Firestore Security Rules tests
   ↓
Prepare clean GitHub Pages artifact
   ↓
Artifact validation
   ↓
GitHub Pages deployment

The deployment workflow should not require a bot to modify or push generated files back into "main".

The source revision that entered CI should remain immutable during that deployment run.

---

32. GitHub Pages Artifact

Only public web resources should be deployed.

Backend/development resources should not be exposed through the Pages artifact.

Examples excluded from "_site":

.git/
.github/
scripts/
tests/
functions/
node_modules/
.firebase/
.firebaserc
.gitignore
firebase.json
firestore.rules
firestore.indexes.json
package.json
README.md

Public website files, including the existing APK, remain deployable unless deliberately excluded later.

---

33. Firebase Deployment

GitHub Pages deployment does not deploy Firestore Security Rules automatically unless explicitly configured to do so.

Firestore production deployment remains a separate privileged operation.

Typical command:

npm run deploy:firestore

Equivalent Firebase CLI operation:

firebase deploy --only firestore --project web11-one

Never deploy new client logic expecting new Rules before the corresponding Rules are ready.

Client and Rules contracts must remain synchronized.

---

34. Deployment Order

Recommended production release sequence:

1. Review pending source changes.
2. Validate all JavaScript syntax.
3. Build static reviews.
4. Run production validator.
5. Run Firestore Emulator Rules tests.
6. Review generated sitemap/review output.
7. Deploy Firestore Rules/indexes.
8. Deploy GitHub Pages.
9. Execute production E2E tests.
10. Inspect Firestore ledger and audit consistency.

---

35. Production E2E Checklist

A full live test should cover this primary journey:

Guest
  ↓
Google Sign-In
  ↓
Profile creation
  ↓
Mobile registration
  ↓
Web Device binding
  ↓
Referral capture
  ↓
Activity anchor
  ↓
8 valid 15-minute checkpoints
  ↓
2 eligible hours
  ↓
Repeat across 7 BD dates
  ↓
Referral Qualified
  ↓
Admin Review
  ↓
Admin Approve
  ↓
Exactly ৳1000 wallet credit
  ↓
Withdrawal request
  ↓
Available -> Held
  ↓
Admin Approve / Reject
  ↓
Ledger + Audit verification

---

36. Required Negative E2E Tests

Production verification must also test failures.

Important cases:

- duplicate mobile
- duplicate Web Device across UIDs
- invalid Bangladesh mobile
- invalid referral code
- self-referral
- unverified Google account
- non-Google sign-in provider
- activity before 15 minutes
- activity after >20-minute idle gap
- multiple rapid activity requests
- multiple tabs
- mismatched current device
- insufficient withdrawal balance
- invalid withdrawal amount
- user withdrawal cancellation
- user wallet manipulation
- duplicate Admin referral approval
- duplicate withdrawal decision
- non-Admin privileged write
- suspended/blocked user operations

---

37. Public Pages

The project includes public informational/legal pages including:

pages/about.html
pages/privacy-policy.html
pages/terms.html
pages/contact.html

These pages should remain aligned with the actual system behavior.

Important disclosures include:

- Google profile information used for account operation
- mobile number used for anti-abuse/referral attribution
- browser-generated Web Device identity
- referral qualification requirements
- withdrawal process
- platform relationship with third-party gaming services

The site does not claim to process third-party gaming transactions itself.

---

38. Navigation / Social Configuration

Main menu configuration:

js/config/menu.config.js

Current production links:

Telegram:
https://t.me/play11play

Website:
https://11play.github.io/11play/

YouTube:
https://youtube.com/@11play-app

Currently intentionally empty:

WhatsApp
Facebook
Twitter/X

Placeholder social URLs must never be deployed.

---

39. APK Status

Current APK:

11play.apk

APK work is explicitly deferred to a later independent phase.

During the current web production-hardening work:

- do not delete it
- do not rebuild it
- do not modify it
- do not replace it
- do not remove its download menu item
- do not make referral qualification depend on APK installation

The current browser and installed-wrapper paths must follow the same referral qualification rules.

---

40. APK Download Menu

Current menu entry intentionally remains:

Download Apk
→
11play.apk

This must remain unchanged until the dedicated APK phase begins.

---

41. Security Assumptions

The following must always be considered attacker-controlled:

- browser JavaScript
- UI state
- form validation
- local timestamps
- activity payload flags
- DOM state
- query parameters
- localStorage values
- client-provided transaction payloads

Security decisions must therefore be enforced through:

Firestore Security Rules
+
server request.time
+
immutable reservation documents
+
atomic multi-document writes
+
ledger/audit consistency

---

42. What the System Does Not Guarantee

The browser-only architecture cannot guarantee physical hardware identity.

Web Device binding does not prevent a determined user from:

- clearing browser storage
- using another browser
- using another browser profile
- using private browsing
- using another physical device

The design increases anti-abuse friction but does not provide hardware attestation.

Similarly, mobile uniqueness without OTP does not establish actual ownership of the phone number.

These limitations should not be misrepresented in UI, documentation, or policy text.

---

43. Data Integrity Principles

Production code should follow these principles:

Fail Closed

Security-sensitive uncertainty should deny qualification rather than silently weaken validation.

Immutable Reservations

Unique mobile and device records should not be transferred between users.

Atomic Financial Writes

Wallet mutation and ledger creation should happen in the same authorized transaction/batch.

Idempotency

Repeated reward or withdrawal operations must not duplicate money.

Server Time

Financial, activity, review, and audit decisions should not trust browser clocks when server time can enforce the requirement.

Final Decisions Stay Final

Reward and withdrawal final states must not be casually reversible.

---

44. Folder Overview

A simplified project layout:

11play/
│
├── index.html
├── 11play.apk
├── manifest.json
├── robots.txt
├── sitemap.xml
│
├── firebase.json
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
│
├── package.json
├── README.md
├── .gitignore
│
├── css/
│   └── ...
│
├── js/
│   ├── account/
│   │   ├── firebase/
│   │   │   ├── functions.client.js
│   │   │   ├── activity.db.js
│   │   │   ├── referral.db.js
│   │   │   └── withdraw.db.js
│   │   │
│   │   ├── profile/
│   │   ├── referral/
│   │   └── withdraw/
│   │
│   ├── config/
│   │   ├── firebase.config.js
│   │   └── menu.config.js
│   │
│   └── services/
│
├── admin/
│   ├── index.html
│   └── js/
│       ├── admin.api.js
│       ├── admin.referrals.js
│       └── admin.withdrawals.js
│
├── pages/
│   ├── about.html
│   ├── privacy-policy.html
│   ├── terms.html
│   └── contact.html
│
├── reviews/
│   ├── index.html
│   ├── index.template.html
│   ├── review.css
│   ├── review-search.js
│   │
│   ├── assets/
│   │   └── ...
│   │
│   ├── partials/
│   │   ├── header.html
│   │   ├── common-features.html
│   │   └── footer.html
│   │
│   └── sites/
│       └── [slug]/
│           └── index.html
│
├── scripts/
│   ├── build-reviews.js
│   └── validate-production.js
│
├── tests/
│   └── firestore.rules.test.js
│
└── .github/
    └── workflows/
        └── build-reviews.yml

Exact repository contents may contain additional UI assets and modules.

---

45. Mobile-Only Maintenance Workflow

The project is maintained primarily from Android using Acode, mobile GitHub, and browser tools.

Recommended workflow:

1. Open one file at a time.
2. Copy the complete production replacement.
3. Replace the entire target file.
4. Save.
5. Review path and filename carefully.
6. Commit through GitHub/mobile workflow.
7. Check GitHub Actions.
8. Do not reorganize the repository structure casually.

Folder structure should remain stable unless a migration is deliberately planned.

---

46. Important Files

Firestore authorization

firestore.rules

Firestore indexes

firestore.indexes.json

Main Spark client

js/account/firebase/functions.client.js

Menu / official links

js/config/menu.config.js

Static review builder

scripts/build-reviews.js

Production validator

scripts/validate-production.js

Firestore Rules tests

tests/firestore.rules.test.js

GitHub Pages pipeline

.github/workflows/build-reviews.yml

---

47. Current Production-Hardening Status

The main Schema-v3 Spark migration and business logic are substantially implemented.

Completed major areas include:

- Firestore Rules architecture
- Spark/direct-Firestore client
- Profile
- Web Device binding
- mobile locking
- activity model
- referral model
- wallet
- withdrawal
- Admin UI/API
- policy pages
- static reviews
- social URL cleanup
- review asset hardening
- production validator
- Firestore Rules test suite
- ".gitignore"

However, the repository must not yet be described as fully production deployment-verified until the remaining validation cycle passes.

---

48. Remaining Release Gate

Before final production sign-off:

1. Dependency configuration reconciliation

The final GitHub Actions workflow and production validator must agree on whether a generated "package-lock.json" exists.

An empty or manually fabricated "package-lock.json" must never be used.

If no valid npm-generated lockfile is committed:

npm install

must be used rather than:

npm ci

If a legitimate npm-generated lockfile is later committed, CI may switch back to "npm ci".

---

2. Production validator pass

Run:

npm run build:reviews
npm run validate:production

and resolve every error.

---

3. Firestore Emulator Rules pass

Run the complete Rules suite.

Required outcome:

PASS

No security-critical test should be skipped merely to get CI green.

---

4. Firestore deployment

Deploy:

firestore.rules
firestore.indexes.json

to the intended Firebase production project.

---

5. GitHub Pages workflow

Required outcome:

GitHub Actions = Green
GitHub Pages deployment = Successful

---

6. Live production E2E

Complete the entire referral/reward/withdrawal flow with real authenticated test accounts.

Only after these gates pass should the project be marked:

Production Deployment Verified

---

49. Do Not Reintroduce

Future maintenance must not accidentally reintroduce the following:

- Cloud Functions dependency
- Blaze-only architecture requirement
- Firebase Storage dependency
- insecure "Math.random()" Web Device ID generation
- hardware IMEI/serial claims
- APK-installation referral requirement
- guest Admin referral link
- user withdrawal cancellation
- paymentReference requirement for withdrawal approval
- paymentConfirmed checkbox requirement
- client-authoritative activity elapsed time
- user-editable wallet balances
- duplicate referral rewards
- mutable financial ledger history
- placeholder social URLs
- automated bot pushes to "main" during deployment

---

50. Production Definition of Done

11Play is considered fully production-ready only when all of the following are true:

[ ] JavaScript syntax passes
[ ] Review build passes
[ ] Published review assets exist
[ ] Production validator passes
[ ] Firestore Rules compile
[ ] Firestore Emulator tests pass
[ ] Firestore indexes deploy
[ ] Firestore Rules deploy
[ ] GitHub Actions passes
[ ] GitHub Pages deploys
[ ] Google authentication works
[ ] Mobile uniqueness works
[ ] Web Device uniqueness works
[ ] 7 × 2-hour activity policy works
[ ] Referral reaches Qualified correctly
[ ] Admin approval credits exactly ৳1000 once
[ ] Referral rejection gives no reward
[ ] Withdrawal moves Available -> Held
[ ] Withdrawal approval settles Held correctly
[ ] Withdrawal rejection refunds correctly
[ ] User cancellation remains impossible
[ ] Duplicate Admin actions are rejected/idempotent
[ ] Ledger records match wallet transitions
[ ] Audit records match privileged operations
[ ] Unauthorized writes fail
[ ] Public pages and SEO URLs are correct

---

51. Maintenance Principle

When changing account, referral, activity, wallet, or withdrawal behavior, always evaluate these together:

Client JavaScript
+
Firestore Security Rules
+
Automated Rules Tests
+
Admin behavior
+
Policy/legal text

Changing only one layer can create a broken or insecure production contract.

---

52. Project Status

Current architecture:

GitHub Pages
+
Firebase Authentication
+
Cloud Firestore
+
Firestore Security Rules
+
Static JavaScript
+
GitHub Actions

Target:

Secure
Auditable
Spark-Compatible
Mobile-Maintainable
Static-Hosting-Friendly
Production-Tested

The current production-hardening phase should finish with validation and deployment verification—not another architectural rewrite.

---

© 11Play. All rights reserved.
