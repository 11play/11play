/* =====================================================
   📰 NEWS CARD (SAFE PRODUCTION UPGRADE)
===================================================== */

const NewsCard = {

  render(post, expanded = false) {

    const full = post.description || "";
    const short = full.slice(0, 120);

    const link = post.link || null;
    const linkLabel = post.linkLabel || "Read More";

    return `
      <div class="news-card">

        ${post.image ? `<img src="${post.image}" class="news-image">` : ""}

        <div class="news-title">${post.title || ""}</div>

        <div class="news-description">
          ${expanded ? full : short + (full.length > 120 ? "..." : "")}
        </div>

        <!-- ================= ACTION BUTTON ================= -->
        ${
          link
            ? `<a href="${link}" class="news-link"
                 target="_blank"
                 rel="noopener noreferrer"
                 data-external="true">
                 ${linkLabel}
               </a>`
            : ""
        }

        <div class="news-separator"></div>
      </div>
    `;
  }

};

window.NewsCard = NewsCard;