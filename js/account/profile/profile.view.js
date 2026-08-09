"use strict";

/* =========================================================
   11PLAY — PROFILE VIEW
   File: js/account/profile/profile.view.js

   Responsibilities:
   - Render the Profile and Account Information card
   - Render Google avatar and username placeholders
   - Render one-time mobile-number input
   - Render server-authoritative Eligible Active Days progress
   - Preserve the existing six-box visual pattern
   - Provide the Shared Account Sections mount
   - Provide stable selectors for ProfileUI modules

   Final referral activity contract:
   - Verified Google account
   - Unique Bangladesh mobile number
   - Unique Web Device anti-abuse binding
   - 7 different Bangladesh calendar days
   - Minimum 120 eligible active minutes per day
   - A day counts only after its full 2-hour requirement
   - Partial activity never becomes a partial Active Day
   - Browser clock is never authoritative

   Important:
   - This file contains markup only
   - It does not read or write Firebase data
   - It does not calculate Eligible Active Days
   - It does not calculate eligible minutes
   - It does not determine device uniqueness
   - It does not perform authentication
   - It does not perform account navigation
========================================================= */

const ProfileView = (() => {
    "use strict";

    const REQUIRED_ACTIVE_DAYS =
        7;

    const REQUIRED_DAILY_MINUTES =
        120;

    const ACTIVITY_POLICY_VERSION =
        2;

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
                    <!-- Profile header -->

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
                            <!-- Name + Registration Date -->

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

                            <!-- Mobile number -->

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

                                    <!-- Saved and permanently locked state -->

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

                            <!-- Gmail -->

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

                            <!-- Last Login + Account Type -->

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
                         ELIGIBLE ACTIVITY

                         Existing six-box layout is preserved.

                         Final rule:
                         - 7 different Bangladesh days
                         - 120 eligible minutes each day
                         - Day becomes +1 only after 120 minutes
                         - Firestore server time is authoritative
                    ====================================== -->

                    <section
                        id="profileUsingTimeSection"
                        class="profile-using-time-section"
                        aria-labelledby="profileUsingTimeTitle"
                    >
                        <div class="profile-using-time-heading">
                            <h2 id="profileUsingTimeTitle">
                                Active Days
                            </h2>

                            <span
                                id="usingTimeStatus"
                                class="profile-using-time-status"
                                data-using-time-status
                                data-completed="false"
                                data-current-day-completed="false"
                                aria-live="polite"
                            >
                                Eligible Active Days: 0/${REQUIRED_ACTIVE_DAYS} • Today: 0/${REQUIRED_DAILY_MINUTES} min
                            </span>
                        </div>

                        <div
                            id="profileUsingTime"
                            class="profile-using-time-grid"
                            data-using-time
                            data-activity-model="eligible-active-days"
                            data-activity-policy-version="${ACTIVITY_POLICY_VERSION}"
                            data-required-daily-minutes="${REQUIRED_DAILY_MINUTES}"
                            data-completed="false"
                            data-device-bound="false"
                            data-current-day-completed="false"
                            data-current-day-key=""
                            data-current-day-seconds="0"
                            data-today-active-seconds="0"
                            data-today-active-minutes="0"
                            data-required-daily-seconds="${REQUIRED_DAILY_MINUTES * 60}"
                            data-remaining-today-seconds="${REQUIRED_DAILY_MINUTES * 60}"
                            data-remaining-today-minutes="${REQUIRED_DAILY_MINUTES}"
                            data-daily-progress-percent="0"
                            data-eligible-active-days="0"
                            data-required-active-days="${REQUIRED_ACTIVE_DAYS}"
                            data-remaining-active-days="${REQUIRED_ACTIVE_DAYS}"
                            data-progress-percent="0"
                            data-total-active-seconds="0"
                            data-required-active-seconds="${REQUIRED_ACTIVE_DAYS * REQUIRED_DAILY_MINUTES * 60}"
                            data-remaining-active-seconds="${REQUIRED_ACTIVE_DAYS * REQUIRED_DAILY_MINUTES * 60}"
                            aria-label="Eligible active-day progress. Seven different days are required, with two eligible active hours per day."
                        >
                            <!-- 1. Completed Eligible Active Days -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeActiveDays"
                                    data-using-time-value="active-days"
                                >
                                    00
                                </strong>

                                <small>
                                    Active Days
                                </small>
                            </div>

                            <!-- 2. Required Eligible Active Days -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeRequiredDays"
                                    data-using-time-value="required-days"
                                >
                                    07
                                </strong>

                                <small>
                                    Required
                                </small>
                            </div>

                            <!-- 3. Remaining Eligible Active Days -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeRemainingDays"
                                    data-using-time-value="remaining-days"
                                >
                                    07
                                </strong>

                                <small>
                                    Remaining
                                </small>
                            </div>

                            <!-- 4. Overall Eligible-Day Progress -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeProgressText"
                                    data-using-time-value="progress"
                                >
                                    0%
                                </strong>

                                <small>
                                    Progress
                                </small>
                            </div>

                            <!-- 5. Last completed Eligible Active Day -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeLastActiveDay"
                                    data-using-time-value="last-active-day"
                                >
                                    —
                                </strong>

                                <small>
                                    Last Active
                                </small>
                            </div>

                            <!-- 6. Current eligibility state -->

                            <div class="profile-time-box">
                                <strong
                                    id="usingTimeEligibilityState"
                                    data-using-time-value="eligibility-state"
                                >
                                    Pending
                                </strong>

                                <small>
                                    Status
                                </small>
                            </div>
                        </div>

                        <!--
                            Non-visual stable hooks for the 2-hour
                            daily activity contract.

                            These do not change the existing design.
                            ProfileUI / ProfileUsingTime may update them.
                        -->

                        <span
                            id="usingTimeTodayMinutes"
                            data-using-time-value="today-minutes"
                            hidden
                        >
                            0
                        </span>

                        <span
                            id="usingTimeRequiredDailyMinutes"
                            data-using-time-value="required-daily-minutes"
                            hidden
                        >
                            ${REQUIRED_DAILY_MINUTES}
                        </span>

                        <span
                            id="usingTimeRemainingTodayMinutes"
                            data-using-time-value="remaining-today-minutes"
                            hidden
                        >
                            ${REQUIRED_DAILY_MINUTES}
                        </span>

                        <!-- Overall completed-day progress bar -->

                        <div
                            class="profile-using-time-progress-track"
                            aria-hidden="true"
                        >
                            <span
                                id="usingTimeProgress"
                                class="profile-using-time-progress-value"
                                data-using-time-progress
                                role="progressbar"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow="0"
                                aria-valuetext="0 of ${REQUIRED_ACTIVE_DAYS} eligible active days completed; today 0 of ${REQUIRED_DAILY_MINUTES} minutes"
                            ></span>
                        </div>
                    </section>

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
                     SHARED ACCOUNT SECTIONS

                     AccountSectionsView renders:
                     - বন্ধু আমন্ত্রণ
                     - Live Reward Withdrawal
                     - Account Services
                ========================================== -->

                <div
                    id="accountSectionsMount"
                    class="account-sections-mount"
                    aria-label="Account features"
                ></div>

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