/* =========================================================
   11PLAY — PROFILE DATABASE CLIENT
   File: js/account/firebase/profile.db.js

   Responsibilities:
   - Detect the current verified Google-authenticated user
   - Create or synchronize the backend profile
   - Pass a captured referral code during profile creation
   - Subscribe to the current user's Firestore profile
   - Read and refresh the current user's profile
   - Save and permanently lock the mobile number
   - Synchronize profile data with ProfileService
   - Prevent stale cross-account profile state
   - Notify Profile UI when profile data changes

   Firestore collection:
   profileUsers/{uid}

   Important:
   - Private profile data is not persisted in localStorage
   - Profile creation and updates use Cloud Functions
   - Firestore access is read-only from this client
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const PROFILE_COLLECTION =
        "profileUsers";

    /*
     * Removed automatically because older versions stored
     * private profile data in localStorage.
     */

    const PROFILE_CACHE_KEY =
        "11play.profile.data";

    const GOOGLE_PROVIDER_ID =
        "google.com";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let firestoreInstance =
        null;

    let authInstance =
        null;

    let currentUid =
        "";

    let currentProfile =
        null;

    let profileUnsubscribe =
        null;

    let authUnsubscribe =
        null;

    let initialized =
        false;

    let readyPromise =
        null;

    let authenticationGeneration =
        0;

    let ensureOperation = {
        uid:
            "",

        promise:
            null
    };

    const subscribers =
        new Set();

    /* =====================================================
       PROFILE DATABASE ERROR
    ===================================================== */

    class ProfileDBError extends Error {
        constructor({
            code = "profile-error",
            message =
                "The profile operation could not be completed.",
            details = null
        } = {}) {
            super(message);

            this.name =
                "ProfileDBError";

            this.code =
                String(
                    code ||
                    "profile-error"
                );

            this.details =
                details;

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
                ProfileDBError
            );
        }
    }

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(value);

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

    function uniqueStrings(values) {
        if (!Array.isArray(values)) {
            return [];
        }

        return Array.from(
            new Set(
                values
                    .map(toSafeString)
                    .filter(Boolean)
            )
        );
    }

    function cloneValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        try {
            return JSON.parse(
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    function freezeDeep(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Object.isFrozen(value)
        ) {
            return value;
        }

        Object.values(value)
            .forEach(
                (nestedValue) => {
                    if (
                        nestedValue &&
                        typeof nestedValue ===
                            "object"
                    ) {
                        freezeDeep(
                            nestedValue
                        );
                    }
                }
            );

        return Object.freeze(value);
    }

    function dispatchProfileEvent(
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

    /* =====================================================
       FIREBASE SERVICE RESOLUTION
    ===================================================== */

    function resolveFirestore() {
        if (firestoreInstance) {
            return firestoreInstance;
        }

        const configuredFirestore =
            window.FirebaseConfig
                ?.firestore ||
            window.firebaseDB ||
            null;

        if (configuredFirestore) {
            firestoreInstance =
                configuredFirestore;

            return firestoreInstance;
        }

        if (
            window.firebase &&
            typeof window.firebase
                .firestore ===
                "function"
        ) {
            try {
                firestoreInstance =
                    window.firebase
                        .firestore();

                return firestoreInstance;
            } catch (error) {
                throw new ProfileDBError({
                    code:
                        "firestore-not-ready",

                    message:
                        "Firestore could not be initialized.",

                    details:
                        error
                });
            }
        }

        throw new ProfileDBError({
            code:
                "firestore-not-loaded",

            message:
                "Firebase Firestore SDK is not loaded."
        });
    }

    function resolveAuth() {
        if (authInstance) {
            return authInstance;
        }

        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (configuredAuth) {
            authInstance =
                configuredAuth;

            return authInstance;
        }

        if (
            window.firebase &&
            typeof window.firebase
                .auth ===
                "function"
        ) {
            try {
                authInstance =
                    window.firebase.auth();

                return authInstance;
            } catch (error) {
                throw new ProfileDBError({
                    code:
                        "auth-not-ready",

                    message:
                        "Firebase Authentication could not be initialized.",

                    details:
                        error
                });
            }
        }

        throw new ProfileDBError({
            code:
                "auth-not-loaded",

            message:
                "Firebase Authentication SDK is not loaded."
        });
    }

    function requireFunctionsClient() {
        const functionsClient =
            window.FunctionsClient ||
            null;

        if (!functionsClient) {
            throw new ProfileDBError({
                code:
                    "functions-client-not-loaded",

                message:
                    "Firebase Functions Client is not loaded."
            });
        }

        return functionsClient;
    }

    /* =====================================================
       LEGACY LOCAL CACHE CLEANUP

       The methods remain exposed temporarily for compatibility,
       but profile data is no longer loaded from localStorage.
    ===================================================== */

    function removeLegacyCache() {
        try {
            window.localStorage
                .removeItem(
                    PROFILE_CACHE_KEY
                );

            return true;
        } catch {
            return false;
        }
    }

    function readCache() {
        return currentProfile
            ? cloneValue(
                currentProfile
            )
            : null;
    }

    function clearCache() {
        return removeLegacyCache();
    }

    removeLegacyCache();

    /* =====================================================
       FIRESTORE VALUE NORMALIZATION
    ===================================================== */

    function isFirestoreTimestamp(value) {
        return Boolean(
            value &&
            typeof value ===
                "object" &&
            typeof value.toDate ===
                "function"
        );
    }

    function normalizeFirestoreValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (isFirestoreTimestamp(value)) {
            try {
                return value
                    .toDate()
                    .toISOString();
            } catch {
                return null;
            }
        }

        if (value instanceof Date) {
            const timestamp =
                value.getTime();

            return Number.isFinite(timestamp)
                ? value.toISOString()
                : null;
        }

        if (Array.isArray(value)) {
            return value.map(
                normalizeFirestoreValue
            );
        }

        if (isPlainObject(value)) {
            const normalizedObject = {};

            Object.entries(value)
                .forEach(
                    ([
                        key,
                        nestedValue
                    ]) => {
                        normalizedObject[key] =
                            normalizeFirestoreValue(
                                nestedValue
                            );
                    }
                );

            return normalizedObject;
        }

        return value;
    }

    function normalizeDateValue(value) {
        const normalizedValue =
            normalizeFirestoreValue(
                value
            );

        if (
            normalizedValue === null ||
            normalizedValue === undefined ||
            normalizedValue === ""
        ) {
            return null;
        }

        if (
            typeof normalizedValue ===
                "number"
        ) {
            const milliseconds =
                normalizedValue < 1e12
                    ? normalizedValue * 1000
                    : normalizedValue;

            const numericDate =
                new Date(milliseconds);

            return Number.isFinite(
                numericDate.getTime()
            )
                ? numericDate.toISOString()
                : null;
        }

        const textValue =
            toSafeString(
                normalizedValue
            );

        if (!textValue) {
            return null;
        }

        const parsedDate =
            new Date(textValue);

        return Number.isFinite(
            parsedDate.getTime()
        )
            ? parsedDate.toISOString()
            : textValue;
    }

    /* =====================================================
       AUTHENTICATION DATA
    ===================================================== */

    function getFirebaseUser() {
        const auth =
            resolveAuth();

        return (
            auth.currentUser ||
            null
        );
    }

    function requireFirebaseUser() {
        const firebaseUser =
            getFirebaseUser();

        if (!firebaseUser?.uid) {
            throw new ProfileDBError({
                code:
                    "unauthenticated",

                message:
                    "Google sign-in is required."
            });
        }

        return firebaseUser;
    }

    function getProviderIds(
        firebaseUser
    ) {
        if (
            !firebaseUser ||
            !Array.isArray(
                firebaseUser.providerData
            )
        ) {
            return [];
        }

        return uniqueStrings(
            firebaseUser.providerData
                .map(
                    (provider) =>
                        provider
                            ?.providerId ||
                        ""
                )
        );
    }

    async function requireVerifiedGoogleUser() {
        const firebaseUser =
            requireFirebaseUser();

        const providerIds =
            getProviderIds(
                firebaseUser
            );

        if (
            !providerIds.includes(
                GOOGLE_PROVIDER_ID
            )
        ) {
            throw new ProfileDBError({
                code:
                    "google-account-required",

                message:
                    "A Google-connected account is required."
            });
        }

        if (
            firebaseUser.emailVerified !==
            true
        ) {
            throw new ProfileDBError({
                code:
                    "verified-email-required",

                message:
                    "A verified Google email is required."
            });
        }

        /*
         * Verify that the current Firebase session was created
         * through Google, not merely linked to Google.
         */

        if (
            typeof firebaseUser
                .getIdTokenResult ===
                "function"
        ) {
            try {
                const tokenResult =
                    await firebaseUser
                        .getIdTokenResult(
                            false
                        );

                const signInProvider =
                    toSafeString(
                        tokenResult
                            ?.signInProvider ||
                        tokenResult
                            ?.claims
                            ?.firebase
                            ?.sign_in_provider
                    );

                if (
                    signInProvider !==
                    GOOGLE_PROVIDER_ID
                ) {
                    throw new ProfileDBError({
                        code:
                            "google-sign-in-required",

                        message:
                            "Sign in directly with Google to continue."
                    });
                }
            } catch (error) {
                if (
                    error instanceof
                    ProfileDBError
                ) {
                    throw error;
                }

                throw new ProfileDBError({
                    code:
                        "authentication-verification-failed",

                    message:
                        "The Google authentication session could not be verified.",

                    details:
                        error
                });
            }
        }

        return firebaseUser;
    }

    function getAuthenticationPresentation(
        uid
    ) {
        const firebaseUser =
            getFirebaseUser();

        if (
            !firebaseUser ||
            firebaseUser.uid !== uid
        ) {
            return {};
        }

        const providerIds =
            getProviderIds(
                firebaseUser
            );

        const authServiceUser =
            window.AuthService &&
            typeof window.AuthService
                .getCurrentUser ===
                "function"
                ? window.AuthService
                    .getCurrentUser()
                : null;

        const authMetadata =
            firebaseUser.metadata ||
            {};

        const registrationDate =
            normalizeDateValue(
                authMetadata.creationTime ||
                authMetadata.createdAt ||
                authServiceUser
                    ?.registrationDate ||
                authServiceUser
                    ?.createdAt ||
                null
            );

        const lastLogin =
            normalizeDateValue(
                authMetadata.lastSignInTime ||
                authMetadata.lastLoginAt ||
                authServiceUser
                    ?.lastLogin ||
                authServiceUser
                    ?.lastLoginAt ||
                registrationDate
            );

        return {
            uid:
                firebaseUser.uid,

            displayName:
                toSafeString(
                    firebaseUser
                        .displayName
                ),

            name:
                toSafeString(
                    firebaseUser
                        .displayName
                ),

            email:
                toSafeString(
                    firebaseUser.email
                ).toLowerCase(),

            photoURL:
                toSafeString(
                    firebaseUser.photoURL
                ),

            photo:
                toSafeString(
                    firebaseUser.photoURL
                ),

            emailVerified:
                firebaseUser
                    .emailVerified ===
                true,

            phoneNumber:
                toSafeString(
                    firebaseUser
                        .phoneNumber
                ),

            providerIds,

            signInProvider:
                toSafeString(
                    authServiceUser
                        ?.signInProvider
                ),

            isGoogleConnected:
                providerIds.includes(
                    GOOGLE_PROVIDER_ID
                ),

            googleConnected:
                providerIds.includes(
                    GOOGLE_PROVIDER_ID
                ),

            isGoogleSignIn:
                authServiceUser
                    ?.isGoogleSignIn ===
                true,

            isAuthenticated:
                true,

            registrationDate,

            createdAt:
                registrationDate,

            lastLogin
        };
    }
    
        /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function deriveUsername(
        explicitUsername,
        email
    ) {
        const username =
            toSafeString(
                explicitUsername
            );

        if (username) {
            return username;
        }

        const normalizedEmail =
            toSafeString(email)
                .toLowerCase();

        const separatorIndex =
            normalizedEmail.indexOf("@");

        return separatorIndex > 0
            ? normalizedEmail.slice(
                0,
                separatorIndex
            )
            : "";
    }

    function normalizeProfile(
        data,
        uid = ""
    ) {
        const source =
            isPlainObject(data)
                ? normalizeFirestoreValue(
                    data
                )
                : {};

        const normalizedUid =
            toSafeString(
                source.uid ||
                uid
            );

        const authenticationData =
            getAuthenticationPresentation(
                normalizedUid
            );

        const displayName =
            toSafeString(
                source.displayName ||
                source.name ||
                authenticationData
                    .displayName
            );

        const email =
            toSafeString(
                source.email ||
                authenticationData.email
            ).toLowerCase();

        const photoURL =
            toSafeString(
                source.photoURL ||
                source.photo ||
                authenticationData.photoURL
            );

        const mobileNumber =
            toSafeString(
                source.mobileNumber
            );

        const providerIds =
            uniqueStrings([
                ...(
                    Array.isArray(
                        source.providerIds
                    )
                        ? source.providerIds
                        : []
                ),

                ...(
                    Array.isArray(
                        authenticationData
                            .providerIds
                    )
                        ? authenticationData
                            .providerIds
                        : []
                )
            ]);

        const isGoogleConnected =
            source.isGoogleConnected ===
                true ||
            source.googleConnected ===
                true ||
            authenticationData
                .isGoogleConnected ===
                true ||
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        const registrationDate =
            normalizeDateValue(
                source.registrationDate ||
                source.createdAt ||
                authenticationData
                    .registrationDate ||
                authenticationData
                    .createdAt ||
                null
            );

        const createdAt =
            normalizeDateValue(
                source.createdAt ||
                source.registrationDate ||
                authenticationData
                    .createdAt ||
                registrationDate ||
                null
            );

        const lastLogin =
            normalizeDateValue(
                source.lastLogin ||
                source.lastLoginAt ||
                authenticationData
                    .lastLogin ||
                registrationDate ||
                null
            );

        const accountType =
            toSafeString(
                source.accountType
            ) ||
            (
                isGoogleConnected
                    ? "google"
                    : "guest"
            );

        const profile = {
            ...authenticationData,
            ...source,

            uid:
                normalizedUid,

            name:
                displayName,

            displayName,

            username:
                deriveUsername(
                    source.username,
                    email
                ),

            email,

            photo:
                photoURL,

            photoURL,

            providerIds,

            emailVerified:
                source.emailVerified ===
                    true ||
                authenticationData
                    .emailVerified ===
                    true,

            isGoogleConnected,

            googleConnected:
                isGoogleConnected,

            isGoogleSignIn:
                authenticationData
                    .isGoogleSignIn ===
                    true,

            isAuthenticated:
                Boolean(
                    normalizedUid
                ),

            accountType,

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
                Boolean(
                    mobileNumber
                ),

            referralCode:
                toSafeString(
                    source.referralCode
                ).toUpperCase(),

            referralLink:
                toSafeString(
                    source.referralLink
                ),

            referredByUid:
                toSafeString(
                    source.referredByUid
                ),

            referredByCode:
                toSafeString(
                    source.referredByCode
                ).toUpperCase(),

            registrationDate,

            createdAt,

            lastLogin,

            status:
                toSafeString(
                    source.status
                ) ||
                "active"
        };

        return freezeDeep(
            profile
        );
    }

    /* =====================================================
       PROFILE SERVICE SYNCHRONIZATION
    ===================================================== */

    function synchronizeProfileService(
        profile,
        options = {}
    ) {
        const profileService =
            window.ProfileService ||
            null;

        if (!profileService) {
            return false;
        }

        if (!profile) {
            if (
                options.signedOut ===
                    true
            ) {
                if (
                    typeof profileService
                        .clearUser ===
                        "function"
                ) {
                    profileService
                        .clearUser();

                    return true;
                }

                if (
                    typeof profileService
                        .setUser ===
                        "function"
                ) {
                    profileService
                        .setUser(null);

                    return true;
                }
            }

            return false;
        }

        if (
            typeof profileService
                .setUser !==
                "function"
        ) {
            return false;
        }

        let existingProfile = {};

        if (
            typeof profileService
                .getUser ===
                "function"
        ) {
            try {
                existingProfile =
                    profileService
                        .getUser() ||
                    {};
            } catch {
                existingProfile = {};
            }
        }

        const sameUser =
            toSafeString(
                existingProfile.uid
            ) === profile.uid;

        const mergedProfile = {
            ...(sameUser
                ? existingProfile
                : {}),

            ...profile
        };

        /*
         * A profile document does not contain the separate
         * Activity, Wallet or Referral Statistics documents.
         * Preserve those independently loaded sections.
         */

        if (
            sameUser &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    profile,
                    "usingTime"
                )
        ) {
            mergedProfile.usingTime =
                existingProfile.usingTime;
        }

        if (
            sameUser &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    profile,
                    "wallet"
                )
        ) {
            mergedProfile.wallet =
                existingProfile.wallet;
        }

        if (
            sameUser &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    profile,
                    "referrals"
                )
        ) {
            mergedProfile.referrals =
                existingProfile.referrals;
        }

        profileService.setUser(
            mergedProfile
        );

        return true;
    }

    /* =====================================================
       PROFILE PUBLICATION
    ===================================================== */

    function publishProfile(
        profile,
        source = "firestore",
        options = {}
    ) {
        const expectedUid =
            toSafeString(
                options.expectedUid
            );

        if (
            expectedUid &&
            currentUid !==
                expectedUid
        ) {
            return currentProfile;
        }

        currentProfile =
            profile
                ? normalizeProfile(
                    profile,
                    expectedUid ||
                    currentUid
                )
                : null;

        synchronizeProfileService(
            currentProfile,
            {
                signedOut:
                    options.signedOut ===
                    true
            }
        );

        const metadata = {
            source,

            uid:
                currentUid
        };

        subscribers.forEach(
            (listener) => {
                try {
                    listener(
                        currentProfile,
                        metadata
                    );
                } catch (error) {
                    console.error(
                        "[ProfileDB] Profile subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatchProfileEvent(
            "profile:data-changed",
            {
                profile:
                    currentProfile,

                source,

                uid:
                    currentUid
            }
        );

        return currentProfile;
    }

    function getReadableErrorMessage(
        error,
        fallbackMessage =
            "The profile operation could not be completed."
    ) {
        const detailsMessage =
            toSafeString(
                error?.details?.message ||
                error?.details
            );

        const errorMessage =
            toSafeString(
                error?.message
            );

        const normalizedCode =
            toSafeString(
                error?.code
            ).replace(
                /^functions\//,
                ""
            );

        if (
            detailsMessage &&
            detailsMessage !==
                "[object Object]"
        ) {
            return detailsMessage;
        }

        if (
            errorMessage &&
            errorMessage.toLowerCase() !==
                "internal"
        ) {
            return errorMessage;
        }

        if (
            normalizedCode ===
                "internal"
        ) {
            return fallbackMessage;
        }

        return (
            errorMessage ||
            fallbackMessage
        );
    }

    function publishError(
        error,
        operation = ""
    ) {
        const normalizedError =
            error instanceof
                ProfileDBError
                ? error
                : new ProfileDBError({
                    code:
                        String(
                            error?.code ||
                            "profile-error"
                        ).replace(
                            /^functions\//,
                            ""
                        ),

                    message:
                        getReadableErrorMessage(
                            error
                        ),

                    details:
                        error?.details ||
                        error
                });

        dispatchProfileEvent(
            "profile:database-error",
            {
                operation,

                error:
                    normalizedError
            }
        );

        return normalizedError;
    }

    /* =====================================================
       REFERRAL CAPTURE
    ===================================================== */

    function initializeReferralCapture() {
        if (
            window.ReferralCapture &&
            typeof window.ReferralCapture
                .init ===
                "function"
        ) {
            try {
                return window.ReferralCapture
                    .init({
                        cleanURL:
                            true
                    });
            } catch (error) {
                console.warn(
                    "[ProfileDB] Referral capture could not initialize.",
                    error
                );
            }
        }

        return "";
    }

    function getPendingReferralCode() {
        if (
            window.ReferralCapture &&
            typeof window.ReferralCapture
                .getPendingCode ===
                "function"
        ) {
            return toSafeString(
                window.ReferralCapture
                    .getPendingCode()
            ).toUpperCase();
        }

        return "";
    }

    function clearPendingReferralCode(
        referralCode
    ) {
        const normalizedCode =
            toSafeString(
                referralCode
            ).toUpperCase();

        if (!normalizedCode) {
            return false;
        }

        if (
            !window.ReferralCapture ||
            typeof window.ReferralCapture
                .getPendingCode !==
                "function" ||
            typeof window.ReferralCapture
                .clearPendingCode !==
                "function"
        ) {
            return false;
        }

        const currentPendingCode =
            toSafeString(
                window.ReferralCapture
                    .getPendingCode()
            ).toUpperCase();

        /*
         * Do not clear a newer referral code captured while
         * an older request was still in progress.
         */

        if (
            currentPendingCode !==
            normalizedCode
        ) {
            return false;
        }

        window.ReferralCapture
            .clearPendingCode({
                reason:
                    "profile_processed"
            });

        return true;
    }

    /* =====================================================
       PROFILE DOCUMENT REFERENCE
    ===================================================== */

    function getProfileReference(
        uid = currentUid
    ) {
        const normalizedUid =
            toSafeString(uid);

        if (
            !normalizedUid ||
            normalizedUid.includes("/")
        ) {
            throw new ProfileDBError({
                code:
                    "invalid-user-id",

                message:
                    "A valid Firebase user ID is required."
            });
        }

        return resolveFirestore()
            .collection(
                PROFILE_COLLECTION
            )
            .doc(
                normalizedUid
            );
    }

    /* =====================================================
       FUNCTION RESULT EXTRACTION
    ===================================================== */

    function extractProfileFromResult(
        result
    ) {
        if (!isPlainObject(result)) {
            return null;
        }

        if (
            isPlainObject(
                result.profile
            )
        ) {
            return result.profile;
        }

        if (
            isPlainObject(
                result.user
            ) &&
            result.user.uid
        ) {
            return result.user;
        }

        if (
            result.uid &&
            (
                result.email ||
                result.referralCode ||
                result.registrationDate ||
                result.mobileNumber
            )
        ) {
            return result;
        }

        return null;
    }
        /* =====================================================
       CREATE OR SYNCHRONIZE PROFILE
    ===================================================== */

    async function ensureProfile(
        options = {}
    ) {
        const firebaseUser =
            await requireVerifiedGoogleUser();

        const uid =
            firebaseUser.uid;

        if (
            ensureOperation.uid ===
                uid &&
            ensureOperation.promise
        ) {
            return ensureOperation.promise;
        }

        currentUid =
            uid;

        const referralCode =
            toSafeString(
                options.referralCode ||
                getPendingReferralCode()
            ).toUpperCase();

        const operationPromise =
            (async () => {
                try {
                    const functionsClient =
                        requireFunctionsClient();

                    const payload =
                        referralCode
                            ? {
                                referralCode
                            }
                            : {};

                    const result =
                        await functionsClient
                            .ensureProfile(
                                payload
                            );

                    if (referralCode) {
                        clearPendingReferralCode(
                            referralCode
                        );
                    }

                    const resultProfile =
                        extractProfileFromResult(
                            result
                        );

                    if (
                        resultProfile &&
                        currentUid === uid
                    ) {
                        publishProfile(
                            resultProfile,
                            "ensure-function",
                            {
                                expectedUid:
                                    uid
                            }
                        );
                    }

                    dispatchProfileEvent(
                        "profile:ensure-success",
                        {
                            result,

                            uid
                        }
                    );

                    return result;
                } catch (error) {
                    throw publishError(
                        error,
                        "ensureProfile"
                    );
                } finally {
                    if (
                        ensureOperation
                            .promise ===
                        operationPromise
                    ) {
                        ensureOperation = {
                            uid:
                                "",

                            promise:
                                null
                        };
                    }
                }
            })();

        ensureOperation = {
            uid,

            promise:
                operationPromise
        };

        return operationPromise;
    }

    /* =====================================================
       FIRESTORE REAL-TIME SUBSCRIPTION
    ===================================================== */

    function stopProfileSubscription() {
        if (
            typeof profileUnsubscribe ===
                "function"
        ) {
            profileUnsubscribe();
        }

        profileUnsubscribe =
            null;
    }

    function subscribeToCurrentProfile(
        uid
    ) {
        const normalizedUid =
            toSafeString(uid);

        if (!normalizedUid) {
            return false;
        }

        stopProfileSubscription();

        currentUid =
            normalizedUid;

        profileUnsubscribe =
            getProfileReference(
                normalizedUid
            ).onSnapshot(
                (snapshot) => {
                    /*
                     * Ignore a delayed snapshot belonging to a
                     * previously signed-in account.
                     */

                    if (
                        currentUid !==
                        normalizedUid
                    ) {
                        return;
                    }

                    if (!snapshot.exists) {
                        currentProfile =
                            null;

                        dispatchProfileEvent(
                            "profile:not-found",
                            {
                                uid:
                                    normalizedUid
                            }
                        );

                        publishProfile(
                            null,
                            "firestore-missing",
                            {
                                expectedUid:
                                    normalizedUid,

                                signedOut:
                                    false
                            }
                        );

                        return;
                    }

                    publishProfile(
                        {
                            id:
                                snapshot.id,

                            ...snapshot.data()
                        },
                        "firestore",
                        {
                            expectedUid:
                                normalizedUid
                        }
                    );
                },

                (error) => {
                    if (
                        currentUid !==
                        normalizedUid
                    ) {
                        return;
                    }

                    console.error(
                        "[ProfileDB] Profile subscription failed.",
                        error
                    );

                    publishError(
                        error,
                        "subscribe"
                    );
                }
            );

        return true;
    }

    /* =====================================================
       READ AND LOAD PROFILE
    ===================================================== */

    async function refresh() {
        try {
            const firebaseUser =
                await requireVerifiedGoogleUser();

            const uid =
                firebaseUser.uid;

            currentUid =
                uid;

            const functionsClient =
                requireFunctionsClient();

            const result =
                await functionsClient
                    .getMyProfile();

            const profile =
                extractProfileFromResult(
                    result
                );

            if (currentUid === uid) {
                publishProfile(
                    profile,
                    "function",
                    {
                        expectedUid:
                            uid
                    }
                );
            }

            return currentProfile;
        } catch (error) {
            throw publishError(
                error,
                "refresh"
            );
        }
    }

    async function load() {
        const firebaseUser =
            await requireVerifiedGoogleUser();

        const uid =
            firebaseUser.uid;

        if (
            currentUid &&
            currentUid !== uid
        ) {
            stopProfileSubscription();

            currentProfile =
                null;
        }

        currentUid =
            uid;

        await ensureProfile();

        if (
            currentUid !== uid
        ) {
            return null;
        }

        subscribeToCurrentProfile(
            uid
        );

        if (!currentProfile) {
            await refresh();
        }

        return currentProfile;
    }

    /* =====================================================
       MOBILE NUMBER
    ===================================================== */

    function normalizeMobileNumber(value) {
        let mobileNumber =
            toSafeString(value)
                .replace(
                    /[\s\-()]/g,
                    ""
                );

        if (
            /^1[3-9]\d{8}$/.test(
                mobileNumber
            )
        ) {
            mobileNumber =
                `+880${mobileNumber}`;
        } else if (
            /^01[3-9]\d{8}$/.test(
                mobileNumber
            )
        ) {
            mobileNumber =
                `+88${mobileNumber}`;
        } else if (
            /^8801[3-9]\d{8}$/.test(
                mobileNumber
            )
        ) {
            mobileNumber =
                `+${mobileNumber}`;
        }

        return mobileNumber;
    }

    async function saveMobileNumber(
        mobileNumber
    ) {
        try {
            const firebaseUser =
                await requireVerifiedGoogleUser();

            const uid =
                firebaseUser.uid;

            const normalizedMobile =
                normalizeMobileNumber(
                    mobileNumber
                );

            if (
                !/^\+8801[3-9]\d{8}$/.test(
                    normalizedMobile
                )
            ) {
                throw new ProfileDBError({
                    code:
                        "invalid-mobile-number",

                    message:
                        "Enter a valid Bangladesh mobile number.",

                    details: {
                        field:
                            "mobileNumber"
                    }
                });
            }

            if (
                currentProfile
                    ?.mobileLocked ===
                    true &&
                currentProfile
                    ?.mobileNumber &&
                currentProfile
                    .mobileNumber !==
                    normalizedMobile
            ) {
                throw new ProfileDBError({
                    code:
                        "mobile-number-locked",

                    message:
                        "The mobile number has already been permanently saved.",

                    details: {
                        field:
                            "mobileNumber"
                    }
                });
            }

            const functionsClient =
                requireFunctionsClient();

            const result =
                await functionsClient
                    .saveMobileNumber(
                        normalizedMobile
                    );

            const resultProfile =
                extractProfileFromResult(
                    result
                );

            if (
                resultProfile &&
                currentUid === uid
            ) {
                publishProfile(
                    resultProfile,
                    "mobile-function",
                    {
                        expectedUid:
                            uid
                    }
                );
            } else if (
                currentUid === uid
            ) {
                await refresh();
            }

            dispatchProfileEvent(
                "profile:mobile-update-success",
                {
                    result,

                    profile:
                        currentProfile
                }
            );

            return result;
        } catch (error) {
            throw publishError(
                error,
                "saveMobileNumber"
            );
        }
    }
        /* =====================================================
       PUBLIC SUBSCRIBERS
    ===================================================== */

    function subscribe(
        listener,
        options = {}
    ) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new ProfileDBError({
                code:
                    "invalid-subscriber",

                message:
                    "Profile subscriber must be a function."
            });
        }

        subscribers.add(
            listener
        );

        if (
            options.emitCurrent !==
                false
        ) {
            listener(
                currentProfile,
                {
                    source:
                        "current",

                    uid:
                        currentUid
                }
            );
        }

        return () => {
            subscribers.delete(
                listener
            );
        };
    }

    /* =====================================================
       AUTHENTICATION STATE HANDLING
    ===================================================== */

    async function handleSignedInUser(
        firebaseUser
    ) {
        if (!firebaseUser?.uid) {
            return null;
        }

        const generation =
            ++authenticationGeneration;

        const uid =
            firebaseUser.uid;

        if (
            currentUid &&
            currentUid !== uid
        ) {
            stopProfileSubscription();

            currentProfile =
                null;

            ensureOperation = {
                uid:
                    "",

                promise:
                    null
            };
        }

        currentUid =
            uid;

        /*
         * Publish Firebase Authentication presentation first.
         * This allows name, email, photo, registration date
         * and last login to appear while the backend profile
         * is being synchronized.
         */

        publishProfile(
            getAuthenticationPresentation(
                uid
            ),
            "authentication",
            {
                expectedUid:
                    uid
            }
        );

        try {
            await requireVerifiedGoogleUser();

            await ensureProfile();

            if (
                generation !==
                    authenticationGeneration ||
                currentUid !== uid
            ) {
                return null;
            }

            subscribeToCurrentProfile(
                uid
            );

            if (!currentProfile) {
                await refresh();
            }

            return currentProfile;
        } catch (error) {
            if (
                generation ===
                authenticationGeneration
            ) {
                stopProfileSubscription();

                currentProfile =
                    null;

                dispatchProfileEvent(
                    "profile:access-blocked",
                    {
                        uid,

                        error:
                            publishError(
                                error,
                                "signed-in-initialization"
                            )
                    }
                );
            }

            return null;
        }
    }

    function handleSignedOutUser() {
        authenticationGeneration +=
            1;

        stopProfileSubscription();

        currentUid =
            "";

        currentProfile =
            null;

        ensureOperation = {
            uid:
                "",

            promise:
                null
        };

        removeLegacyCache();

        publishProfile(
            null,
            "signed-out",
            {
                signedOut:
                    true
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (readyPromise) {
            return readyPromise;
        }

        readyPromise =
            new Promise(
                (
                    resolve,
                    reject
                ) => {
                    let initialAuthResolved =
                        false;

                    try {
                        initializeReferralCapture();

                        resolveFirestore();

                        const auth =
                            resolveAuth();

                        authUnsubscribe =
                            auth.onAuthStateChanged(
                                async (
                                    firebaseUser
                                ) => {
                                    try {
                                        if (firebaseUser) {
                                            await handleSignedInUser(
                                                firebaseUser
                                            );
                                        } else {
                                            handleSignedOutUser();
                                        }

                                        if (
                                            !initialAuthResolved
                                        ) {
                                            initialAuthResolved =
                                                true;

                                            resolve(
                                                currentProfile
                                            );
                                        }
                                    } catch (error) {
                                        const normalizedError =
                                            publishError(
                                                error,
                                                "auth-state"
                                            );

                                        if (
                                            !initialAuthResolved
                                        ) {
                                            initialAuthResolved =
                                                true;

                                            readyPromise =
                                                null;

                                            initialized =
                                                false;

                                            reject(
                                                normalizedError
                                            );
                                        }
                                    }
                                },

                                (error) => {
                                    const normalizedError =
                                        publishError(
                                            error,
                                            "auth-state"
                                        );

                                    if (
                                        !initialAuthResolved
                                    ) {
                                        initialAuthResolved =
                                            true;

                                        readyPromise =
                                            null;

                                        initialized =
                                            false;

                                        reject(
                                            normalizedError
                                        );
                                    }
                                }
                            );

                        initialized =
                            true;
                    } catch (error) {
                        readyPromise =
                            null;

                        initialized =
                            false;

                        reject(
                            publishError(
                                error,
                                "init"
                            )
                        );
                    }
                }
            );

        return readyPromise;
    }

    /* =====================================================
       STATE ACCESS
    ===================================================== */

    function getProfile() {
        return currentProfile;
    }

    function getUser() {
        return currentProfile;
    }

    function getCurrentUser() {
        return currentProfile;
    }

    function getCurrentUid() {
        return currentUid;
    }

    function isReady() {
        return Boolean(
            initialized &&
            firestoreInstance &&
            authInstance
        );
    }

    function whenReady() {
        return init();
    }

    function getState() {
        return Object.freeze({
            initialized,

            ready:
                isReady(),

            uid:
                currentUid,

            profile:
                currentProfile,

            subscribed:
                typeof profileUnsubscribe ===
                    "function",

            ensuringProfile:
                Boolean(
                    ensureOperation.promise
                ),

            subscriberCount:
                subscribers.size
        });
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        authenticationGeneration +=
            1;

        stopProfileSubscription();

        if (
            typeof authUnsubscribe ===
                "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        firestoreInstance =
            null;

        authInstance =
            null;

        currentUid =
            "";

        currentProfile =
            null;

        ensureOperation = {
            uid:
                "",

            promise:
                null
        };

        readyPromise =
            null;

        initialized =
            false;

        subscribers.clear();

        removeLegacyCache();

        return true;
    }

    /* =====================================================
       GLOBAL API
    ===================================================== */

    window.ProfileDB =
        Object.freeze({
            init,
            destroy,
            whenReady,
            isReady,

            ensureProfile,
            load,
            refresh,

            saveMobileNumber,

            subscribe,

            getProfile,
            getUser,
            getCurrentUser,
            getCurrentUid,
            getState,

            /*
             * Compatibility methods. No private persistent
             * profile cache is used.
             */

            readCache,
            clearCache,

            PROFILE_COLLECTION,
            PROFILE_CACHE_KEY,

            ProfileDBError
        });
})();