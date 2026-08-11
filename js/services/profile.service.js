/* =========================================================
   11PLAY — PROFILE STATE SERVICE
   File: js/services/profile.service.js

   Responsibilities:
   - Maintain the current Profile UI state
   - Keep a persistent non-sensitive Guest identity
   - Keep authenticated Profile data in memory only
   - Normalize Profile information for the UI
   - Prevent retired account-system fields from entering state
   - Notify the application when Profile state changes

   Current Profile fields:
   - Name
   - Username
   - Gmail / email
   - Profile photo
   - Mobile number
   - Registration date
   - Last login
   - Account type
   - Google authentication state

   Important:
   - Authenticated private Profile data is never stored locally
   - Only the Guest identity token is persisted locally
   - Mobile data remains backend / Firestore authoritative
   - Referral, activity, reward, wallet, withdrawal and
     Web Device state are not part of this service
========================================================= */

const ProfileService = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const LEGACY_USER_KEY =
        "profile_user";

    const LEGACY_START_TIME_KEY =
        "profile_start_time";

    const GUEST_IDENTITY_KEY =
        "11play_guest_identity_v1";

    const GUEST_USERNAME_PREFIX =
        "11guest-";

    const GUEST_TOKEN_LENGTH =
        6;

    const GOOGLE_PROVIDER_ID =
        "google.com";

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

    function uniqueStrings(values) {
        if (
            !Array.isArray(values)
        ) {
            return [];
        }

        return Array.from(
            new Set(
                values
                    .map(
                        toSafeString
                    )
                    .filter(
                        Boolean
                    )
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
                JSON.stringify(
                    value
                )
            );
        } catch {
            return value;
        }
    }

    function freezeObject(value) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Object.isFrozen(
                value
            )
        ) {
            return value;
        }

        Object.values(
            value
        ).forEach(
            nestedValue => {
                if (
                    nestedValue &&
                    typeof nestedValue ===
                        "object"
                ) {
                    freezeObject(
                        nestedValue
                    );
                }
            }
        );

        return Object.freeze(
            value
        );
    }

    function toNullableValue(value) {
        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            return null;
        }

        return value;
    }

    /* =====================================================
       GUEST IDENTITY
    ===================================================== */

    function normalizeGuestToken(
        value
    ) {
        return toSafeString(
            value
        )
            .replace(
                /^@+/,
                ""
            )
            .replace(
                /^guest_/i,
                ""
            )
            .replace(
                /^youare11guest/i,
                ""
            )
            .replace(
                /^11guest[-_]?/i,
                ""
            )
            .replace(
                /[^a-z0-9]/gi,
                ""
            )
            .toLowerCase()
            .slice(
                0,
                GUEST_TOKEN_LENGTH
            );
    }

    function createGuestToken() {
        const alphabet =
            "abcdefghijklmnopqrstuvwxyz0123456789";

        const values =
            new Uint32Array(
                GUEST_TOKEN_LENGTH
            );

        let secure =
            false;

        try {
            if (
                window.crypto &&
                typeof window.crypto
                    .getRandomValues ===
                    "function"
            ) {
                window.crypto
                    .getRandomValues(
                        values
                    );

                secure =
                    true;
            }
        } catch {
            secure =
                false;
        }

        return Array.from(
            {
                length:
                    GUEST_TOKEN_LENGTH
            },

            (
                _,
                index
            ) => {
                const randomNumber =
                    secure
                        ? values[index]
                        : Math.floor(
                            Math.random() *
                            alphabet.length
                        );

                return alphabet[
                    randomNumber %
                    alphabet.length
                ];
            }
        ).join("");
    }

    function buildGuestIdentity(
        token
    ) {
        const normalizedToken =
            normalizeGuestToken(
                token
            ) ||
            createGuestToken();

        return {
            token:
                normalizedToken,

            guestId:
                `guest_${normalizedToken}`,

            username:
                `${GUEST_USERNAME_PREFIX}${normalizedToken}`
        };
    }

    function readStoredGuestIdentity() {
        try {
            const raw =
                window.localStorage
                    ?.getItem(
                        GUEST_IDENTITY_KEY
                    );

            if (!raw) {
                return null;
            }

            const parsed =
                JSON.parse(
                    raw
                );

            if (
                !isPlainObject(
                    parsed
                )
            ) {
                return null;
            }

            const token =
                normalizeGuestToken(
                    parsed.token ||
                    parsed.guestId ||
                    parsed.username
                );

            return token
                ? buildGuestIdentity(
                    token
                )
                : null;
        } catch {
            return null;
        }
    }

    function storeGuestIdentity(
        identity
    ) {
        if (
            !isPlainObject(
                identity
            )
        ) {
            return false;
        }

        const token =
            normalizeGuestToken(
                identity.token ||
                identity.guestId ||
                identity.username
            );

        if (!token) {
            return false;
        }

        try {
            window.localStorage
                ?.setItem(
                    GUEST_IDENTITY_KEY,
                    JSON.stringify({
                        token
                    })
                );

            return true;
        } catch {
            return false;
        }
    }

    function getGuestIdentity() {
        const stored =
            readStoredGuestIdentity();

        if (stored) {
            return stored;
        }

        const identity =
            buildGuestIdentity(
                createGuestToken()
            );

        storeGuestIdentity(
            identity
        );

        return identity;
    }

    /* =====================================================
       USERNAME
    ===================================================== */

    function deriveUsername(
        explicitUsername,
        email,
        fallback = ""
    ) {
        const normalizedEmail =
            normalizeEmail(
                email
            );

        const separatorIndex =
            normalizedEmail
                .indexOf("@");

        if (
            separatorIndex >
                0
        ) {
            return normalizedEmail
                .slice(
                    0,
                    separatorIndex
                );
        }

        const username =
            toSafeString(
                explicitUsername
            )
                .replace(
                    /^@+/,
                    ""
                )
                .replace(
                    /\s+/g,
                    ""
                );

        return (
            username ||
            toSafeString(
                fallback
            )
        );
    }

    /* =====================================================
       GUEST PROFILE
    ===================================================== */

    function createGuestProfile() {
        const guest =
            getGuestIdentity();

        return {
            uid:
                "",

            guestId:
                guest.guestId,

            name:
                "Guest User",

            displayName:
                "Guest User",

            username:
                guest.username,

            email:
                "",

            photo:
                "",

            photoURL:
                "",

            emailVerified:
                false,

            phoneNumber:
                "",

            providerIds:
                [],

            signInProvider:
                "",

            googleConnected:
                false,

            isGoogleConnected:
                false,

            isGoogleSignIn:
                false,

            accountType:
                "guest",

            isAuthenticated:
                false,

            authenticated:
                false,

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            isMobileLocked:
                false,

            registrationDate:
                null,

            createdAt:
                null,

            lastLogin:
                null,

            lastLoginAt:
                null,

            status:
                ""
        };
    }

    /* =====================================================
       AUTHENTICATED PROFILE NORMALIZATION
    ===================================================== */

    function normalizeProfile(value) {
        if (
            !isPlainObject(
                value
            )
        ) {
            return createGuestProfile();
        }

        const uid =
            toSafeString(
                value.uid ||
                value.userId
            );

        const authenticated =
            Boolean(
                uid &&
                value.isAuthenticated !==
                    false &&
                value.authenticated !==
                    false
            );

        if (!authenticated) {
            return createGuestProfile();
        }

        const email =
            normalizeEmail(
                value.email
            );

        const providerIds =
            uniqueStrings(
                value.providerIds
            );

        const googleConnected =
            value.isGoogleConnected ===
                true ||
            value.googleConnected ===
                true ||
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        const signInProvider =
            toSafeString(
                value.signInProvider
            );

        const googleSignIn =
            value.isGoogleSignIn ===
                true ||
            signInProvider ===
                GOOGLE_PROVIDER_ID;

        const displayName =
            toSafeString(
                value.displayName ||
                value.name
            );

        const photoURL =
            toSafeString(
                value.photoURL ||
                value.photo
            );

        const mobileNumber =
            toSafeString(
                value.mobileNumber ||
                value.mobile
            );

        const mobileLocked =
            value.mobileLocked ===
                true ||
            value.isMobileLocked ===
                true ||
            Boolean(
                mobileNumber
            );

        const accountType =
            googleConnected
                ? "google"
                : (
                    toSafeString(
                        value.accountType
                    ) ||
                    "firebase"
                );

        return {
            uid,

            guestId:
                "",

            name:
                displayName,

            displayName,

            username:
                deriveUsername(
                    value.username,
                    email,
                    "user"
                ),

            email,

            photo:
                photoURL,

            photoURL,

            emailVerified:
                value.emailVerified ===
                    true,

            phoneNumber:
                toSafeString(
                    value.phoneNumber
                ),

            providerIds,

            signInProvider,

            googleConnected,

            isGoogleConnected:
                googleConnected,

            isGoogleSignIn:
                googleSignIn,

            accountType,

            isAuthenticated:
                true,

            authenticated:
                true,

            mobileNumber,

            mobileAdded:
                value.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked,

            isMobileLocked:
                mobileLocked,

            registrationDate:
                toNullableValue(
                    value.registrationDate ||
                    value.createdAt
                ),

            createdAt:
                toNullableValue(
                    value.createdAt ||
                    value.registrationDate
                ),

            lastLogin:
                toNullableValue(
                    value.lastLogin ||
                    value.lastLoginAt
                ),

            lastLoginAt:
                toNullableValue(
                    value.lastLoginAt ||
                    value.lastLogin
                ),

            status:
                toSafeString(
                    value.status
                )
        };
    }

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let currentProfile =
        freezeObject(
            createGuestProfile()
        );

    /* =====================================================
       STATE ACCESS
    ===================================================== */

    function getUser() {
        return cloneValue(
            currentProfile
        );
    }

    function getCurrentUser() {
        return getUser();
    }

    function isAuthenticated() {
        return Boolean(
            currentProfile
                ?.uid &&
            currentProfile
                ?.isAuthenticated ===
                true
        );
    }

    function isGuest() {
        return !isAuthenticated();
    }

    /* =====================================================
       PROFILE EVENTS
    ===================================================== */

    function dispatchProfileUpdate(
        previousProfile
    ) {
        const profile =
            getUser();

        window.dispatchEvent(
            new Event(
                "PROFILE_UPDATED"
            )
        );

        window.dispatchEvent(
            new CustomEvent(
                "profile:updated",
                {
                    detail: {
                        user:
                            profile,

                        previousUser:
                            cloneValue(
                                previousProfile
                            ),

                        authenticated:
                            profile
                                ?.isAuthenticated ===
                            true
                    }
                }
            )
        );

        return true;
    }

    /* =====================================================
       PROFILE MUTATION
    ===================================================== */

    function setUser(user) {
        const previousProfile =
            currentProfile;

        currentProfile =
            freezeObject(
                user
                    ? normalizeProfile(
                        user
                    )
                    : createGuestProfile()
            );

        dispatchProfileUpdate(
            previousProfile
        );

        return getUser();
    }

    function patchUser(updates) {
        if (
            !isPlainObject(
                updates
            )
        ) {
            return getUser();
        }

        /*
         * normalizeProfile() acts as the whitelist boundary.
         *
         * Even if an old module passes retired fields such as
         * wallet, referrals, usingTime, activity or deviceId,
         * those fields are discarded before entering state.
         */

        return setUser({
            ...getUser(),
            ...updates
        });
    }

    function clearUser() {
        return setUser(
            createGuestProfile()
        );
    }

    /* =====================================================
       PROFILE FIELD HELPERS
    ===================================================== */

    function setMobileNumber(
        mobileNumber
    ) {
        if (
            !isAuthenticated()
        ) {
            return getUser();
        }

        const normalizedMobile =
            toSafeString(
                mobileNumber
            );

        if (
            !normalizedMobile
        ) {
            return getUser();
        }

        return patchUser({
            mobileNumber:
                normalizedMobile,

            mobileAdded:
                true,

            mobileLocked:
                true,

            isMobileLocked:
                true
        });
    }

    function setProfileData(
        profile
    ) {
        return setUser(
            profile
        );
    }

    /* =====================================================
       LEGACY PRIVATE LOCAL DATA CLEANUP
    ===================================================== */

    function removeLegacyLocalData() {
        try {
            window.localStorage
                ?.removeItem(
                    LEGACY_USER_KEY
                );

            window.localStorage
                ?.removeItem(
                    LEGACY_START_TIME_KEY
                );

            return true;
        } catch (error) {
            console.warn(
                "[ProfileService] Legacy local profile data could not be removed.",
                error
            );

            return false;
        }
    }

    removeLegacyLocalData();

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        getUser,
        getCurrentUser,

        setUser,
        setProfileData,
        patchUser,
        clearUser,
        setMobileNumber,

        isAuthenticated,
        isGuest,

        getGuestIdentity,
        createGuestProfile,

        /*
         * Exposed so other Profile modules can sanitize data
         * through the same canonical whitelist.
         */

        normalizeProfile
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileService =
    ProfileService;