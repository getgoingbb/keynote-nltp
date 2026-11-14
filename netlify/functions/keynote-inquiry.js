// Direct form handler for the keynote booking inquiry — detection-independent
// (the form POSTs straight here, so a $2k lead can never sit unseen in the Netlify UI).
// Emails Brent + Stephen instantly via Brevo, then redirects to /thanks.html.
// Uses Node's built-in https (no dependency on global fetch / Node version).
const https = require("https");

function brevoSend(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.brevo.com",
        path: "/v3/smtp/email",
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY || "",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data.slice(0, 200) }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: String(e && e.message) }));
    req.write(body);
    req.end();
  });
}

// Spam gate added 2026-09-30 (Brent: keynote-inquiry spam getting through). Deliberately
// conservative -- this path handles real, sometimes $2k+, leads, so it only suppresses the
// HIGH-CONFIDENCE-spam case (promotional/SEO/link-farm pitches, the actual spam Brent saw),
// and even then it never destroys the submission -- it still emails a low-key digest version
// instead of silently dropping it, so a false positive is recoverable, not invisible.
const SPAM_PATTERNS = [
  /\bseo services?\b/i, /\bbacklinks?\b/i, /\bguest post(ing)?\b/i,
  /\bincrease (your )?(website )?traffic\b/i, /\bcasino\b/i, /\bcrypto(currency)?\b/i,
  /\bdropship(ping)?\b/i, /\bwe (can|will) (rank|boost)\b/i, /\bdigital marketing agency\b/i,
  /\b(cheap|low[- ]cost) (web ?design|website)\b/i,
];
const URL_RE = /https?:\/\/\S+/gi;

function looksLikeSpam(fields) {
  const text = Object.values(fields).join(" \n ");
  const urlCount = (text.match(URL_RE) || []).length;
  const spamHits = SPAM_PATTERNS.filter((p) => p.test(text)).length;
  // Require a real signal, not a single loose match -- e.g. one link in a legit inquiry
  // ("here's a clip of a past talk") is normal and must never get flagged alone.
  return spamHits >= 1 || urlCount >= 3;
}

exports.handler = async (event) => {
  const redirect = { statusCode: 303, headers: { Location: "/thanks.html" } };
  try {
    // 2026-10-17: the form has no file input and no enctype set, so a real browser can only
    // ever POST application/x-www-form-urlencoded. A bot's generic multipart/form-data POST
    // broke URLSearchParams silently -- it parsed into one garbled field instead of throwing,
    // so BOTH the honeypot check below and the spam-pattern check never saw the real fields at
    // all (bot-field read as empty), and the raw multipart body leaked into the notification
    // email as unreadable text. A non-urlencoded submission to this exact form is itself a
    // reliable bot signal, so reject it the same way as a tripped honeypot -- silently.
    const contentType = (event.headers && (event.headers["content-type"] || event.headers["Content-Type"])) || "";
    if (!contentType.includes("application/x-www-form-urlencoded")) return redirect;
    const params = new URLSearchParams(event.body || "");
    if ((params.get("bot-field") || "").trim()) return redirect; // honeypot → silently drop
    const name = (params.get("name") || "").trim();
    const email = (params.get("email") || "").trim();

    const rows = [...params.entries()].filter(([k]) => k !== "form-name" && k !== "bot-field");
    const fieldsObj = Object.fromEntries(rows);
    const spam = looksLikeSpam(fieldsObj);

    const html =
      `<h2 style="font-family:sans-serif">${spam ? "🚫 Likely-spam keynote inquiry (low confidence, review before ignoring)" : "🎤 New keynote inquiry"}</h2>` +
      rows
        .map(
          ([k, v]) =>
            `<p style="font-family:sans-serif;margin:6px 0"><b>${k}:</b> ${String(v).replace(/</g, "&lt;")}</p>`
        )
        .join("") +
      `<p style="font-family:sans-serif;color:#666;font-size:12px">via keynote-speaker.neverleavetheplayground.com</p>`;

    const r = await brevoSend({
      sender: { name: "NLTP Keynote Site", email: "stephen@neverleavetheplayground.com" },
      to: [{ email: "stephen@neverleavetheplayground.com" }],
      bcc: [{ email: "StephenJepson@gmail.com" }, { email: "brent.bozeman@gmail.com" }],
      ...(email ? { replyTo: { email, name } } : {}),
      subject: spam ? `🚫 Likely spam — keynote form (${name || "someone"})` : `🎤 Keynote inquiry — ${name || "someone"}`,
      htmlContent: html,
    });
    console.log("keynote-inquiry brevo:", r.status, r.body, "spam:", spam);
  } catch (e) {
    console.log("keynote-inquiry error:", e && e.message);
  }
  return redirect; // always send them to the thank-you page
};
