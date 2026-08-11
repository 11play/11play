"use strict";

/* =========================================================
   11PLAY — PROFILE UI CONTROLLER
   File: js/account/profile/profile.ui.js

   Responsibilities:
   - Render Guest and verified Google-user states
   - Render profile information
   - Delegate avatar rendering to ProfileAvatar
   - Delegate username rendering to ProfileUsername
   - Manage one-time mobile-number UI
   - Handle Google sign-in and logout actions
   - Show loading, success and error states
   - Clean up Profile-specific event listeners

   Profile scope:
   - Profile photo
   - Username
   - Name
   - Registration Date
   - Mobile
   - Gmail
   - Last Login
   - Account Type
   - Google authentication action

   Not handled here:
   - Referral
   - Reward
   - Referral Statistics
   - Referral Rules
   - Withdrawal
   - Wallet
   - Active Days
   - Activity tracking
   - Device eligibility
   - Offer
   - Live Chat
   - Direct Firebase writes
========================================================= */

const ProfileUI = (() => {
    "use strict";

    /* =====================================================
       DEFAULT PROFILE
    ===================================================== */

    const DEFAULT_PROFILE =
        Object.freeze({
            isAuthenticated:
                false,

            authenticated:
                false,

            uid:
                "",

            photoURL:
                "",

            username:
                "guest",

            displayName:
                "Guest User",

            email:
                "",

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

            accountType:
                "guest",

            isGoogleConnected:
                false,

            googleConnected:
                false,

            lastLogin:
                null
        });

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        root:
            null,

        initialized:
            false,

        currentProfile: {
            ...DEFAULT_PROFILE
        },

        isSubmittingMobile:
            false,

        isAuthLoading:
            false,

        handlers: {
            signIn:
                null,

            logout:
                null,

            saveMobile:
                null
        },

        listeners:
            []
    };

    let statusTimer =
        null;

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

    function normalizeString(
        value,
        fallback = ""
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }

        const normalizedValue =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
        );
    }

    function normalizeBoolean(value) {
        return value === true;
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

    function firstDefined(
        ...values
    ) {
        for (
            const value of values
        ) {
            if (
                value !== undefined &&
                value !== null &&
                value !== ""
            ) {
                return value;
            }
        }

        return undefined;
    }

    function escapeSelector(value) {
        if (
            window.CSS &&
            typeof window.CSS.escape ===
                "function"
        ) {
            return window.CSS.escape(
                String(value)
            );
        }

        return String(value)
            .replace(
                /([^\w-])/g,
                "\\$1"
            );
    }

    function getReadableErrorMessage(
        error,
        fallback =
            "The operation could not be completed."
    ) {
        const detailsMessage =
            normalizeString(
                error?.details?.message ||
                error?.details
                    ?.error?.message ||
                ""
            );

        if (
            detailsMessage &&
            detailsMessage
                .toLowerCase() !==
                "internal"
        ) {
            return detailsMessage;
        }

        const errorMessage =
            normalizeString(
                error?.message ||
                ""
            );

        if (
            errorMessage &&
            errorMessage
                .toLowerCase() !==
                "internal"
        ) {
            return errorMessage;
        }

        const errorCode =
            normalizeString(
                error?.code ||
                ""
            )
                .replace(
                    /^functions\//,
                    ""
                )
                .replace(
                    /^firestore\//,
                    ""
                );

        if (
            errorCode ===
            "failed-precondition"
        ) {
            return "The requested profile update is not available yet.";
        }

        if (
            errorCode ===
            "permission-denied"
        ) {
            return "This profile cannot currently be updated.";
        }

        if (
            errorCode ===
            "unauthenticated"
        ) {
            return "Sign in with Google to continue.";
        }

        if (
            errorCode ===
            "invalid-argument"
        ) {
            return "The submitted information is not valid.";
        }

        if (
            errorCode ===
            "already-exists"
        ) {
            return "This information is already linked to another account.";
        }

        return fallback;
    }

    /* =====================================================
       DOM HELPERS
    ===================================================== */

    function getElement(id) {
        const scope =
            state.root ||
            document;

        if (
            scope ===
            document
        ) {
            return document
                .getElementById(
                    id
                );
        }

        if (
            scope instanceof
                HTMLElement &&
            scope.id ===
                id
        ) {
            return scope;
        }

        return scope.querySelector(
            `#${escapeSelector(
                id
            )}`
        );
    }

    function setText(
        id,
        value,
        fallback =
            "Not available"
    ) {
        const element =
            getElement(
                id
            );

        if (!element) {
            return false;
        }

        element.textContent =
            normalizeString(
                value,
                fallback
            );

        return true;
    }

    /* =====================================================
       PROFILE SECTION VISIBILITY AND ORDER
    ===================================================== */

    function syncProfileSections(
        profile
    ) {
        const card =
            getElement(
                "profileInformationCard"
            );

        if (
            !(card instanceof
                HTMLElement)
        ) {
            return false;
        }

        const header =
            card.querySelector(
                ".profile-header"
            );

        const accountInformation =
            card.querySelector(
                ".profile-account-information"
            );

        const authSection =
            card.querySelector(
                ".profile-auth-section"
            );

        const authenticated =
            profile?.isAuthenticated ===
                true;

        if (
            accountInformation
        ) {
            accountInformation.hidden =
                !authenticated;

            accountInformation.setAttribute(
                "aria-hidden",
                String(
                    !authenticated
                )
            );
        }

        card.classList.toggle(
            "is-guest-profile",
            !authenticated
        );

        card.classList.toggle(
            "is-authenticated-profile",
            authenticated
        );

        /*
         * Guest:
         * Header → Sign in button
         */

        if (
            !authenticated &&
            header &&
            authSection
        ) {
            header.insertAdjacentElement(
                "afterend",
                authSection
            );

            return true;
        }

        /*
         * Authenticated:
         * Header → Account Information → Logout
         */

        if (
            authenticated &&
            accountInformation &&
            authSection
        ) {
            accountInformation
                .insertAdjacentElement(
                    "afterend",
                    authSection
                );
        }

        return true;
    }

    /* =====================================================
       MOBILE NUMBER NORMALIZATION
    ===================================================== */

    function sanitizeMobileDigits(
        value
    ) {
        return normalizeString(
            value
        )
            .replace(
                /\D/g,
                ""
            )
            .slice(
                0,
                10
            );
    }

    function normalizeMobileForDisplay(
        value
    ) {
        const digits =
            normalizeString(
                value
            )
                .replace(
                    /\D/g,
                    ""
                );

        if (
            /^8801[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+${digits}`;
        }

        if (
            /^01[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+88${digits}`;
        }

        if (
            /^1[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return `+880${digits}`;
        }

        return "";
    }

    function validateMobileNumber(
        value
    ) {
        const digits =
            sanitizeMobileDigits(
                value
            );

        if (!digits) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Mobile number is required."
            };
        }

        if (
            digits.length !==
            10
        ) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Enter exactly 10 digits after +880."
            };
        }

        if (
            !/^1[3-9]\d{8}$/
                .test(
                    digits
                )
        ) {
            return {
                valid:
                    false,

                digits,

                fullNumber:
                    "",

                message:
                    "Enter a valid Bangladesh mobile number."
            };
        }

        return {
            valid:
                true,

            digits,

            fullNumber:
                `+880${digits}`,

            message:
                ""
        };
    }

    /* =====================================================
       FIREBASE USER
    ===================================================== */

    function getCurrentFirebaseUser(
        uid = ""
    ) {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        let firebaseUser =
            configuredAuth
                ?.currentUser ||
            null;

        if (
            !firebaseUser &&
            window.firebase
                ?.auth
        ) {
            try {
                firebaseUser =
                    window.firebase
                        .auth()
                        .currentUser ||
                    null;
            } catch {
                firebaseUser =
                    null;
            }
        }

        if (
            !firebaseUser?.uid
        ) {
            return null;
        }

        const normalizedUid =
            normalizeString(
                uid
            );

        if (
            normalizedUid &&
            firebaseUser.uid !==
                normalizedUid
        ) {
            return null;
        }

        return firebaseUser;
    }

    /* =====================================================
       USERNAME
    ===================================================== */

    function deriveUsername(
        profile,
        email,
        authenticated
    ) {
        if (
            window.ProfileUsername &&
            typeof window
                .ProfileUsername
                .getUsername ===
                "function"
        ) {
            try {
                return window
                    .ProfileUsername
                    .getUsername(
                        {
                            ...profile,
                            email
                        },
                        {
                            allowGuest:
                                true
                        }
                    );
            } catch {
                /*
                 * Continue to local fallback.
                 */
            }
        }

        const emailUsername =
            email.includes("@")
                ? email.split("@")[0]
                : "";

        const username =
            normalizeString(
                emailUsername ||
                profile.username,
                authenticated
                    ? "user"
                    : "guest"
            )
                .replace(
                    /^@+/,
                    ""
                )
                .replace(
                    /\s+/g,
                    ""
                )
                .toLowerCase();

        return (
            username ||
            "guest"
        );
    }

    /* =====================================================
       GOOGLE ACCOUNT STATE
    ===================================================== */

    function isGoogleConnectedProfile(
        profile = {},
        uid = ""
    ) {
        const providerIds =
            Array.isArray(
                profile.providerIds
            )
                ? profile.providerIds
                    .map(
                        providerId =>
                            normalizeString(
                                providerId
                            )
                    )
                : [];

        const firebaseUser =
            getCurrentFirebaseUser(
                uid ||
                profile.uid
            );

        if (
            Array.isArray(
                firebaseUser
                    ?.providerData
            )
        ) {
            firebaseUser
                .providerData
                .forEach(
                    provider => {
                        const providerId =
                            normalizeString(
                                provider
                                    ?.providerId
                            );

                        if (
                            providerId &&
                            !providerIds
                                .includes(
                                    providerId
                                )
                        ) {
                            providerIds.push(
                                providerId
                            );
                        }
                    }
                );
        }

        return Boolean(
            profile.isGoogleConnected ===
                true ||
            profile.googleConnected ===
                true ||
            profile.isGoogleSignIn ===
                true ||
            providerIds.includes(
                "google.com"
            ) ||
            normalizeString(
                profile.accountType
            ).toLowerCase() ===
                "google"
        );
    }

    function normalizeAccountType(
        value,
        authenticated
    ) {
        if (!authenticated) {
            return "guest";
        }

        const accountType =
            normalizeString(
                value,
                "google"
            )
                .toLowerCase();

        return accountType ===
            "guest"
                ? "google"
                : accountType;
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function normalizeProfile(
        profile = {}
    ) {
        const source =
            isPlainObject(
                profile
            )
                ? profile
                : {};

        const uid =
            normalizeString(
                source.uid ||
                source.userId
            );

        const authenticated =
            normalizeBoolean(
                source.isAuthenticated
            ) ||
            normalizeBoolean(
                source.authenticated
            ) ||
            Boolean(
                uid
            );

        const firebaseUser =
            authenticated
                ? getCurrentFirebaseUser(
                    uid
                )
                : null;

        const email =
            normalizeString(
                source.email ||
                firebaseUser
                    ?.email
            )
                .toLowerCase();

        const username =
            deriveUsername(
                source,
                email,
                authenticated
            );

        const displayName =
            normalizeString(
                source.displayName ||
                source.name ||
                firebaseUser
                    ?.displayName,
                authenticated
                    ? username
                    : "Guest User"
            );

        const mobileNumber =
            normalizeMobileForDisplay(
                source.mobileNumber ||
                source.mobile
            );

        const googleConnected =
            authenticated &&
            isGoogleConnectedProfile(
                source,
                uid
            );

        const authMetadata =
            firebaseUser
                ?.metadata ||
            {};

        const registrationDate =
            firstDefined(
                source.registrationDate,
                source.createdAt,
                authMetadata.creationTime
            ) ||
            null;

        const lastLogin =
            firstDefined(
                source.lastLogin,
                source.lastLoginAt,
                authMetadata.lastSignInTime,
                registrationDate
            ) ||
            null;

        const mobileLocked =
            normalizeBoolean(
                source.isMobileLocked
            ) ||
            normalizeBoolean(
                source.mobileLocked
            ) ||
            Boolean(
                mobileNumber
            );

        return {
            ...DEFAULT_PROFILE,
            ...source,

            isAuthenticated:
                authenticated,

            authenticated,

            uid,

            photoURL:
                normalizeString(
                    source.photoURL ||
                    source.photo ||
                    firebaseUser
                        ?.photoURL
                ),

            username,

            displayName,

            email,

            isGoogleConnected:
                googleConnected,

            googleConnected,

            mobileNumber,

            mobileAdded:
                source.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked,

            isMobileLocked:
                mobileLocked,

            registrationDate,

            accountType:
                normalizeAccountType(
                    source.accountType,
                    authenticated
                ),

            lastLogin
        };
    }

    /* =====================================================
       AVATAR
    ===================================================== */

    function getAvatarInitial(
        profile
    ) {
        const source =
            normalizeString(
                profile.displayName ||
                profile.username ||
                profile.email,
                "G"
            );

        return source
            .charAt(0)
            .toUpperCase();
    }

    function showInitialFallback(
        image,
        fallback,
        avatar,
        profile
    ) {
        if (image) {
            image.hidden =
                true;

            image.onerror =
                null;

            image.removeAttribute(
                "src"
            );

            image.alt =
                "";
        }

        if (fallback) {
            fallback.hidden =
                false;

            fallback.textContent =
                getAvatarInitial(
                    profile
                );
        }

        if (avatar) {
            avatar.dataset
                .avatarState =
                "fallback";

            avatar.classList.add(
                "is-fallback"
            );

            avatar.classList.remove(
                "has-image"
            );
        }

        return true;
    }

    function renderAvatar(profile) {
        const image =
            getElement(
                "profileAvatarImage"
            );

        const fallback =
            getElement(
                "profileAvatarFallback"
            );

        const avatar =
            getElement(
                "profileAvatar"
            );

        if (
            !image ||
            !fallback ||
            !avatar
        ) {
            return false;
        }

        if (
            window.ProfileAvatar &&
            typeof window
                .ProfileAvatar
                .applyToImage ===
                "function"
        ) {
            try {
                window.ProfileAvatar
                    .applyToImage(
                        image,
                        profile
                    );

                image.hidden =
                    false;

                fallback.hidden =
                    true;

                avatar.dataset
                    .avatarState =
                    profile.photoURL
                        ? "google"
                        : "default";

                avatar.classList.add(
                    "has-image"
                );

                avatar.classList.remove(
                    "is-fallback"
                );

                avatar.setAttribute(
                    "aria-label",
                    profile.photoURL
                        ? "Google profile photo"
                        : "Default profile photo"
                );

                return true;
            } catch (error) {
                console.warn(
                    "[ProfileUI] ProfileAvatar could not render the image.",
                    error
                );
            }
        }

        const photoURL =
            normalizeString(
                profile.photoURL
            );

        if (
            !profile.isAuthenticated ||
            !photoURL
        ) {
            return showInitialFallback(
                image,
                fallback,
                avatar,
                profile
            );
        }

        image.onload =
            () => {
                image.hidden =
                    false;

                fallback.hidden =
                    true;

                avatar.dataset
                    .avatarState =
                    "google";

                avatar.classList.add(
                    "has-image"
                );

                avatar.classList.remove(
                    "is-fallback"
                );
            };

        image.onerror =
            () => {
                showInitialFallback(
                    image,
                    fallback,
                    avatar,
                    profile
                );
            };

        image.src =
            photoURL;

        image.alt =
            `${profile.displayName}'s profile photo`;

        image.referrerPolicy =
            "no-referrer";

        return true;
    }

    /* =====================================================
       USERNAME RENDERING
    ===================================================== */

    function renderUsername(
        profile
    ) {
        const element =
            getElement(
                "profileUsername"
            );

        if (!element) {
            return false;
        }

        if (
            window.ProfileUsername &&
            typeof window
                .ProfileUsername
                .applyToElement ===
                "function"
        ) {
            try {
                return window
                    .ProfileUsername
                    .applyToElement(
                        element,
                        profile,
                        {
                            allowGuest:
                                true
                        }
                    );
            } catch (error) {
                console.warn(
                    "[ProfileUI] ProfileUsername could not render the username.",
                    error
                );
            }
        }

        const username =
            normalizeString(
                profile.username,
                profile.isAuthenticated
                    ? "user"
                    : "guest"
            )
                .replace(
                    /^@+/,
                    ""
                );

        const displayUsername =
            `@${username}`;

        element.textContent =
            displayUsername;

        element.dataset.username =
            username;

        element.dataset.accountType =
            profile.isAuthenticated
                ? "google"
                : "guest";

        element.setAttribute(
            "aria-label",
            profile.isAuthenticated
                ? `Username ${displayUsername}`
                : "Guest username"
        );

        return displayUsername;
    }

    /* =====================================================
       DATE FORMATTING
    ===================================================== */

    function resolveDate(value) {
        if (!value) {
            return null;
        }

        if (
            typeof value ===
                "object" &&
            typeof value.toDate ===
                "function"
        ) {
            try {
                const firestoreDate =
                    value.toDate();

                return Number.isNaN(
                    firestoreDate
                        .getTime()
                )
                    ? null
                    : firestoreDate;
            } catch {
                return null;
            }
        }

        if (
            typeof value ===
                "object" &&
            typeof value.toMillis ===
                "function"
        ) {
            try {
                const firestoreDate =
                    new Date(
                        value.toMillis()
                    );

                return Number.isNaN(
                    firestoreDate
                        .getTime()
                )
                    ? null
                    : firestoreDate;
            } catch {
                return null;
            }
        }

        if (
            typeof value ===
                "object" &&
            typeof value.seconds ===
                "number"
        ) {
            const timestampDate =
                new Date(
                    value.seconds *
                    1000
                );

            return Number.isNaN(
                timestampDate
                    .getTime()
            )
                ? null
                : timestampDate;
        }

        const date =
            value instanceof
                Date
                ? value
                : new Date(
                    value
                );

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function formatDate(
        value,
        options = {}
    ) {
        const date =
            resolveDate(
                value
            );

        if (!date) {
            return "Not available";
        }

        try {
            return new Intl
                .DateTimeFormat(
                    "en-BD",
                    {
                        day:
                            "2-digit",

                        month:
                            "short",

                        year:
                            "numeric",

                        ...options
                    }
                )
                .format(
                    date
                );
        } catch {
            return "Not available";
        }
    }

    function formatDateTime(
        value
    ) {
        return formatDate(
            value,
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit",

                hour12:
                    true
            }
        );
    }

    /* =====================================================
       MOBILE ERROR
    ===================================================== */

    function showMobileError(
        message
    ) {
        const errorElement =
            getElement(
                "profileMobileError"
            );

        const input =
            getElement(
                "profileMobileInput"
            );

        const normalizedMessage =
            normalizeString(
                message
            );

        if (
            errorElement
        ) {
            errorElement.textContent =
                normalizedMessage;

            errorElement.hidden =
                !normalizedMessage;
        }

        if (input) {
            input.classList.toggle(
                "has-error",
                Boolean(
                    normalizedMessage
                )
            );

            input.setAttribute(
                "aria-invalid",
                String(
                    Boolean(
                        normalizedMessage
                    )
                )
            );
        }

        return true;
    }

    function clearMobileError() {
        return showMobileError(
            ""
        );
    }

    /* =====================================================
       MOBILE UI STATE
    ===================================================== */

    function renderMobileState(
        profile
    ) {
        const authenticated =
            profile.isAuthenticated;

        const locked =
            profile.isMobileLocked ===
                true &&
            Boolean(
                profile.mobileNumber
            );

        const emptyState =
            getElement(
                "profileMobileEmptyState"
            );

        const savedState =
            getElement(
                "profileMobileSavedState"
            );

        const input =
            getElement(
                "profileMobileInput"
            );

        const submitButton =
            getElement(
                "profileMobileSubmitButton"
            );

        const help =
            getElement(
                "profileMobileHelp"
            );

        if (
            !emptyState ||
            !savedState ||
            !input ||
            !submitButton
        ) {
            return false;
        }

        if (locked) {
            emptyState.hidden =
                true;

            emptyState.setAttribute(
                "aria-hidden",
                "true"
            );

            savedState.hidden =
                false;

            savedState.setAttribute(
                "aria-hidden",
                "false"
            );

            setText(
                "profileInfoMobile",
                profile.mobileNumber,
                "Not set"
            );

            input.value =
                "";

            input.disabled =
                true;

            input.readOnly =
                true;

            submitButton.disabled =
                true;

            submitButton.setAttribute(
                "aria-disabled",
                "true"
            );

            submitButton.textContent =
                "Submitted";

            submitButton.classList.remove(
                "is-loading"
            );

            submitButton.classList.add(
                "is-locked"
            );

            clearMobileError();

            return true;
        }

        emptyState.hidden =
            false;

        emptyState.setAttribute(
            "aria-hidden",
            "false"
        );

        savedState.hidden =
            true;

        savedState.setAttribute(
            "aria-hidden",
            "true"
        );

        input.readOnly =
            false;

        input.disabled =
            !authenticated ||
            state.isSubmittingMobile;

        submitButton.disabled =
            !authenticated ||
            state.isSubmittingMobile;

        submitButton.setAttribute(
            "aria-disabled",
            String(
                submitButton.disabled
            )
        );

        submitButton.textContent =
            state.isSubmittingMobile
                ? "Saving..."
                : "Submit";

        submitButton.classList.toggle(
            "is-loading",
            state.isSubmittingMobile
        );

        submitButton.classList.remove(
            "is-locked"
        );

        if (
            !authenticated
        ) {
            input.value =
                "";

            input.placeholder =
                "Sign in to add number";

            if (help) {
                help.textContent =
                    "Sign in with Google to add your mobile number.";
            }
        } else {
            input.placeholder =
                "1XXXXXXXXX";

            if (help) {
                help.textContent =
                    "Enter 10 digits after +880. This number can be submitted only once.";
            }
        }

        return true;
    }

    function setMobileSubmitting(
        isSubmitting
    ) {
        state.isSubmittingMobile =
            Boolean(
                isSubmitting
            );

        renderMobileState(
            state.currentProfile
        );

        return true;
    }

    function markMobileAsSaved(
        mobileNumber
    ) {
        const normalizedMobile =
            normalizeMobileForDisplay(
                mobileNumber
            );

        if (!normalizedMobile) {
            return false;
        }

        state.isSubmittingMobile =
            false;

        state.currentProfile = {
            ...state.currentProfile,

            mobileNumber:
                normalizedMobile,

            mobileAdded:
                true,

            mobileLocked:
                true,

            isMobileLocked:
                true
        };

        renderMobileState(
            state.currentProfile
        );

        showStatus(
            "Mobile number saved successfully.",
            "success",
            4000
        );

        return true;
    }

    /* =====================================================
       AUTHENTICATION UI
    ===================================================== */

    function getAccountTypeLabel(
        profile
    ) {
        if (
            !profile.isAuthenticated
        ) {
            return "Guest";
        }

        if (
            isGoogleConnectedProfile(
                profile,
                profile.uid
            )
        ) {
            return "Registered • Google Connected";
        }

        return "Registered";
    }

    function renderAuthState(
        profile
    ) {
        const page =
            getElement(
                "profilePage"
            );

        const button =
            getElement(
                "profileAuthButton"
            );

        const buttonText =
            getElement(
                "profileAuthButtonText"
            );

        const buttonIcon =
            getElement(
                "profileAuthButtonIcon"
            );

        if (page) {
            page.dataset.accountState =
                profile.isAuthenticated
                    ? "google"
                    : "guest";
        }

        if (
            !button ||
            !buttonText
        ) {
            return false;
        }

        button.disabled =
            state.isAuthLoading;

        button.setAttribute(
            "aria-busy",
            String(
                state.isAuthLoading
            )
        );

        button.classList.toggle(
            "is-loading",
            state.isAuthLoading
        );

        if (
            state.isAuthLoading
        ) {
            buttonText.textContent =
                "Please wait...";

            return true;
        }

        if (
            profile.isAuthenticated
        ) {
            button.dataset.action =
                "logout";

            button.classList.add(
                "is-logout"
            );

            button.classList.remove(
                "is-google-sign-in"
            );

            buttonText.textContent =
                "Logout";

            if (
                buttonIcon
            ) {
                buttonIcon.textContent =
                    "↪";
            }

            return true;
        }

        button.dataset.action =
            "google-sign-in";

        button.classList.add(
            "is-google-sign-in"
        );

        button.classList.remove(
            "is-logout"
        );

        buttonText.textContent =
            "Sign up with Google Account";

        if (
            buttonIcon
        ) {
            buttonIcon.textContent =
                "G";
        }

        return true;
    }

    /* =====================================================
       COMPLETE PROFILE RENDER
    ===================================================== */

    function render(
        profileData = {}
    ) {
        const profile =
            normalizeProfile(
                profileData
            );

        state.currentProfile =
            profile;

        renderAvatar(
            profile
        );

        renderUsername(
            profile
        );

        renderAuthState(
            profile
        );

        syncProfileSections(
            profile
        );

        renderMobileState(
            profile
        );

        setText(
            "profileInfoName",
            profile.isAuthenticated
                ? profile.displayName
                : "Guest User",
            "Guest User"
        );

        setText(
            "profileInfoEmail",
            profile.isAuthenticated
                ? profile.email
                : "Not signed in",
            "Not signed in"
        );

        setText(
            "profileRegistrationDate",
            profile.isAuthenticated
                ? formatDate(
                    profile.registrationDate
                )
                : "Not registered",
            "Not registered"
        );

        setText(
            "profileAccountType",
            getAccountTypeLabel(
                profile
            ),
            "Guest"
        );

        setText(
            "profileLastLogin",
            profile.isAuthenticated
                ? formatDateTime(
                    profile.lastLogin
                )
                : "Not available",
            "Not available"
        );

        return profile;
    }

    function renderGuest(
        overrides = {}
    ) {
        return render({
            ...DEFAULT_PROFILE,
            ...overrides,

            uid:
                "",

            isAuthenticated:
                false,

            authenticated:
                false,

            accountType:
                "guest",

            isGoogleConnected:
                false,

            googleConnected:
                false,

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            isMobileLocked:
                false
        });
    }

    function renderRegisteredUser(
        profile = {}
    ) {
        return render({
            ...profile,

            isAuthenticated:
                true,

            authenticated:
                true,

            accountType:
                normalizeString(
                    profile.accountType,
                    "google"
                )
        });
    }

    /* =====================================================
       AUTH ACTION
    ===================================================== */

    function setAuthButtonLoading(
        isLoading
    ) {
        state.isAuthLoading =
            Boolean(
                isLoading
            );

        renderAuthState(
            state.currentProfile
        );

        return true;
    }

    async function handleAuthAction() {
        const button =
            getElement(
                "profileAuthButton"
            );

        if (
            !button ||
            button.disabled ||
            state.isAuthLoading
        ) {
            return;
        }

        const action =
            normalizeString(
                button.dataset.action
            );

        clearMobileError();
        hideStatus();

        setAuthButtonLoading(
            true
        );

        try {
            if (
                action ===
                    "logout" &&
                typeof state.handlers
                    .logout ===
                    "function"
            ) {
                await state.handlers
                    .logout();

                return;
            }

            if (
                action ===
                    "google-sign-in" &&
                typeof state.handlers
                    .signIn ===
                    "function"
            ) {
                await state.handlers
                    .signIn();

                return;
            }

            window.dispatchEvent(
                new CustomEvent(
                    "profile:auth-action",
                    {
                        detail: {
                            action
                        }
                    }
                )
            );
        } catch (error) {
            console.error(
                "[ProfileUI] Authentication action failed.",
                error
            );

            showStatus(
                getReadableErrorMessage(
                    error,
                    "The account action could not be completed."
                ),
                "error",
                5000
            );
        } finally {
            setAuthButtonLoading(
                false
            );
        }
    }

    /* =====================================================
       MOBILE SUBMISSION
    ===================================================== */

    function handleMobileInput(
        event
    ) {
        const input =
            event.currentTarget;

        const digits =
            sanitizeMobileDigits(
                input.value
            );

        if (
            input.value !==
            digits
        ) {
            input.value =
                digits;
        }

        clearMobileError();
    }

    function extractSavedMobile(
        result,
        fallbackMobile
    ) {
        return normalizeMobileForDisplay(
            result?.profile
                ?.mobileNumber ||
            result?.mobileNumber ||
            result?.data
                ?.profile
                ?.mobileNumber ||
            result?.data
                ?.mobileNumber ||
            fallbackMobile
        );
    }

    async function handleMobileSubmit() {
        if (
            state.isSubmittingMobile
        ) {
            return;
        }

        const input =
            getElement(
                "profileMobileInput"
            );

        if (
            !input ||
            input.disabled ||
            input.readOnly
        ) {
            return;
        }

        if (
            !state.currentProfile
                .isAuthenticated
        ) {
            showMobileError(
                "Sign in with Google before adding a mobile number."
            );

            return;
        }

        if (
            state.currentProfile
                .isMobileLocked
        ) {
            showMobileError(
                "The mobile number has already been saved."
            );

            return;
        }

        const validation =
            validateMobileNumber(
                input.value
            );

        if (
            !validation.valid
        ) {
            showMobileError(
                validation.message
            );

            input.focus();

            return;
        }

        clearMobileError();

        if (
            typeof state.handlers
                .saveMobile !==
                "function"
        ) {
            window.dispatchEvent(
                new CustomEvent(
                    "profile:save-mobile",
                    {
                        detail: {
                            mobileNumber:
                                validation
                                    .fullNumber
                        }
                    }
                )
            );

            return;
        }

        setMobileSubmitting(
            true
        );

        try {
            const result =
                await state.handlers
                    .saveMobile(
                        validation
                            .fullNumber
                    );

            if (
                result === false
            ) {
                throw new Error(
                    "Mobile number could not be saved."
                );
            }

            const savedMobile =
                extractSavedMobile(
                    result,
                    validation
                        .fullNumber
                );

            if (!savedMobile) {
                throw new Error(
                    "The server did not return a valid mobile number."
                );
            }

            markMobileAsSaved(
                savedMobile
            );
        } catch (error) {
            console.error(
                "[ProfileUI] Mobile number submission failed.",
                error
            );

            setMobileSubmitting(
                false
            );

            showMobileError(
                getReadableErrorMessage(
                    error,
                    "Unable to save the mobile number."
                )
            );
        }
    }

    function handleMobileKeydown(
        event
    ) {
        if (
            event.key !==
            "Enter"
        ) {
            return;
        }

        event.preventDefault();

        void handleMobileSubmit();
    }

    /* =====================================================
       PAGE STATUS
    ===================================================== */

    function showStatus(
        message,
        type = "info",
        duration = 0
    ) {
        const status =
            getElement(
                "profilePageStatus"
            );

        if (!status) {
            return false;
        }

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
        }

        const normalizedMessage =
            normalizeString(
                message
            );

        status.textContent =
            normalizedMessage;

        status.hidden =
            !normalizedMessage;

        status.dataset.statusType =
            normalizeString(
                type,
                "info"
            );

        status.classList.toggle(
            "is-success",
            type ===
                "success"
        );

        status.classList.toggle(
            "is-error",
            type ===
                "error"
        );

        status.classList.toggle(
            "is-info",
            type ===
                "info"
        );

        if (
            normalizedMessage &&
            duration >
                0
        ) {
            statusTimer =
                window.setTimeout(
                    hideStatus,
                    duration
                );
        }

        return true;
    }

    function hideStatus() {
        const status =
            getElement(
                "profilePageStatus"
            );

        if (!status) {
            return false;
        }

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
        }

        status.hidden =
            true;

        status.textContent =
            "";

        delete status.dataset
            .statusType;

        status.classList.remove(
            "is-success",
            "is-error",
            "is-info"
        );

        return true;
    }

    /* =====================================================
       PAGE LOADING
    ===================================================== */

    function setPageLoading(
        isLoading
    ) {
        const page =
            getElement(
                "profilePage"
            );

        if (!page) {
            return false;
        }

        const loading =
            Boolean(
                isLoading
            );

        page.classList.toggle(
            "is-loading",
            loading
        );

        page.setAttribute(
            "aria-busy",
            String(
                loading
            )
        );

        return true;
    }

    /* =====================================================
       EVENT MANAGEMENT
    ===================================================== */

    function addManagedListener(
        element,
        eventName,
        handler,
        options
    ) {
        if (
            !element ||
            typeof element
                .addEventListener !==
                "function"
        ) {
            return false;
        }

        element.addEventListener(
            eventName,
            handler,
            options
        );

        state.listeners.push({
            element,
            eventName,
            handler,
            options
        });

        return true;
    }

    function removeAllListeners() {
        state.listeners.forEach(
            ({
                element,
                eventName,
                handler,
                options
            }) => {
                try {
                    element
                        .removeEventListener(
                            eventName,
                            handler,
                            options
                        );
                } catch {
                    /*
                     * No additional cleanup required.
                     */
                }
            }
        );

        state.listeners =
            [];

        return true;
    }

    function bindEvents() {
        removeAllListeners();

        addManagedListener(
            getElement(
                "profileAuthButton"
            ),
            "click",
            handleAuthAction
        );

        addManagedListener(
            getElement(
                "profileMobileInput"
            ),
            "input",
            handleMobileInput
        );

        addManagedListener(
            getElement(
                "profileMobileInput"
            ),
            "keydown",
            handleMobileKeydown
        );

        addManagedListener(
            getElement(
                "profileMobileSubmitButton"
            ),
            "click",
            handleMobileSubmit
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function initialize(
        options = {}
    ) {
        destroy();

        state.root =
            options.root instanceof
                HTMLElement
                ? options.root
                : document;

        state.handlers = {
            signIn:
                typeof options
                    .onSignIn ===
                    "function"
                    ? options.onSignIn
                    : null,

            logout:
                typeof options
                    .onLogout ===
                    "function"
                    ? options.onLogout
                    : null,

            saveMobile:
                typeof options
                    .onSaveMobile ===
                    "function"
                    ? options.onSaveMobile
                    : null
        };

        const profilePage =
            getElement(
                "profilePage"
            );

        if (!profilePage) {
            console.error(
                "[ProfileUI] ProfileView must be rendered before ProfileUI initialization."
            );

            state.root =
                null;

            return false;
        }

        const initialProfile =
            normalizeProfile(
                options.profile ||
                DEFAULT_PROFILE
            );

        bindEvents();

        state.initialized =
            true;

        render(
            initialProfile
        );

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        removeAllListeners();

        if (
            statusTimer
        ) {
            window.clearTimeout(
                statusTimer
            );

            statusTimer =
                null;
        }

        const image =
            getElement(
                "profileAvatarImage"
            );

        if (image) {
            image.onload =
                null;

            image.onerror =
                null;
        }

        state.root =
            null;

        state.initialized =
            false;

        state.currentProfile = {
            ...DEFAULT_PROFILE
        };

        state.isSubmittingMobile =
            false;

        state.isAuthLoading =
            false;

        state.handlers = {
            signIn:
                null,

            logout:
                null,

            saveMobile:
                null
        };

        return true;
    }

    function isInitialized() {
        return state.initialized;
    }

    /* =====================================================
       TEMPORARY COMPATIBILITY

       Old ProfileModule versions may still call these
       methods before that module is replaced.

       They intentionally perform no activity/referral work.
    ===================================================== */

    function normalizeActivity() {
        return {};
    }

    function renderUsingTime() {
        return true;
    }

    function updateUsingTime() {
        return true;
    }

    function renderActivity() {
        return true;
    }

    function updateActivity() {
        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        initialize,
        destroy,
        isInitialized,

        render,
        renderGuest,
        renderRegisteredUser,

        renderAvatar,
        renderUsername,

        normalizeProfile,

        validateMobileNumber,
        normalizeMobileForDisplay,

        setMobileSubmitting,
        markMobileAsSaved,

        showMobileError,
        clearMobileError,

        setPageLoading,
        setAuthButtonLoading,

        showStatus,
        hideStatus,

        formatDate,
        formatDateTime,

        /*
         * Temporary no-op compatibility API.
         * Removed activity system is not executed.
         */
        normalizeActivity,
        renderUsingTime,
        updateUsingTime,
        renderActivity,
        updateActivity,

        getCurrentProfile() {
            return cloneValue(
                state.currentProfile
            );
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileUI =
    ProfileUI;