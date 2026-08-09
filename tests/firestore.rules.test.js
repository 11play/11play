"use strict";

/* =========================================================
   11PLAY — FIRESTORE SECURITY RULES TEST SUITE
   File: tests/firestore.rules.test.js

   Production contract under test:
   - Verified Google authentication only
   - Permanent Admin: casinobuzzbd@gmail.com
   - Globally unique immutable Bangladesh mobile
   - Unique immutable Web Device binding
   - Activity policy v2: 7 BD dates × 2 hours/day
   - 15–20 minute server-authorized checkpoints
   - Referral reward only after final Admin approval
   - Withdrawal Available -> Held on submit
   - User cannot cancel/edit/delete submitted withdrawal
   - Admin withdrawal review = Approve / Reject only
   - Wallet changes require matching ledger/audit writes
========================================================= */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  test,
  before,
  after,
  beforeEach
} = require("node:test");

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require("@firebase/rules-unit-testing");

const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} = require("firebase/firestore");

const PROJECT_ID = "demo-11play";

const ADMIN_UID = "admin-uid";

const ADMIN_EMAIL =
  "casinobuzzbd@gmail.com";

const BASE_URL =
  "https://11play.github.io/11play/";

const RULES_PATH =
  path.resolve(
    __dirname,
    "..",
    "firestore.rules"
  );

const CODE_A =
  "ABCDEFGH";

const CODE_B =
  "JKLMNPQR";

const CODE_C =
  "STUVWXYZ";

const MOBILE_A =
  "+8801712345678";

const MOBILE_B =
  "+8801812345678";

const DEVICE_A =
  "a".repeat(64);

const DEVICE_B =
  "b".repeat(64);

let env;

/* =========================================================
   AUTH HELPERS
========================================================= */

function token(
  email,
  verified = true,
  provider = "google.com"
) {
  return {
    email,

    email_verified:
      verified,

    firebase: {
      sign_in_provider:
        provider
    }
  };
}

function userDb(
  uid,
  email = `${uid}@example.com`
) {
  return env
    .authenticatedContext(
      uid,
      token(email)
    )
    .firestore();
}

function unverifiedDb(
  uid,
  email = `${uid}@example.com`
) {
  return env
    .authenticatedContext(
      uid,
      token(
        email,
        false
      )
    )
    .firestore();
}

function nonGoogleDb(
  uid,
  email = `${uid}@example.com`
) {
  return env
    .authenticatedContext(
      uid,
      token(
        email,
        true,
        "password"
      )
    )
    .firestore();
}

function adminDb() {
  return userDb(
    ADMIN_UID,
    ADMIN_EMAIL
  );
}

function guestDb() {
  return env
    .unauthenticatedContext()
    .firestore();
}

/* =========================================================
   TIME HELPERS
========================================================= */

function past(
  ms =
    60 * 60 * 1000
) {
  return Timestamp.fromMillis(
    Date.now() - ms
  );
}

function bdDayStartMs() {
  const now =
    Date.now();

  const shifted =
    new Date(
      now +
      6 *
      60 *
      60 *
      1000
    );

  return (
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    ) -
    6 *
    60 *
    60 *
    1000
  );
}

function sameBdDayTime() {
  return Timestamp.fromMillis(
    Math.max(
      bdDayStartMs(),

      Date.now() -
      2 *
      60 *
      1000
    )
  );
}

/* =========================================================
   DATA FACTORIES
========================================================= */

function profile({
  uid,
  email,
  code,
  ts,

  mobile = "",
  device = "",

  referredByUid = "",
  referredByCode = "",

  status = "active"
}) {
  const isAdmin =
    email.toLowerCase() ===
    ADMIN_EMAIL;

  const username =
    email
      .split("@")[0]
      .toLowerCase();

  return {
    uid,

    name:
      username,

    displayName:
      username,

    username,

    email:
      email.toLowerCase(),

    photo:
      "",

    photoURL:
      "",

    emailVerified:
      true,

    providerIds: [
      "google.com"
    ],

    googleConnected:
      true,

    isGoogleConnected:
      true,

    accountType:
      "google",

    isAdmin,

    role:
      isAdmin
        ? "admin"
        : "user",

    mobileNumber:
      mobile,

    mobileAdded:
      Boolean(mobile),

    mobileLocked:
      Boolean(mobile),

    deviceId:
      device,

    deviceAdded:
      Boolean(device),

    deviceLocked:
      Boolean(device),

    referralCode:
      code,

    referralLink:
      `${BASE_URL}?ref=${code}`,

    referredByUid,

    referredByCode,

    registrationDate:
      ts,

    createdAt:
      ts,

    lastLogin:
      ts,

    updatedAt:
      ts,

    status,

    statusChangedAt:
      null,

    statusChangedBy:
      "",

    schemaVersion:
      3
  };
}

function codeDoc(
  uid,
  code,
  ts
) {
  return {
    code,

    referralCode:
      code,

    uid,

    userId:
      uid,

    active:
      true,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

function stats(
  uid,
  ts,
  extra = {}
) {
  return {
    uid,

    total:
      0,

    pending:
      0,

    qualified:
      0,

    approved:
      0,

    rejected:
      0,

    rewarded:
      0,

    totalReward:
      0,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3,

    ...extra
  };
}

function activity(
  uid,
  ts,
  extra = {}
) {
  return {
    uid,

    userId:
      uid,

    deviceId:
      "",

    activeDays:
      0,

    requiredActiveDays:
      7,

    currentDaySeconds:
      0,

    requiredDailySeconds:
      7200,

    currentDayStartedAt:
      null,

    currentDayCompleted:
      false,

    lastCheckpointAt:
      null,

    completed:
      false,

    lastActiveAt:
      null,

    completedAt:
      null,

    activityPolicyVersion:
      2,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3,

    ...extra
  };
}

function wallet(
  uid,
  ts,
  extra = {}
) {
  return {
    uid,

    userId:
      uid,

    availableBalance:
      0,

    heldBalance:
      0,

    totalEarned:
      0,

    totalWithdrawn:
      0,

    lastWithdrawalAmount:
      0,

    lastWithdrawalAt:
      null,

    revision:
      0,

    lastOperationId:
      "",

    lastOperationType:
      "",

    lastOperationAt:
      null,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3,

    ...extra
  };
}

function mobileReservation(
  uid,
  mobile,
  ts
) {
  return {
    mobile,

    uid,

    userId:
      uid,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

function deviceReservation(
  uid,
  deviceId,
  ts
) {
  return {
    deviceId,

    uid,

    userId:
      uid,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

function referral({
  referrerUid,
  referredUid,
  referralCode,
  referredEmail,
  ts,

  mobile = "",

  mobileAdded = false,
  deviceAdded = false,

  activeDays = 0,

  activityCompleted =
    false,

  eligible =
    false,

  status =
    "pending",

  qualifiedAt =
    null
}) {
  const name =
    referredEmail
      .split("@")[0];

  return {
    referralId:
      referredUid,

    referrerUid,

    referredUid,

    referralCode,

    referredProfile: {
      uid:
        referredUid,

      name,

      displayName:
        name,

      email:
        referredEmail
          .toLowerCase(),

      photoURL:
        "",

      mobileNumber:
        mobile
    },

    googleConnected:
      true,

    mobileAdded,

    deviceAdded,

    activeDays,

    requiredActiveDays:
      7,

    requiredDailySeconds:
      7200,

    activityPolicyVersion:
      2,

    activityCompleted,

    eligible,

    status,

    rewardAmount:
      1000,

    rewardGranted:
      false,

    rewardGrantedAt:
      null,

    createdAt:
      ts,

    capturedAt:
      ts,

    qualifiedAt,

    reviewedAt:
      null,

    reviewedBy:
      "",

    approvedAt:
      null,

    rejectedAt:
      null,

    rewardedAt:
      null,

    adminNote:
      "",

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

function withdrawal({
  uid,
  id,
  requestId,
  number,
  amount,
  ts
}) {
  const holdId =
    `withdraw_hold_${id}`;

  return {
    withdrawalId:
      id,

    userId:
      uid,

    uid,

    provider:
      "bkash",

    walletNumber:
      number,

    wallet:
      number,

    number,

    amount,

    status:
      "pending",

    requestId,

    transactionId:
      holdId,

    holdTransactionId:
      holdId,

    completionTransactionId:
      "",

    refundTransactionId:
      "",

    paymentConfirmed:
      false,

    paymentConfirmedAt:
      null,

    paymentReference:
      "",

    reviewedAt:
      null,

    approvedAt:
      null,

    rejectedAt:
      null,

    cancelledAt:
      null,

    reviewedBy:
      "",

    adminNote:
      "",

    date:
      ts,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

function ledger({
  id,
  uid,

  type,
  direction,

  amount,

  referenceId,
  operationId,

  before,
  after: next,

  ts,

  adminUid = "",
  adminEmail = "",

  note = "",

  metadata = {}
}) {
  return {
    transactionId:
      id,

    userId:
      uid,

    uid,

    type,

    direction,

    amount,

    referenceId,

    operationId,

    availableBalanceBefore:
      before
        .availableBalance,

    availableBalanceAfter:
      next
        .availableBalance,

    heldBalanceBefore:
      before
        .heldBalance,

    heldBalanceAfter:
      next
        .heldBalance,

    totalEarnedBefore:
      before
        .totalEarned,

    totalEarnedAfter:
      next
        .totalEarned,

    totalWithdrawnBefore:
      before
        .totalWithdrawn,

    totalWithdrawnAfter:
      next
        .totalWithdrawn,

    adminUid,

    adminEmail,

    note,

    status:
      "completed",

    metadata,

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      3
  };
}

/* =========================================================
   SEED HELPERS
========================================================= */

async function seed(
  entries
) {
  await env
    .withSecurityRulesDisabled(
      async ctx => {
        const db =
          ctx.firestore();

        for (
          const [
            col,
            id,
            data
          ]
          of entries
        ) {
          await setDoc(
            doc(
              db,
              col,
              id
            ),
            data
          );
        }
      }
    );
}

/* =========================================================
   RULES-ENFORCED BOOTSTRAP
========================================================= */

async function bootstrapUser(
  uid,
  email,
  code
) {
  const db =
    userDb(
      uid,
      email
    );

  const batch =
    writeBatch(db);

  const now =
    serverTimestamp();

  batch.set(
    doc(
      db,
      "profileUsers",
      uid
    ),

    profile({
      uid,
      email,
      code,
      ts: now
    })
  );

  batch.set(
    doc(
      db,
      "profileReferralCodes",
      code
    ),

    codeDoc(
      uid,
      code,
      now
    )
  );

  batch.set(
    doc(
      db,
      "profileReferralStats",
      uid
    ),

    stats(
      uid,
      now
    )
  );

  batch.set(
    doc(
      db,
      "profileActivity",
      uid
    ),

    activity(
      uid,
      now
    )
  );

  batch.set(
    doc(
      db,
      "profileWallets",
      uid
    ),

    wallet(
      uid,
      now
    )
  );

  await batch.commit();

  return db;
}

/* =========================================================
   MOBILE / DEVICE BINDING
========================================================= */

async function bindMobile(
  uid,
  email,
  mobile
) {
  const db =
    userDb(
      uid,
      email
    );

  const batch =
    writeBatch(db);

  const now =
    serverTimestamp();

  batch.update(
    doc(
      db,
      "profileUsers",
      uid
    ),
    {
      mobileNumber:
        mobile,

      mobileAdded:
        true,

      mobileLocked:
        true,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  batch.set(
    doc(
      db,
      "profileMobiles",
      mobile
    ),

    mobileReservation(
      uid,
      mobile,
      now
    )
  );

  return batch.commit();
}

async function bindDevice(
  uid,
  email,
  deviceId
) {
  const db =
    userDb(
      uid,
      email
    );

  const batch =
    writeBatch(db);

  const now =
    serverTimestamp();

  batch.update(
    doc(
      db,
      "profileUsers",
      uid
    ),
    {
      deviceId,

      deviceAdded:
        true,

      deviceLocked:
        true,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  batch.set(
    doc(
      db,
      "profileDevices",
      deviceId
    ),

    deviceReservation(
      uid,
      deviceId,
      now
    )
  );

  return batch.commit();
}

async function readyUser(
  uid,
  email,
  code,
  mobile,
  deviceId
) {
  await bootstrapUser(
    uid,
    email,
    code
  );

  await bindMobile(
    uid,
    email,
    mobile
  );

  await bindDevice(
    uid,
    email,
    deviceId
  );

  return userDb(
    uid,
    email
  );
}

/* =========================================================
   ACTIVITY SEED
========================================================= */

async function seedActivity(
  uid,
  deviceId,
  seconds,
  minutesAgo,
  extra = {}
) {
  const created =
    past(
      24 *
      60 *
      60 *
      1000
    );

  const checkpoint =
    Timestamp.fromMillis(
      Date.now() -
      minutesAgo *
      60 *
      1000
    );

  await seed([
    [
      "profileActivity",

      uid,

      activity(
        uid,
        created,
        {
          deviceId,

          currentDaySeconds:
            seconds,

          currentDayStartedAt:
            sameBdDayTime(),

          lastCheckpointAt:
            checkpoint,

          lastActiveAt:
            checkpoint,

          updatedAt:
            checkpoint,

          ...extra
        }
      )
    ]
  ]);
}

/* =========================================================
   ELIGIBLE REFERRAL SEED
========================================================= */

async function seedEligibleReferral() {
  const referrerUid =
    "referrer";

  const referrerEmail =
    "referrer@example.com";

  const referredUid =
    "referred";

  const referredEmail =
    "referred@example.com";

  const ts =
    past();

  const completedAt =
    past(
      10 *
      60 *
      1000
    );

  const ref =
    referral({
      referrerUid,
      referredUid,

      referralCode:
        CODE_A,

      referredEmail,

      ts,

      mobile:
        MOBILE_A,

      mobileAdded:
        true,

      deviceAdded:
        true,

      activeDays:
        7,

      activityCompleted:
        true,

      eligible:
        true,

      status:
        "qualified",

      qualifiedAt:
        completedAt
    });

  const referrerStats =
    stats(
      referrerUid,
      ts,
      {
        total:
          1,

        qualified:
          1
      }
    );

  const referrerWallet =
    wallet(
      referrerUid,
      ts
    );

  await seed([
    [
      "profileUsers",

      referrerUid,

      profile({
        uid:
          referrerUid,

        email:
          referrerEmail,

        code:
          CODE_A,

        ts
      })
    ],

    [
      "profileUsers",

      referredUid,

      profile({
        uid:
          referredUid,

        email:
          referredEmail,

        code:
          CODE_B,

        ts,

        mobile:
          MOBILE_A,

        device:
          DEVICE_A,

        referredByUid:
          referrerUid,

        referredByCode:
          CODE_A
      })
    ],

    [
      "profileReferralCodes",
      CODE_A,
      codeDoc(
        referrerUid,
        CODE_A,
        ts
      )
    ],

    [
      "profileReferralCodes",
      CODE_B,
      codeDoc(
        referredUid,
        CODE_B,
        ts
      )
    ],

    [
      "profileMobiles",
      MOBILE_A,
      mobileReservation(
        referredUid,
        MOBILE_A,
        ts
      )
    ],

    [
      "profileDevices",
      DEVICE_A,
      deviceReservation(
        referredUid,
        DEVICE_A,
        ts
      )
    ],

    [
      "profileActivity",

      referredUid,

      activity(
        referredUid,
        ts,
        {
          deviceId:
            DEVICE_A,

          activeDays:
            7,

          currentDaySeconds:
            7200,

          currentDayStartedAt:
            ts,

          currentDayCompleted:
            true,

          lastCheckpointAt:
            completedAt,

          completed:
            true,

          lastActiveAt:
            completedAt,

          completedAt,

          updatedAt:
            completedAt
        }
      )
    ],

    [
      "profileReferrals",
      referredUid,
      ref
    ],

    [
      "profileReferralStats",
      referrerUid,
      referrerStats
    ],

    [
      "profileWallets",
      referrerUid,
      referrerWallet
    ]
  ]);

  return {
    referrerUid,

    referrerEmail,

    referredUid,

    referredEmail,

    referral:
      ref,

    stats:
      referrerStats,

    wallet:
      referrerWallet,

    mobile:
      MOBILE_A,

    device:
      DEVICE_A
  };
}

/* =========================================================
   ADMIN REFERRAL APPROVAL
========================================================= */

async function approveReferral(
  state
) {
  const db =
    adminDb();

  const id =
    state.referredUid;

  const ledgerId =
    `referral_reward_${id}`;

  const rewardId =
    `referral_${id}`;

  const auditId =
    `referral_approved_${id}`;

  const now =
    serverTimestamp();

  const walletBefore =
    state.wallet;

  const walletAfter = {
    ...walletBefore,

    availableBalance:
      walletBefore
        .availableBalance +
      1000,

    totalEarned:
      walletBefore
        .totalEarned +
      1000,

    revision:
      walletBefore
        .revision +
      1,

    lastOperationId:
      ledgerId,

    lastOperationType:
      "referral_reward",

    lastOperationAt:
      now,

    updatedAt:
      now
  };

  const referralAfter = {
    ...state.referral,

    status:
      "rewarded",

    rewardGranted:
      true,

    rewardGrantedAt:
      now,

    reviewedAt:
      now,

    reviewedBy:
      ADMIN_UID,

    approvedAt:
      now,

    rewardedAt:
      now,

    adminNote:
      "",

    updatedAt:
      now
  };

  const statsAfter = {
    ...state.stats,

    qualified:
      0,

    approved:
      1,

    rewarded:
      1,

    totalReward:
      1000,

    updatedAt:
      now
  };

  const batch =
    writeBatch(db);

  batch.set(
    doc(
      db,
      "profileReferrals",
      id
    ),
    referralAfter
  );

  batch.set(
    doc(
      db,
      "profileReferralStats",
      state.referrerUid
    ),
    statsAfter
  );

  batch.set(
    doc(
      db,
      "profileWallets",
      state.referrerUid
    ),
    walletAfter
  );

  batch.set(
    doc(
      db,
      "profileWalletTransactions",
      ledgerId
    ),

    ledger({
      id:
        ledgerId,

      uid:
        state.referrerUid,

      type:
        "referral_reward",

      direction:
        "credit",

      amount:
        1000,

      referenceId:
        id,

      operationId:
        rewardId,

      before:
        walletBefore,

      after:
        walletAfter,

      ts:
        now,

      adminUid:
        ADMIN_UID,

      adminEmail:
        ADMIN_EMAIL,

      metadata: {
        referralId:
          id,

        referredUid:
          id,

        referralCode:
          CODE_A,

        activityPolicyVersion:
          2,

        requiredDailySeconds:
          7200
      }
    })
  );

  batch.set(
    doc(
      db,
      "profileRewardEvents",
      rewardId
    ),
    {
      rewardEventId:
        rewardId,

      type:
        "referral",

      status:
        "credited",

      userId:
        state.referrerUid,

      uid:
        state.referrerUid,

      referredUid:
        id,

      referralId:
        id,

      referralCode:
        CODE_A,

      amount:
        1000,

      walletTransactionId:
        ledgerId,

      approvedBy:
        ADMIN_UID,

      approvedByEmail:
        ADMIN_EMAIL,

      approvedAt:
        now,

      creditedAt:
        now,

      createdAt:
        now,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  batch.set(
    doc(
      db,
      "profileAuditLogs",
      auditId
    ),
    {
      auditId,

      action:
        "referral_approved",

      adminUid:
        ADMIN_UID,

      adminEmail:
        ADMIN_EMAIL,

      adminRole:
        "admin",

      targetUid:
        id,

      referrerUid:
        state.referrerUid,

      referralId:
        id,

      previousStatus:
        "qualified",

      newStatus:
        "rewarded",

      rewardAmount:
        1000,

      walletTransactionId:
        ledgerId,

      note:
        "",

      createdAt:
        now,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  return batch.commit();
}

/* =========================================================
   ADMIN REFERRAL REJECT
========================================================= */

async function rejectReferral(
  state
) {
  const db =
    adminDb();

  const id =
    state.referredUid;

  const auditId =
    `referral_rejected_${id}`;

  const now =
    serverTimestamp();

  const batch =
    writeBatch(db);

  batch.set(
    doc(
      db,
      "profileReferrals",
      id
    ),
    {
      ...state.referral,

      status:
        "rejected",

      reviewedAt:
        now,

      reviewedBy:
        ADMIN_UID,

      rejectedAt:
        now,

      adminNote:
        "",

      updatedAt:
        now
    }
  );

  batch.set(
    doc(
      db,
      "profileReferralStats",
      state.referrerUid
    ),
    {
      ...state.stats,

      qualified:
        0,

      rejected:
        1,

      updatedAt:
        now
    }
  );

  batch.set(
    doc(
      db,
      "profileAuditLogs",
      auditId
    ),
    {
      auditId,

      action:
        "referral_rejected",

      adminUid:
        ADMIN_UID,

      adminEmail:
        ADMIN_EMAIL,

      adminRole:
        "admin",

      targetUid:
        id,

      referrerUid:
        state.referrerUid,

      referralId:
        id,

      previousStatus:
        "qualified",

      newStatus:
        "rejected",

      rewardAmount:
        0,

      walletTransactionId:
        "",

      note:
        "",

      createdAt:
        now,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  return batch.commit();
}

/* =========================================================
   PENDING WITHDRAWAL SEED
========================================================= */

async function seedPendingWithdrawal(
  id =
    "wd_seed_001"
) {
  const uid =
    "withdraw-user";

  const email =
    "withdraw-user@example.com";

  const amount =
    1000;

  const requestId =
    `request_${id}`;

  const ts =
    past(
      30 *
      60 *
      1000
    );

  const holdId =
    `withdraw_hold_${id}`;

  const currentWallet =
    wallet(
      uid,
      ts,
      {
        availableBalance:
          2000,

        heldBalance:
          1000,

        totalEarned:
          3000,

        revision:
          1,

        lastOperationId:
          holdId,

        lastOperationType:
          "withdraw_hold",

        lastOperationAt:
          ts
      }
    );

  const currentWithdrawal =
    withdrawal({
      uid,
      id,
      requestId,

      number:
        MOBILE_A,

      amount,

      ts
    });

  await seed([
    [
      "profileUsers",

      uid,

      profile({
        uid,
        email,

        code:
          CODE_C,

        ts
      })
    ],

    [
      "profileWallets",
      uid,
      currentWallet
    ],

    [
      "profileWithdrawals",
      id,
      currentWithdrawal
    ]
  ]);

  return {
    uid,

    email,

    amount,

    requestId,

    id,

    wallet:
      currentWallet,

    withdrawal:
      currentWithdrawal
  };
}

/* =========================================================
   ADMIN WITHDRAWAL REVIEW
========================================================= */

async function reviewWithdrawal(
  state,
  approved
) {
  const db =
    adminDb();

  const ledgerId =
    `${
      approved
        ? "withdraw_success"
        : "withdraw_refund"
    }_${state.id}`;

  const auditId =
    `withdrawal_${
      approved
        ? "approved"
        : "rejected"
    }_${state.id}`;

  const now =
    serverTimestamp();

  const before =
    state.wallet;

  const next =
    approved
      ? {
          ...before,

          heldBalance:
            before.heldBalance -
            state.amount,

          totalWithdrawn:
            before.totalWithdrawn +
            state.amount,

          lastWithdrawalAmount:
            state.amount,

          lastWithdrawalAt:
            now,

          revision:
            before.revision +
            1,

          lastOperationId:
            ledgerId,

          lastOperationType:
            "withdraw_success",

          lastOperationAt:
            now,

          updatedAt:
            now
        }
      : {
          ...before,

          availableBalance:
            before.availableBalance +
            state.amount,

          heldBalance:
            before.heldBalance -
            state.amount,

          revision:
            before.revision +
            1,

          lastOperationId:
            ledgerId,

          lastOperationType:
            "withdraw_refund",

          lastOperationAt:
            now,

          updatedAt:
            now
        };

  const withdrawalAfter = {
    ...state.withdrawal,

    status:
      approved
        ? "approved"
        : "rejected",

    completionTransactionId:
      approved
        ? ledgerId
        : "",

    refundTransactionId:
      approved
        ? ""
        : ledgerId,

    reviewedAt:
      now,

    approvedAt:
      approved
        ? now
        : null,

    rejectedAt:
      approved
        ? null
        : now,

    reviewedBy:
      ADMIN_UID,

    adminNote:
      "",

    updatedAt:
      now
  };

  const batch =
    writeBatch(db);

  batch.set(
    doc(
      db,
      "profileWallets",
      state.uid
    ),
    next
  );

  batch.set(
    doc(
      db,
      "profileWithdrawals",
      state.id
    ),
    withdrawalAfter
  );

  batch.set(
    doc(
      db,
      "profileWalletTransactions",
      ledgerId
    ),

    ledger({
      id:
        ledgerId,

      uid:
        state.uid,

      type:
        approved
          ? "withdraw_success"
          : "withdraw_refund",

      direction:
        approved
          ? "debit"
          : "credit",

      amount:
        state.amount,

      referenceId:
        state.id,

      operationId:
        auditId,

      before,

      after:
        next,

      ts:
        now,

      adminUid:
        ADMIN_UID,

      adminEmail:
        ADMIN_EMAIL,

      metadata: {
        withdrawalId:
          state.id,

        provider:
          "bkash"
      }
    })
  );

  batch.set(
    doc(
      db,
      "profileAuditLogs",
      auditId
    ),
    {
      auditId,

      action:
        approved
          ? "withdrawal_approved"
          : "withdrawal_rejected",

      adminUid:
        ADMIN_UID,

      adminEmail:
        ADMIN_EMAIL,

      adminRole:
        "admin",

      targetUid:
        state.uid,

      withdrawalId:
        state.id,

      previousStatus:
        "pending",

      newStatus:
        approved
          ? "approved"
          : "rejected",

      amount:
        state.amount,

      walletTransactionId:
        ledgerId,

      note:
        "",

      createdAt:
        now,

      updatedAt:
        now,

      schemaVersion:
        3
    }
  );

  return batch.commit();
}

/* =========================================================
   TEST ENVIRONMENT
========================================================= */

before(
  async () => {
    env =
      await initializeTestEnvironment({
        projectId:
          PROJECT_ID,

        firestore: {
          rules:
            fs.readFileSync(
              RULES_PATH,
              "utf8"
            )
        }
      });
  }
);

after(
  async () => {
    if (env) {
      await env.cleanup();
    }
  }
);

beforeEach(
  async () => {
    await env.clearFirestore();
  }
);

/* =========================================================
   PUBLIC DATA
========================================================= */

test(
  "public collections are readable but browser writes are denied",

  async () => {
    const db =
      guestDb();

    for (
      const col
      of [
        "sites",
        "news",
        "banners",
        "siteClicks"
      ]
    ) {
      await assertSucceeds(
        getDoc(
          doc(
            db,
            col,
            "sample"
          )
        )
      );

      await assertFails(
        setDoc(
          doc(
            db,
            col,
            "sample"
          ),
          {
            unsafe:
              true
          }
        )
      );
    }
  }
);

test(
  "default rule denies unknown collections",

  async () => {
    const db =
      userDb(
        "unknown-user"
      );

    await assertFails(
      getDoc(
        doc(
          db,
          "unknownCollection",
          "sample"
        )
      )
    );

    await assertFails(
      setDoc(
        doc(
          db,
          "unknownCollection",
          "sample"
        ),
        {
          unsafe:
            true
        }
      )
    );
  }
);

/* =========================================================
   AUTH / PROFILE
========================================================= */

test(
  "verified Google user can bootstrap schema-v3 companions atomically",

  async () => {
    await assertSucceeds(
      bootstrapUser(
        "bootstrap-user",
        "bootstrap@example.com",
        CODE_A
      )
    );

    const snap =
      await getDoc(
        doc(
          userDb(
            "bootstrap-user",
            "bootstrap@example.com"
          ),
          "profileUsers",
          "bootstrap-user"
        )
      );

    assert.equal(
      snap.exists(),
      true
    );

    assert.equal(
      snap
        .data()
        .schemaVersion,
      3
    );
  }
);

test(
  "unverified account cannot create owner-protected profile",

  async () => {
    const uid =
      "unverified-user";

    const email =
      "unverified@example.com";

    const db =
      unverifiedDb(
        uid,
        email
      );

    const now =
      serverTimestamp();

    await assertFails(
      setDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),

        profile({
          uid,
          email,

          code:
            CODE_A,

          ts:
            now
        })
      )
    );
  }
);

test(
  "non-Google provider cannot read protected owner profile",

  async () => {
    const uid =
      "password-user";

    const email =
      "password@example.com";

    await seed([
      [
        "profileUsers",

        uid,

        profile({
          uid,
          email,

          code:
            CODE_A,

          ts:
            past()
        })
      ]
    ]);

    await assertFails(
      getDoc(
        doc(
          nonGoogleDb(
            uid,
            email
          ),
          "profileUsers",
          uid
        )
      )
    );
  }
);

test(
  "owner reads own profile only; Admin can list profiles",

  async () => {
    await bootstrapUser(
      "user-a",
      "user-a@example.com",
      CODE_A
    );

    await bootstrapUser(
      "user-b",
      "user-b@example.com",
      CODE_B
    );

    const db =
      userDb(
        "user-a",
        "user-a@example.com"
      );

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "profileUsers",
          "user-a"
        )
      )
    );

    await assertFails(
      getDoc(
        doc(
          db,
          "profileUsers",
          "user-b"
        )
      )
    );

    await assertFails(
      getDocs(
        collection(
          db,
          "profileUsers"
        )
      )
    );

    await assertSucceeds(
      getDocs(
        collection(
          adminDb(),
          "profileUsers"
        )
      )
    );
  }
);

/* =========================================================
   UNIQUE MOBILE
========================================================= */

test(
  "owner can bind valid unique Bangladesh mobile",

  async () => {
    await bootstrapUser(
      "mobile-user",
      "mobile@example.com",
      CODE_A
    );

    await assertSucceeds(
      bindMobile(
        "mobile-user",
        "mobile@example.com",
        MOBILE_A
      )
    );

    const snap =
      await getDoc(
        doc(
          userDb(
            "mobile-user",
            "mobile@example.com"
          ),

          "profileMobiles",

          MOBILE_A
        )
      );

    assert.equal(
      snap
        .data()
        .uid,

      "mobile-user"
    );
  }
);

test(
  "same mobile cannot be bound to a second UID",

  async () => {
    await bootstrapUser(
      "mobile-owner",
      "mobile-owner@example.com",
      CODE_A
    );

    await bindMobile(
      "mobile-owner",
      "mobile-owner@example.com",
      MOBILE_A
    );

    await bootstrapUser(
      "mobile-attacker",
      "mobile-attacker@example.com",
      CODE_B
    );

    await assertFails(
      bindMobile(
        "mobile-attacker",
        "mobile-attacker@example.com",
        MOBILE_A
      )
    );
  }
);

/* =========================================================
   UNIQUE WEB DEVICE
========================================================= */

test(
  "same Web Device cannot be bound to a second UID",

  async () => {
    await readyUser(
      "device-owner",
      "device-owner@example.com",
      CODE_A,
      MOBILE_A,
      DEVICE_A
    );

    await bootstrapUser(
      "device-attacker",
      "device-attacker@example.com",
      CODE_B
    );

    await bindMobile(
      "device-attacker",
      "device-attacker@example.com",
      MOBILE_B
    );

    await assertFails(
      bindDevice(
        "device-attacker",
        "device-attacker@example.com",
        DEVICE_A
      )
    );
  }
);

test(
  "mobile and device reservations are immutable",

  async () => {
    await readyUser(
      "immutable-user",
      "immutable@example.com",
      CODE_A,
      MOBILE_A,
      DEVICE_A
    );

    const db =
      userDb(
        "immutable-user",
        "immutable@example.com"
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileMobiles",
          MOBILE_A
        ),
        {
          updatedAt:
            serverTimestamp()
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileDevices",
          DEVICE_A
        )
      )
    );
  }
);

/* =========================================================
   ACTIVITY POLICY
========================================================= */

test(
  "qualified profile can start a new BD activity day with zero credit",

  async () => {
    const uid =
      "activity-start";

    const email =
      "activity-start@example.com";

    const db =
      await readyUser(
        uid,
        email,
        CODE_A,
        MOBILE_A,
        DEVICE_A
      );

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          deviceId:
            DEVICE_A,

          currentDaySeconds:
            0,

          currentDayStartedAt:
            serverTimestamp(),

          currentDayCompleted:
            false,

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );

    const snap =
      await getDoc(
        doc(
          db,
          "profileActivity",
          uid
        )
      );

    assert.equal(
      snap
        .data()
        .currentDaySeconds,
      0
    );

    assert.equal(
      snap
        .data()
        .activeDays,
      0
    );
  }
);

test(
  "checkpoint before 15 minutes is denied",

  async () => {
    const uid =
      "activity-early";

    const email =
      "activity-early@example.com";

    const db =
      await readyUser(
        uid,
        email,
        CODE_A,
        MOBILE_A,
        DEVICE_A
      );

    await updateDoc(
      doc(
        db,
        "profileActivity",
        uid
      ),
      {
        deviceId:
          DEVICE_A,

        currentDayStartedAt:
          serverTimestamp(),

        lastCheckpointAt:
          serverTimestamp(),

        lastActiveAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp(),

        schemaVersion:
          3
      }
    );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          currentDaySeconds:
            900,

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );
  }
);

test(
  "15–20 minute checkpoint credits exactly 900 seconds",

  async () => {
    const uid =
      "activity-valid";

    const email =
      "activity-valid@example.com";

    const db =
      await readyUser(
        uid,
        email,
        CODE_A,
        MOBILE_A,
        DEVICE_A
      );

    await seedActivity(
      uid,
      DEVICE_A,
      0,
      16
    );

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          currentDaySeconds:
            900,

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );

    const snap =
      await getDoc(
        doc(
          db,
          "profileActivity",
          uid
        )
      );

    assert.equal(
      snap
        .data()
        .currentDaySeconds,
      900
    );

    assert.equal(
      snap
        .data()
        .activeDays,
      0
    );
  }
);

test(
  "gap over 20 minutes earns zero and only resume anchor is allowed",

  async () => {
    const uid =
      "activity-resume";

    const email =
      "activity-resume@example.com";

    const db =
      await readyUser(
        uid,
        email,
        CODE_A,
        MOBILE_A,
        DEVICE_A
      );

    await seedActivity(
      uid,
      DEVICE_A,
      900,
      21
    );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          currentDaySeconds:
            1800,

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );

    const snap =
      await getDoc(
        doc(
          db,
          "profileActivity",
          uid
        )
      );

    assert.equal(
      snap
        .data()
        .currentDaySeconds,
      900
    );
  }
);

test(
  "7200 seconds completes one day and same BD date cannot create another day",

  async () => {
    const uid =
      "activity-day";

    const email =
      "activity-day@example.com";

    const db =
      await readyUser(
        uid,
        email,
        CODE_A,
        MOBILE_A,
        DEVICE_A
      );

    await seedActivity(
      uid,
      DEVICE_A,
      6300,
      16
    );

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          activeDays:
            1,

          currentDaySeconds:
            7200,

          currentDayCompleted:
            true,

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          activeDays:
            2,

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );
  }
);

test(
  "activity start is denied without locked mobile and device",

  async () => {
    const uid =
      "activity-unqualified";

    const email =
      "activity-unqualified@example.com";

    const db =
      await bootstrapUser(
        uid,
        email,
        CODE_A
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileActivity",
          uid
        ),
        {
          deviceId:
            DEVICE_A,

          currentDayStartedAt:
            serverTimestamp(),

          lastCheckpointAt:
            serverTimestamp(),

          lastActiveAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            3
        }
      )
    );
  }
);

/* =========================================================
   REFERRAL REVIEW
========================================================= */

test(
  "referred user cannot self-reward referral",

  async () => {
    const state =
      await seedEligibleReferral();

    const db =
      userDb(
        state.referredUid,
        state.referredEmail
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileReferrals",
          state.referredUid
        ),
        {
          status:
            "rewarded",

          rewardGranted:
            true,

          rewardGrantedAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        }
      )
    );
  }
);

test(
  "Admin approval of eligible referral credits exactly ৳1000 with ledger/reward/audit",

  async () => {
    const state =
      await seedEligibleReferral();

    await assertSucceeds(
      approveReferral(
        state
      )
    );

    const db =
      adminDb();

    const [
      refSnap,
      walletSnap,
      statsSnap,
      rewardSnap
    ] =
      await Promise.all([
        getDoc(
          doc(
            db,
            "profileReferrals",
            state.referredUid
          )
        ),

        getDoc(
          doc(
            db,
            "profileWallets",
            state.referrerUid
          )
        ),

        getDoc(
          doc(
            db,
            "profileReferralStats",
            state.referrerUid
          )
        ),

        getDoc(
          doc(
            db,
            "profileRewardEvents",
            `referral_${state.referredUid}`
          )
        )
      ]);

    assert.equal(
      refSnap
        .data()
        .status,
      "rewarded"
    );

    assert.equal(
      refSnap
        .data()
        .rewardGranted,
      true
    );

    assert.equal(
      walletSnap
        .data()
        .availableBalance,
      1000
    );

    assert.equal(
      walletSnap
        .data()
        .totalEarned,
      1000
    );

    assert.equal(
      statsSnap
        .data()
        .rewarded,
      1
    );

    assert.equal(
      statsSnap
        .data()
        .totalReward,
      1000
    );

    assert.equal(
      rewardSnap
        .data()
        .amount,
      1000
    );
  }
);

test(
  "Admin cannot approve referral when device reservation is missing",

  async () => {
    const state =
      await seedEligibleReferral();

    await env
      .withSecurityRulesDisabled(
        async ctx => {
          await deleteDoc(
            doc(
              ctx.firestore(),
              "profileDevices",
              state.device
            )
          );
        }
      );

    await assertFails(
      approveReferral(
        state
      )
    );
  }
);

test(
  "Admin can reject qualified referral without wallet reward",

  async () => {
    const state =
      await seedEligibleReferral();

    await assertSucceeds(
      rejectReferral(
        state
      )
    );

    const db =
      adminDb();

    const refSnap =
      await getDoc(
        doc(
          db,
          "profileReferrals",
          state.referredUid
        )
      );

    const walletSnap =
      await getDoc(
        doc(
          db,
          "profileWallets",
          state.referrerUid
        )
      );

    assert.equal(
      refSnap
        .data()
        .status,
      "rejected"
    );

    assert.equal(
      refSnap
        .data()
        .rewardGranted,
      false
    );

    assert.equal(
      walletSnap
        .data()
        .availableBalance,
      0
    );
  }
);

/* =========================================================
   WITHDRAWAL SUBMISSION
========================================================= */

test(
  "user withdrawal atomically moves Available to Held and creates hold ledger",

  async () => {
    const uid =
      "withdraw-submit";

    const email =
      "withdraw-submit@example.com";

    const db =
      await bootstrapUser(
        uid,
        email,
        CODE_A
      );

    const old =
      wallet(
        uid,
        past(),
        {
          availableBalance:
            3000,

          totalEarned:
            3000
        }
      );

    await seed([
      [
        "profileWallets",
        uid,
        old
      ]
    ]);

    const id =
      "wd_submit_001";

    const requestId =
      "request_submit_001";

    const holdId =
      `withdraw_hold_${id}`;

    const now =
      serverTimestamp();

    const next = {
      ...old,

      availableBalance:
        2000,

      heldBalance:
        1000,

      revision:
        1,

      lastOperationId:
        holdId,

      lastOperationType:
        "withdraw_hold",

      lastOperationAt:
        now,

      updatedAt:
        now
    };

    const wd =
      withdrawal({
        uid,
        id,
        requestId,

        number:
          MOBILE_A,

        amount:
          1000,

        ts:
          now
      });

    const hold =
      ledger({
        id:
          holdId,

        uid,

        type:
          "withdraw_hold",

        direction:
          "debit",

        amount:
          1000,

        referenceId:
          id,

        operationId:
          requestId,

        before:
          old,

        after:
          next,

        ts:
          now,

        note:
          "Withdrawal amount held",

        metadata: {
          withdrawalId:
            id,

          requestId,

          provider:
            "bkash"
        }
      });

    const batch =
      writeBatch(db);

    batch.set(
      doc(
        db,
        "profileWallets",
        uid
      ),
      next
    );

    batch.set(
      doc(
        db,
        "profileWithdrawals",
        id
      ),
      wd
    );

    batch.set(
      doc(
        db,
        "profileWalletTransactions",
        holdId
      ),
      hold
    );

    await assertSucceeds(
      batch.commit()
    );

    const snap =
      await getDoc(
        doc(
          db,
          "profileWallets",
          uid
        )
      );

    assert.equal(
      snap
        .data()
        .availableBalance,
      2000
    );

    assert.equal(
      snap
        .data()
        .heldBalance,
      1000
    );
  }
);

test(
  "submitted withdrawal cannot be edited, cancelled or deleted by user",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_no_cancel_001"
      );

    const db =
      userDb(
        state.uid,
        state.email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileWithdrawals",
          state.id
        ),
        {
          status:
            "cancelled",

          cancelledAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileWithdrawals",
          state.id
        )
      )
    );
  }
);

test(
  "user cannot directly mutate wallet balance",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_wallet_attack_001"
      );

    const db =
      userDb(
        state.uid,
        state.email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileWallets",
          state.uid
        ),
        {
          availableBalance:
            999999,

          revision:
            state.wallet
              .revision +
            1,

          lastOperationId:
            "manual",

          lastOperationType:
            "manual",

          lastOperationAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        }
      )
    );
  }
);

/* =========================================================
   ADMIN WITHDRAWAL REVIEW
========================================================= */

test(
  "Admin approves pending withdrawal without requiring payment reference",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_approve_001"
      );

    await assertSucceeds(
      reviewWithdrawal(
        state,
        true
      )
    );

    const db =
      adminDb();

    const wd =
      await getDoc(
        doc(
          db,
          "profileWithdrawals",
          state.id
        )
      );

    const w =
      await getDoc(
        doc(
          db,
          "profileWallets",
          state.uid
        )
      );

    assert.equal(
      wd
        .data()
        .status,
      "approved"
    );

    assert.equal(
      wd
        .data()
        .paymentConfirmed,
      false
    );

    assert.equal(
      wd
        .data()
        .paymentReference,
      ""
    );

    assert.equal(
      w
        .data()
        .heldBalance,
      0
    );

    assert.equal(
      w
        .data()
        .totalWithdrawn,
      1000
    );
  }
);

test(
  "Admin rejects pending withdrawal and refunds Held to Available",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_reject_001"
      );

    await assertSucceeds(
      reviewWithdrawal(
        state,
        false
      )
    );

    const db =
      adminDb();

    const wd =
      await getDoc(
        doc(
          db,
          "profileWithdrawals",
          state.id
        )
      );

    const w =
      await getDoc(
        doc(
          db,
          "profileWallets",
          state.uid
        )
      );

    assert.equal(
      wd
        .data()
        .status,
      "rejected"
    );

    assert.equal(
      w
        .data()
        .availableBalance,
      3000
    );

    assert.equal(
      w
        .data()
        .heldBalance,
      0
    );

    assert.equal(
      w
        .data()
        .totalWithdrawn,
      0
    );
  }
);

test(
  "non-Admin cannot make final withdrawal decision",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_non_admin_001"
      );

    const db =
      userDb(
        "other-user",
        "other-user@example.com"
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileWithdrawals",
          state.id
        ),
        {
          status:
            "approved",

          reviewedAt:
            serverTimestamp(),

          approvedAt:
            serverTimestamp(),

          reviewedBy:
            "other-user",

          updatedAt:
            serverTimestamp()
        }
      )
    );
  }
);

test(
  "final withdrawal decision cannot be reversed",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_final_001"
      );

    await reviewWithdrawal(
      state,
      true
    );

    await assertFails(
      updateDoc(
        doc(
          adminDb(),
          "profileWithdrawals",
          state.id
        ),
        {
          status:
            "rejected",

          completionTransactionId:
            "",

          refundTransactionId:
            `withdraw_refund_${state.id}`,

          reviewedAt:
            serverTimestamp(),

          approvedAt:
            null,

          rejectedAt:
            serverTimestamp(),

          reviewedBy:
            ADMIN_UID,

          updatedAt:
            serverTimestamp()
        }
      )
    );
  }
);

/* =========================================================
   PRIVACY
========================================================= */

test(
  "wallet and withdrawals are private to owner while Admin can read",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_privacy_001"
      );

    const owner =
      userDb(
        state.uid,
        state.email
      );

    const stranger =
      userDb(
        "stranger",
        "stranger@example.com"
      );

    await assertSucceeds(
      getDoc(
        doc(
          owner,
          "profileWallets",
          state.uid
        )
      )
    );

    await assertFails(
      getDoc(
        doc(
          stranger,
          "profileWallets",
          state.uid
        )
      )
    );

    await assertSucceeds(
      getDoc(
        doc(
          owner,
          "profileWithdrawals",
          state.id
        )
      )
    );

    await assertFails(
      getDoc(
        doc(
          stranger,
          "profileWithdrawals",
          state.id
        )
      )
    );

    await assertSucceeds(
      getDoc(
        doc(
          adminDb(),
          "profileWallets",
          state.uid
        )
      )
    );
  }
);

test(
  "owner can query own ledger but not another user's ledger",

  async () => {
    const state =
      await seedPendingWithdrawal(
        "wd_ledger_001"
      );

    const holdId =
      `withdraw_hold_${state.id}`;

    const before =
      wallet(
        state.uid,
        state.wallet.createdAt,
        {
          availableBalance:
            3000,

          totalEarned:
            3000
        }
      );

    await seed([
      [
        "profileWalletTransactions",

        holdId,

        ledger({
          id:
            holdId,

          uid:
            state.uid,

          type:
            "withdraw_hold",

          direction:
            "debit",

          amount:
            1000,

          referenceId:
            state.id,

          operationId:
            state.requestId,

          before,

          after:
            state.wallet,

          ts:
            state.wallet.updatedAt,

          metadata: {
            withdrawalId:
              state.id
          }
        })
      ]
    ]);

    const owner =
      userDb(
        state.uid,
        state.email
      );

    const stranger =
      userDb(
        "ledger-stranger",
        "ledger-stranger@example.com"
      );

    await assertSucceeds(
      getDocs(
        query(
          collection(
            owner,
            "profileWalletTransactions"
          ),

          where(
            "userId",
            "==",
            state.uid
          )
        )
      )
    );

    await assertFails(
      getDoc(
        doc(
          stranger,
          "profileWalletTransactions",
          holdId
        )
      )
    );
  }
);

/* =========================================================
   IMMUTABILITY
========================================================= */

test(
  "protected profile/referral/reward records cannot be deleted",

  async () => {
    const state =
      await seedEligibleReferral();

    const db =
      userDb(
        state.referredUid,
        state.referredEmail
      );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileUsers",
          state.referredUid
        )
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileReferrals",
          state.referredUid
        )
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          adminDb(),
          "profileRewardEvents",
          "any-reward"
        )
      )
    );
  }
);

/* =========================================================
   SETTINGS
========================================================= */

test(
  "deprecated publicAdminReferral is fully denied; other settings are Admin-only",

  async () => {
    const regular =
      userDb(
        "settings-user",
        "settings-user@example.com"
      );

    await assertFails(
      getDoc(
        doc(
          regular,
          "profileSettings",
          "publicAdminReferral"
        )
      )
    );

    await assertFails(
      setDoc(
        doc(
          adminDb(),
          "profileSettings",
          "publicAdminReferral"
        ),
        {
          enabled:
            true
        }
      )
    );

    await assertSucceeds(
      setDoc(
        doc(
          adminDb(),
          "profileSettings",
          "production"
        ),
        {
          enabled:
            true
        }
      )
    );

    await assertFails(
      getDoc(
        doc(
          regular,
          "profileSettings",
          "production"
        )
      )
    );
  }
);
