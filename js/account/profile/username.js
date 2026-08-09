"use strict";

/* =========================================================
   11PLAY — PROFILE USERNAME
   File: js/account/profile/username.js

   Responsibilities:
   - Generate the display username from Google email
   - Use only the Gmail/email local part
   - Display the persistent Guest username from ProfileService
   - Add the @ prefix for display
   - Apply the username to a DOM element
   - Never save or modify username data
========================================================= */

(function initializeProfileUsername(
    window
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const GUEST_USERNAME =
        "11guest-xxxxxx";

    const USERNAME_PREFIX =
        "@";

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizeString(value) {
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

    function normalizeAccountType(value) {
        const accountType =
            normalizeString(value)
                .toLowerCase();

        if (
            accountType === "google" ||
            accountType === "firebase"
        ) {
            return accountType;
        }

        return "guest";
    }

    /* =====================================================
       EMAIL NORMALIZATION
    ===================================================== */

    function normalizeEmail(value) {
        const email =
            normalizeString(value)
                .toLowerCase();

        if (
            !email ||
            !email.includes("@")
        ) {
            return "";
        }

        const parts =
            email.split("@");

        if (
            parts.length !== 2 ||
            !parts[0] ||
            !parts[1]
        ) {
            return "";
        }

        return email;
    }

    function getEmailLocalPart(value) {
        const email =
            normalizeEmail(value);

        if (!email) {
            return "";
        }

        return email
            .split("@")[0]
            .trim();
    }

    /* =====================================================
       USERNAME NORMALIZATION
    ===================================================== */

    function normalizeUsername(value) {
        return normalizeString(value)
            .replace(
                /^@+/,
                ""
            )
            .replace(
                /\s+/g,
                ""
            )
            .replace(
                /[^a-zA-Z0-9._-]/g,
                ""
            )
            .toLowerCase();
    }

    function deriveUsernameFromEmail(
        email
    ) {
        const localPart =
            getEmailLocalPart(
                email
            );

        if (!localPart) {
            return "";
        }

        return normalizeUsername(
            localPart
        );
    }

    /* =====================================================
       ACCOUNT STATE
    ===================================================== */

    function isAuthenticatedProfile(
        profile = {}
    ) {
        const source =
            profile &&
            typeof profile === "object"
                ? profile
                : {};

        return Boolean(
            normalizeString(
                source.uid
            ) &&
            source.isAuthenticated === true
        );
    }

    function isGuestProfile(
        profile = {}
    ) {
        return !isAuthenticatedProfile(
            profile
        );
    }

    function getAccountType(
        profile = {}
    ) {
        const source =
            profile &&
            typeof profile === "object"
                ? profile
                : {};

        if (
            isGuestProfile(source)
        ) {
            return "guest";
        }

        if (
            source.isGoogleConnected === true ||
            source.googleConnected === true ||
            source.isGoogleSignIn === true
        ) {
            return "google";
        }

        return normalizeAccountType(
            source.accountType
        );
    }

    /* =====================================================
       GUEST USERNAME
    ===================================================== */

    function getPersistentGuestUsername(
        profile = {}
    ) {
        const source =
            profile &&
            typeof profile === "object"
                ? profile
                : {};

        const profileUsername =
            normalizeUsername(
                source.username
            );

        if (
            profileUsername.startsWith(
                "11guest-"
            )
        ) {
            return profileUsername;
        }

        if (
            window.ProfileService &&
            typeof window
                .ProfileService
                .getGuestIdentity ===
                "function"
        ) {
            try {
                const identity =
                    window.ProfileService
                        .getGuestIdentity();

                const identityUsername =
                    normalizeUsername(
                        identity?.username
                    );

                if (
                    identityUsername.startsWith(
                        "11guest-"
                    )
                ) {
                    return identityUsername;
                }
            } catch (error) {
                console.warn(
                    "[ProfileUsername] Guest identity could not be read.",
                    error
                );
            }
        }

        return GUEST_USERNAME;
    }

    /* =====================================================
       PROFILE USERNAME
    ===================================================== */

    function getUsername(
        profile = {},
        options = {}
    ) {
        const source =
            profile &&
            typeof profile === "object"
                ? profile
                : {};

        if (
            isAuthenticatedProfile(source)
        ) {
            const usernameFromEmail =
                deriveUsernameFromEmail(
                    source.email
                );

            if (usernameFromEmail) {
                return usernameFromEmail;
            }

            const storedUsername =
                normalizeUsername(
                    source.username
                );

            if (storedUsername) {
                return storedUsername;
            }

            return "";
        }

        if (
            options.allowGuest === false
        ) {
            return "";
        }

        return getPersistentGuestUsername(
            source
        );
    }

    function formatUsername(
        username
    ) {
        const normalizedUsername =
            normalizeUsername(
                username
            );

        if (!normalizedUsername) {
            return "";
        }

        return (
            USERNAME_PREFIX +
            normalizedUsername
        );
    }

    function getDisplayUsername(
        profile = {},
        options = {}
    ) {
        return formatUsername(
            getUsername(
                profile,
                options
            )
        );
    }

    /* =====================================================
       DOM APPLICATION
    ===================================================== */

    function applyToElement(
        element,
        profile = {},
        options = {}
    ) {
        if (
            !(element instanceof
                HTMLElement)
        ) {
            return false;
        }

        const username =
            getUsername(
                profile,
                options
            );

        const displayUsername =
            formatUsername(
                username
            );

        const accountType =
            getAccountType(
                profile
            );

        const isGuest =
            accountType === "guest";

        element.textContent =
            displayUsername;

        element.dataset.username =
            username;

        element.dataset.accountType =
            accountType;

        element.setAttribute(
            "aria-label",
            isGuest
                ? `Guest username ${displayUsername}`
                : `Username ${displayUsername}`
        );

        return displayUsername;
    }

    function resetElement(element) {
        if (
            !(element instanceof
                HTMLElement)
        ) {
            return false;
        }

        const guestUsername =
            getPersistentGuestUsername();

        const displayUsername =
            formatUsername(
                guestUsername
            );

        element.textContent =
            displayUsername;

        element.dataset.username =
            guestUsername;

        element.dataset.accountType =
            "guest";

        element.setAttribute(
            "aria-label",
            `Guest username ${displayUsername}`
        );

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.ProfileUsername =
        Object.freeze({
            normalizeEmail,
            normalizeUsername,

            getEmailLocalPart,
            deriveUsernameFromEmail,

            isAuthenticatedProfile,
            isGuestProfile,
            getAccountType,

            getUsername,
            getDisplayUsername,
            formatUsername,

            applyToElement,
            resetElement,

            GUEST_USERNAME,
            USERNAME_PREFIX
        });
})(
    window
);