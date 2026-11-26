ZishuChat website (static, no build step)

Files
  index.html        page structure
  css/style.css     all styling (colors are CSS variables at the top)
  js/main.js        interactions (download button, customizer, legal pop-up)
  js/legal.js       Privacy Policy and Terms text
  assets/img/       app screenshots (webp), logo and favicon

Download link
  Open js/main.js, find:  var DOWNLOAD_URL = "";
  Paste your link between the quotes. All "Get the app" buttons become live.

Run locally: just double-click index.html.
Host: upload the whole folder to Netlify, Cloudflare Pages, GitHub Pages or any hosting.
