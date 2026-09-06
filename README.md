# 11Play Web

11Play is a static Smart Web Access platform built with GitHub Pages, Firebase Authentication, Cloud Firestore, Firestore Security Rules and browser JavaScript.

Canonical website:

```text
https://11play.github.io/11play/
```

External Reviews website:

```text
https://11playreview.github.io/11playreview/
```

The production architecture is designed to operate on the Firebase Spark plan without deployed Cloud Functions, Firebase Storage, Firebase Hosting, Cloud Run or a traditional application server.

---

## 1. Production Architecture

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
- Google Analytics
- tawk.to Live Chat

The browser communicates directly with Firebase Authentication and Cloud Firestore.

There is intentionally no application server between the browser and Firestore.

Therefore:

> Firestore Security Rules are the primary server-side authorization boundary of the application.

Client-side checks improve user experience but must never be treated as sufficient authorization.

---

## 2. Public Website

Canonical production URL:

```text
https://11play.github.io/11play/
```

Primary indexable pages:

```text
https://11play.github.io/11play/
https://11play.github.io/11play/pages/about.html
https://11play.github.io/11play/pages/contact.html
https://11play.github.io/11play/pages/privacy-policy.html
https://11play.github.io/11play/pages/terms.html
```

The informational and legal pages must remain consistent with actual production behavior.

---

## 3. Brand Identity

Primary brand:

```text
11Play
```

Brand subtitle:

```text
Smart Web Access
```

Supported entity aliases used in metadata and structured data may include:

```text
11play
11 Play
11Play Smart Web Access
১১প্লে
স্মার্ট ওয়েব এক্সেস
```

The Bengali aliases are intended as search/entity signals and are not required to be displayed as visible page text.

---

## 4. GitHub Project Pages Paths

11Play is deployed as a GitHub Project Pages website.

Repository base path:

```text
/11play/
```

Careless root-relative paths such as:

```text
/assets/image.png
```

may point to the wrong location.

Use project-safe relative paths or the correct `/11play/` base when required.

---

## 5. Current Account Scope

Supported account functionality includes:

- optional Google Sign-In
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
- device qualification
- referral wallet balances
- referral withdrawals
- financial ledger
- reward events
- referral administration

---

## 6. Current Schema Version

The current Profile and Offer architecture uses:

```text
schemaVersion = 4
```

The Firestore contract must remain synchronized across:

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

## 7. Firebase Services

Primary Firebase services:

```text
Firebase Authentication
Cloud Firestore
```

The current production architecture does not require:

```text
Firebase Cloud Functions
Firebase Storage
Firebase Hosting
Cloud Run
Custom API server
Blaze-only backend services
```

The intended Firebase plan is:

```text
Spark
```

---

## 8. Authentication Model

Protected profile functionality requires:

1. Firebase Authentication
2. Google Sign-In
3. verified Google email
4. Google authentication provider

Expected provider:

```text
google.com
```

Firestore Security Rules independently enforce protected account requirements.

Public website content may be browsed without creating a profile where authentication is not required.

---

## 9. FunctionsClient

Historical file:

```text
js/account/firebase/functions.client.js
```

Public object:

```text
window.FunctionsClient
```

Despite the historical name, the current implementation is not a deployed Firebase Cloud Functions client.

It acts as a shared Spark-compatible direct-Firestore application facade.

---

## 10. User Profiles

Primary collection:

```text
profileUsers/{firebaseUid}
```

The document ID must match the authenticated Firebase UID.

Profile fields may include:

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
4
```

---

## 11. Google Identity

The Google account is the protected account identity.

Important rules:

- profile UID must match Firebase Auth UID
- profile email must match the authenticated Google email
- authenticated email must remain associated with the correct account
- Google email must be verified
- protected account access requires Google authentication

Example:

```text
email:
johnsmith@gmail.com

username:
johnsmith
```

11Play does not receive or store the user's Google password.

---

## 12. Email Reservation

Email ownership is represented by:

```text
profileEmails/{normalizedEmail}
```

Example:

```text
profileEmails/johnsmith@gmail.com
```

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

Email reservations are immutable and must remain consistent with the corresponding user profile.

---

## 13. Mobile Number

Users may add a Bangladesh mobile number to their own profile.

Required normalized format:

```text
+8801[3-9]XXXXXXXX
```

Example:

```text
+8801712345678
```

The current system does not require global mobile-number uniqueness.

Therefore multiple profiles may contain the same valid mobile number.

Saving a number does not by itself prove physical SIM ownership and is not represented as 11Play SMS OTP verification.

---

## 14. Mobile Lock

Initial state:

```text
mobileNumber = ""
mobileAdded = false
mobileLocked = false
isMobileLocked = false
```

After a valid number is saved:

```text
mobileAdded = true
mobileLocked = true
isMobileLocked = true
```

After locking, an ordinary user must not be able to:

- replace the number
- remove the number
- reset the number through normal profile operations

Firestore Security Rules enforce the protected state.

---

## 15. Account Status

Supported profile states:

```text
active
suspended
blocked
```

Account status may be visible through authorized administration interfaces.

Users must not be able to modify protected account state arbitrarily.

---

## 16. Invite Your Friend

Invite Your Friend is a normal website-sharing feature.

Shared website:

```text
https://11play.github.io/11play/
```

The feature must not generate referral tracking such as:

```text
?ref=
```

The current system has no:

- referral code
- referral attribution
- referral ownership record
- referral reward
- referral wallet
- referral qualification process

Sharing 11Play does not automatically create financial entitlement.

---

## 17. Main Account Menu

Current account-related menu features:

```text
Profile
Invite Your Friend
Offer
Live Chat
```

Legacy Referral, Reward, Wallet and Withdrawal flows must not be reintroduced without an explicit product decision and architecture review.

---

## 18. External Reviews

11Play no longer maintains an internal static review publishing system inside this repository.

The Reviews menu item opens the separate external Reviews website:

```text
https://11playreview.github.io/11playreview/
```

Current menu configuration:

```text
js/config/menu.config.js
```

The Reviews item must remain external and must not use:

```text
page: "reviews"
```

The main 11Play repository should not recreate internal review routes, generated review pages or review sitemap entries.

---

## 19. 500 BDT New-User Offer

11Play currently provides a manually handled promotional offer for eligible new users.

Current promotional amount:

```text
500 BDT
```

Typical flow:

```text
User opens 11Play
        ↓
User opens Live Chat
        ↓
User receives current target-site instructions
        ↓
User follows the applicable registration process
        ↓
User completes applicable requirements
        ↓
User returns to Live Chat
        ↓
Offer is reviewed
        ↓
Authorized Admin records Offer Paid after delivery
```

The Offer is promotional.

It is not:

- an 11Play gaming wallet
- a gaming deposit
- a withdrawal account
- a third-party gaming balance

---

## 20. Offer Assets

Primary offer image:

```text
assets/images/offers/11play-500-bdt-offer.png
```

Primary social/share image:

```text
assets/seo/11play-500-bdt-offer-share.png
```

The share image may be used for Open Graph and compatible social previews.

---

## 21. Offer Paid Storage

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

Offer Paid information is protected administrative data.

---

## 22. Offer Paid Security

Ordinary users must not be able to:

- read Offer Paid records
- list Offer Paid records
- create Offer Paid records
- modify Offer Paid records
- mark themselves as paid
- delete protected Offer Paid records

Only the authorized Admin may access the collection through the permitted Firestore Rules contract.

The normal Profile page does not expose protected Offer Paid information.

---

## 23. Offer Paid Finality

The authorized Admin may record:

```text
PAID
```

only after the promotional Offer has actually been provided.

The current system intentionally does not provide a normal user-facing mechanism for reversing the protected paid state.

---

## 24. Administration

Admin Dashboard:

```text
admin/index.html
```

Current modules:

```text
admin/js/admin.api.js
admin/js/admin.auth.js
admin/js/admin.users.js
admin/js/admin.app.js
```

Current Admin scope includes:

- Admin authentication
- session validation
- dashboard summary
- user listing
- user searching
- user filtering
- user detail inspection
- Offer Paid inspection
- Offer Paid action
- logout

Removed Admin systems include:

- referral approval
- referral rejection
- wallet adjustment
- withdrawal review
- transaction review
- activity review
- device review

---

## 25. Permanent Admin

Configured Admin identity:

```text
casinobuzzbd@gmail.com
```

Admin access requires the verified Google account matching the configured identity.

Client-side checks are only interface protection.

Firestore Security Rules remain the final authorization boundary.

The current project does not use:

```text
Firestore Admin-role documents
Custom claims
Super Admin hierarchy
```

---

## 26. Public Firestore Collections

Public content collections may include:

```text
sites
news
banners
siteClicks
```

Intended security model:

```text
public read
no public browser write
```

Example:

```rules
match /siteClicks/{siteId} {
    allow read: if true;
    allow write: if false;
}
```

`siteClicks` values may be maintained manually or through a future authorized architecture.

The current project does not require public client-side writes to `siteClicks`.

---

## 27. Protected Firestore Collections

Primary protected account collections:

```text
profileUsers
profileEmails
profileOfferStatus
```

Removed legacy account systems include:

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

Unsupported collections should remain denied by default.

---

## 28. Firestore Security Rules

Primary authorization file:

```text
firestore.rules
```

Current Rules responsibilities include:

- verified Google authentication
- profile ownership
- identity consistency
- immutable email reservation
- one-time mobile locking
- Admin-only Offer Paid access
- public-content read permissions
- protected write restrictions
- deny-by-default behavior

Rules are authoritative even when equivalent checks exist in browser JavaScript.

---

## 29. Firestore Indexes

Configuration:

```text
firestore.indexes.json
```

Current content:

```json
{
    "indexes": [],
    "fieldOverrides": []
}
```

Do not add composite indexes unless a real production query requires them.

---

## 30. Firestore Security Tests

Rules test:

```text
tests/firestore.rules.test.js
```

Coverage includes:

### Authentication

- verified Google succeeds
- unverified Google fails
- unsupported provider fails

### Profiles

- owner profile creation
- guest denial
- owner read
- cross-user read denial
- user list denial
- Admin read/list
- protected field integrity
- deletion denial

### Email

- owner reservation read
- list denial
- immutability
- duplicate ownership denial

### Mobile

- valid Bangladesh mobile
- duplicate mobile across users allowed
- locked mobile cannot change
- locked mobile cannot be removed
- invalid format denied

### Offer Paid

- authorized Admin can mark an existing user
- missing target profile denied
- ordinary user create denied
- ordinary user read denied
- Admin list allowed
- paid reversal denied
- deletion denied

### Legacy Collections

Removed account collections remain inaccessible.

The Rules test suite should pass before the Firestore security contract is considered verified.

---

## 31. Production Validator

Validator:

```text
scripts/validate-production.js
```

Current validation includes areas such as:

- required production files
- obsolete architecture removal
- JSON parsing
- Firebase configuration
- Firestore configuration
- Firestore Rules contract
- manifest configuration
- robots.txt
- sitemap.xml
- external Reviews URL validation
- Profile / Offer / Live Chat scripts
- Admin configuration
- local HTML targets
- JSON-LD
- canonical URLs
- SEO titles and descriptions
- primary public URLs
- unresolved placeholders
- removed internal Review references

The APK is intentionally excluded from binary inspection.

---

## 32. Removed Internal Review Architecture

The main repository must not contain or depend on the previous internal static Review publishing system.

Do not reintroduce:

```text
reviews/
scripts/build-reviews.js
build:reviews
review sitemap routes
internal page: "reviews"
static review generation
```

Reviews now belong to:

```text
https://11playreview.github.io/11playreview/
```

---

## 33. Removed Compatibility Files

Removed empty compatibility files include:

```text
js/core/state.js
js/core/events.js
js/core/utils.js
js/services/api.service.js
```

`index.html` must not reference them.

---

## 34. Removed Legacy Account Modules

Examples include:

```text
js/account/firebase/activity.db.js
js/account/firebase/referral.db.js
js/account/firebase/reward.db.js
js/account/firebase/wallet.db.js
js/account/firebase/withdraw.db.js

js/account/referral/referral.capture.js
```

Removed referral, reward, wallet and withdrawal modules must not be recreated without an intentional architecture change.

---

## 35. Removed Admin Modules

Removed Admin modules include:

```text
admin/js/admin.referrals.js
admin/js/admin.withdrawals.js
admin/js/admin.transactions.js
```

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

## 36. Application Boot

Root application:

```text
index.html
```

Important dependencies include:

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

The public application must remain usable without requiring the visitor to create a profile.

---

## 37. Current Application Routes

Current account routes include:

```text
profile
offer
live-chat
```

Invite Your Friend is a share action rather than a separate application route.

Legacy routes such as the following must not be restored unintentionally:

```text
referral
reward
wallet
withdrawal
reviews
```

---

## 38. Live Chat

11Play provides Live Chat for platform and promotional support.

The current implementation uses:

```text
tawk.to
```

Live Chat is separate from protected Firestore profile data.

Users should not submit:

- Google passwords
- third-party passwords
- PINs
- OTPs
- recovery codes
- banking credentials
- unnecessary sensitive information

through Live Chat.

---

## 39. Third-Party Service Position

11Play organizes access to independent third-party gaming sites.

11Play does not:

- own those independent websites
- operate their user accounts
- accept third-party gaming deposits
- process third-party withdrawals
- process banking or cash transactions for those services
- control external gaming outcomes

Financial activity performed directly with an external service remains between the user and that service.

---

## 40. Terms and Eligibility

Users must meet applicable minimum-age, eligibility and legal requirements for any external service they choose to access.

Users are responsible for determining whether use of a particular third-party service is lawful in their location.

Current Terms:

```text
pages/terms.html
```

---

## 41. Privacy

Current Privacy Policy:

```text
pages/privacy-policy.html
```

It covers:

- optional Google Sign-In
- Firebase profile data
- user-provided mobile information
- promotional administration
- Live Chat
- analytics
- local browser storage
- third-party services
- security
- retention
- user privacy choices

The policy must not claim that 11Play collects no information at all.

---

## 42. Public Pages

Current informational/legal pages:

```text
pages/about.html
pages/contact.html
pages/privacy-policy.html
pages/terms.html
```

Each page should maintain:

- unique title
- unique meta description
- self-canonical URL
- exactly one H1
- valid structured data
- crawlable internal links
- accurate product/legal wording

---

## 43. SEO

Primary SEO resources:

```text
index.html
robots.txt
sitemap.xml
manifest.json
pages/about.html
pages/contact.html
pages/privacy-policy.html
pages/terms.html
```

Primary sitemap:

```text
https://11play.github.io/11play/sitemap.xml
```

Current sitemap contains the five primary indexable URLs only.

The external Reviews website must not be added to the main 11Play sitemap as an internal page.

---

## 44. Social Metadata

Primary current share image:

```text
https://11play.github.io/11play/assets/seo/11play-500-bdt-offer-share.png
```

Open Graph and X/Twitter metadata should use valid HTTPS URLs.

Old or misleading promotional share images must not be reused.

---

## 45. Google Analytics

Current Measurement ID:

```text
G-H668K4EMNT
```

Analytics must not interfere with Firebase Authentication, protected profile operations or Firestore authorization.

---

## 46. APK

Current APK:

```text
11play.apk
```

APK maintenance is deferred to a separate phase.

During web hardening:

- do not delete it
- do not rebuild it
- do not replace it unnecessarily
- keep the existing download entry

The production validator intentionally does not inspect the APK binary.

---

## 47. Development Tooling

Development configuration:

```text
package.json
```

Current scripts include:

```bash
npm run check:js
npm run validate:production
npm run test:rules
npm run validate
npm run deploy:firestore
```

There is no current:

```bash
npm run build:reviews
```

The visitor-facing website does not require Node.js.

Node.js is used only for repository validation, testing and deployment tooling.

---

## 48. JavaScript Validation

Production JavaScript should pass:

```bash
npm run check:js
```

Syntax validation does not replace:

- Firestore Rules tests
- production validator
- live Google Sign-In testing
- manual Admin testing
- browser compatibility testing

---

## 49. Production Validation

Run:

```bash
npm run validate:production
```

Complete validation:

```bash
npm run validate
```

The complete validation process combines:

```text
JavaScript syntax
+
Production validator
+
Firestore Rules emulator tests
```

---

## 50. Firebase Deployment

GitHub Pages deployment and Firestore deployment are separate operations.

Firestore deployment:

```bash
firebase deploy --only firestore --project web11-one
```

or:

```bash
npm run deploy:firestore
```

Do not deploy client functionality that requires Firestore permissions before the corresponding Rules contract is ready.

---

## 51. GitHub Pages Workflow

Current workflow:

```text
.github/workflows/deploy.yml
```

The obsolete workflow name:

```text
.github/workflows/build-reviews.yml
```

must not be restored.

The deployment workflow validates the application before publishing the GitHub Pages artifact.

---

## 52. Public Deployment Artifact

Only public website resources should be included in the GitHub Pages artifact.

Development and Firebase configuration resources normally remain outside the deployed website artifact.

Examples:

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

The APK remains a public downloadable resource until the APK architecture is changed intentionally.

---

## 53. Recommended Release Sequence

```text
1. Review source changes
2. Run JavaScript syntax validation
3. Run production validator
4. Run Firestore Emulator Rules tests
5. Deploy Firestore Rules/index configuration when changed
6. Deploy GitHub Pages
7. Test public homepage
8. Test informational/legal pages
9. Test Google Sign-In
10. Test profile creation
11. Test returning-user profile
12. Test mobile registration
13. Confirm mobile locking
14. Test Offer
15. Test Live Chat
16. Test Admin authentication
17. Test Admin user listing
18. Test Offer Paid
19. Verify unauthorized access fails
20. Verify external Reviews link
```

---

## 54. Production E2E Journey

```text
Guest
  ↓
11Play public website
  ↓
Optional Google Sign-In
  ↓
Verified Google authentication
  ↓
Profile creation
  ↓
Profile displayed
  ↓
Optional Bangladesh mobile added
  ↓
Mobile locked
  ↓
Offer / Live Chat
  ↓
Manual Offer process
  ↓
Authorized Admin review
  ↓
Offer Paid recorded after delivery
```

Important checks:

- same Google account returns the same profile
- user cannot read another user's protected profile
- mobile cannot be changed after locking
- duplicate mobile numbers across different profiles are permitted
- user cannot read Offer Paid data
- user cannot create Offer Paid data
- authorized Admin can inspect users
- authorized Admin can record Offer Paid
- paid state cannot be casually reversed

---

## 55. Negative Security Tests

Important denial scenarios include:

```text
Guest private-profile read
Unverified Google account
Unsupported authentication provider
User reads another profile
User lists profiles
User changes protected Google identity
User removes locked mobile
User changes locked mobile
Invalid Bangladesh mobile
User reads Offer Paid data
User creates Offer Paid data
User changes Offer Paid data
User deletes Offer Paid data
Non-Admin lists Offer Paid records
Admin marks missing user
Unsupported legacy collection write
```

Authorization failures must be enforced by Firestore Security Rules.

---

## 56. Security Assumptions

Always treat the following as attacker-controlled:

```text
Browser JavaScript
DOM state
UI validation
Query parameters
localStorage
Browser timestamps
Form values
Client payloads
Client-side Admin checks
```

Security-sensitive decisions must rely on:

```text
Firebase Authentication
+
Firestore Security Rules
+
request.auth
+
request.time
+
Document ownership
+
Immutable-state rules
```

---

## 57. Data Integrity Principles

### Verified Identity

Protected profiles remain tied to authenticated Google identity.

### Immutable Email Mapping

Email ownership cannot be transferred casually between accounts.

### One-Time Mobile Lock

A saved mobile number cannot be arbitrarily replaced through ordinary user operations.

### Admin Separation

Offer Paid records remain separate from normal user profile data.

### Least Privilege

Users receive only the data access required for their own account.

### Deny by Default

Unknown Firestore collections and unsupported operations remain denied.

### Server Time

Security-sensitive timestamps should use Firestore-authoritative time where appropriate.

### Final Paid State

Offer Paid records should not be casually reversed or deleted.

---

## 58. Simplified Repository Layout

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
│   ├── about.css
│   ├── contact.css
│   ├── privacy.css
│   ├── terms.css
│   └── ...
│
├── js/
│   ├── account/
│   ├── config/
│   ├── core/
│   ├── layout/
│   ├── modules/
│   ├── services/
│   ├── ui/
│   └── views/
│
├── admin/
│   ├── index.html
│   ├── css/
│   └── js/
│
├── pages/
│   ├── about.html
│   ├── contact.html
│   ├── privacy-policy.html
│   └── terms.html
│
├── scripts/
│   └── validate-production.js
│
├── tests/
│   └── firestore.rules.test.js
│
└── .github/
    └── workflows/
        └── deploy.yml
```

There is intentionally no internal:

```text
reviews/
```

directory in the current architecture.

---

## 59. Mobile Maintenance Workflow

The repository is commonly maintained from Android using Acode, GitHub and browser tools.

Recommended workflow:

```text
1. Work on one file at a time.
2. Replace the complete target file where appropriate.
3. Save the exact filename and path.
4. Review the change.
5. Commit through GitHub.
6. Check GitHub Actions.
7. Test the affected feature.
8. Run production validation before release.
```

Do not reorganize the repository casually.

---

## 60. Important Files

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

### Offer configuration

```text
js/config/offer.data.js
```

### Sharing

```text
js/core/share.js
```

### External Reviews menu target

```text
https://11playreview.github.io/11playreview/
```

### Admin API

```text
admin/js/admin.api.js
```

### Admin users

```text
admin/js/admin.users.js
```

### Admin application controller

```text
admin/js/admin.app.js
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
.github/workflows/deploy.yml
```

---

## 61. Do Not Reintroduce

Do not accidentally restore:

```text
Internal Reviews system
reviews/
build-reviews.js
build:reviews
page: "reviews"
Review sitemap routes

Referral codes
Referral tracking
?ref= URLs
Referral rewards
৳1000 referral reward
Activity qualification
Seven-day activity tracking
Web Device qualification
Referral wallet
Referral withdrawals
Financial ledger
Reward events

Referral Admin pages
Withdrawal Admin pages
Transaction Admin pages

Cloud Functions dependency
Blaze-only backend requirement
Firebase Storage dependency
```

The current Invite feature is normal sharing only.

Reviews are maintained separately at:

```text
https://11playreview.github.io/11playreview/
```

---

## 62. Production Definition of Done

```text
[ ] JavaScript syntax passes
[ ] Production validator passes
[ ] Firestore Rules compile
[ ] Firestore Emulator Rules tests pass
[ ] Firestore deployment succeeds when Rules changed
[ ] GitHub Actions passes
[ ] GitHub Pages deployment succeeds
[ ] Homepage loads correctly
[ ] About page loads correctly
[ ] Contact page loads correctly
[ ] Privacy Policy loads correctly
[ ] Terms page loads correctly
[ ] Google Sign-In works
[ ] Verified Google profile creation works
[ ] Returning user receives the same profile
[ ] Mobile registration works
[ ] Mobile remains locked after saving
[ ] Duplicate mobile across users remains permitted
[ ] Invite sharing uses canonical URL
[ ] Invite sharing contains no referral tracking
[ ] Offer page works
[ ] Live Chat works
[ ] Reviews opens the external Reviews website
[ ] Admin authentication works
[ ] Non-Admin access is rejected
[ ] Admin user listing works
[ ] Admin user details work
[ ] Offer Paid action works
[ ] User cannot read Offer Paid data
[ ] User cannot write Offer Paid data
[ ] Paid state cannot normally be reversed
[ ] Public/legal pages match production behavior
[ ] SEO titles, canonical URLs and structured data are correct
[ ] sitemap.xml contains only the five primary 11Play URLs
```

---

## 63. Current Target Architecture

```text
GitHub Pages
+
Static HTML / CSS / JavaScript
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
Optional Profile
+
One-Time Mobile Lock
+
Invite Sharing
+
500 BDT Promotional Offer
+
tawk.to Live Chat
+
Admin Offer Paid
+
External Reviews Website
+
GitHub Actions
```

Target qualities:

```text
Static
Secure
Spark-Compatible
Google-Authenticated
Firestore-Protected
Mobile-Maintainable
GitHub-Pages-Friendly
SEO-Ready
Production-Tested
```

---

## 64. Maintenance Principle

For changes involving Authentication, Profile, Mobile, Offer Paid or Admin behavior, evaluate all relevant layers together:

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

Changing only one layer can create inconsistent or insecure behavior.

---

© 11Play. All rights reserved.