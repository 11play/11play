/* ==========================================================
   11PLAY REVIEW SYSTEM
   File : reviews/review.js
========================================================== */

const Review = (() => {

    "use strict";

    /* ================= INIT ================= */

    function init(){

        copyLink();

        loadRelated();

        loadRecent();

        loadPopular();

        updateYear();

    }

    /* ================= COPY LINK ================= */

    function copyLink(){

        const btn = document.getElementById("copyLink");

        if(!btn) return;

        btn.addEventListener("click",()=>{

            navigator.clipboard.writeText(window.location.href);

            btn.innerText="Copied ✓";

            setTimeout(()=>{

                btn.innerText="Copy Link";

            },2000);

        });

    }

    /* ================= RELATED ================= */

    function loadRelated(){

        const box=document.querySelectorAll(".review-list")[0];

        if(!box) return;

        // Future Dynamic Loader

    }

    /* ================= RECENT ================= */

    function loadRecent(){

        const box=document.querySelectorAll(".review-list")[1];

        if(!box) return;

        // Future Dynamic Loader

    }

    /* ================= POPULAR ================= */

    function loadPopular(){

        const box=document.querySelectorAll(".review-list")[2];

        if(!box) return;

        // Future Dynamic Loader

    }

    /* ================= YEAR ================= */

    function updateYear(){

        const year=document.getElementById("year");

        if(year){

            year.textContent=new Date().getFullYear();

        }

    }

    /* ================= PUBLIC ================= */

    return{

        init

    };

})();

/* ================= START ================= */

document.addEventListener("DOMContentLoaded",()=>{

    Review.init();

});