/* =========================================================
   11PLAY — FIREBASE SPARK CLIENT
   File: js/account/firebase/functions.client.js

   Production contract:
   - GitHub Pages + Firebase Spark only
   - Firebase Authentication + Cloud Firestore directly
   - No Cloud Functions dependency
   - No Firebase Storage dependency
   - Verified Google account required for Profile operations

   Account identity:
   - Firebase UID identifies the permanent 11Play account
   - Verified Google email must be unique
   - Google name, photo and email are synchronized automatically
   - Username is generated from the email part before "@"
   - Logout + login with the same Google account restores
     the same Firestore Profile document

   Mobile policy:
   - User submits mobile number manually
   - Bangladesh mobile format is validated
   - Mobile number does NOT need to be unique
   - Multiple users may use the same mobile number
   - Once saved on a Profile, the user cannot change it

   Offer policy:
   - Offer Paid status is NOT stored inside profileUsers
   - It is stored separately in profileOfferStatus
   - User-side Profile code never receives Offer Paid status
   - Only the authorized Admin can read/write Offer Paid status

   Current supported operations:
   - ensureProfile
   - getMyProfile
   - saveMobileNumber

   - getAdminSession
   - getAdminDashboardSummary
   - getAdminUsers
   - getAdminUserDetails
   - markOfferPaid

   Collections:
   - profileUsers
   - profileEmails
   - profileOfferStatus

   Important:
   - Firestore Security Rules remain the final security boundary.
   - Referral, reward, wallet, withdrawal, activity and
     device-binding systems are not part of this client.
   - No private Profile data is stored in localStorage.
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const COMPATIBILITY_REGION =
        "asia-south1";

    const ADMIN_EMAIL =
        "casinobuzzbd@gmail.com";

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const SCHEMA_VERSION =
        4;

    const COLLECTIONS =
        Object.freeze({
            USERS:
                "profileUsers",

            EMAILS:
                "profileEmails",

            OFFER_STATUS:
                "profileOfferStatus"
        });

    const FUNCTION_NAMES =
        Object.freeze({
            ENSURE_PROFILE:
                "ensureProfile",

            GET_MY_PROFILE:
                "getMyProfile",

            SAVE_MOBILE_NUMBER:
                "saveMobileNumber",

            GET_ADMIN_SESSION:
                "getAdminSession",

            GET_ADMIN_DASHBOARD_SUMMARY:
                "getAdminDashboardSummary",

            GET_ADMIN_USERS:
                "getAdminUsers",

            GET_ADMIN_USER_DETAILS:
                "getAdminUserDetails",

            MARK_OFFER_PAID:
                "markOfferPaid"
        });

    const PROFILE_STATUS =
        Object.freeze({
            ACTIVE:
                "active",

            SUSPENDED:
                "suspended",

            BLOCKED:
                "blocked"
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let firestoreInstance =
        null;

    let authInstance =
        null;

    let initialized =
        false;

    /* =====================================================
       CLIENT ERROR
    ===================================================== */

    class FunctionsClientError extends Error {
        constructor({
            code = "unknown",
            message =
                "The requested operation could not be completed.",
            details = null,
            functionName = ""
        } = {}) {
            super(message);

            this.name =
                "FunctionsClientError";

            this.code =
                String(
                    code ||
                    "unknown"
                );

            this.details =
                details;

            this.functionName =
                String(
                    functionName ||
                    ""
                );

            this.field =
                details &&
                typeof details ===
                    "object"
                    ? String(
                        details.field ||
                        ""
                    )
                    : "";

            Error.captureStackTrace?.(
                this,
                FunctionsClientError
            );
        }
    }

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(
                value
            );

        return (
            prototype ===
                Object.prototype ||
            prototype ===
                null
        );
    }

    function toSafeString(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .normalize("NFKC")
            .trim();
    }

    function normalizeEmail(value) {
        return toSafeString(
            value
        )
            .toLowerCase();
    }

    function toSafeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(
                value
            );

        return Number.isFinite(
            number
        )
            ? number
            : fallback;
    }

    function toPositiveInteger(
        value,
        fallback = 50,
        maximum = 100
    ) {
        const number =
            Math.floor(
                toSafeNumber(
                    value,
                    fallback
                )
            );

        return Math.min(
            maximum,
            Math.max(
                1,
                number ||
                fallback
            )
        );
    }

    function normalizePayload(
        payload
    ) {
        if (
            payload === null ||
            payload === undefined
        ) {
            return {};
        }

        if (
            !isPlainObject(
                payload
            )
        ) {
            throw clientError(
                "invalid-argument",
                "Operation data must be a plain object."
            );
        }

        return {
            ...payload
        };
    }

    function clientError(
        code,
        message,
        field = "",
        details = null
    ) {
        return new FunctionsClientError({
            code,
            message,

            details:
                details ||
                (
                    field
                        ? {
                            field
                        }
                        : null
                )
        });
    }

    function dispatchClientEvent(
        eventName,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail
                }
            )
        );
    }

    function normalizeError(
        error,
        functionName = ""
    ) {
        if (
            error instanceof
                FunctionsClientError
        ) {
            if (
                !error.functionName
            ) {
                error.functionName =
                    functionName;
            }

            return error;
        }

        const rawCode =
            toSafeString(
                error?.code
            )
                .replace(
                    /^functions\//,
                    ""
                )
                .replace(
                    /^firestore\//,
                    ""
                ) ||
            "unknown";

        const messages = {
            "permission-denied":
                "You do not have permission to complete this operation.",

            "unauthenticated":
                "Google sign-in is required.",

            "invalid-argument":
                "The submitted information is not valid.",

            "failed-precondition":
                "This operation is not available yet.",

            "already-exists":
                "This information has already been saved.",

            "not-found":
                "The requested information was not found.",

            "unavailable":
                "The service is temporarily unavailable. Please try again.",

            "deadline-exceeded":
                "The request took too long. Please try again.",

            "aborted":
                "The operation was interrupted. Please try again."
        };

        return new FunctionsClientError({
            code:
                rawCode,

            message:
                toSafeString(
                    error?.message
                ) ||
                messages[
                    rawCode
                ] ||
                "The requested operation could not be completed.",

            details:
                error?.details ||
                null,

            functionName
        });
    }

    function sanitizeId(
        value,
        field = "id"
    ) {
        const id =
            toSafeString(
                value
            );

        if (
            !id ||
            id.length >
                512 ||
            id.includes("/")
        ) {
            throw clientError(
                "invalid-argument",
                `A valid ${field} is required.`,
                field
            );
        }

        return id;
    }

    function sanitizeEmail(
        value
    ) {
        const email =
            normalizeEmail(
                value
            );

        if (
            !email ||
            email.length >
                320 ||
            !email.includes("@") ||
            email.startsWith("@") ||
            email.endsWith("@") ||
            email.includes("/")
        ) {
            throw clientError(
                "invalid-argument",
                "A valid Google email is required.",
                "email"
            );
        }

        return email;
    }

    /* =====================================================
       FIREBASE RESOLUTION
    ===================================================== */

    function assertFirebaseAvailable() {
        if (
            !window.firebase
        ) {
            throw clientError(
                "firebase-not-loaded",
                "Firebase SDK is not loaded."
            );
        }
    }

    function resolveFirestore() {
        if (
            firestoreInstance
        ) {
            return firestoreInstance;
        }

        assertFirebaseAvailable();

        firestoreInstance =
            window.FirebaseConfig
                ?.firestore ||
            window.firebaseDB ||
            null;

        if (
            !firestoreInstance &&
            typeof window.firebase
                .firestore ===
                "function"
        ) {
            firestoreInstance =
                window.firebase
                    .firestore();
        }

        if (
            !firestoreInstance ||
            typeof firestoreInstance
                .collection !==
                "function"
        ) {
            firestoreInstance =
                null;

            throw clientError(
                "firestore-not-ready",
                "Firebase Firestore is not available."
            );
        }

        return firestoreInstance;
    }

    function resolveAuth() {
        if (
            authInstance
        ) {
            return authInstance;
        }

        assertFirebaseAvailable();

        authInstance =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (
            !authInstance &&
            typeof window.firebase
                .auth ===
                "function"
        ) {
            authInstance =
                window.firebase
                    .auth();
        }

        if (
            !authInstance
        ) {
            throw clientError(
                "auth-not-ready",
                "Firebase Authentication is not available."
            );
        }

        return authInstance;
    }

    function getFieldValue() {
        assertFirebaseAvailable();

        const value =
            window.firebase
                ?.firestore
                ?.FieldValue;

        if (
            !value
        ) {
            throw clientError(
                "firestore-not-ready",
                "Firebase Firestore FieldValue is not available."
            );
        }

        return value;
    }

    function serverTimestamp() {
        return getFieldValue()
            .serverTimestamp();
    }

    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    function getProviderIds(user) {
        if (
            !user ||
            !Array.isArray(
                user.providerData
            )
        ) {
            return [];
        }

        return Array.from(
            new Set(
                user.providerData
                    .map(
                        provider =>
                            toSafeString(
                                provider
                                    ?.providerId
                            )
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    async function waitForAuthentication() {
        if (
            window.AuthService &&
            typeof window.AuthService
                .whenReady ===
                "function"
        ) {
            try {
                await window.AuthService
                    .whenReady();
            } catch (error) {
                console.warn(
                    "[FunctionsClient] Auth initialization warning.",
                    error
                );
            }
        }

        const user =
            resolveAuth()
                .currentUser ||
            null;

        if (
            !user?.uid
        ) {
            throw clientError(
                "unauthenticated",
                "Google sign-in is required."
            );
        }

        const email =
            sanitizeEmail(
                user.email
            );

        if (
            !email
        ) {
            throw clientError(
                "permission-denied",
                "A Google email is required."
            );
        }

        const providerIds =
            getProviderIds(
                user
            );

        if (
            !providerIds.includes(
                GOOGLE_PROVIDER_ID
            )
        ) {
            throw clientError(
                "permission-denied",
                "A Google-connected account is required."
            );
        }

        if (
            user.emailVerified !==
                true
        ) {
            throw clientError(
                "permission-denied",
                "A verified Google email is required."
            );
        }

        /*
         * A linked Google provider is not enough.
         * When token information is available, confirm that
         * the current sign-in session was established through
         * Google.
         */

        if (
            typeof user
                .getIdTokenResult ===
                "function"
        ) {
            let signInProvider =
                "";

            try {
                const tokenResult =
                    await user
                        .getIdTokenResult(
                            false
                        );

                signInProvider =
                    toSafeString(
                        tokenResult
                            ?.signInProvider ||
                        tokenResult
                            ?.claims
                            ?.firebase
                            ?.sign_in_provider
                    );
            } catch (error) {
                console.warn(
                    "[FunctionsClient] Google sign-in provider verification warning.",
                    error
                );
            }

            if (
                signInProvider &&
                signInProvider !==
                    GOOGLE_PROVIDER_ID
            ) {
                throw clientError(
                    "permission-denied",
                    "Sign in directly with Google to continue."
                );
            }
        }

        return user;
    }

    async function requireAdmin() {
        const user =
            await waitForAuthentication();

        if (
            normalizeEmail(
                user.email
            ) !==
                ADMIN_EMAIL
        ) {
            throw clientError(
                "permission-denied",
                "Admin access is required."
            );
        }

        return user;
    }

    /* =====================================================
       DATE HELPERS
    ===================================================== */

    function resolveDate(value) {
        if (
            !value
        ) {
            return null;
        }

        if (
            typeof value.toDate ===
                "function"
        ) {
            try {
                return value
                    .toDate();
            } catch {
                return null;
            }
        }

        if (
            typeof value.toMillis ===
                "function"
        ) {
            try {
                return new Date(
                    value.toMillis()
                );
            } catch {
                return null;
            }
        }

        if (
            value instanceof
                Date
        ) {
            return Number.isNaN(
                value.getTime()
            )
                ? null
                : value;
        }

        if (
            Number.isFinite(
                value?.seconds
            )
        ) {
            const date =
                new Date(
                    value.seconds *
                        1000
                );

            return Number.isNaN(
                date.getTime()
            )
                ? null
                : date;
        }

        const date =
            new Date(
                value
            );

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function firebaseMetadataDate(
        value
    ) {
        return resolveDate(
            value
        );
    }

    /* =====================================================
       SERIALIZATION
    ===================================================== */

    function isServerTimestampSentinel(
        value
    ) {
        if (
            !value ||
            typeof value !==
                "object"
        ) {
            return false;
        }

        return toSafeString(
            value?._methodName
        )
            .toLowerCase()
            .includes(
                "servertimestamp"
            );
    }

    function serializeValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            isServerTimestampSentinel(
                value
            )
        ) {
            return new Date()
                .toISOString();
        }

        if (
            typeof value.toDate ===
                "function"
        ) {
            try {
                return value
                    .toDate()
                    .toISOString();
            } catch {
                return null;
            }
        }

        if (
            typeof value.toMillis ===
                "function"
        ) {
            try {
                return new Date(
                    value.toMillis()
                )
                    .toISOString();
            } catch {
                return null;
            }
        }

        if (
            value instanceof
                Date
        ) {
            return Number.isNaN(
                value.getTime()
            )
                ? null
                : value
                    .toISOString();
        }

        if (
            Array.isArray(
                value
            )
        ) {
            return value.map(
                serializeValue
            );
        }

        if (
            isPlainObject(
                value
            )
        ) {
            const output =
                {};

            Object.entries(
                value
            )
                .forEach(
                    ([
                        key,
                        nestedValue
                    ]) => {
                        output[
                            key
                        ] =
                            serializeValue(
                                nestedValue
                            );
                    }
                );

            return output;
        }

        return value;
    }

    /* =====================================================
       PROFILE HELPERS
    ===================================================== */

    function getUsernameFromEmail(
        email
    ) {
        const normalizedEmail =
            normalizeEmail(
                email
            );

        const separatorIndex =
            normalizedEmail
                .indexOf(
                    "@"
                );

        if (
            separatorIndex <=
                0
        ) {
            return "user";
        }

        return normalizedEmail
            .slice(
                0,
                separatorIndex
            );
    }

    function normalizeMobileNumber(
        value
    ) {
        let mobileNumber =
            toSafeString(
                value
            )
                .replace(
                    /[\s\-()]/g,
                    ""
                );

        if (
            /^1[3-9]\d{8}$/
                .test(
                    mobileNumber
                )
        ) {
            mobileNumber =
                `+880${mobileNumber}`;
        } else if (
            /^01[3-9]\d{8}$/
                .test(
                    mobileNumber
                )
        ) {
            mobileNumber =
                `+88${mobileNumber}`;
        } else if (
            /^8801[3-9]\d{8}$/
                .test(
                    mobileNumber
                )
        ) {
            mobileNumber =
                `+${mobileNumber}`;
        }

        if (
            !/^\+8801[3-9]\d{8}$/
                .test(
                    mobileNumber
                )
        ) {
            throw clientError(
                "invalid-argument",
                "Enter a valid Bangladesh mobile number.",
                "mobileNumber"
            );
        }

        return mobileNumber;
    }

    function isValidMobileNumber(
        value
    ) {
        return /^\+8801[3-9]\d{8}$/
            .test(
                toSafeString(
                    value
                )
            );
    }

    function isActiveProfile(
        profile
    ) {
        const status =
            toSafeString(
                profile?.status
            ) ||
            PROFILE_STATUS.ACTIVE;

        return status ===
            PROFILE_STATUS.ACTIVE;
    }

    function createProviderIds(
        user
    ) {
        const providerIds =
            getProviderIds(
                user
            );

        return providerIds.length
            ? providerIds
            : [
                GOOGLE_PROVIDER_ID
            ];
    }

    function getRegistrationDateFromAuth(
        user
    ) {
        return firebaseMetadataDate(
            user
                ?.metadata
                ?.creationTime ||
            user
                ?.metadata
                ?.createdAt ||
            null
        );
    }

    function getLastLoginFromAuth(
        user
    ) {
        return firebaseMetadataDate(
            user
                ?.metadata
                ?.lastSignInTime ||
            user
                ?.metadata
                ?.lastLoginAt ||
            null
        );
    }

    /* =====================================================
       USER PROFILE PROJECTION

       Important:
       Offer Paid information intentionally DOES NOT exist
       in this projection.

       User-side code receives Profile information only.
    ===================================================== */

    function projectProfile(
        data,
        id = ""
    ) {
        const source =
            data ||
            {};

        const uid =
            toSafeString(
                source.uid ||
                id
            );

        const email =
            normalizeEmail(
                source.email
            );

        const displayName =
            toSafeString(
                source.displayName ||
                source.name
            );

        const photoURL =
            toSafeString(
                source.photoURL ||
                source.photo
            );

        const mobileNumber =
            isValidMobileNumber(
                source.mobileNumber
            )
                ? toSafeString(
                    source.mobileNumber
                )
                : "";

        const googleConnected =
            source
                .isGoogleConnected ===
                true ||
            source
                .googleConnected ===
                true ||
            (
                Array.isArray(
                    source.providerIds
                ) &&
                source.providerIds
                    .includes(
                        GOOGLE_PROVIDER_ID
                    )
            );

        return serializeValue({
            id:
                id ||
                uid,

            uid,

            name:
                displayName,

            displayName,

            username:
                getUsernameFromEmail(
                    email
                ),

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                source.emailVerified ===
                true,

            providerIds:
                Array.isArray(
                    source.providerIds
                )
                    ? Array.from(
                        new Set(
                            source
                                .providerIds
                                .map(
                                    toSafeString
                                )
                                .filter(
                                    Boolean
                                )
                        )
                    )
                    : [],

            isGoogleConnected:
                googleConnected,

            googleConnected,

            isGoogleSignIn:
                source.isGoogleSignIn ===
                    true,

            isAuthenticated:
                Boolean(
                    uid
                ),

            authenticated:
                Boolean(
                    uid
                ),

            accountType:
                toSafeString(
                    source.accountType
                ) ||
                "google",

            mobileNumber,

            mobileAdded:
                source.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked:
                source.mobileLocked ===
                    true ||
                source.isMobileLocked ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            isMobileLocked:
                source.isMobileLocked ===
                    true ||
                source.mobileLocked ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            registrationDate:
                source.registrationDate ||
                source.createdAt ||
                null,

            createdAt:
                source.createdAt ||
                source.registrationDate ||
                null,

            lastLogin:
                source.lastLogin ||
                source.lastLoginAt ||
                null,

            lastLoginAt:
                source.lastLoginAt ||
                source.lastLogin ||
                null,

            status:
                toSafeString(
                    source.status
                ) ||
                PROFILE_STATUS.ACTIVE,

            schemaVersion:
                SCHEMA_VERSION
        });
    }

    /* =====================================================
       ADMIN OFFER STATUS PROJECTION
    ===================================================== */

    function projectOfferStatus(
        data,
        uid = ""
    ) {
        const source =
            data ||
            {};

        return serializeValue({
            uid:
                toSafeString(
                    source.uid ||
                    uid
                ),

            offerPaid:
                source.offerPaid ===
                    true,

            offerPaidAt:
                source.offerPaidAt ||
                null,

            offerPaidByUid:
                toSafeString(
                    source.offerPaidByUid
                ),

            offerPaidByEmail:
                normalizeEmail(
                    source.offerPaidByEmail
                )
        });
    }

    /* =====================================================
       ADMIN USER PROJECTION

       Admin-only projection combines Profile data with
       profileOfferStatus data.
    ===================================================== */

    function projectAdminUser(
        profileData,
        id = "",
        offerStatusData = null
    ) {
        const profile =
            projectProfile(
                profileData,
                id
            );

        const offerStatus =
            projectOfferStatus(
                offerStatusData,
                profile.uid
            );

        return {
            uid:
                profile.uid,

            name:
                profile.name,

            displayName:
                profile.displayName,

            username:
                profile.username,

            email:
                profile.email,

            photo:
                profile.photo,

            photoURL:
                profile.photoURL,

            emailVerified:
                profile.emailVerified,

            mobileNumber:
                profile.mobileNumber,

            mobileAdded:
                profile.mobileAdded,

            registrationDate:
                profile.registrationDate,

            createdAt:
                profile.createdAt,

            lastLogin:
                profile.lastLogin,

            lastLoginAt:
                profile.lastLoginAt,

            accountType:
                profile.accountType,

            status:
                profile.status,

            offerPaid:
                offerStatus.offerPaid,

            offerPaidAt:
                offerStatus.offerPaidAt,

            offerPaidByUid:
                offerStatus.offerPaidByUid,

            offerPaidByEmail:
                offerStatus.offerPaidByEmail
        };
    }

    /* =====================================================
       FIRESTORE REFERENCES
    ===================================================== */

    function getUserReference(
        uid
    ) {
        const normalizedUid =
            sanitizeId(
                uid,
                "userId"
            );

        return resolveFirestore()
            .collection(
                COLLECTIONS.USERS
            )
            .doc(
                normalizedUid
            );
    }

    function getEmailReference(
        email
    ) {
        const normalizedEmail =
            sanitizeEmail(
                email
            );

        return resolveFirestore()
            .collection(
                COLLECTIONS.EMAILS
            )
            .doc(
                normalizedEmail
            );
    }

    function getOfferStatusReference(
        uid
    ) {
        const normalizedUid =
            sanitizeId(
                uid,
                "userId"
            );

        return resolveFirestore()
            .collection(
                COLLECTIONS
                    .OFFER_STATUS
            )
            .doc(
                normalizedUid
            );
    }

    /* =====================================================
       PROFILE CREATION DATA
    ===================================================== */

    function createProfileData(
        user,
        timestamp
    ) {
        const email =
            sanitizeEmail(
                user.email
            );

        const username =
            getUsernameFromEmail(
                email
            );

        const displayName =
            toSafeString(
                user.displayName
            ) ||
            username;

        const photoURL =
            toSafeString(
                user.photoURL
            );

        const registrationDate =
            getRegistrationDateFromAuth(
                user
            );

        const lastLogin =
            getLastLoginFromAuth(
                user
            );

        return {
            uid:
                user.uid,

            name:
                displayName,

            displayName,

            username,

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                user.emailVerified ===
                    true,

            providerIds:
                createProviderIds(
                    user
                ),

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
                registrationDate ||
                timestamp,

            createdAt:
                timestamp,

            lastLogin:
                lastLogin ||
                timestamp,

            lastLoginAt:
                lastLogin ||
                timestamp,

            updatedAt:
                timestamp,

            status:
                PROFILE_STATUS.ACTIVE,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    /* =====================================================
       PROFILE REFRESH DATA

       Google-controlled fields are synchronized each time.

       Registration date and mobile number are intentionally
       not modified here.
    ===================================================== */

    function createProfileRefreshPatch(
        user,
        existingProfile,
        timestamp
    ) {
        const email =
            sanitizeEmail(
                user.email
            );

        const username =
            getUsernameFromEmail(
                email
            );

        const displayName =
            toSafeString(
                user.displayName
            ) ||
            username;

        const photoURL =
            toSafeString(
                user.photoURL
            );

        const lastLogin =
            getLastLoginFromAuth(
                user
            );

        return {
            name:
                displayName,

            displayName,

            username,

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                user.emailVerified ===
                    true,

            providerIds:
                createProviderIds(
                    user
                ),

            googleConnected:
                true,

            isGoogleConnected:
                true,

            isGoogleSignIn:
                true,

            accountType:
                "google",

            lastLogin:
                lastLogin ||
                timestamp,

            lastLoginAt:
                lastLogin ||
                timestamp,

            updatedAt:
                timestamp,

            status:
                toSafeString(
                    existingProfile
                        ?.status
                ) ||
                PROFILE_STATUS.ACTIVE,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    /* =====================================================
       EMAIL RESERVATION DATA
    ===================================================== */

    function createEmailReservationData(
        user,
        timestamp
    ) {
        const email =
            sanitizeEmail(
                user.email
            );

        return {
            email,

            uid:
                user.uid,

            userId:
                user.uid,

            provider:
                GOOGLE_PROVIDER_ID,

            createdAt:
                timestamp,

            schemaVersion:
                SCHEMA_VERSION
        };
    }

    /* =====================================================
       ENSURE PROFILE

       Transaction responsibilities:
       1. Validate authenticated Google account.
       2. Reserve verified email uniquely.
       3. Create Profile if missing.
       4. Restore/update same Profile on later logins.
       5. Preserve registration/mobile data.
    ===================================================== */

    async function ensureProfile() {
        const user =
            await waitForAuthentication();

        const email =
            sanitizeEmail(
                user.email
            );

        const db =
            resolveFirestore();

        const profileRef =
            getUserReference(
                user.uid
            );

        const emailRef =
            getEmailReference(
                email
            );

        try {
            const result =
                await db
                    .runTransaction(
                        async transaction => {
                            /*
                             * All transaction reads occur before
                             * any transaction writes.
                             */

                            const profileSnapshot =
                                await transaction
                                    .get(
                                        profileRef
                                    );

                            const emailSnapshot =
                                await transaction
                                    .get(
                                        emailRef
                                    );

                            const timestamp =
                                serverTimestamp();

                            /*
                             * Enforce one verified Google email
                             * -> one Firebase UID -> one Profile.
                             */

                            if (
                                emailSnapshot
                                    .exists
                            ) {
                                const reservedEmail =
                                    emailSnapshot
                                        .data() ||
                                    {};

                                const reservedUid =
                                    toSafeString(
                                        reservedEmail
                                            .uid ||
                                        reservedEmail
                                            .userId
                                    );

                                if (
                                    reservedUid &&
                                    reservedUid !==
                                        user.uid
                                ) {
                                    throw clientError(
                                        "already-exists",
                                        "This Google email is already linked to another 11Play account.",
                                        "email"
                                    );
                                }
                            }

                            if (
                                !profileSnapshot
                                    .exists
                            ) {
                                const profile =
                                    createProfileData(
                                        user,
                                        timestamp
                                    );

                                transaction.set(
                                    profileRef,
                                    profile
                                );

                                if (
                                    !emailSnapshot
                                        .exists
                                ) {
                                    transaction.set(
                                        emailRef,
                                        createEmailReservationData(
                                            user,
                                            timestamp
                                        )
                                    );
                                }

                                return {
                                    created:
                                        true,

                                    updated:
                                        false,

                                    profile
                                };
                            }

                            const existingProfile =
                                profileSnapshot
                                    .data() ||
                                {};

                            if (
                                !isActiveProfile(
                                    existingProfile
                                )
                            ) {
                                throw clientError(
                                    "permission-denied",
                                    "This profile is not active."
                                );
                            }

                            /*
                             * A previously-created Profile cannot
                             * silently switch to another email.
                             *
                             * This protects the permanent identity
                             * of the 11Play account.
                             */

                            const existingEmail =
                                normalizeEmail(
                                    existingProfile
                                        .email
                                );

                            if (
                                existingEmail &&
                                existingEmail !==
                                    email
                            ) {
                                throw clientError(
                                    "failed-precondition",
                                    "The Google email does not match this 11Play account.",
                                    "email"
                                );
                            }

                            const patch =
                                createProfileRefreshPatch(
                                    user,
                                    existingProfile,
                                    timestamp
                                );

                            transaction.update(
                                profileRef,
                                patch
                            );

                            /*
                             * Migration support:
                             * Older Profiles may exist without
                             * profileEmails reservation.
                             */

                            if (
                                !emailSnapshot
                                    .exists
                            ) {
                                transaction.set(
                                    emailRef,
                                    createEmailReservationData(
                                        user,
                                        timestamp
                                    )
                                );
                            }

                            return {
                                created:
                                    false,

                                updated:
                                    true,

                                profile: {
                                    ...existingProfile,
                                    ...patch
                                }
                            };
                        }
                    );

            const response = {
                success:
                    true,

                created:
                    result.created ===
                        true,

                updated:
                    result.updated ===
                        true,

                profile:
                    projectProfile(
                        result.profile,
                        user.uid
                    )
            };

            dispatchClientEvent(
                "profile:ensured",
                {
                    result:
                        response
                }
            );

            return response;
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .ENSURE_PROFILE
            );
        }
    }

    /* =====================================================
       GET CURRENT PROFILE
    ===================================================== */

    async function getMyProfile() {
        const user =
            await waitForAuthentication();

        const profileRef =
            getUserReference(
                user.uid
            );

        try {
            let snapshot =
                await profileRef
                    .get();

            if (
                !snapshot.exists
            ) {
                await ensureProfile();

                snapshot =
                    await profileRef
                        .get();
            }

            if (
                !snapshot.exists
            ) {
                throw clientError(
                    "not-found",
                    "Profile was not found."
                );
            }

            const profile =
                snapshot.data() ||
                {};

            if (
                !isActiveProfile(
                    profile
                )
            ) {
                throw clientError(
                    "permission-denied",
                    "This profile is not active."
                );
            }

            const storedEmail =
                normalizeEmail(
                    profile.email
                );

            const currentEmail =
                normalizeEmail(
                    user.email
                );

            if (
                storedEmail &&
                storedEmail !==
                    currentEmail
            ) {
                throw clientError(
                    "permission-denied",
                    "The authenticated Google account does not match this Profile."
                );
            }

            return {
                success:
                    true,

                profile:
                    projectProfile(
                        profile,
                        snapshot.id
                    )
            };
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .GET_MY_PROFILE
            );
        }
    }

    /* =====================================================
       SAVE MOBILE NUMBER

       Important:
       - Mobile is NOT unique.
       - No profileMobiles collection exists.
       - Another user may use the same mobile.
       - User can save mobile only once on their own Profile.
    ===================================================== */

    async function saveMobileNumber(
        mobileNumber
    ) {
        const user =
            await waitForAuthentication();

        const normalizedMobile =
            normalizeMobileNumber(
                mobileNumber
            );

        const db =
            resolveFirestore();

        const profileRef =
            getUserReference(
                user.uid
            );

        try {
            const result =
                await db
                    .runTransaction(
                        async transaction => {
                            const profileSnapshot =
                                await transaction
                                    .get(
                                        profileRef
                                    );

                            if (
                                !profileSnapshot
                                    .exists
                            ) {
                                throw clientError(
                                    "not-found",
                                    "Profile was not found."
                                );
                            }

                            const profile =
                                profileSnapshot
                                    .data() ||
                                {};

                            if (
                                !isActiveProfile(
                                    profile
                                )
                            ) {
                                throw clientError(
                                    "permission-denied",
                                    "This profile is not active."
                                );
                            }

                            const existingMobile =
                                isValidMobileNumber(
                                    profile
                                        .mobileNumber
                                )
                                    ? toSafeString(
                                        profile
                                            .mobileNumber
                                    )
                                    : "";

                            /*
                             * Mobile number is permanent once
                             * submitted by this user.
                             *
                             * It is NOT globally unique.
                             */

                            if (
                                existingMobile &&
                                existingMobile !==
                                    normalizedMobile
                            ) {
                                throw clientError(
                                    "failed-precondition",
                                    "The mobile number has already been permanently saved.",
                                    "mobileNumber"
                                );
                            }

                            if (
                                existingMobile ===
                                    normalizedMobile
                            ) {
                                return {
                                    changed:
                                        false,

                                    duplicate:
                                        true,

                                    profile
                                };
                            }

                            const timestamp =
                                serverTimestamp();

                            const profilePatch = {
                                mobileNumber:
                                    normalizedMobile,

                                mobileAdded:
                                    true,

                                mobileLocked:
                                    true,

                                isMobileLocked:
                                    true,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            };

                            transaction.update(
                                profileRef,
                                profilePatch
                            );

                            return {
                                changed:
                                    true,

                                duplicate:
                                    false,

                                profile: {
                                    ...profile,
                                    ...profilePatch
                                }
                            };
                        }
                    );

            const response = {
                success:
                    true,

                changed:
                    result.changed ===
                        true,

                duplicate:
                    result.duplicate ===
                        true,

                mobileNumber:
                    normalizedMobile,

                profile:
                    projectProfile(
                        result.profile,
                        user.uid
                    )
            };

            dispatchClientEvent(
                "profile:mobile-saved",
                {
                    result:
                        response,

                    uid:
                        user.uid
                }
            );

            return response;
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .SAVE_MOBILE_NUMBER
            );
        }
    }

    /* =====================================================
       ADMIN SESSION
    ===================================================== */

    async function getAdminSession() {
        const admin =
            await requireAdmin();

        return {
            success:
                true,

            admin: {
                uid:
                    admin.uid,

                email:
                    normalizeEmail(
                        admin.email
                    ),

                displayName:
                    toSafeString(
                        admin.displayName
                    ) ||
                    "Admin",

                name:
                    toSafeString(
                        admin.displayName
                    ) ||
                    "Admin",

                photoURL:
                    toSafeString(
                        admin.photoURL
                    ),

                role:
                    "admin",

                isAdmin:
                    true
            }
        };
    }

    /* =====================================================
       ADMIN DASHBOARD SUMMARY
    ===================================================== */

    async function getAdminDashboardSummary() {
        await requireAdmin();

        const db =
            resolveFirestore();

        try {
            const [
                usersSnapshot,
                offerStatusSnapshot
            ] =
                await Promise.all([
                    db
                        .collection(
                            COLLECTIONS.USERS
                        )
                        .get(),

                    db
                        .collection(
                            COLLECTIONS
                                .OFFER_STATUS
                        )
                        .get()
                ]);

            const summary = {
                users: {
                    total:
                        0,

                    active:
                        0,

                    suspended:
                        0,

                    blocked:
                        0
                },

                offers: {
                    paid:
                        0
                }
            };

            usersSnapshot.forEach(
                documentSnapshot => {
                    const profile =
                        documentSnapshot
                            .data() ||
                        {};

                    const status =
                        toSafeString(
                            profile.status
                        ) ||
                        PROFILE_STATUS
                            .ACTIVE;

                    summary.users.total +=
                        1;

                    if (
                        status ===
                            PROFILE_STATUS
                                .SUSPENDED
                    ) {
                        summary.users
                            .suspended +=
                            1;
                    } else if (
                        status ===
                            PROFILE_STATUS
                                .BLOCKED
                    ) {
                        summary.users
                            .blocked +=
                            1;
                    } else {
                        summary.users
                            .active +=
                            1;
                    }
                }
            );

            offerStatusSnapshot.forEach(
                documentSnapshot => {
                    const offerStatus =
                        documentSnapshot
                            .data() ||
                        {};

                    if (
                        offerStatus
                            .offerPaid ===
                            true
                    ) {
                        summary.offers
                            .paid +=
                            1;
                    }
                }
            );

            return {
                success:
                    true,

                summary
            };
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .GET_ADMIN_DASHBOARD_SUMMARY
            );
        }
    }

    /* =====================================================
       ADMIN USER PAGINATION
    ===================================================== */

    async function getAdminUsers(
        payload = {}
    ) {
        await requireAdmin();

        const db =
            resolveFirestore();

        const collection =
            db.collection(
                COLLECTIONS.USERS
            );

        const limit =
            toPositiveInteger(
                payload.limit,
                50,
                100
            );

        const cursor =
            toSafeString(
                payload.cursor
            );

        try {
            let query =
                collection.orderBy(
                    "registrationDate",
                    "desc"
                );

            if (
                cursor
            ) {
                const cursorSnapshot =
                    await collection
                        .doc(
                            sanitizeId(
                                cursor,
                                "cursor"
                            )
                        )
                        .get();

                if (
                    cursorSnapshot
                        .exists
                ) {
                    query =
                        query.startAfter(
                            cursorSnapshot
                        );
                }
            }

            const snapshot =
                await query
                    .limit(
                        limit +
                            1
                    )
                    .get();

            const hasMore =
                snapshot.docs.length >
                    limit;

            const visibleDocuments =
                hasMore
                    ? snapshot.docs
                        .slice(
                            0,
                            limit
                        )
                    : snapshot.docs;

            /*
             * Offer status is stored separately so ordinary
             * users can never receive it with their Profile.
             *
             * Admin joins the data here.
             */

            const offerSnapshots =
                await Promise.all(
                    visibleDocuments
                        .map(
                            documentSnapshot =>
                                getOfferStatusReference(
                                    documentSnapshot
                                        .id
                                )
                                    .get()
                        )
                );

            const users =
                visibleDocuments
                    .map(
                        (
                            documentSnapshot,
                            index
                        ) => {
                            const offerSnapshot =
                                offerSnapshots[
                                    index
                                ];

                            return projectAdminUser(
                                documentSnapshot
                                    .data() ||
                                    {},

                                documentSnapshot
                                    .id,

                                offerSnapshot
                                    ?.exists
                                    ? offerSnapshot
                                        .data()
                                    : null
                            );
                        }
                    );

            return {
                success:
                    true,

                users,

                count:
                    users.length,

                hasMore,

                nextCursor:
                    hasMore &&
                    visibleDocuments
                        .length
                        ? visibleDocuments[
                            visibleDocuments
                                .length -
                            1
                        ].id
                        : ""
            };
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .GET_ADMIN_USERS
            );
        }
    }

    /* =====================================================
       ADMIN USER DETAILS
    ===================================================== */

    async function getAdminUserDetails(
        payload = {}
    ) {
        await requireAdmin();

        const userId =
            sanitizeId(
                payload.userId ||
                    payload.uid,
                "userId"
            );

        const db =
            resolveFirestore();

        try {
            const [
                profileSnapshot,
                offerSnapshot
            ] =
                await Promise.all([
                    getUserReference(
                        userId
                    )
                        .get(),

                    getOfferStatusReference(
                        userId
                    )
                        .get()
                ]);

            if (
                !profileSnapshot
                    .exists
            ) {
                throw clientError(
                    "not-found",
                    "User profile was not found."
                );
            }

            return {
                success:
                    true,

                user:
                    projectAdminUser(
                        profileSnapshot
                            .data() ||
                            {},

                        profileSnapshot
                            .id,

                        offerSnapshot
                            .exists
                            ? offerSnapshot
                                .data()
                            : null
                    )
            };
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .GET_ADMIN_USER_DETAILS
            );
        }
    }

    /* =====================================================
       ADMIN — MARK OFFER PAID

       This is the only Offer write operation.

       Important:
       - User Profile document is NOT modified.
       - Status is written to profileOfferStatus/{uid}.
       - Ordinary users must have no Firestore read/write
         access to this collection.
       - Paid status is permanent through this client.
    ===================================================== */

    async function markOfferPaid(
        payload = {}
    ) {
        const admin =
            await requireAdmin();

        const userId =
            sanitizeId(
                payload.userId ||
                    payload.uid,
                "userId"
            );

        const db =
            resolveFirestore();

        const profileRef =
            getUserReference(
                userId
            );

        const offerStatusRef =
            getOfferStatusReference(
                userId
            );

        try {
            const result =
                await db
                    .runTransaction(
                        async transaction => {
                            const profileSnapshot =
                                await transaction
                                    .get(
                                        profileRef
                                    );

                            const offerStatusSnapshot =
                                await transaction
                                    .get(
                                        offerStatusRef
                                    );

                            if (
                                !profileSnapshot
                                    .exists
                            ) {
                                throw clientError(
                                    "not-found",
                                    "User profile was not found.",
                                    "userId"
                                );
                            }

                            if (
                                offerStatusSnapshot
                                    .exists
                            ) {
                                const existingStatus =
                                    offerStatusSnapshot
                                        .data() ||
                                    {};

                                if (
                                    existingStatus
                                        .offerPaid ===
                                        true
                                ) {
                                    return {
                                        changed:
                                            false,

                                        alreadyPaid:
                                            true,

                                        status:
                                            existingStatus
                                    };
                                }
                            }

                            const timestamp =
                                serverTimestamp();

                            const offerStatus = {
                                uid:
                                    userId,

                                offerPaid:
                                    true,

                                offerPaidAt:
                                    timestamp,

                                offerPaidByUid:
                                    admin.uid,

                                offerPaidByEmail:
                                    normalizeEmail(
                                        admin.email
                                    ),

                                createdAt:
                                    offerStatusSnapshot
                                        .exists
                                        ? (
                                            offerStatusSnapshot
                                                .data()
                                                ?.createdAt ||
                                            timestamp
                                        )
                                        : timestamp,

                                updatedAt:
                                    timestamp,

                                schemaVersion:
                                    SCHEMA_VERSION
                            };

                            transaction.set(
                                offerStatusRef,
                                offerStatus,
                                {
                                    merge:
                                        true
                                }
                            );

                            return {
                                changed:
                                    true,

                                alreadyPaid:
                                    false,

                                status:
                                    offerStatus
                            };
                        }
                    );

            const response = {
                success:
                    true,

                changed:
                    result.changed ===
                        true,

                alreadyPaid:
                    result.alreadyPaid ===
                        true,

                userId,

                offerStatus:
                    projectOfferStatus(
                        result.status,
                        userId
                    )
            };

            dispatchClientEvent(
                "admin:offer-paid",
                {
                    result:
                        response,

                    userId
                }
            );

            return response;
        } catch (error) {
            throw normalizeError(
                error,
                FUNCTION_NAMES
                    .MARK_OFFER_PAID
            );
        }
    }

    /* =====================================================
       LOCAL OPERATION ROUTER
    ===================================================== */

    const LOCAL_HANDLERS =
        Object.freeze({
            [FUNCTION_NAMES
                .ENSURE_PROFILE]:
                () =>
                    ensureProfile(),

            [FUNCTION_NAMES
                .GET_MY_PROFILE]:
                () =>
                    getMyProfile(),

            [FUNCTION_NAMES
                .SAVE_MOBILE_NUMBER]:
                payload =>
                    saveMobileNumber(
                        payload
                            .mobileNumber
                    ),

            [FUNCTION_NAMES
                .GET_ADMIN_SESSION]:
                () =>
                    getAdminSession(),

            [FUNCTION_NAMES
                .GET_ADMIN_DASHBOARD_SUMMARY]:
                () =>
                    getAdminDashboardSummary(),

            [FUNCTION_NAMES
                .GET_ADMIN_USERS]:
                payload =>
                    getAdminUsers(
                        payload
                    ),

            [FUNCTION_NAMES
                .GET_ADMIN_USER_DETAILS]:
                payload =>
                    getAdminUserDetails(
                        payload
                    ),

            [FUNCTION_NAMES
                .MARK_OFFER_PAID]:
                payload =>
                    markOfferPaid(
                        payload
                    )
        });

    /* =====================================================
       GENERIC CALL
    ===================================================== */

    async function call(
        functionName,
        payload = {},
        options = {}
    ) {
        const normalizedFunctionName =
            toSafeString(
                functionName
            );

        if (
            !normalizedFunctionName
        ) {
            throw clientError(
                "invalid-argument",
                "Operation name is required."
            );
        }

        const handler =
            LOCAL_HANDLERS[
                normalizedFunctionName
            ];

        if (
            typeof handler !==
                "function"
        ) {
            throw clientError(
                "not-found",
                `Unsupported operation: ${normalizedFunctionName}`
            );
        }

        const normalizedPayload =
            normalizePayload(
                payload
            );

        const requireAuth =
            options.requireAuth !==
                false;

        try {
            if (
                requireAuth
            ) {
                await waitForAuthentication();
            }

            dispatchClientEvent(
                "profile:function-started",
                {
                    functionName:
                        normalizedFunctionName,

                    payload:
                        normalizedPayload,

                    requireAuth,

                    transport:
                        "firestore"
                }
            );

            const data =
                await handler(
                    normalizedPayload
                );

            dispatchClientEvent(
                "profile:function-success",
                {
                    functionName:
                        normalizedFunctionName,

                    data,

                    transport:
                        "firestore"
                }
            );

            return data;
        } catch (error) {
            const normalizedError =
                normalizeError(
                    error,
                    normalizedFunctionName
                );

            console.error(
                `[FunctionsClient] ${normalizedFunctionName} failed:`,
                normalizedError
            );

            dispatchClientEvent(
                "profile:function-error",
                {
                    functionName:
                        normalizedFunctionName,

                    error:
                        normalizedError,

                    transport:
                        "firestore"
                }
            );

            throw normalizedError;
        }
    }

    function callNamed(
        functionName,
        payload = {}
    ) {
        return call(
            functionName,
            payload,
            {
                requireAuth:
                    true
            }
        );
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        resolveFirestore();

        resolveAuth();

        initialized =
            true;

        console.info(
            "[FunctionsClient] Ready — Firebase Spark Profile + Offer Admin client."
        );

        return true;
    }

    function isReady() {
        return Boolean(
            initialized &&
            firestoreInstance &&
            authInstance
        );
    }

    function getRegion() {
        return COMPATIBILITY_REGION;
    }

    function getInstance() {
        return resolveFirestore();
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.FunctionsClient =
        Object.freeze({
            init,
            isReady,
            call,

            ensureProfile:
                () =>
                    callNamed(
                        FUNCTION_NAMES
                            .ENSURE_PROFILE
                    ),

            getMyProfile:
                () =>
                    callNamed(
                        FUNCTION_NAMES
                            .GET_MY_PROFILE
                    ),

            saveMobileNumber:
                mobileNumber =>
                    callNamed(
                        FUNCTION_NAMES
                            .SAVE_MOBILE_NUMBER,
                        {
                            mobileNumber
                        }
                    ),

            getAdminSession:
                () =>
                    callNamed(
                        FUNCTION_NAMES
                            .GET_ADMIN_SESSION
                    ),

            getAdminDashboardSummary:
                () =>
                    callNamed(
                        FUNCTION_NAMES
                            .GET_ADMIN_DASHBOARD_SUMMARY
                    ),

            getAdminUsers:
                payload =>
                    callNamed(
                        FUNCTION_NAMES
                            .GET_ADMIN_USERS,
                        payload
                    ),

            getAdminUserDetails:
                payload =>
                    callNamed(
                        FUNCTION_NAMES
                            .GET_ADMIN_USER_DETAILS,
                        payload
                    ),

            markOfferPaid:
                payload =>
                    callNamed(
                        FUNCTION_NAMES
                            .MARK_OFFER_PAID,
                        payload
                    ),

            getRegion,
            getInstance,

            FunctionsClientError,
            FUNCTION_NAMES,
            COLLECTIONS,
            SCHEMA_VERSION
        });
})();