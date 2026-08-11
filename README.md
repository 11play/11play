# 11Play Web

11Play is a production-oriented static web platform built with GitHub Pages, Firebase Authentication, Cloud Firestore, Firestore Security Rules, and browser JavaScript.

Canonical website:

https://11play.github.io/11play/

The current production architecture is designed to operate on the Firebase Spark plan without deployed Cloud Functions, Firebase Storage, Firebase Hosting, Cloud Run, or a traditional backend server.

---

## 1. Current Architecture

11Play currently uses:

- GitHub Pages
- Static HTML
- Static CSS
- Static JavaScript
- Firebase Authentication
- Google Sign-In
- Cloud Firestore
- Firestore Security Rules
- Firebase Spark plan
- GitHub Actions
- Static review generation

The browser communicates directly with Firebase Authentication and Cloud Firestore.

There is intentionally no application server between the browser and Firestore.

Therefore:

> Firestore Security Rules are the primary server-side security boundary of the application.

Client-side checks improve the user experience but must never be considered sufficient authorization.

---

## 2. Current Account Scope

The current account system is intentionally simple.

Supported account functionality:

- Google Sign-In
- verified Google account validation
- automatic profile creation
- user profile
- Gmail identity
- Google profile photo
- username
- Bangladesh mobile number
- one-time mobile locking
- registration date
- last login
- account status
- logout

The current system does not include:

- referral tracking
- referral codes
- referral rewards
- activity qualification
- Web Device qualification
- wallet balances
- withdrawals
- financial ledger
- reward events
- referral administration

---

## 3. Current Schema Version

The current Profile and Offer system uses:

```text
schemaVersion = 4
```

The current Firestore contract must remain synchronized across:

```text
Client JavaScript
+
Firestore Security Rules
+
Firestore Rules Tests
+
Admin Dashboard
+
Production Validator
```

---

## 4. Hosting

The public application is hosted through GitHub Pages.

Canonical URL:

```text
https://11play.github.io/11play/
```

Production URLs should use this canonical base.

Because this is a GitHub Project Pages deployment, careless root-relative URLs such as:

```text
/assets/image.png
```

may be incorrect.

Use repository-relative paths or the proper `/11play/` project path when required.

---

## 5. Firebase Services

Primary Firebase services:

- Firebase Authentication
- Cloud Firestore

The current architecture does not require:

- deployed Firebase Cloud Functions
- Firebase Storage
- Firebase Hosting
- Cloud Run
- Blaze plan
- custom API server

The project is designed to remain compatible with:

```text
Firebase Spark Plan
```

---

## 6. FunctionsClient

The project retains the historical file:

```text
js/account/firebase/functions.client.js
```

and public object:

```text
window.FunctionsClient
```

Despite the historical name, the current implementation is not a deployed Firebase Cloud Functions client.

It acts as the shared Firebase Spark / direct-Firestore application facade.

Security-sensitive Firestore operations must remain compatible with Firestore Security Rules.

---

## 7. Authentication Model

Protected account functionality requires:

1. Firebase Authentication
2. Google Sign-In
3. verified Google email
4. Google authentication provider

The expected Firebase provider is:

```text
google.com
```

Firestore Security Rules independently enforce the authentication requirements.

Guest users may browse public website content without signing in.

---

## 8. User Profile

Primary profile collection:

```text
profileUsers/{firebaseUid}
```

The document ID is the authenticated Firebase UID.

Current profile fields may include:

```text
uid
name
displayName
username
email
photo
photoURL
emailVerified
providerIds
googleConnected
isGoogleConnected
isGoogleSignIn
accountType
mobileNumber
mobileAdded
mobileLocked
isMobileLocked
registrationDate
createdAt
lastLogin
lastLoginAt
updatedAt
status
schemaVersion
```

Current schema:

```text
schemaVersion = 4
```

---

## 9. Google Identity

The user's Google account is the account identity.

Important rules:

- profile UID must match Firebase Auth UID
- Gmail/email must match the authenticated Google account
- email must remain tied to that account
- Google account must be verified
- account must be authenticated through Google

The profile username is derived from the Gmail local part.

Example:

```text
email:
johnsmith@gmail.com

username:
johnsmith
```

---

## 10. Email Reservation

Email ownership is represented by:

```text
profileEmails/{normalizedEmail}
```

Example:

```text
profileEmails/johnsmith@gmail.com
```

The reservation maps the verified Google email to the Firebase UID.

Typical fields:

```text
email
uid
userId
provider
createdAt
schemaVersion
```

Provider:

```text
google.com
```

Schema:

```text
4
```

Email reservation creation and profile creation must remain consistent with the Firestore Rules contract.

Email reservations are immutable.

---

## 11. Mobile Number

Users may add a Bangladesh mobile number to their own profile.

Required normalized format:

```text
+8801[3-9]XXXXXXXX
```

Example:

```text
+8801712345678
```

The current system does not require global mobile uniqueness.

Therefore:

> Multiple different 11Play profiles may contain the same mobile number.

The current system also does not claim that saving a number proves physical SIM ownership.

---

## 12. Mobile Lock

Mobile registration is one-time per profile.

Initial state:

```text
mobileNumber = ""
mobileAdded = false
mobileLocked = false
isMobileLocked = false
```

After a valid mobile number is saved:

```text
mobileAdded = true
mobileLocked = true
isMobileLocked = true
```

Once saved and locked, the user must not be able to:

- change the number
- remove the number
- reset the number through normal client operations

Firestore Security Rules enforce the final restriction.

---

## 13. Account Status

Supported profile statuses:

```text
active
suspended
blocked
```

Account status is visible to the Admin.

The current Admin interface does not provide direct profile-status editing.

Users must not be able to modify protected account state arbitrarily.

---

## 14. Invite Your Friend

The current Invite feature is a normal sharing feature.

It does not use referral tracking.

Shared URL:

```text
https://11play.github.io/11play/
```

The Invite system must not generate:

```text
?ref=
```

URLs.

There are no:

- referral codes
- referral ownership records
- referral rewards
- referral attribution
- referral qualification rules

---

## 15. Current Main Menu Account Features

The current account-related menu contains:

```text
Profile
Invite Your Friend
Offer
Live Chat
```

Invite Your Friend uses the normal sharing system.

The previous referral/reward/wallet/withdrawal menu flows must not be reintroduced accidentally.

---

## 16. 500 BDT New User Offer

11Play currently provides a manually handled new-user promotional offer.

Offer amount:

```text
500 BDT
```

The offer process is Live Chat-first.

Typical flow:

```text
User opens 11Play
        ↓
User opens Live Chat
        ↓
User receives target site link/instructions
        ↓
User registers through the supplied link
        ↓
User completes the target site's required conditions
        ↓
User returns to 11Play Live Chat
        ↓
Offer is reviewed manually
        ↓
Admin marks Offer Paid after delivery
```

The exact promotional eligibility conditions are communicated through the Offer and Live Chat experience.

---

## 17. Offer Assets

Current Offer assets include:

```text
assets/images/offers/11play-500-bdt-offer.png
```

and social/share image:

```text
assets/seo/11play-500-bdt-offer-share.png
```

The social-share image is used for Open Graph and compatible social previews.

---

## 18. Offer Paid Storage

Offer payment state is separated from the user's normal profile.

Collection:

```text
profileOfferStatus/{firebaseUid}
```

Typical fields:

```text
uid
offerPaid
offerPaidAt
offerPaidByUid
offerPaidByEmail
createdAt
updatedAt
schemaVersion
```

Current schema:

```text
schemaVersion = 4
```

The Offer Paid document is Admin-only data.

---

## 19. Offer Paid Security

Normal users must not be able to:

- read their Offer Paid document
- list Offer Paid documents
- create Offer Paid documents
- modify Offer Paid documents
- mark themselves as paid

Only the authorized Admin can access this collection through the permitted Firestore Rules contract.

The user-facing Profile page does not display Offer Paid status.

---

## 20. Offer Paid Finality

Admin may mark a user as:

```text
PAID
```

only after the promotional Offer has actually been provided.

The Admin interface intentionally provides no normal:

```text
Mark Unpaid
```

operation.

An existing paid status must not be casually reversed or rewritten.

---

## 21. Administration

Admin Dashboard:

```text
admin/index.html
```

Current Admin modules:

```text
admin/js/admin.api.js
admin/js/admin.auth.js
admin/js/admin.users.js
admin/js/admin.app.js
```

Current Admin capabilities:

- Admin authentication
- Admin session validation
- Dashboard summary
- registered user listing
- user searching
- user filtering
- user detail inspection
- Offer Paid inspection
- Offer Paid action
- logout

The Admin Dashboard no longer includes:

- referral approval
- referral rejection
- wallet adjustment
- withdrawal review
- transaction review
- audit-log review
- activity review
- device review

---

## 22. Permanent Admin

The configured permanent Admin email is:

```text
casinobuzzbd@gmail.com
```

Admin access requires the verified Google account matching that email.

Client-side checks are only UI protection.

Firestore Security Rules remain the final authorization boundary.

The project does not use:

- Firestore Admin-role documents
- custom claims
- Super Admin hierarchy

---

## 23. Admin User Information

The Admin user list is designed to display:

```text
Name
Username
Gmail
Mobile
Registration Date
Last Login
Account Status
Offer Status
```

Admin can open detailed information for individual users.

User profile identity remains read-only from the Admin user-management interface.

---

## 24. Public Firestore Collections

Public content collections may include:

```text
sites
news
banners
siteClicks
```

Current intended security model:

```text
public read
no public write
```

For example:

```rules
match /siteClicks/{siteId} {
    allow read: if true;
    allow write: if false;
}
```

A failed browser-side write to these protected public-content collections should not automatically be considered a bug.

---

## 25. Current Protected Firestore Collections

The current account system primarily uses:

```text
profileUsers
profileEmails
profileOfferStatus
```

Legacy account collections are no longer part of the active production architecture.

Examples of removed systems include:

```text
profileReferralCodes
profileMobiles
profileDevices
profileReferrals
profileReferralStats
profileActivity
profileActivitySessions
profileWallets
profileWalletTransactions
profileRewardEvents
profileWithdrawals
profileAuditLogs
profileSettings
profileAdmins
```

The default Firestore Rules policy denies access to unsupported collections.

---

## 26. Firestore Rules

Primary authorization file:

```text
firestore.rules
```

Current Rules responsibilities include:

- verified Google authentication
- profile ownership validation
- Google identity consistency
- immutable email reservation
- one-time mobile locking
- Admin-only Offer Paid access
- public content read protection
- deny-by-default behavior

Firestore Security Rules must be treated as authoritative even if equivalent checks exist in JavaScript.

---

## 27. Firestore Indexes

Current file:

```text
firestore.indexes.json
```

Current configuration:

```json
{
    "indexes": [],
    "fieldOverrides": []
}
```

The current production queries do not require a composite Firestore index.

Do not add indexes unless an actual production query requires one.

---

## 28. Firestore Security Tests

Rules tests:

```text
tests/firestore.rules.test.js
```

The test suite uses Firebase Rules Unit Testing and the Firestore Emulator.

Current coverage includes:

### Authentication

- verified Google account succeeds
- unverified Google account fails
- non-Google authentication fails

### Profile

- profile creation succeeds for the authenticated owner
- guest profile access fails
- owner can read own profile
- owner cannot read another user's profile
- owner cannot list profiles
- Admin can read/list profiles
- protected identity fields cannot be changed arbitrarily
- profile deletion is denied

### Email

- own email reservation can be read
- email reservation list is denied
- reservation is immutable
- duplicate email ownership by another UID is denied

### Mobile

- valid Bangladesh mobile succeeds
- duplicate mobile numbers across different users are allowed
- saved mobile cannot be changed
- saved mobile cannot be removed
- invalid mobile format fails

### Offer Paid

- Admin can mark an existing user as paid
- missing target profile cannot be marked
- regular users cannot create Offer Paid data
- regular users cannot read Offer Paid data
- Admin can list Offer Paid records
- paid state cannot be reversed
- paid record cannot be deleted

### Legacy Collections

Removed account collections remain inaccessible.

The Rules test suite must pass before the Firestore security contract is considered verified.

---

## 29. Static Review System

The project also contains a static review publishing system.

Review root:

```text
reviews/
```

Published review pages:

```text
reviews/sites/[slug]/index.html
```

Review builder:

```text
scripts/build-reviews.js
```

The builder may perform tasks including:

- reading review metadata
- validating review content
- generating review pages
- generating the review index
- generating structured data
- updating sitemap entries
- validating local review assets

---

## 30. Review Assets

Published local review images must:

- exist
- be non-empty
- resolve inside the repository
- use Project Pages-safe paths

Example asset:

```text
reviews/assets/megacricketworld.webp
```

Broken published review assets must not be deployed.

---

## 31. Production Validator

Production validation:

```text
scripts/validate-production.js
```

The current validator checks areas including:

- required production files
- obsolete-file removal
- JSON parsing
- Firebase configuration
- Firestore index configuration
- current Firestore Rules contract
- manifest configuration
- robots.txt
- menu URLs
- Profile/Offer/Live Chat scripts
- removed dependency references
- Share configuration
- Admin module configuration
- Admin Offer Paid UI
- removed Admin feature references
- local HTML href/src targets
- JSON-LD
- unresolved template placeholders
- canonical URLs
- placeholder/legacy production URLs
- review output
- review assets
- sitemap content
- sitemap lastmod consistency

The deferred APK is intentionally excluded from validator inspection.

---

## 32. Removed Empty Compatibility Files

The following empty compatibility files have been removed:

```text
js/core/state.js
js/core/events.js
js/core/utils.js
js/services/api.service.js
```

`index.html` must not reference them.

They should not be recreated unless a future architecture explicitly requires them.

---

## 33. Removed Legacy Account Modules

Examples of removed account modules include:

```text
js/account/firebase/activity.db.js
js/account/firebase/referral.db.js
js/account/firebase/reward.db.js
js/account/firebase/wallet.db.js
js/account/firebase/withdraw.db.js

js/account/referral/referral.capture.js
```

Additional old referral/reward/withdrawal UI modules have also been removed.

---

## 34. Removed Admin Modules

The following Admin feature modules are no longer part of the current system:

```text
admin/js/admin.referrals.js
admin/js/admin.withdrawals.js
admin/js/admin.transactions.js
```

`admin/index.html` must not load these files.

Current Admin loading order:

```text
admin.api.js
    ↓
admin.auth.js
    ↓
admin.users.js
    ↓
admin.app.js
```

---

## 35. Main Application Boot

Root application:

```text
index.html
```

Important current boot dependencies include:

```text
js/core/router.js
js/core/share.js

js/services/firebase.service.js
js/services/auth.service.js
js/services/profile.service.js

js/account/shared/auth.guard.js

js/account/firebase/functions.client.js
js/account/firebase/profile.db.js

js/account/profile/profile.module.js
js/account/offer/offer.module.js
js/account/live-chat/live-chat.module.js

js/account/router.js
```

Authentication/Profile initialization runs independently so public application rendering does not have to wait for the user to sign in.

---

## 36. Current Application Routes

Current account-related application routes include:

```text
profile
offer
live-chat
```

Invite Your Friend is implemented as a share action rather than a separate application page.

The project must not reintroduce legacy routes such as:

```text
referral
reward
wallet
withdrawal
```

without an explicit architecture change.

---

## 37. Sharing

Main sharing implementation:

```text
js/core/share.js
```

Current sharing behavior:

```text
https://11play.github.io/11play/
```

The current share system promotes the 500 BDT new-user Offer.

It must not create referral tracking parameters.

Forbidden legacy behavior:

```text
https://11play.github.io/11play/?ref=XXXXXXXX
```

---

## 38. Public Pages

Public informational/legal pages include:

```text
pages/about.html
pages/privacy-policy.html
pages/terms.html
pages/contact.html
```

These pages must remain consistent with actual production behavior.

Current system descriptions should not claim that 11Play still provides:

- referral rewards
- wallet management
- withdrawal processing
- activity qualification
- device qualification

unless those features are deliberately reintroduced in the future.

---

## 39. Third-Party Service Position

11Play may provide information, access links, reviews, promotional information, and support relating to third-party services.

The platform should not falsely claim that it directly processes third-party gaming transactions when it does not.

Public/legal wording must remain aligned with the actual platform implementation.

---

## 40. APK Status

Current APK:

```text
11play.apk
```

APK work is deferred to a separate phase.

During the current web production-hardening work:

- do not delete it
- do not rebuild it
- do not replace it
- do not modify it unnecessarily
- do not remove its current download entry

The production validator intentionally does not inspect the APK binary.

---

## 41. APK Download

The current download target remains:

```text
11play.apk
```

The root website contains an APK installation/download popup.

The existing APK experience should remain unchanged until the dedicated APK phase begins.

---

## 42. Google Analytics

The public root page currently includes Google Analytics.

Current Measurement ID:

```text
G-H668K4EMNT
```

Analytics configuration should not interfere with Authentication or Firestore security behavior.

---

## 43. SEO

Important SEO configuration includes:

- canonical URL
- meta description
- Open Graph metadata
- social share image
- Twitter/X card metadata
- JSON-LD structured data
- robots.txt
- sitemap.xml

Canonical root:

```text
https://11play.github.io/11play/
```

Current primary Offer share image:

```text
https://11play.github.io/11play/assets/seo/11play-500-bdt-offer-share.png
```

---

## 44. Development Tooling

Development configuration:

```text
package.json
```

Node.js is used for development tasks such as:

- JavaScript syntax checking
- review generation
- production validation
- Firestore Emulator Rules testing
- Firebase CLI deployment

The visitor-facing website remains a static browser application and does not require Node.js on the client.

Typical commands may include:

```bash
npm run check:js
npm run build:reviews
npm run validate:production
npm run test:rules
npm run validate
npm run deploy:firestore
```

Available commands depend on the current `package.json`.

---

## 45. JavaScript Syntax Validation

Production JavaScript should pass:

```bash
node --check
```

Syntax validation is necessary but does not replace:

- Firestore Rules tests
- production validation
- live authentication testing
- manual Admin testing

---

## 46. Firebase Deployment

GitHub Pages deployment and Firestore Rules deployment are separate operations.

Typical Firestore deployment:

```bash
firebase deploy --only firestore --project web11-one
```

or the repository script:

```bash
npm run deploy:firestore
```

Never deploy client behavior that depends on new Firestore permissions before the corresponding Rules are ready.

---

## 47. GitHub Pages Artifact

Only public website resources should be included in the deployed Pages artifact.

Development/backend configuration should normally remain outside the generated public artifact.

Examples may include:

```text
.git/
.github/
scripts/
tests/
node_modules/
.firebase/
.firebaserc
.gitignore
firebase.json
firestore.rules
firestore.indexes.json
package.json
README.md
```

The current APK remains a public downloadable asset until the APK phase changes that decision.

---

## 48. Recommended Release Sequence

Recommended production release sequence:

```text
1. Review source changes
2. Validate JavaScript syntax
3. Build static reviews
4. Run production validator
5. Run Firestore Emulator Rules tests
6. Review generated review/sitemap output
7. Deploy Firestore Rules/index configuration
8. Deploy GitHub Pages
9. Test Google authentication
10. Test Profile creation
11. Test mobile locking
12. Test Admin authentication
13. Test Admin user listing
14. Test Offer Paid
15. Verify unauthorized access fails
```

---

## 49. Production E2E Checklist

Primary current production journey:

```text
Guest
  ↓
11Play public website
  ↓
Google Sign-In
  ↓
Verified Google authentication
  ↓
Profile creation
  ↓
Profile displayed
  ↓
Bangladesh mobile added
  ↓
Mobile permanently locked
  ↓
Offer / Live Chat
  ↓
Manual Offer process
  ↓
Admin reviews user
  ↓
Admin marks Offer Paid
```

Important verification:

- same Google account returns the same profile
- user cannot read another user's profile
- mobile cannot be changed after locking
- duplicate mobile across different users is permitted
- normal user cannot read Offer Paid data
- normal user cannot mark Offer Paid
- Admin can inspect users
- Admin can mark Offer Paid through the authorized contract
- paid state cannot be casually reversed

---

## 50. Negative Security Tests

Important negative scenarios include:

```text
Guest attempts private profile read
Unverified Google account
Non-Google authentication provider
User reads another profile
User lists all profiles
User changes Gmail identity
User removes locked mobile
User changes locked mobile
Invalid Bangladesh mobile
User reads Offer Paid status
User creates Offer Paid status
User changes Offer Paid status
User deletes Offer Paid status
Non-Admin lists Offer Paid records
Admin marks missing user
Admin attempts unsupported legacy write
```

Unauthorized operations must fail through Firestore Security Rules.

---

## 51. Security Assumptions

The following must always be treated as attacker-controlled:

- browser JavaScript
- DOM state
- UI validation
- query parameters
- localStorage
- browser timestamps
- form values
- client-generated payloads
- client-side Admin checks

Security-sensitive decisions must be enforced through:

```text
Firebase Authentication
+
Firestore Security Rules
+
request.auth
+
request.time
+
document ownership
+
immutable state rules
```

---

## 52. Data Integrity Principles

### Verified Identity

Protected profiles must remain tied to the authenticated Google UID and Gmail.

### Immutable Email Mapping

Email ownership reservations must not be transferred between accounts.

### One-Time Mobile Lock

Once the profile mobile is saved, it must not be arbitrarily replaced.

### Admin Separation

Offer Paid data must remain separate from normal user profile data.

### Least Privilege

Users should only access data required for their own account.

### Deny by Default

Unknown Firestore collections and unsupported writes should remain denied.

### Server Time

Security-sensitive timestamps should use Firestore server-authoritative request time where appropriate.

### Final Paid State

Offer Paid records should not be casually reversed or deleted.

---

## 53. Folder Overview

Simplified current repository layout:

```text
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
├── assets/
│   ├── icon/
│   ├── images/
│   │   └── offers/
│   └── seo/
│
├── css/
│   ├── account/
│   │   ├── profile.css
│   │   ├── offer.css
│   │   └── live-chat.css
│   └── ...
│
├── js/
│   ├── account/
│   │   ├── firebase/
│   │   │   ├── functions.client.js
│   │   │   └── profile.db.js
│   │   │
│   │   ├── shared/
│   │   │   └── auth.guard.js
│   │   │
│   │   ├── profile/
│   │   ├── offer/
│   │   ├── live-chat/
│   │   └── router.js
│   │
│   ├── config/
│   │   ├── firebase.config.js
│   │   ├── app.config.js
│   │   ├── menu.config.js
│   │   ├── banner.data.js
│   │   ├── offer.data.js
│   │   └── support.config.js
│   │
│   ├── core/
│   │   ├── router.js
│   │   └── share.js
│   │
│   ├── layout/
│   ├── modules/
│   ├── services/
│   ├── ui/
│   └── views/
│
├── admin/
│   ├── index.html
│   ├── css/
│   │   └── admin.css
│   └── js/
│       ├── admin.api.js
│       ├── admin.auth.js
│       ├── admin.users.js
│       └── admin.app.js
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
│   ├── assets/
│   ├── partials/
│   └── sites/
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
```

Exact repository contents may contain additional static UI assets and modules.

---

## 54. Mobile-Only Maintenance Workflow

The project is primarily maintained from Android using Acode, mobile GitHub, and browser tools.

Recommended workflow:

```text
1. Work on one file at a time.
2. Copy the complete replacement code.
3. Replace the full target file.
4. Save the file.
5. Verify the exact path and filename.
6. Commit from the mobile GitHub workflow.
7. Review GitHub Actions.
8. Test affected functionality.
```

Do not reorganize the folder structure casually.

---

## 55. Important Files

### Firestore authorization

```text
firestore.rules
```

### Firestore indexes

```text
firestore.indexes.json
```

### Shared Spark client

```text
js/account/firebase/functions.client.js
```

### Profile Firestore integration

```text
js/account/firebase/profile.db.js
```

### Main menu

```text
js/config/menu.config.js
```

### Offer data

```text
js/config/offer.data.js
```

### Share system

```text
js/core/share.js
```

### Admin API

```text
admin/js/admin.api.js
```

### Admin user system

```text
admin/js/admin.users.js
```

### Admin controller

```text
admin/js/admin.app.js
```

### Review builder

```text
scripts/build-reviews.js
```

### Production validator

```text
scripts/validate-production.js
```

### Firestore Rules tests

```text
tests/firestore.rules.test.js
```

### GitHub Pages workflow

```text
.github/workflows/build-reviews.yml
```

---

## 56. Do Not Reintroduce

Future maintenance must not accidentally reintroduce the removed architecture without an explicit product decision.

Do not unintentionally restore:

```text
Referral code system
Referral tracking
?ref= URLs
Referral rewards
৳1000 referral wallet reward
Activity qualification
7-day activity tracking
Web Device qualification
Mobile uniqueness reservation
Wallet balances
Withdrawal system
Financial ledger
Reward events
Referral Admin pages
Withdrawal Admin pages
Transaction Admin pages
Cloud Functions dependency
Blaze-only requirement
Firebase Storage dependency
Guest Admin referral link
```

The current Invite feature is sharing only.

---

## 57. Production Definition of Done

11Play should only be described as production deployment verified after the relevant checks have passed.

Current checklist:

```text
[ ] JavaScript syntax passes
[ ] Static review build passes
[ ] Required review assets exist
[ ] Production validator passes
[ ] Firestore Rules compile
[ ] Firestore Emulator Rules tests pass
[ ] Firestore Rules deploy successfully
[ ] Firestore indexes/config deploy successfully
[ ] GitHub Actions passes
[ ] GitHub Pages deployment succeeds
[ ] Public website loads correctly
[ ] Google Sign-In works
[ ] Verified Google profile creation works
[ ] Returning Google user receives same profile
[ ] Username is correct
[ ] Mobile registration works
[ ] Mobile becomes permanently locked
[ ] Duplicate mobile across users is permitted
[ ] Invite sharing uses canonical URL
[ ] Invite sharing contains no referral tracking
[ ] Offer page works
[ ] Live Chat page works
[ ] Admin authentication works
[ ] Non-Admin access is rejected
[ ] Admin user listing works
[ ] Admin user details work
[ ] Offer Paid action works
[ ] User cannot read Offer Paid data
[ ] User cannot write Offer Paid data
[ ] Paid status cannot be reversed normally
[ ] Public/legal pages match current behavior
[ ] SEO/canonical/share URLs are correct
```

---

## 58. Current Production-Hardening Status

Current architecture:

```text
GitHub Pages
+
Firebase Authentication
+
Verified Google Sign-In
+
Cloud Firestore
+
Firestore Security Rules
+
Schema Version 4
+
Profile
+
One-Time Mobile Lock
+
500 BDT Offer
+
Admin Offer Paid
+
Static Reviews
+
GitHub Actions
```

The current hardening phase focuses on:

- removing obsolete architecture
- keeping Firestore permissions minimal
- keeping Admin scope minimal
- aligning tests with actual production behavior
- aligning documentation with actual product behavior
- validating production files
- completing deployment verification

The project should finish this phase through validation and testing rather than another architecture rewrite.

---

## 59. Maintenance Principle

For future changes to Authentication, Profile, Mobile, or Offer Paid behavior, evaluate these together:

```text
Client JavaScript
+
Firestore Security Rules
+
Firestore Emulator Tests
+
Admin Dashboard
+
Production Validator
+
Public / Legal Documentation
```

Changing only one layer can create inconsistent, broken, or insecure behavior.

---

## 60. Project Status

Current target architecture:

```text
Static
Secure
Spark-Compatible
Google-Authenticated
Firestore-Protected
Mobile-Maintainable
GitHub-Pages-Friendly
Production-Tested
```

Current business/account scope:

```text
Profile
+
Invite Sharing
+
500 BDT Offer
+
Live Chat
+
Admin Offer Paid
```

---

© 11Play. All rights reserved.