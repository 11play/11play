"use strict";

/* =========================================================
   11PLAY — CLOUD FUNCTIONS ENTRY POINT
   File: functions/index.js

   Responsibilities:
   - Initialize Firebase Admin SDK
   - Configure Firebase Cloud Functions
   - Export Profile functions
   - Export Activity / Using Time functions
   - Export Wallet functions
   - Export Referral functions
   - Export Withdrawal functions
   - Export Admin functions
   - Support staged Firebase App Check rollout

   Admin policy:
   - Sole Admin: casinobuzzbd@gmail.com
   - Verified Google sign-in required
   - No Super Admin
   - No custom claim authorization
   - No Firestore Admin assignment
   - No terminal-based Admin assignment
========================================================= */

const {
    initializeApp,
    getApps
} = require(
    "firebase-admin/app"
);

const {
    onCall
} = require(
    "firebase-functions/v2/https"
);

const {
    setGlobalOptions
} = require(
    "firebase-functions/v2"
);

/* =========================================================
   FIREBASE ADMIN INITIALIZATION
========================================================= */

if (getApps().length === 0) {
    initializeApp();
}

/* =========================================================
   GLOBAL CLOUD FUNCTIONS OPTIONS
========================================================= */

setGlobalOptions({
    region:
        "asia-south1",

    memory:
        "256MiB",

    timeoutSeconds:
        60,

    maxInstances:
        10
});

/* =========================================================
   PROFILE BACKEND
========================================================= */

const {
    ensureProfile,
    getMyProfile,
    getPublicAdminReferral,
    saveMobileNumber
} = require(
    "./lib/profile"
);

/* =========================================================
   ACTIVITY / USING TIME BACKEND
========================================================= */

const {
    recordActivityHeartbeat,
    getMyActivity,
    closeActivitySession
} = require(
    "./lib/activity"
);

/* =========================================================
   WALLET BACKEND
========================================================= */

const {
    getMyWallet,
    getMyWalletTransactions
} = require(
    "./lib/wallet"
);

/* =========================================================
   REFERRAL BACKEND
========================================================= */

const {
    getMyReferralStats,
    getMyReferrals,

    getPendingReferrals,
    approveReferral,
    rejectReferral
} = require(
    "./lib/referral"
);

/* =========================================================
   WITHDRAWAL BACKEND
========================================================= */

const {
    submitWithdrawal,
    cancelWithdrawal,

    getMyWithdrawals,
    getMyWithdrawalSummary,

    getPendingWithdrawals,
    approveWithdrawal,
    rejectWithdrawal
} = require(
    "./lib/withdrawal"
);

/* =========================================================
   ADMIN BACKEND
========================================================= */

const {
    getAdminSession,
    getAdminDashboardSummary,

    getAdminUsers,
    getAdminUserDetails,

    updateAdminUserProfile,
    adjustAdminWallet,

    getAdminTransactions,
    getAdminAuditLogs
} = require(
    "./lib/admin"
);

/* =========================================================
   CALLABLE FUNCTION OPTIONS

   App Check enforcement আপাতত বন্ধ থাকবে।

   enforceAppCheck true করার আগে:
   - Firebase Console-এ Web App Check provider configure করতে হবে
   - Main এবং Admin frontend-এ App Check SDK load করতে হবে
   - js/config/firebase.config.js-এ App Check initialize করতে হবে
   - GitHub Pages production domain configure করতে হবে
   - বৈধ callable request App Check token পাঠাচ্ছে যাচাই করতে হবে
   - Firebase App Check metrics পর্যবেক্ষণ করতে হবে

   Authentication এবং Admin authorization প্রতিটি relevant
   backend handler-এর ভিতরে আলাদাভাবে enforce করা হচ্ছে।
========================================================= */

const callableOptions =
    Object.freeze({
        cors:
            true,

        enforceAppCheck:
            false
    });

/* =========================================================
   CALLABLE EXPORT HELPER
========================================================= */

function exportCallable(handler) {
    if (
        typeof handler !== "function"
    ) {
        throw new TypeError(
            "A callable function handler is required."
        );
    }

    return onCall(
        callableOptions,

        async (request) => {
            return handler(
                request
            );
        }
    );
}

/* =========================================================
   PROFILE FUNCTIONS
========================================================= */

/**
 * Creates or synchronizes the verified Google user's profile.
 *
 * It also creates:
 * - Permanent referral code
 * - Permanent referral link
 * - Initial wallet
 * - Initial Using Time record
 * - Initial referral statistics
 * - Referral relationship when a valid code exists
 */
exports.ensureProfile =
    exportCallable(
        ensureProfile
    );

/**
 * Returns the authenticated user's profile.
 */
exports.getMyProfile =
    exportCallable(
        getMyProfile
    );

/**
 * Returns the sole Admin profile's permanent referral code
 * and referral link.
 *
 * Access:
 * Public, including Guest users.
 *
 * Returned data:
 * - referralCode
 * - referralLink
 *
 * Private Admin profile information is not returned.
 */
exports.getPublicAdminReferral =
    exportCallable(
        getPublicAdminReferral
    );

/**
 * Saves and permanently locks the user's Bangladesh mobile
 * number.
 */
exports.saveMobileNumber =
    exportCallable(
        saveMobileNumber
    );

/* =========================================================
   ACTIVITY / USING TIME FUNCTIONS
========================================================= */

/**
 * Records one authenticated activity heartbeat.
 *
 * Time is credited only when:
 * - Google authentication is valid
 * - Email is verified
 * - Site or app is visible
 * - Device is online
 * - User is active
 * - No other fresh session owns the activity lease
 */
exports.recordActivityHeartbeat =
    exportCallable(
        recordActivityHeartbeat
    );

/**
 * Returns the authenticated user's verified Using Time.
 */
exports.getMyActivity =
    exportCallable(
        getMyActivity
    );

/**
 * Closes the authenticated user's activity session.
 */
exports.closeActivitySession =
    exportCallable(
        closeActivitySession
    );

/* =========================================================
   WALLET FUNCTIONS
========================================================= */

/**
 * Returns the authenticated user's wallet balances.
 */
exports.getMyWallet =
    exportCallable(
        getMyWallet
    );

/**
 * Returns the authenticated user's paginated wallet
 * transaction history.
 */
exports.getMyWalletTransactions =
    exportCallable(
        getMyWalletTransactions
    );

/* =========================================================
   USER REFERRAL FUNCTIONS
========================================================= */

/**
 * Returns the authenticated user's referral statistics.
 */
exports.getMyReferralStats =
    exportCallable(
        getMyReferralStats
    );

/**
 * Returns the authenticated user's paginated referral
 * records.
 */
exports.getMyReferrals =
    exportCallable(
        getMyReferrals
    );

/* =========================================================
   ADMIN REFERRAL FUNCTIONS
========================================================= */

/**
 * Returns referrals qualified for Admin review.
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.getPendingReferrals =
    exportCallable(
        getPendingReferrals
    );

/**
 * Approves a qualified referral and credits the reward
 * exactly once.
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.approveReferral =
    exportCallable(
        approveReferral
    );

/**
 * Rejects a qualified referral without issuing a reward.
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.rejectReferral =
    exportCallable(
        rejectReferral
    );

/* =========================================================
   USER WITHDRAWAL FUNCTIONS
========================================================= */

/**
 * Creates an idempotent withdrawal request and transfers the
 * amount from available balance to held balance.
 *
 * The amount must be at least ৳1000 and a multiple of ৳1000.
 */
exports.submitWithdrawal =
    exportCallable(
        submitWithdrawal
    );

/**
 * Cancels the authenticated user's pending withdrawal and
 * refunds the held amount.
 */
exports.cancelWithdrawal =
    exportCallable(
        cancelWithdrawal
    );

/**
 * Returns the authenticated user's paginated withdrawal
 * history.
 */
exports.getMyWithdrawals =
    exportCallable(
        getMyWithdrawals
    );

/**
 * Returns the authenticated user's withdrawal summary.
 */
exports.getMyWithdrawalSummary =
    exportCallable(
        getMyWithdrawalSummary
    );

/* =========================================================
   ADMIN WITHDRAWAL FUNCTIONS
========================================================= */

/**
 * Returns withdrawals with Pending status.
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.getPendingWithdrawals =
    exportCallable(
        getPendingWithdrawals
    );

/**
 * Approves a Pending withdrawal after the Admin has manually
 * sent the payment.
 *
 * Result:
 * - Status becomes Approved
 * - Held balance decreases
 * - Total withdrawn increases
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.approveWithdrawal =
    exportCallable(
        approveWithdrawal
    );

/**
 * Rejects a Pending withdrawal when the payment is not sent.
 *
 * Result:
 * - Status becomes Rejected
 * - Held balance decreases
 * - Amount returns to available balance
 *
 * Access:
 * Sole verified Admin account only.
 */
exports.rejectWithdrawal =
    exportCallable(
        rejectWithdrawal
    );

/* =========================================================
   ADMIN DASHBOARD FUNCTIONS
========================================================= */

/**
 * Verifies the sole Admin session.
 */
exports.getAdminSession =
    exportCallable(
        getAdminSession
    );

/**
 * Returns the Admin Dashboard summary.
 */
exports.getAdminDashboardSummary =
    exportCallable(
        getAdminDashboardSummary
    );

/**
 * Returns paginated Profile System users.
 */
exports.getAdminUsers =
    exportCallable(
        getAdminUsers
    );

/**
 * Returns one user's complete Profile System details.
 */
exports.getAdminUserDetails =
    exportCallable(
        getAdminUserDetails
    );

/**
 * Changes a permitted user profile status.
 */
exports.updateAdminUserProfile =
    exportCallable(
        updateAdminUserProfile
    );

/**
 * Applies an idempotent Admin wallet credit or debit.
 */
exports.adjustAdminWallet =
    exportCallable(
        adjustAdminWallet
    );

/**
 * Returns paginated wallet transactions for Admin review.
 */
exports.getAdminTransactions =
    exportCallable(
        getAdminTransactions
    );

/**
 * Returns paginated permanent Admin audit records.
 */
exports.getAdminAuditLogs =
    exportCallable(
        getAdminAuditLogs
    );
