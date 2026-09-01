<div align="center">

<!-- The cards are real SVG <text>, not bitmaps — but a browser will not let you
     select text inside an <img>. Linking to the raw file opens it as a document,
     where it is selectable and searchable.

     Both cards are served live by the Worker (/card.svg and /languages.svg);
     see worker/README.md. The committed assets/ copies stay as the fallback,
     refreshed weekly by .github/workflows/update-assets.yml — point a src back
     at assets/ if the Worker is ever down. -->
<a href="https://muddyblack-card.muddyblack.workers.dev/card.svg">
  <img src="https://muddyblack-card.muddyblack.workers.dev/card.svg" alt="muddyblack@github" width="820" />
</a>
<br/>
<br/>

</div>

<p align="center"><img src="assets/dividers/divider-label.svg" alt="" width="100%" /></p>

<div align="center">

<a href="https://muddyblack-card.muddyblack.workers.dev/languages.svg">
  <img src="https://muddyblack-card.muddyblack.workers.dev/languages.svg" alt="languages by commit weight" width="820" />
</a>

<br/>

</div>

<br/>

<p align="center"><img src="assets/dividers/divider-pcb.svg" alt="" width="100%" /></p>

<div align="center">

*"There are two ways to write error-free programs; only the third works."* — Alan J. Perlis

</div>

<!-- komarev counts a view by being fetched, so it only keeps counting while
     something here still requests it. Kept at 1x1 rather than removed: the
     tally carries on climbing in the background, so if this ever goes back to
     being a visible badge it picks up from a real number instead of restarting.
     Do not delete unless you are happy to lose the count. -->
<img src="https://komarev.com/ghpvc/?username=Muddyblack&style=flat-square" alt="" width="1" height="1" />
