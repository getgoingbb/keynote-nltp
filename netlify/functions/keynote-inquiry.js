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

exports.handler = async (event) => {
  const redirect = { statusCode: 303, headers: { Location: "/thanks.html" } };
  try {
    const params = new URLSearchParams(event.body || "");
    if ((params.get("bot-field") || "").trim()) return redirect; // honeypot → silently drop
    const name = (params.get("name") || "").trim();
    const email = (params.get("email") || "").trim();

    const rows = [...params.entries()].filter(([k]) => k !== "form-name" && k !== "bot-field");
    const html =
      `<h2 style="font-family:sans-serif">🎤 New keynote inquiry</h2>` +
      rows
        .map(
          ([k, v]) =>
            `<p style="font-family:sans-serif;margin:6px 0"><b>${k}:</b> ${String(v).replace(/</g, "&lt;")}</p>`
        )
        .join("") +
      `<p style="font-family:sans-serif;color:#666;font-size:12px">via keynote-speaker.neverleavetheplayground.com</p>`;

    const r = await brevoSend({
      sender: { name: "NLTP Keynote Site", email: "stephen@neverleavetheplayground.com" },
      to: [{ email: "brent.bozeman@gmail.com" }],
      bcc: [{ email: "brent@globalnow.biz" }, { email: "StephenJepson@gmail.com" }],
      ...(email ? { replyTo: { email, name } } : {}),
      subject: `🎤 Keynote inquiry — ${name || "someone"}`,
      htmlContent: html,
    });
    console.log("keynote-inquiry brevo:", r.status, r.body);
  } catch (e) {
    console.log("keynote-inquiry error:", e && e.message);
  }
  return redirect; // always send them to the thank-you page
};
