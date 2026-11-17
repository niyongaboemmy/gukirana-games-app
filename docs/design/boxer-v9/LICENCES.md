# Boxer v9: licence check (P3-FGT-21)

Checked on 2026-11-17 against the official pages linked below. Quotes are copied word for word. Where an official page
could not be read directly, this says so and gives the route the text came by. Anything not confirmed is marked
**unconfirmed**. This is not legal advice. Before the first public release with v9 assets, the owner should read the
full Unreal Engine EULA and the Adobe General Terms themselves.

## Summary

| Source | May we use it in a published, commercial, cash-stakes web (three.js) game? | Conditions |
| --- | --- | --- |
| (a) MetaHuman characters | **Yes, with conditions** | Free while the company's annual gross revenue is under US$1 million. Above that, an Unreal Engine seat licence is needed. No royalty. No AI training. Create in Unreal Engine 5.7+ (the web Creator closed on 2026-11-05). Keep the derived files out of the public repo (see "Public repository"). Attribution: none found, **unconfirmed**. |
| (b) Mixamo animations and characters | **Yes, with conditions** | Royalty-free, also commercially. Never distribute the raw files: no asset packs and no free download, and that includes a public Git repo. No AI training. No credit required. Whether a web game's downloadable GLB counts as "embedded in the game" is **unconfirmed** (Adobe does not address the web). |
| (c) CMU Graphics Lab mocap | **Yes, with conditions** | May go into a commercially sold product. The data itself may not be resold, "even in converted form". The acknowledgement text is requested. |
| (d) CC0 1.0 | **Yes** | No conditions. Do not imply the author endorses the game. Trademarks and publicity rights are not waived. |
| (d) CC BY 4.0 (most Sketchfab gear) | **Yes, with conditions** | Credit the work: title, author, source link, licence link, and "modified". No added restrictions. Paint out brand logos, because CC does not license trademarks. |

**Conflict with the current project policy.** `docs/ASSET-LICENSES.md` says: "Not allowed: files whose licence forbids
redistributing the raw asset (Mixamo downloads, Ready Player Me, MetaHuman, paid-store assets)". The v9 plan uses
MetaHuman and Mixamo, so that policy line has to change. The owner must approve the change explicitly. The change is
safe only together with the "Public repository" rule below.

### Public repository: the deciding condition

`gh repo view` reports this repository as **PUBLIC**. If MetaHuman-derived or Mixamo-derived GLBs are committed to a
public GitHub repo, anyone can clone the assets on their own, outside the game. That is the "redistribution of raw
files" which both Epic (assets as a product) and Adobe ("you can't distribute the raw character and animation files")
forbid in spirit, and possibly in letter.

Recommendation:
- keep v9 runtime assets **out of git**. Store them in private storage (a private bucket, or a private Git LFS repo or
  submodule) and copy them into `apps/web/public/assets/characters/v9/` at build or deploy time;
- the scripts and specs in this task are our own work and stay in the public repo;
- CC0, CC BY and MIT assets may stay in the public repo, with credits.

The pipeline already git-ignores `apps/web/scripts/boxer-v9/work/`, where all inputs and outputs live.

---

## (a) MetaHuman

Official page: https://www.metahuman.com/license (FAQ). It was fetched directly on 2026-11-17; the page is served
from a JavaScript bundle, and the answers below were extracted from it. WebFetch was redirected to an Epic login, and
curl returned the page.

> **How much do I have to pay for MetaHuman?** MetaHuman is included as part of your standard Unreal Engine license,
> meaning it's free to use for anyone making under $1 million USD in revenue and standard Unreal Engine terms apply
> above that threshold. See the Unreal Engine licensing page for details. The MetaHuman-related technology and tools
> provided within Unreal Engine are Licensed Technology under the Unreal Engine license.

> **Can I use MetaHuman characters and animation outside of Unreal Engine?** Yes. The Unreal Engine EULA provides for
> MetaHuman characters and animation to be used across all engines and creative software, subject to applicable
> terms.

> **Do I have to pay royalties if I use MetaHuman characters and animation outside of Unreal Engine?** No. MetaHuman
> characters and animation are classed as Non-Engine Products under the Unreal Engine EULA, so neither their use as
> linear media output or at runtime in games (or other interactive applications) using engines other than Unreal
> Engine triggers royalty obligations.

> **Do I need to buy an Unreal Engine seat license if I use MetaHuman characters and animation outside of Unreal
> Engine?** If you make over $1 million USD in annual gross revenue and render MetaHuman characters and animation
> outside of Unreal Engine, you'll need an Unreal Engine seat license; below that threshold, Unreal Engine is free to
> use.

> **Are there specific restrictions around using MetaHuman characters and animation with artificial intelligence
> (AI)?** You can use MetaHuman characters and animation in workflows that incorporate artificial intelligence
> technology. However, you may not use MetaHuman characters or animation curves to build or enhance any database or
> train or test artificial intelligence, machine learning, deep learning, neural networks, or similar technologies (as
> further detailed in the Unreal Engine EULA). This includes the use of rendered output from MetaHuman digital
> characters and animation curves, if created to replicate the functionality of MetaHuman.

Unreal Engine EULA: https://www.unrealengine.com/eula/unreal. A direct fetch returned HTTP 403, so the clause below was
read through a search engine's index of that page. Section 4(i), "Non-Engine Products":

> You will not be obligated to pay us any royalty payments for Distributing Products that (i) do not include any Engine
> Code, (ii) do not require any Engine Code to run and (iii) do not include Starter Content in source format. [...]
> asset files, such as character models and animations, other than Starter Content, that you developed using Engine
> Code. Such asset files remain Non-Engine Products even if included in Products that use or rely on other video game
> engines.

Status of the tool (official Epic forum notice, via search coverage): the MetaHuman Creator **web application closed
on 2026-11-05**. Characters still in the web gallery can be retrieved for about 90 days after that. Creation now
happens only inside Unreal Engine; on macOS that means **5.7 or newer**, because 5.6 was Windows-only for Creator. Epic
recommends at least 16 CPU cores, 32 GB RAM and an "Apple M2 Ultra" class GPU
(https://dev.epicgames.com/documentation/metahuman/metahuman-hardware-requirements-in-unreal-engine). An M2 Pro is
below that recommendation, so it may run slowly, or a Windows PC may be needed. **Unconfirmed** whether it runs
acceptably on the user's Mac.

**Verdict: YES, with conditions.**
1. Free while Gukirana's annual gross revenue is under US$1 million. Above that, a UE seat licence is needed (press
   reports about US$1,850 per seat per year; the price is **unconfirmed**).
2. No royalty: a web game is a "Non-Engine Product".
3. No use for AI or ML training, or for building datasets, including renders of the MetaHuman.
4. Attribution: the FAQ asks for none, and we found no notice clause. **Unconfirmed**. Read section 4 and the
   trademark section of the EULA. Never use Epic or MetaHuman logos in a way that suggests endorsement.
5. Web delivery: the FAQ explicitly allows "runtime in games ... using engines other than Unreal Engine". We found no
   EULA clause that requires technical protection against extracting files from a shipped product. **Unconfirmed**.
   Do not publish the files separately (see "Public repository").
6. Cash-stakes or gambling products: we found no MetaHuman or UE restriction on real-money skill games.
   **Unconfirmed**. Read the EULA's restrictions section before launch.
7. Uploading the MetaHuman body to Adobe Mixamo for auto-rigging is "use in creative software", which the FAQ allows.
   Whether Adobe may analyse uploaded content is governed by Adobe's terms (**unconfirmed**). The pipeline also has an
   offline rigging route that avoids the upload (BLENDER-PIPELINE.md, step 3, alternative).

## (b) Mixamo

Official FAQ, Adobe Help Center: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html. A direct fetch returned
HTTP 403, so the text came from the search index:

> Characters and animations can be used royalty-free for personal, commercial, and non-profit projects. [...] Mixamo
> is available free for anyone with an Adobe ID and does not require a subscription to Creative Cloud.

Adobe's pinned Mixamo FAQ in the Adobe Community, "Mixamo FAQ: Licensing, Royalties, Ownership, EULA and TOS",
2022-09-29 (read directly):
https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775

> You can use the auto-rigger, characters and animations in any type of creative project.

> [Non-profit, commercial, research, school projects:] Yes to all.

> really the only thing you can't do is distribute the raw character and animation files.

> The only research application Mixamo content can't be used in is training machine-learning models.

> [Credit:] No. That is up to you, and you're certainly welcome to, but are not required to give credit to Adobe,
> Mixamo, or Fuse in any way.

The same FAQ lists "Video Games Blueprints, templates, or asset packages for video game engines which redistribute
character or animation raw files as the product" as not allowed. It says use is "covered under the terms at the time
you use it". It still calls Mixamo a "limited duration technology preview". A community reply from November 2026 says
"no rules are changed till now" (that reply is not official).

**Verdict: YES, with conditions.**
1. Royalty-free in a commercial game, including real-money skill games: no game-type restriction was found
   (**unconfirmed** against the full Adobe General Terms).
2. Never distribute the raw files: no FBX in the repo, no clip pack, no download link. Ship only the retargeted,
   resampled clips merged into our own GLB.
3. A web game's GLB can be downloaded from the browser's network tab. Adobe has not said whether that counts as
   "embedded in the game". **Unconfirmed, low-to-moderate residual risk**. The mitigations are the items above plus
   the "Public repository" rule.
4. No AI or ML training.
5. No credit needed. We credit Mixamo in the game's credits anyway.
6. Download only with the user's own free Adobe ID. The agent never logs in.

## (c) CMU Graphics Lab Motion Capture Database

Official page: http://mocap.cs.cmu.edu/ (home page and FAQ, read directly).

> This data is free for use in research projects. You may include this data in commercially-sold products, but you may
> not resell this data directly, even in converted form. If you publish results obtained using this data, we would
> appreciate it if you would send the citation to your published paper to jkh+mocap@cs.cmu.edu, and also would add this
> text to your acknowledgments section: The data used in this project was obtained from mocap.cs.cmu.edu. The database
> was created with funding from NSF EIA-0196217.

The site also says: "Please don't crawl this database!" Download only the takes you need.

**Verdict: YES, with conditions.** It may go into the game, even a paid one. Never sell the data or a converted clip
pack. Add the acknowledgement line to the credits (we already do for the v5 measurements, `docs/ASSET-LICENSES.md`).
Committing converted CMU clips to the public repo is redistribution, not resale, so it is allowed. Credit it anyway.

## (d) Creative Commons

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/deed.en

> You can copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission.

The deed also notes that CC0 does not affect patent or trademark rights, or the "publicity or privacy" rights other
people may have. It also says that you "should not imply endorsement by the author or the affirmer".

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/deed.en

> Share — copy and redistribute the material in any medium or format for any purpose, even commercially.
> Adapt — remix, transform, and build upon the material for any purpose, even commercially.
> Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made.
> No additional restrictions — You may not apply legal terms or technological measures that legally restrict others
> from doing anything the license permits.

Sketchfab's "CC Attribution" label is CC BY 4.0. Sketchfab downloads need a free Sketchfab account (the user's own).

**Verdict: YES** (CC0, no conditions). **YES, with conditions** (CC BY):
1. Credit each asset in `docs/ASSET-LICENSES.md` and in the in-game credits. Use this format: "<title>" by <author>
   (<Sketchfab URL>), CC BY 4.0 (link), modified: retopologised, re-textured, fitted to our boxer.
2. Paint out brand marks on scanned products (Everlast, Larsen, "Challenger" labels). CC covers the author's
   copyright, not the manufacturer's trademark.
3. Do not imply that the author endorses the game.
4. Respect authors' "noai" tags: we never train models on assets.

## Not usable (checked)

| Source | Why |
| --- | --- |
| Renderpeople free models | Real-time or game use is unclear: their terms reportedly need a separate licence for commercial games. **Unconfirmed**. Avoid. |
| SMPL / SMPL-X bodies | Non-commercial research licence. |
| Bandai Namco motion dataset | CC BY-NC-ND (already excluded in ASSET-LICENSES.md). |
| Fab "Standard License" freebies | Allowed in any engine; the raw assets may not be redistributed. Usable case by case, but no suitable free boxer was found. |
| MetaHuman Creator web app | Closed on 2026-11-05. Use the in-editor Creator (UE 5.7+). |
