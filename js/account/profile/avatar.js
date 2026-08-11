"use strict";

/* =========================================================
   11PLAY — PROFILE AVATAR
   File: js/account/profile/avatar.js

   Responsibilities:
   - Use the Google account profile photo
   - Support normalized profile photo fields
   - Show a default avatar when no Google photo exists
   - Replace broken external images with the default avatar
   - Never upload or modify profile photos
========================================================= */

(function initializeProfileAvatar(
    window
) {
    /* =====================================================
       DEFAULT AVATAR
    ===================================================== */

    const DEFAULT_AVATAR =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="160"
                height="160"
                viewBox="0 0 160 160"
            >
                <rect
                    width="160"
                    height="160"
                    rx="80"
                    fill="#e5e7eb"
                />

                <circle
                    cx="80"
                    cy="59"
                    r="30"
                    fill="#9ca3af"
                />

                <path
                    d="M28 145c5-32 25-48 52-48s47 16 52 48"
                    fill="#9ca3af"
                />
            </svg>
        `);

    /* =====================================================
       HELPERS
    ===================================================== */

    function normalizeString(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .trim();
    }

    function normalizePhotoURL(value) {
        const photoURL =
            normalizeString(value);

        if (!photoURL) {
            return "";
        }

        try {
            const parsedURL =
                new URL(
                    photoURL,
                    window.location.origin
                );

            if (
                parsedURL.protocol !==
                    "https:" &&
                parsedURL.protocol !==
                    "http:"
            ) {
                return "";
            }

            return parsedURL.toString();
        } catch {
            return "";
        }
    }

    function getPhotoURL(profile) {
        const source =
            profile &&
            typeof profile ===
                "object"
                ? profile
                : {};

        return (
            normalizePhotoURL(
                source.photoURL ||
                source.photo
            ) ||
            DEFAULT_AVATAR
        );
    }

    function getDisplayName(profile) {
        const source =
            profile &&
            typeof profile ===
                "object"
                ? profile
                : {};

        return normalizeString(
            source.displayName ||
            source.name
        );
    }

    function getAltText(profile) {
        const displayName =
            getDisplayName(profile);

        return displayName
            ? `${displayName}'s profile photo`
            : "Profile photo";
    }

    /* =====================================================
       IMAGE ELEMENT
    ===================================================== */

    function applyToImage(
        imageElement,
        profile = {}
    ) {
        if (
            !(imageElement instanceof
                HTMLImageElement)
        ) {
            return false;
        }

        const photoURL =
            getPhotoURL(profile);

        imageElement.alt =
            getAltText(profile);

        imageElement.referrerPolicy =
            "no-referrer";

        imageElement.decoding =
            "async";

        imageElement.loading =
            "eager";

        imageElement.onerror =
            () => {
                imageElement.onerror =
                    null;

                imageElement.src =
                    DEFAULT_AVATAR;

                imageElement.dataset
                    .avatarFallback =
                    "true";
            };

        imageElement.src =
            photoURL;

        imageElement.dataset
            .avatarSource =
            photoURL ===
                DEFAULT_AVATAR
                ? "default"
                : "google";

        if (
            photoURL ===
            DEFAULT_AVATAR
        ) {
            imageElement.dataset
                .avatarFallback =
                "true";
        } else {
            delete imageElement.dataset
                .avatarFallback;
        }

        return true;
    }

    function resetImage(imageElement) {
        if (
            !(imageElement instanceof
                HTMLImageElement)
        ) {
            return false;
        }

        imageElement.onerror =
            null;

        imageElement.src =
            DEFAULT_AVATAR;

        imageElement.alt =
            "Profile photo";

        imageElement.dataset
            .avatarSource =
            "default";

        imageElement.dataset
            .avatarFallback =
            "true";

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.ProfileAvatar =
        Object.freeze({
            getPhotoURL,
            getAltText,

            normalizePhotoURL,

            applyToImage,
            resetImage,

            DEFAULT_AVATAR
        });
})(
    window
);