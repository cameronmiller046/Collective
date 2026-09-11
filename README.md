# Rooted & Crowned Collective — Website

**Grounded Roots. Crown Driven.** The official home of the Rooted & Crowned Collective: story, Root-to-Crown framework, programs, podcast, books, app preview, community branches, shop and contact.

The whole site is one file, `public/index.html`. There are no build steps and no dependencies. `server.js` is a small Node server that serves it.

## Run locally

```bash
npm start
```

Then open http://localhost:3000.

## Deploy on Railway

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick `cameronmiller046/Collective`.
2. Railway detects Node and runs `npm start`. The server listens on Railway's `$PORT` automatically.
3. Under **Settings → Networking**, generate a domain, or attach your own `.com`.
4. Optional: set the health check path to `/health`.

## Before launch: paste the real links

At the top of the `<script>` in `public/index.html`, fill in the `LINKS` object:

| Key | What it should point to |
| --- | --- |
| `stan` | Stan Store home |
| `stanEmail` | Conversations newsletter / email sign-up page |
| `stan7week` | 7-Week Root-to-Crown Experience checkout |
| `stanJournalClub` | Journal Club membership |
| `stanApp` | App subscription / waitlist |
| `stanBooks` | Digital books & journals |
| `shopify` | Shopify storefront |
| `podcast` | Podcast platform |
| `instagram`, `tiktok`, `youtube`, `facebook` | Social profiles |

While a link is empty, its button shows a "link goes here" notice instead of going anywhere.

## Still to supply

- Coach Kia's branded portrait (it replaces the arch placeholder on Home and Our Story)
- Coach Kia's origin story, in her own words (Our Story page)
- Final Privacy, Terms, Refund and Shipping policy text
- An email provider (the sign-up and contact forms show a preview notice until one is connected)
- A podcast player embed (Podcast page)

## Pages

Pages use hash routes, for example `/#/root-to-crown`:

`/` · `/about` · `/root-to-crown` · `/programs` · `/root-to-crown-experience` · `/journal-club` · `/conversations` · `/books` · `/app` · `/community` · `/sisterhood` · `/mens-collective` · `/children` · `/infinite-possibilities` · `/events` · `/shop` · `/start-here` · `/contact` · `/speaking` · `/privacy` · `/terms` · `/accessibility`

Note: the 7-Week Root-to-Crown Experience does **not** include a journal. Some older presentation slides say it does; the site follows the current offer.
