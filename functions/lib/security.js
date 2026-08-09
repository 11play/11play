"use strict";

/* =========================================================
   11PLAY — BACKEND SECURITY HELPERS
   File: functions/lib/security.js

   ADMIN POLICY:
   - Only one Admin exists
   - Fixed Admin email: casinobuzzbd@gmail.com
   - Google sign-in is mandatory
   - Email verification is mandatory
   - No Super Admin
   - No second Admin
   - No environment-variable Admin override
   - No custom claim authorization
   - No Firestore Admin assignment
   - No terminal command is required

   Callable Cloud Functions verify Firebase ID tokens.
   Identity information sent inside request.data is never
   trusted for authentication or authorization.
========================================================= */

const {
    HttpsError
} = require(
    "firebase-functions/v2/https"
);

const {
    getAuth
} = require(
    "firebase-admin/auth"
);

const {
    ADMIN,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    ValidationError,
    isPlainObject,
    validateUid,
    normalizeEmail,
    isValidEmail,
    normalizeText
} = require(
    "./validators"
);

/* =========================================================
   FIXED ADMIN CONFIGURATION

   The Admin email is permanently fixed in backend code.
   Environment variables, Firestore documents and custom
   claims cannot replace or add an Admin account.
========================================================= */

const ADMIN_EMAIL =
    normalizeEmail(
        "casinobuzzbd@gmail.com"
    );

if (!isValidEmail(ADMIN_EMAIL)) {
    throw new Error(
        "11Play fixed Admin email configuration is invalid."
    );
}

const ADMIN_ROLE =
    ADMIN.ROLE;

/* =========================================================
   GENERAL HELPERS
========================================================= */

function createHttpsError(
    code,
    message,
    details = undefined
) {
    return new HttpsError(
        code,
        message,
        details === null
            ? undefined
            : details
    );
}

function requireCallableRequest(request) {
    if (
        request === null ||
        typeof request !== "object"
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid callable request is required."
        );
    }

    return request;
}

function requireRequestData(
    request,
    fieldName = "data"
) {
    requireCallableRequest(
        request
    );

    const data =
        request.data;

    if (!isPlainObject(data)) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            `${fieldName} must be a valid object.`,
            {
                field:
                    fieldName
            }
        );
    }

    return data;
}

/* =========================================================
   AUTHENTICATION CONTEXT
========================================================= */

function getAuthContext(request) {
    requireCallableRequest(
        request
    );

    const auth =
        request.auth;

    if (
        !auth ||
        typeof auth !== "object" ||
        !auth.uid
    ) {
        throw createHttpsError(
            ERROR_CODES.UNAUTHENTICATED,
            "Google sign-in is required."
        );
    }

    return auth;
}

function getAuthToken(request) {
    const auth =
        getAuthContext(
            request
        );

    return (
        auth.token &&
        typeof auth.token === "object"
            ? auth.token
            : {}
    );
}

/* =========================================================
   PROVIDER INFORMATION
========================================================= */

function getProviderIdsFromToken(token) {
    const providerIds =
        new Set();

    const firebaseData =
        token?.firebase;

    const signInProvider =
        normalizeText(
            firebaseData
                ?.sign_in_provider
        );

    if (signInProvider) {
        providerIds.add(
            signInProvider
        );
    }

    const identities =
        firebaseData
            ?.identities;

    if (
        identities &&
        typeof identities === "object" &&
        !Array.isArray(identities)
    ) {
        for (
            const providerId
            of Object.keys(
                identities
            )
        ) {
            const normalizedProviderId =
                normalizeText(
                    providerId
                );

            if (
                normalizedProviderId
            ) {
                providerIds.add(
                    normalizedProviderId
                );
            }
        }
    }

    return Object.freeze(
        Array.from(
            providerIds
        )
    );
}

/* =========================================================
   AUTHENTICATED USER
========================================================= */

function getAuthenticatedUser(request) {
    const auth =
        getAuthContext(
            request
        );

    const token =
        getAuthToken(
            request
        );

    const providerIds =
        getProviderIdsFromToken(
            token
        );

    const signInProvider =
        normalizeText(
            token.firebase
                ?.sign_in_provider
        );

    const user =
        Object.freeze({
            uid:
                validateUid(
                    auth.uid
                ),

            email:
                normalizeEmail(
                    token.email || ""
                ),

            displayName:
                normalizeText(
                    token.name || ""
                ),

            photoURL:
                normalizeText(
                    token.picture || ""
                ),

            emailVerified:
                token.email_verified ===
                true,

            providerIds,

            signInProvider,

            isGoogleConnected:
                providerIds.includes(
                    "google.com"
                ),

            isGoogleSignIn:
                signInProvider ===
                "google.com"
        });

    return user;
}

function assertAuthenticated(request) {
    return getAuthenticatedUser(
        request
    );
}

/* =========================================================
   GOOGLE ACCOUNT REQUIREMENT

   A linked Google provider is not sufficient.
   The current authentication session must also have been
   created directly through Google sign-in.
========================================================= */

function assertGoogleUser(request) {
    const user =
        getAuthenticatedUser(
            request
        );

    if (
        !user.isGoogleConnected ||
        !user.isGoogleSignIn
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "Sign in directly with a Google account."
        );
    }

    return user;
}

function assertVerifiedEmail(request) {
    const user =
        getAuthenticatedUser(
            request
        );

    if (
        !user.email ||
        !user.emailVerified
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "A verified email address is required."
        );
    }

    return user;
}

function assertGoogleVerifiedUser(
    request
) {
    const user =
        assertGoogleUser(
            request
        );

    if (
        !user.email ||
        !user.emailVerified
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "A verified Google account is required."
        );
    }

    return user;
}

/* =========================================================
   USER OWNERSHIP

   Sensitive operations never trust a client-supplied UID.
========================================================= */

function assertUidOwnership(
    request,
    targetUid
) {
    const user =
        getAuthenticatedUser(
            request
        );

    const normalizedTargetUid =
        validateUid(
            targetUid,
            "targetUid"
        );

    if (
        user.uid !==
        normalizedTargetUid
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "You cannot access another user's private data."
        );
    }

    return user;
}

/* =========================================================
   REFERRAL SECURITY
========================================================= */

function assertNotSelfReferral(
    referrerUid,
    referredUid
) {
    const normalizedReferrerUid =
        validateUid(
            referrerUid,
            "referrerUid"
        );

    const normalizedReferredUid =
        validateUid(
            referredUid,
            "referredUid"
        );

    if (
        normalizedReferrerUid ===
        normalizedReferredUid
    ) {
        throw createHttpsError(
            ERROR_CODES.FAILED_PRECONDITION,
            "Self-referral is not allowed."
        );
    }

    return Object.freeze({
        referrerUid:
            normalizedReferrerUid,

        referredUid:
            normalizedReferredUid
    });
}

/* =========================================================
   ADMIN COMPATIBILITY HELPERS

   Custom claims and Firestore roles are intentionally ignored.
========================================================= */

function normalizeAdminRole(value) {
    const role =
        normalizeText(value)
            .toLowerCase();

    return role === ADMIN_ROLE
        ? ADMIN_ROLE
        : "";
}

function getAdminRoleFromClaims() {
    return "";
}

function isAdminRole(role) {
    return (
        normalizeAdminRole(
            role
        ) === ADMIN_ROLE
    );
}

function isSuperAdminRole() {
    return false;
}

/* =========================================================
   FIXED ADMIN AUTH RECORD

   Admin authorization is verified only against:
   - The fixed backend email
   - Firebase Authentication account status
   - Verified email
   - Connected Google provider
========================================================= */

async function getAdminRecord(uid) {
    const normalizedUid =
        validateUid(
            uid
        );

    try {
        const userRecord =
            await getAuth()
                .getUser(
                    normalizedUid
                );

        const email =
            normalizeEmail(
                userRecord.email || ""
            );

        const hasGoogleProvider =
            Array.isArray(
                userRecord.providerData
            ) &&
            userRecord.providerData.some(
                (provider) =>
                    provider
                        ?.providerId ===
                    "google.com"
            );

        const allowed =
            userRecord.disabled !==
                true &&
            userRecord.emailVerified ===
                true &&
            hasGoogleProvider &&
            email ===
                ADMIN_EMAIL;

        if (!allowed) {
            return null;
        }

        return Object.freeze({
            uid:
                userRecord.uid,

            email,

            displayName:
                normalizeText(
                    userRecord
                        .displayName ||
                    ""
                ),

            photoURL:
                normalizeText(
                    userRecord
                        .photoURL ||
                    ""
                ),

            role:
                ADMIN_ROLE,

            active:
                true,

            isAdmin:
                true,

            isSuperAdmin:
                false,

            authorizationSource:
                "fixed_verified_google_email"
        });
    } catch (error) {
        if (
            error?.code ===
                "auth/user-not-found" ||
            error?.code ===
                "auth/invalid-uid"
        ) {
            return null;
        }

        throw error;
    }
}

/* =========================================================
   ADMIN AUTHORIZATION

   Required:
   1. Firebase Authentication
   2. Current sign-in provider is Google
   3. Google provider remains connected
   4. Email is verified
   5. Email matches casinobuzzbd@gmail.com
   6. Firebase Authentication account is active
========================================================= */

async function assertAdmin(request) {
    const authenticatedUser =
        assertGoogleVerifiedUser(
            request
        );

    if (
        authenticatedUser.email !==
        ADMIN_EMAIL
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "Admin permission is required."
        );
    }

    const adminRecord =
        await getAdminRecord(
            authenticatedUser.uid
        );

    if (!adminRecord) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "Admin permission is required."
        );
    }

    return Object.freeze({
        ...authenticatedUser,

        role:
            ADMIN_ROLE,

        isAdmin:
            true,

        isSuperAdmin:
            false,

        authorizationSource:
            adminRecord
                .authorizationSource
    });
}

/* =========================================================
   SUPER ADMIN

   Super Admin is permanently unavailable.
========================================================= */

async function assertSuperAdmin(request) {
    await assertAdmin(
        request
    );

    throw createHttpsError(
        ERROR_CODES.PERMISSION_DENIED,
        "Super Admin is not available in this system."
    );
}

/* =========================================================
   APP CHECK

   required can be changed to true after Firebase App Check
   has been configured for the production application.
========================================================= */

function assertAppCheck(
    request,
    options = {}
) {
    const {
        required = false
    } = options;

    if (!required) {
        return true;
    }

    requireCallableRequest(
        request
    );

    if (
        !request.app ||
        typeof request.app !== "object" ||
        !request.app.appId
    ) {
        throw createHttpsError(
            ERROR_CODES.PERMISSION_DENIED,
            "App verification failed."
        );
    }

    return true;
}

/* =========================================================
   SAFE ERROR CONVERSION
========================================================= */

function toHttpsError(
    error,
    fallbackMessage =
        "The operation could not be completed."
) {
    if (
        error instanceof HttpsError
    ) {
        return error;
    }

    if (
        error instanceof
        ValidationError
    ) {
        return createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            error.message,
            {
                field:
                    error.field || "",

                details:
                    error.details ??
                    null
            }
        );
    }

    console.error(
        "[11Play Security] Unexpected backend error:",
        error
    );

    return createHttpsError(
        ERROR_CODES.INTERNAL,
        fallbackMessage
    );
}

function throwHttpsError(
    error,
    fallbackMessage
) {
    throw toHttpsError(
        error,
        fallbackMessage
    );
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    ADMIN_EMAIL,
    ADMIN_ROLE,

    createHttpsError,

    requireCallableRequest,
    requireRequestData,

    getAuthContext,
    getAuthToken,
    getProviderIdsFromToken,
    getAuthenticatedUser,

    assertAuthenticated,
    assertGoogleUser,
    assertVerifiedEmail,
    assertGoogleVerifiedUser,

    assertUidOwnership,
    assertNotSelfReferral,

    normalizeAdminRole,
    getAdminRoleFromClaims,
    isAdminRole,
    isSuperAdminRole,

    getAdminRecord,
    assertAdmin,
    assertSuperAdmin,

    assertAppCheck,

    toHttpsError,
    throwHttpsError
});