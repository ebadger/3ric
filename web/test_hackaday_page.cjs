// Run after web/build.ps1 to check the page against its deployed source and assets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "hackaday.html"), "utf8");
const pageUrl = "https://ebadger.github.io/3ric/hackaday.html";
const previewPath = "media/hackaday-preview.png";
const sourcePath = "programs/hackaday.s";
const launchHref = `index.html?src=${sourcePath}`;

function tags(name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i"))
    ?.slice(1).find((value) => value !== undefined);
}

function text(markup) {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(key) {
  const tag = tags("meta").find((candidate) =>
    attribute(candidate, "name") === key || attribute(candidate, "property") === key);
  assert(tag, `missing ${key} metadata`);
  return attribute(tag, "content");
}

const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
const css = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
assert(body && css, "landing page must contain its own body and styles");
const bodyText = text(body);
const anchors = tags("a");
const hrefs = anchors.map((tag) => attribute(tag, "href"));

assert.match(html, /^<!DOCTYPE html>/i);
assert.equal(attribute(tags("html")[0], "lang"), "en");
assert.match(html, /<title>Built from Bits — 3RIC Studio<\/title>/);
assert.equal(meta("application-name"), "3RIC Studio");
assert.match(meta("description"), /3RIC.*65C02.*built from scratch/i);
assert.equal(meta("viewport"), "width=device-width, initial-scale=1");
assert.equal(meta("og:type"), "website");
assert.equal(meta("og:site_name"), "3RIC Studio");
assert.match(meta("og:title"), /Built from Bits.*65C02/);
assert(meta("og:description"), "social previews need a description");
assert.equal(meta("og:url"), pageUrl);
assert.equal(meta("og:image"), new URL(previewPath, pageUrl).href);
assert.equal(meta("og:image:width"), "320");
assert.equal(meta("og:image:height"), "384");
assert.match(meta("og:image:alt"), /still.*actual.*emulator/i);
const canonical = tags("link").filter((tag) => attribute(tag, "rel") === "canonical");
assert.equal(canonical.length, 1);
assert.equal(attribute(canonical[0], "href"), pageUrl);

const primaryLaunch = anchors.find((tag) =>
  attribute(tag, "class")?.split(/\s+/).includes("button-primary"));
assert.equal(attribute(primaryLaunch || "", "href"), launchHref,
  "the primary action must use the existing relative, auto-running source link");
assert(hrefs.includes(`${launchHref}#ide`), "remixing and exports must lead to the existing editor");
assert.doesNotMatch(html, /<base\b|\bfullscreen[=?]/i,
  "the landing page must not change project-relative navigation or add a special emulator mode");

const images = tags("img");
assert.equal(images.length, 1, "the real framebuffer still is the only image asset");
assert.equal(attribute(images[0], "src"), previewPath);
assert.equal(attribute(images[0], "width"), "320");
assert.equal(attribute(images[0], "height"), "384");
assert.match(attribute(images[0], "alt"), /still.*actual.*emulator framebuffer/i);
const caption = text(html.match(/<figcaption>([\s\S]*?)<\/figcaption>/i)?.[1] || "");
assert.match(caption, /Still from the actual emulator — not a live demo or video\./);
assert.match(caption, /320 × 384.*4:3.*non-square pixels/);
assert.match(css, /\.screen\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
assert.match(css, /\.screen img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*fill/,
  "display the complete non-square-pixel framebuffer at the hardware's 4:3 aspect ratio");

const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
assert.equal(headings.filter((match) => match[1] === "1").length, 1);
assert.equal(text(headings[0][2]), "Built from Bits.");
let previousLevel = 0;
for (const [, level] of headings) {
  assert(Number(level) <= previousLevel + 1, "heading levels must not skip a level");
  previousLevel = Number(level);
}
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "element IDs must be unique");
const skipLink = anchors.find((tag) => attribute(tag, "class") === "skip-link");
assert.equal(attribute(skipLink || "", "href"), "#main");
assert.match(html, /<main\b[^>]*id="main"[^>]*tabindex="-1"/);
assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
assert.match(css, /@media\s*\(max-width:\s*600px\)/,
  "the layout must include narrow-screen rules");
for (const [, , target] of html.matchAll(/\s(aria-labelledby|aria-describedby)="([^"]+)"/g)) {
  for (const id of target.split(/\s+/)) assert(ids.includes(id), `missing accessible label target: ${id}`);
}

for (const scene of ["Signal", "Color", "Wireframe", "Stereo"]) {
  assert.match(html, new RegExp(`<h3>${scene}</h3>`), `missing ${scene} scene`);
}
assert.match(bodyText, /hi-res 3RIC logo and a moving starfield/);
assert.match(bodyText, /16-color lo-res plasma.*40 × 40 mixed graphics area.*four explanatory text rows/);
assert.match(bodyText, /rotating wireframe cube, rasterized by the CPU/);
assert.match(bodyText, /original six-channel chiptune sequencer.*Pitch and level bars reflect the actual values sent to two AY chips/);
assert.match(bodyText, /approximately one-minute autoplay loop at native 1x speed/);
assert.match(bodyText, /65C02 generates the visuals, sequences the music, and handles input/);
assert.match(bodyText, /no JavaScript animation overlay/);

const controlsHtml = html.match(/<dl class="controls"[^>]*>([\s\S]*?)<\/dl>/)?.[1];
assert(controlsHtml, "the demo must document its controls");
const controls = new Map(
  [...controlsHtml.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)]
    .map(([, key, description]) => [text(key), text(description)]),
);
assert.match(controls.get("1–4") || "", /Choose a scene/);
assert.match(controls.get("N / Right") || "", /Next scene/);
assert.match(controls.get("Left") || "", /Previous scene/);
assert.match(controls.get("Space") || "", /Pause or resume.*freezes the score and animation and silences sound/);
assert.match(controls.get("M") || "", /Music on\/off/);
assert.match(controls.get("Q / Esc") || "", /Quit to the ROM monitor/);
assert.match(bodyText, /first user gesture inside the emulator/);
assert.match(bodyText, /Click the emulator screen, or use its Sound control/);
assert.match(bodyText, /Keep the speed at 1x for music/);
assert.match(bodyText, /virtual keyboard/);

assert.match(bodyText, /hardware design generates VGA with custom logic/);
assert.match(bodyText, /artifact color in logic circuits/);
assert.match(bodyText, /CPU and video hardware share RAM.*take turns on the bus/);
assert.match(bodyText, /final build uses 74-series logic chips to decode addresses/);
assert.doesNotMatch(html, /\b(?:22v10|GAL)\b/i,
  "the showcase must describe the final logic-chip build, not intermediate GAL experiments");
assert.match(bodyText, /same C\+\+ VM core.*native emulator.*WebAssembly/);
assert.match(bodyText, /512 KB ROM/);
assert.match(bodyText, /not a claim of blanket Apple II compatibility/);
assert.match(bodyText, /demonstrate emulator behavior, not a fresh bench measurement/);
assert.match(bodyText, /targets the final 3RIC hardware design/);
assert.match(bodyText, /no physical-board testing is claimed for this demo/);
assert.match(bodyText, /slot-4 dual-AY Mockingboard/);
assert.match(bodyText, /visuals do not require an audio expansion on hardware/);
assert.match(bodyText, /3RIC-specific program, not an unmodified Apple II program/);
assert.match(bodyText, /onboard VIA Timer2 at \$C200.*tune calibrated to 3RIC’s clock/);
assert.match(bodyText, /Download \.PRG.*raw program.*Download \.woz.*bootable disk image/);
assert.match(bodyText, /declared origin, \$0800/);
assert.match(bodyText, /BRUN HACKADAY\.PRG 0800/);
assert.match(bodyText, /Hardware compatibility is the target, not a claim of physical-board testing/);
assert.match(bodyText, /not affiliated with or endorsed by Hackaday/);
for (const href of hrefs) {
  assert.doesNotMatch(href, /\.(?:prg|woz)(?:[?#]|$)/i,
    "export links must open the editor, not advertise nonexistent binary downloads");
}

const expectedLinks = [
  "story.html",
  "gallery.html",
  "tutorials.html",
  "https://github.com/ebadger/3ric",
  "https://github.com/ebadger/3ric/tree/main/kicad",
  "https://github.com/ebadger/3ric/tree/main/schematic_pdf",
  "https://github.com/ebadger/3ric/blob/main/codegen/programs/hackaday.s",
  "https://www.youtube.com/playlist?list=PLbYLt1iawSBLK4w46Kn7cxxuoeVt7Zepq",
];
for (const href of expectedLinks) assert(hrefs.includes(href), `missing project resource: ${href}`);

function checkLocalTarget(target) {
  assert(target && !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(target),
    `local target must remain relative for project Pages: ${target}`);
  assert(!target.includes("\\") && !target.split("/").includes(".."),
    `local URL must stay inside the staged web root: ${target}`);
  const resolved = new URL(target, pageUrl);
  assert(resolved.pathname.startsWith("/3ric/"));
  const relativePath = decodeURIComponent(resolved.pathname.slice("/3ric/".length));
  assert(fs.existsSync(path.join(__dirname, ...relativePath.split("/"))),
    `missing local page target: ${relativePath}`);
  if (resolved.searchParams.has("src")) {
    assert.equal(resolved.searchParams.get("src"), sourcePath);
    checkLocalTarget(resolved.searchParams.get("src"));
    assert.equal(resolved.searchParams.size, 1, "launch links must not introduce another loading mode");
  }
}
for (const href of hrefs) {
  if (href.startsWith("#")) {
    assert(ids.includes(href.slice(1)), `missing section target: ${href}`);
  } else if (/^https:\/\//.test(href)) {
    assert(expectedLinks.includes(href), `unexpected external resource: ${href}`);
  } else {
    checkLocalTarget(href);
  }
}
for (const image of images) checkLocalTarget(attribute(image, "src"));
for (const link of tags("link")) {
  if (attribute(link, "rel") !== "canonical") checkLocalTarget(attribute(link, "href"));
}

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, "the static page must load only the site's analytics, not a second emulator");
assert.equal(attribute(`<script${scripts[0][1]}>`, "src"), "//gc.zgo.at/count.js");
assert.equal(attribute(`<script${scripts[0][1]}>`, "data-goatcounter"), "https://3ric.goatcounter.com/count");
assert.match(scripts[0][1], /\sasync(?:\s|$)/);
assert.equal(scripts[0][2].trim(), "", "no inline runtime belongs on the static landing page");
assert.doesNotMatch(body, /<(?:script|canvas|iframe|video|audio|object|embed)\b/i);
assert.doesNotMatch(html, /<[^>]*\s(?:on[a-z]+|autoplay)\s*=/i);
assert.doesNotMatch(css, /@import|@keyframes|\b(?:animation|transition)\s*:|\burl\s*\(/i,
  "the landing page must stay still and use no external styles, fonts, or decorative images");

console.log("PASS: Hackaday page metadata, real-demo links, framebuffer still, controls, hardware caveats, and relative assets");
