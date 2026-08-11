"use strict";

/* =========================================================
   11PLAY — FIRESTORE SECURITY RULES TEST SUITE
   File: tests/firestore.rules.test.js

   Current production contract under test:
   - Firebase Spark + GitHub Pages
   - Verified Google authentication only
   - Firebase UID identifies each Profile
   - Google email reservation prevents duplicate account email
   - Username comes from Google email in application logic
   - User can read only their own Profile
   - Admin can read/list all Profiles
   - Mobile number is NOT globally unique
   - Same mobile may be used by multiple users
   - Mobile becomes immutable after first save
   - Offer Paid data is completely separate from Profile
   - Offer Paid data is Admin-only
   - User cannot read/write Offer Paid status
   - Admin can permanently mark Offer Paid
   - Removed referral/wallet/activity/device/withdrawal
     collections are denied by default

   Permanent Admin:
   - casinobuzzbd@gmail.com
========================================================= */

const fs =
  require("node:fs");

const path =
  require("node:path");

const assert =
  require("node:assert/strict");

const {
  test,
  before,
  after,
  beforeEach
} =
  require("node:test");

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} =
  require(
    "@firebase/rules-unit-testing"
  );

const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} =
  require(
    "firebase/firestore"
  );

/* =========================================================
   CONFIGURATION
========================================================= */

const PROJECT_ID =
  "demo-11play";

const ADMIN_UID =
  "admin-uid";

const ADMIN_EMAIL =
  "casinobuzzbd@gmail.com";

const SCHEMA_VERSION =
  4;

const GOOGLE_PROVIDER =
  "google.com";

const RULES_PATH =
  path.resolve(
    __dirname,
    "..",
    "firestore.rules"
  );

const MOBILE_A =
  "+8801712345678";

const MOBILE_B =
  "+8801812345678";

let env;

/* =========================================================
   AUTH HELPERS
========================================================= */

function token(
  email,
  verified = true,
  provider = GOOGLE_PROVIDER
) {
  return {
    email:
      email.toLowerCase(),

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
      token(
        email
      )
    )
    .firestore();
}

function unverifiedDb(
  uid,
  email
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
  email
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
   DATA HELPERS
========================================================= */

function usernameFromEmail(
  email
) {
  return email
    .toLowerCase()
    .split("@")[0];
}

function profileData({
  uid,
  email,
  ts,
  name = "",
  photoURL = ""
}) {
  const normalizedEmail =
    email.toLowerCase();

  const username =
    usernameFromEmail(
      normalizedEmail
    );

  const displayName =
    name ||
    username;

  return {
    uid,

    name:
      displayName,

    displayName,

    username,

    email:
      normalizedEmail,

    photo:
      photoURL,

    photoURL,

    emailVerified:
      true,

    providerIds: [
      GOOGLE_PROVIDER
    ],

    googleConnected:
      true,

    isGoogleConnected:
      true,

    isGoogleSignIn:
      true,

    accountType:
      "google",

    mobileNumber:
      "",

    mobileAdded:
      false,

    mobileLocked:
      false,

    isMobileLocked:
      false,

    registrationDate:
      ts,

    createdAt:
      ts,

    lastLogin:
      ts,

    lastLoginAt:
      ts,

    updatedAt:
      ts,

    status:
      "active",

    schemaVersion:
      SCHEMA_VERSION
  };
}

function emailReservationData({
  uid,
  email,
  ts
}) {
  const normalizedEmail =
    email.toLowerCase();

  return {
    email:
      normalizedEmail,

    uid,

    userId:
      uid,

    provider:
      GOOGLE_PROVIDER,

    createdAt:
      ts,

    schemaVersion:
      SCHEMA_VERSION
  };
}

function offerPaidData({
  uid,
  adminUid = ADMIN_UID,
  adminEmail = ADMIN_EMAIL,
  ts
}) {
  return {
    uid,

    offerPaid:
      true,

    offerPaidAt:
      ts,

    offerPaidByUid:
      adminUid,

    offerPaidByEmail:
      adminEmail.toLowerCase(),

    createdAt:
      ts,

    updatedAt:
      ts,

    schemaVersion:
      SCHEMA_VERSION
  };
}

/* =========================================================
   PROFILE BOOTSTRAP

   Profile + Email reservation must be created atomically.
========================================================= */

async function bootstrapUser(
  uid,
  email,
  options = {}
) {
  const db =
    userDb(
      uid,
      email
    );

  const batch =
    writeBatch(
      db
    );

  const now =
    serverTimestamp();

  batch.set(
    doc(
      db,
      "profileUsers",
      uid
    ),
    profileData({
      uid,
      email,
      ts:
        now,
      name:
        options.name ||
        "",
      photoURL:
        options.photoURL ||
        ""
    })
  );

  batch.set(
    doc(
      db,
      "profileEmails",
      email.toLowerCase()
    ),
    emailReservationData({
      uid,
      email,
      ts:
        now
    })
  );

  await batch.commit();

  return db;
}

/* =========================================================
   MOBILE SAVE
========================================================= */

async function saveMobile(
  uid,
  email,
  mobile
) {
  const db =
    userDb(
      uid,
      email
    );

  await updateDoc(
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

      isMobileLocked:
        true,

      updatedAt:
        serverTimestamp(),

      schemaVersion:
        SCHEMA_VERSION
    }
  );

  return db;
}

/* =========================================================
   OFFER PAID
========================================================= */

async function markOfferPaid(
  uid
) {
  const db =
    adminDb();

  const now =
    serverTimestamp();

  return setDoc(
    doc(
      db,
      "profileOfferStatus",
      uid
    ),
    offerPaidData({
      uid,
      ts:
        now
    })
  );
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
    if (
      env
    ) {
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
   PUBLIC COLLECTIONS
========================================================= */

test(
  "public application collections are readable but browser writes are denied",

  async () => {
    const db =
      guestDb();

    const publicCollections = [
      "sites",
      "news",
      "banners",
      "siteClicks"
    ];

    for (
      const collectionName
      of publicCollections
    ) {
      await assertSucceeds(
        getDoc(
          doc(
            db,
            collectionName,
            "sample"
          )
        )
      );

      await assertFails(
        setDoc(
          doc(
            db,
            collectionName,
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
  "unknown collections are denied by default",

  async () => {
    const db =
      userDb(
        "unknown-user",
        "unknown@example.com"
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
   VERIFIED GOOGLE AUTHENTICATION
========================================================= */

test(
  "verified Google user can create Profile and email reservation atomically",

  async () => {
    const uid =
      "google-user";

    const email =
      "google-user@example.com";

    await assertSucceeds(
      bootstrapUser(
        uid,
        email
      )
    );

    const db =
      userDb(
        uid,
        email
      );

    const profileSnapshot =
      await getDoc(
        doc(
          db,
          "profileUsers",
          uid
        )
      );

    assert.equal(
      profileSnapshot.exists(),
      true
    );

    assert.equal(
      profileSnapshot
        .data()
        .uid,
      uid
    );

    assert.equal(
      profileSnapshot
        .data()
        .email,
      email
    );

    assert.equal(
      profileSnapshot
        .data()
        .username,
      "google-user"
    );

    assert.equal(
      profileSnapshot
        .data()
        .schemaVersion,
      SCHEMA_VERSION
    );
  }
);

test(
  "unverified Google account cannot create Profile",

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

    const batch =
      writeBatch(
        db
      );

    const now =
      serverTimestamp();

    batch.set(
      doc(
        db,
        "profileUsers",
        uid
      ),
      profileData({
        uid,
        email,
        ts:
          now
      })
    );

    batch.set(
      doc(
        db,
        "profileEmails",
        email
      ),
      emailReservationData({
        uid,
        email,
        ts:
          now
      })
    );

    await assertFails(
      batch.commit()
    );
  }
);

test(
  "non-Google authentication provider cannot create Profile",

  async () => {
    const uid =
      "password-user";

    const email =
      "password@example.com";

    const db =
      nonGoogleDb(
        uid,
        email
      );

    const batch =
      writeBatch(
        db
      );

    const now =
      serverTimestamp();

    batch.set(
      doc(
        db,
        "profileUsers",
        uid
      ),
      profileData({
        uid,
        email,
        ts:
          now
      })
    );

    batch.set(
      doc(
        db,
        "profileEmails",
        email
      ),
      emailReservationData({
        uid,
        email,
        ts:
          now
      })
    );

    await assertFails(
      batch.commit()
    );
  }
);

test(
  "guest cannot read private Profile",

  async () => {
    await bootstrapUser(
      "private-user",
      "private-user@example.com"
    );

    await assertFails(
      getDoc(
        doc(
          guestDb(),
          "profileUsers",
          "private-user"
        )
      )
    );
  }
);

/* =========================================================
   PROFILE PRIVACY
========================================================= */

test(
  "user can read own Profile but cannot read another user's Profile",

  async () => {
    await bootstrapUser(
      "user-a",
      "user-a@example.com"
    );

    await bootstrapUser(
      "user-b",
      "user-b@example.com"
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
  }
);

test(
  "regular user cannot list Profile collection",

  async () => {
    await bootstrapUser(
      "list-user",
      "list-user@example.com"
    );

    const db =
      userDb(
        "list-user",
        "list-user@example.com"
      );

    await assertFails(
      getDocs(
        collection(
          db,
          "profileUsers"
        )
      )
    );
  }
);

test(
  "Admin can read and list registered Profiles",

  async () => {
    await bootstrapUser(
      "admin-visible-a",
      "admin-visible-a@example.com"
    );

    await bootstrapUser(
      "admin-visible-b",
      "admin-visible-b@example.com"
    );

    const db =
      adminDb();

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "profileUsers",
          "admin-visible-a"
        )
      )
    );

    const snapshot =
      await assertSucceeds(
        getDocs(
          collection(
            db,
            "profileUsers"
          )
        )
      );

    assert.equal(
      snapshot.size,
      2
    );
  }
);

/* =========================================================
   PROFILE UPDATE
========================================================= */

test(
  "owner can synchronize allowed Google Profile fields",

  async () => {
    const uid =
      "refresh-user";

    const email =
      "refresh-user@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertSucceeds(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          name:
            "Updated User",

          displayName:
            "Updated User",

          photo:
            "https://example.com/photo.jpg",

          photoURL:
            "https://example.com/photo.jpg",

          lastLogin:
            serverTimestamp(),

          lastLoginAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );

    const snapshot =
      await getDoc(
        doc(
          db,
          "profileUsers",
          uid
        )
      );

    assert.equal(
      snapshot
        .data()
        .displayName,
      "Updated User"
    );
  }
);

test(
  "owner cannot change Profile email to another email",

  async () => {
    const uid =
      "email-change-user";

    const email =
      "email-change@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          email:
            "another-email@example.com",

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "owner cannot change own account status",

  async () => {
    const uid =
      "status-user";

    const email =
      "status-user@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          status:
            "blocked",

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "Profile cannot be deleted by owner",

  async () => {
    const uid =
      "delete-profile-user";

    const email =
      "delete-profile@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileUsers",
          uid
        )
      )
    );
  }
);

test(
  "Admin cannot directly modify user Profile",

  async () => {
    await bootstrapUser(
      "admin-update-target",
      "admin-update-target@example.com"
    );

    await assertFails(
      updateDoc(
        doc(
          adminDb(),
          "profileUsers",
          "admin-update-target"
        ),
        {
          status:
            "blocked",

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

/* =========================================================
   EMAIL RESERVATION
========================================================= */

test(
  "user can read only their own email reservation",

  async () => {
    await bootstrapUser(
      "email-user-a",
      "email-user-a@example.com"
    );

    await bootstrapUser(
      "email-user-b",
      "email-user-b@example.com"
    );

    const db =
      userDb(
        "email-user-a",
        "email-user-a@example.com"
      );

    await assertSucceeds(
      getDoc(
        doc(
          db,
          "profileEmails",
          "email-user-a@example.com"
        )
      )
    );

    await assertFails(
      getDoc(
        doc(
          db,
          "profileEmails",
          "email-user-b@example.com"
        )
      )
    );
  }
);

test(
  "email reservation collection cannot be listed by regular user",

  async () => {
    await bootstrapUser(
      "email-list-user",
      "email-list@example.com"
    );

    const db =
      userDb(
        "email-list-user",
        "email-list@example.com"
      );

    await assertFails(
      getDocs(
        collection(
          db,
          "profileEmails"
        )
      )
    );
  }
);

test(
  "same verified email cannot be registered to a second Firebase UID",

  async () => {
    const email =
      "unique-email@example.com";

    await bootstrapUser(
      "email-owner",
      email
    );

    await assertFails(
      bootstrapUser(
        "email-attacker",
        email
      )
    );
  }
);

test(
  "email reservation cannot be modified after creation",

  async () => {
    const uid =
      "email-immutable-user";

    const email =
      "email-immutable@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileEmails",
          email
        ),
        {
          uid:
            "another-user"
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          db,
          "profileEmails",
          email
        )
      )
    );
  }
);

/* =========================================================
   MOBILE NUMBER

   Mobile is NOT globally unique.
========================================================= */

test(
  "owner can save valid Bangladesh mobile number",

  async () => {
    const uid =
      "mobile-user";

    const email =
      "mobile-user@example.com";

    await bootstrapUser(
      uid,
      email
    );

    await assertSucceeds(
      saveMobile(
        uid,
        email,
        MOBILE_A
      )
    );

    const snapshot =
      await getDoc(
        doc(
          userDb(
            uid,
            email
          ),
          "profileUsers",
          uid
        )
      );

    assert.equal(
      snapshot
        .data()
        .mobileNumber,
      MOBILE_A
    );

    assert.equal(
      snapshot
        .data()
        .mobileAdded,
      true
    );

    assert.equal(
      snapshot
        .data()
        .mobileLocked,
      true
    );

    assert.equal(
      snapshot
        .data()
        .isMobileLocked,
      true
    );
  }
);

test(
  "same mobile number can be used by multiple different users",

  async () => {
    await bootstrapUser(
      "mobile-user-a",
      "mobile-user-a@example.com"
    );

    await bootstrapUser(
      "mobile-user-b",
      "mobile-user-b@example.com"
    );

    await assertSucceeds(
      saveMobile(
        "mobile-user-a",
        "mobile-user-a@example.com",
        MOBILE_A
      )
    );

    await assertSucceeds(
      saveMobile(
        "mobile-user-b",
        "mobile-user-b@example.com",
        MOBILE_A
      )
    );

    const first =
      await getDoc(
        doc(
          userDb(
            "mobile-user-a",
            "mobile-user-a@example.com"
          ),
          "profileUsers",
          "mobile-user-a"
        )
      );

    const second =
      await getDoc(
        doc(
          userDb(
            "mobile-user-b",
            "mobile-user-b@example.com"
          ),
          "profileUsers",
          "mobile-user-b"
        )
      );

    assert.equal(
      first
        .data()
        .mobileNumber,
      MOBILE_A
    );

    assert.equal(
      second
        .data()
        .mobileNumber,
      MOBILE_A
    );
  }
);

test(
  "mobile number cannot be changed after first save",

  async () => {
    const uid =
      "mobile-lock-user";

    const email =
      "mobile-lock@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await saveMobile(
      uid,
      email,
      MOBILE_A
    );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          mobileNumber:
            MOBILE_B,

          mobileAdded:
            true,

          mobileLocked:
            true,

          isMobileLocked:
            true,

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "saved mobile number cannot be removed",

  async () => {
    const uid =
      "mobile-remove-user";

    const email =
      "mobile-remove@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await saveMobile(
      uid,
      email,
      MOBILE_A
    );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          mobileNumber:
            "",

          mobileAdded:
            false,

          mobileLocked:
            false,

          isMobileLocked:
            false,

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "invalid Bangladesh mobile number is denied",

  async () => {
    const uid =
      "invalid-mobile-user";

    const email =
      "invalid-mobile@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    await assertFails(
      updateDoc(
        doc(
          db,
          "profileUsers",
          uid
        ),
        {
          mobileNumber:
            "+8801212345678",

          mobileAdded:
            true,

          mobileLocked:
            true,

          isMobileLocked:
            true,

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

/* =========================================================
   OFFER PAID — ADMIN ONLY
========================================================= */

test(
  "Admin can mark Offer Paid for an existing user",

  async () => {
    const uid =
      "offer-user";

    await bootstrapUser(
      uid,
      "offer-user@example.com"
    );

    await assertSucceeds(
      markOfferPaid(
        uid
      )
    );

    const snapshot =
      await getDoc(
        doc(
          adminDb(),
          "profileOfferStatus",
          uid
        )
      );

    assert.equal(
      snapshot.exists(),
      true
    );

    assert.equal(
      snapshot
        .data()
        .offerPaid,
      true
    );

    assert.equal(
      snapshot
        .data()
        .offerPaidByUid,
      ADMIN_UID
    );

    assert.equal(
      snapshot
        .data()
        .offerPaidByEmail,
      ADMIN_EMAIL
    );
  }
);

test(
  "Admin cannot mark Offer Paid for a missing Profile",

  async () => {
    await assertFails(
      markOfferPaid(
        "missing-profile-user"
      )
    );
  }
);

test(
  "regular user cannot create their own Offer Paid status",

  async () => {
    const uid =
      "self-offer-user";

    const email =
      "self-offer@example.com";

    const db =
      await bootstrapUser(
        uid,
        email
      );

    const now =
      serverTimestamp();

    await assertFails(
      setDoc(
        doc(
          db,
          "profileOfferStatus",
          uid
        ),
        {
          uid,

          offerPaid:
            true,

          offerPaidAt:
            now,

          offerPaidByUid:
            uid,

          offerPaidByEmail:
            email,

          createdAt:
            now,

          updatedAt:
            now,

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "user cannot read their own Offer Paid status",

  async () => {
    const uid =
      "hidden-offer-user";

    const email =
      "hidden-offer@example.com";

    await bootstrapUser(
      uid,
      email
    );

    await markOfferPaid(
      uid
    );

    await assertFails(
      getDoc(
        doc(
          userDb(
            uid,
            email
          ),
          "profileOfferStatus",
          uid
        )
      )
    );
  }
);

test(
  "another regular user cannot read Offer Paid status",

  async () => {
    await bootstrapUser(
      "offer-owner",
      "offer-owner@example.com"
    );

    await bootstrapUser(
      "offer-stranger",
      "offer-stranger@example.com"
    );

    await markOfferPaid(
      "offer-owner"
    );

    await assertFails(
      getDoc(
        doc(
          userDb(
            "offer-stranger",
            "offer-stranger@example.com"
          ),
          "profileOfferStatus",
          "offer-owner"
        )
      )
    );
  }
);

test(
  "regular user cannot list Offer Paid collection",

  async () => {
    await bootstrapUser(
      "offer-list-user",
      "offer-list-user@example.com"
    );

    await assertFails(
      getDocs(
        collection(
          userDb(
            "offer-list-user",
            "offer-list-user@example.com"
          ),
          "profileOfferStatus"
        )
      )
    );
  }
);

test(
  "Admin can list Offer Paid statuses",

  async () => {
    await bootstrapUser(
      "offer-paid-a",
      "offer-paid-a@example.com"
    );

    await bootstrapUser(
      "offer-paid-b",
      "offer-paid-b@example.com"
    );

    await markOfferPaid(
      "offer-paid-a"
    );

    await markOfferPaid(
      "offer-paid-b"
    );

    const snapshot =
      await assertSucceeds(
        getDocs(
          collection(
            adminDb(),
            "profileOfferStatus"
          )
        )
      );

    assert.equal(
      snapshot.size,
      2
    );
  }
);

test(
  "Offer Paid status cannot be reversed after Admin marks it paid",

  async () => {
    const uid =
      "offer-final-user";

    await bootstrapUser(
      uid,
      "offer-final-user@example.com"
    );

    await markOfferPaid(
      uid
    );

    await assertFails(
      updateDoc(
        doc(
          adminDb(),
          "profileOfferStatus",
          uid
        ),
        {
          offerPaid:
            false,

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "already-paid Offer status cannot be rewritten",

  async () => {
    const uid =
      "offer-rewrite-user";

    await bootstrapUser(
      uid,
      "offer-rewrite-user@example.com"
    );

    await markOfferPaid(
      uid
    );

    await assertFails(
      updateDoc(
        doc(
          adminDb(),
          "profileOfferStatus",
          uid
        ),
        {
          offerPaidAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),

          schemaVersion:
            SCHEMA_VERSION
        }
      )
    );
  }
);

test(
  "Offer Paid status cannot be deleted",

  async () => {
    const uid =
      "offer-delete-user";

    await bootstrapUser(
      uid,
      "offer-delete-user@example.com"
    );

    await markOfferPaid(
      uid
    );

    await assertFails(
      deleteDoc(
        doc(
          adminDb(),
          "profileOfferStatus",
          uid
        )
      )
    );
  }
);

test(
  "Offer Paid fields are not stored inside user Profile",

  async () => {
    const uid =
      "offer-profile-separation";

    const email =
      "offer-profile-separation@example.com";

    await bootstrapUser(
      uid,
      email
    );

    await markOfferPaid(
      uid
    );

    const profileSnapshot =
      await getDoc(
        doc(
          userDb(
            uid,
            email
          ),
          "profileUsers",
          uid
        )
      );

    const data =
      profileSnapshot.data();

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data,
        "offerPaid"
      ),
      false
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data,
        "offerPaidAt"
      ),
      false
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data,
        "offerPaidByUid"
      ),
      false
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data,
        "offerPaidByEmail"
      ),
      false
    );
  }
);

/* =========================================================
   REMOVED LEGACY ACCOUNT COLLECTIONS
========================================================= */

test(
  "removed legacy account collections are denied to regular users",

  async () => {
    const db =
      userDb(
        "legacy-user",
        "legacy-user@example.com"
      );

    const removedCollections = [
      "profileReferralCodes",
      "profileMobiles",
      "profileDevices",
      "profileReferrals",
      "profileReferralStats",
      "profileActivity",
      "profileActivitySessions",
      "profileWallets",
      "profileWalletTransactions",
      "profileRewardEvents",
      "profileWithdrawals",
      "profileAuditLogs",
      "profileSettings",
      "profileAdmins"
    ];

    for (
      const collectionName
      of removedCollections
    ) {
      await assertFails(
        getDoc(
          doc(
            db,
            collectionName,
            "sample"
          )
        )
      );

      await assertFails(
        setDoc(
          doc(
            db,
            collectionName,
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
  "removed legacy account collections are also denied to Admin",

  async () => {
    const db =
      adminDb();

    const removedCollections = [
      "profileReferralCodes",
      "profileMobiles",
      "profileDevices",
      "profileReferrals",
      "profileReferralStats",
      "profileActivity",
      "profileActivitySessions",
      "profileWallets",
      "profileWalletTransactions",
      "profileRewardEvents",
      "profileWithdrawals",
      "profileAuditLogs",
      "profileSettings",
      "profileAdmins"
    ];

    for (
      const collectionName
      of removedCollections
    ) {
      await assertFails(
        getDoc(
          doc(
            db,
            collectionName,
            "sample"
          )
        )
      );

      await assertFails(
        setDoc(
          doc(
            db,
            collectionName,
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