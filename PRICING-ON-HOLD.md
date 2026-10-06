# Program pricing on hold (removed from the website, to be restored later)

Removed on request and replaced with a "Coming soon" tag. This file is NOT served by the website (only the `public/` folder is). The last live version that still shows these prices is git commit `0214572`.

## Where each price was

| # | Page | Spot | What it said |
|---|------|------|--------------|
| 1 | Home | Journal Club card, price line next to "Membership" | $60 / MONTH |
| 2 | The Framework | "Ready to experience the framework?" caps line | Live Virtual Classes via Zoom • $299 |
| 3 | Programs | 7-Week Experience, beside the "Start Your Transformation" button | $299 (LIVE EXPERIENCE) |
| 4 | Programs | eCourse Chakra Alignment Series pricing block | Regular price $199 (struck through) • Founding Launch Price $175 • "Save $24 · All 7 Chakra Journeys Included" • button "Begin the Root-to-Crown Journey — $175" • note "Founding Launch Pricing · Regular Price $199" |
| 5 | Programs | Journal Club, beside the "Join the Journal Journey" button | $60 / MONTH |
| 6 | Programs | "Choose the experience that meets you where you are" cards | 7 Weeks: $299 (LIVE) • Weekly Live Gatherings: $60 / MONTH |
| 7 | Start Here | The doors list | 7-Week Experience: $299 • Journal Club: $60/mo |
| 8 | Programs | Journal Club photo `assets/programs-journal-club.webp` | "$60 a month" is part of the picture itself, so it needs a new image when pricing returns or is changed |

## Not touched (not part of "programs")

Books and journals ($24.99, $39, $49, $99 series), the App ($9.99/month introductory), and the Support page goal amounts.

## How it was restored-ready

The previous markup for every spot above is in git history. To restore: tell Claude "restore the program pricing", and each "Coming soon" tag in the spots above gets its price back (updated to whatever final prices you give).

## Original markup for the two bigger spots

eCourse pricing block (Programs page), original:

```html
<div class="price-row">
  <span class="price-was">$199 Regular Price</span>
  <span class="price">$175<small>Founding Launch Price</small></span>
</div>
<p class="price-save">Save $24 · All 7 Chakra Journeys Included</p>
...
<span class="btn btn--gold btn--lg" aria-disabled="true" style="margin-top:14px;pointer-events:none;opacity:.92">Begin the Root-to-Crown Journey — $175</span>
<p class="caps" style="color:var(--plum-muted)">Founding Launch Pricing · Regular Price $199</p>
<span class="status-pill">Coming soon</span>
```

Price line pattern (home, Programs cards): `<span class="price">$60<small>/MONTH</small></span>`; 7-Week: `<span class="price">$299<small>LIVE EXPERIENCE</small></span>`.
