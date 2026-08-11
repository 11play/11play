"use strict";

/* =========================================================
   11PLAY — PROFILE VIEW
   File: js/account/profile/profile.view.js

   Responsibilities:
   - Render the Profile and Account Information card
   - Render Google avatar and username placeholders
   - Render one-time mobile-number input
   - Provide stable selectors for ProfileUI modules

   Profile contains only:
   - Profile photo
   - Username
   - Name
   - Registration Date
   - Mobile
   - Gmail
   - Last Login
   - Account Type
   - Authentication action

   Important:
   - This file contains markup only
   - It does not read or write Firebase data
   - It does not perform authentication
   - It does not perform account navigation
========================================================= */

const ProfileView = (() => {
    "use strict";

    /* =====================================================
       PROFILE TEMPLATE
    ===================================================== */

    function getTemplate() {
        return `
            <main
                id="profilePage"
                class="profile-page"
                data-account-page="profile"
                data-account-state="guest"
                aria-labelledby="profilePageTitle"
            >
                <!-- =========================================
                     PROFILE + ACCOUNT INFORMATION
                ========================================== -->

                <section
                    id="profileInformationCard"
                    class="profile-card profile-information-card"
                    aria-labelledby="profilePageTitle"
                >
                    <!-- =====================================
                         PROFILE HEADER
                    ====================================== -->

                    <header class="profile-header">
                        <div
                            id="profileAvatar"
                            class="profile-avatar"
                            data-avatar-state="guest"
                        >
                            <img
                                id="profileAvatarImage"
                                class="profile-avatar-image"
                                src=""
                                alt="Profile photo"
                                referrerpolicy="no-referrer"
                                decoding="async"
                                hidden
                            >

                            <span
                                id="profileAvatarFallback"
                                class="profile-avatar-fallback"
                                aria-hidden="true"
                            >
                                G
                            </span>
                        </div>

                        <h1
                            id="profilePageTitle"
                            class="sr-only"
                        >
                            Profile
                        </h1>

                        <p
                            id="profileUsername"
                            class="profile-username"
                            aria-label="Guest username"
                        >
                            @11guest-xxxxxx
                        </p>
                    </header>

                    <!-- =====================================
                         ACCOUNT INFORMATION
                    ====================================== -->

                    <div class="profile-account-information">
                        <dl class="profile-information-list">

                            <!-- =================================
                                 NAME + REGISTRATION DATE
                            ================================== -->

                            <div
                                class="profile-information-row profile-information-pair-row"
                                data-paired-row
                            >
                                <div class="profile-information-pair">
                                    <dt class="profile-information-label">
                                        Name
                                    </dt>

                                    <dd
                                        id="profileInfoName"
                                        class="profile-information-value"
                                    >
                                        Guest User
                                    </dd>
                                </div>

                                <div class="profile-information-pair">
                                    <dt class="profile-information-label">
                                        Registration Date
                                    </dt>

                                    <dd
                                        id="profileRegistrationDate"
                                        class="profile-information-value"
                                    >
                                        Not registered
                                    </dd>
                                </div>
                            </div>

                            <!-- =================================
                                 MOBILE NUMBER
                            ================================== -->

                            <div
                                class="profile-information-row profile-mobile-row"
                            >
                                <dt class="profile-information-label">
                                    Mobile
                                </dt>

                                <dd class="profile-information-value">

                                    <!-- Mobile entry state -->

                                    <div
                                        id="profileMobileEmptyState"
                                        class="profile-mobile-empty-state"
                                    >
                                        <div class="profile-phone-input-group">
                                            <span
                                                class="profile-phone-prefix"
                                                aria-hidden="true"
                                            >
                                                +880
                                            </span>

                                            <label
                                                class="sr-only"
                                                for="profileMobileInput"
                                            >
                                                Enter your 10-digit mobile number
                                            </label>

                                            <input
                                                id="profileMobileInput"
                                                class="profile-phone-input"
                                                type="tel"
                                                inputmode="numeric"
                                                autocomplete="tel-national"
                                                maxlength="10"
                                                pattern="1[3-9][0-9]{8}"
                                                placeholder="1XXXXXXXXX"
                                                aria-describedby="profileMobileHelp profileMobileError"
                                            >

                                            <button
                                                id="profileMobileSubmitButton"
                                                class="profile-mobile-submit-button"
                                                type="button"
                                            >
                                                Submit
                                            </button>
                                        </div>

                                        <small
                                            id="profileMobileHelp"
                                            class="profile-field-help"
                                        >
                                            This number can be submitted only once.
                                        </small>

                                        <small
                                            id="profileMobileError"
                                            class="profile-field-error"
                                            role="alert"
                                            aria-live="assertive"
                                            hidden
                                        ></small>
                                    </div>

                                    <!-- Saved and locked state -->

                                    <div
                                        id="profileMobileSavedState"
                                        class="profile-mobile-saved-state"
                                        hidden
                                    >
                                        <span id="profileInfoMobile">
                                            Not set
                                        </span>

                                        <span
                                            class="profile-mobile-lock"
                                            aria-label="Mobile number locked"
                                            title="Mobile number cannot be edited"
                                        >
                                            🔒
                                        </span>
                                    </div>
                                </dd>
                            </div>

                            <!-- =================================
                                 GMAIL
                            ================================== -->

                            <div class="profile-information-row">
                                <dt class="profile-information-label">
                                    Gmail
                                </dt>

                                <dd
                                    id="profileInfoEmail"
                                    class="profile-information-value"
                                >
                                    Not signed in
                                </dd>
                            </div>

                            <!-- =================================
                                 LAST LOGIN + ACCOUNT TYPE
                            ================================== -->

                            <div
                                class="profile-information-row profile-information-pair-row"
                                data-paired-row
                            >
                                <div class="profile-information-pair">
                                    <dt class="profile-information-label">
                                        Last Login
                                    </dt>

                                    <dd
                                        id="profileLastLogin"
                                        class="profile-information-value"
                                    >
                                        Not available
                                    </dd>
                                </div>

                                <div
                                    class="profile-information-pair profile-account-type-row"
                                >
                                    <dt class="profile-information-label">
                                        Account Type
                                    </dt>

                                    <dd
                                        id="profileAccountType"
                                        class="profile-information-value profile-account-type-value"
                                    >
                                        Guest
                                    </dd>
                                </div>
                            </div>
                        </dl>
                    </div>

                    <!-- =====================================
                         AUTHENTICATION ACTION
                    ====================================== -->

                    <div class="profile-auth-section">
                        <button
                            id="profileAuthButton"
                            class="profile-auth-button"
                            type="button"
                            data-action="google-sign-in"
                            aria-busy="false"
                        >
                            <span
                                id="profileAuthButtonIcon"
                                class="profile-auth-button-icon"
                                aria-hidden="true"
                            >
                                G
                            </span>

                            <span id="profileAuthButtonText">
                                Sign up with Google Account
                            </span>
                        </button>
                    </div>
                </section>

                <!-- =========================================
                     PAGE STATUS
                ========================================== -->

                <div
                    id="profilePageStatus"
                    class="profile-page-status"
                    role="status"
                    aria-live="polite"
                    hidden
                ></div>
            </main>
        `;
    }

    /* =====================================================
       ROOT RESOLUTION
    ===================================================== */

    function resolveRoot(root) {
        if (
            root instanceof
            HTMLElement
        ) {
            return root;
        }

        if (
            typeof root ===
                "string" &&
            root.trim()
        ) {
            return document.querySelector(
                root.trim()
            );
        }

        return null;
    }

    /* =====================================================
       RENDER
    ===================================================== */

    function render(root) {
        const targetRoot =
            resolveRoot(
                root
            );

        if (
            !(targetRoot instanceof
                HTMLElement)
        ) {
            console.error(
                "[ProfileView] A valid root element is required."
            );

            return false;
        }

        targetRoot.innerHTML =
            getTemplate();

        return (
            targetRoot.querySelector(
                "#profilePage"
            ) ||
            false
        );
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        getTemplate,
        render
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileView =
    ProfileView;