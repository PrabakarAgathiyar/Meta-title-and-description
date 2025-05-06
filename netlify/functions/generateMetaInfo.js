const fetch = require("node-fetch");

const rateLimitMap = new Map();

exports.handler = async (event) => {
  const allowOrigin = "https://www.rythmworks.com";

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(allowOrigin),
      body: "OK",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return errorResponse(500, "OPENAI_API_KEY is not set", allowOrigin);
  }

  const userIP = event.headers["x-nf-client-connection-ip"] || "unknown";
  const usage = rateLimitMap.get(userIP) || { count: 0, lastUsed: Date.now() };
  const today = new Date().toDateString();
  const lastUsedDay = new Date(usage.lastUsed).toDateString();

  if (usage.count >= 5 && today === lastUsedDay) {
    return {
      statusCode: 429,
      headers: corsHeaders(allowOrigin),
      body: JSON.stringify({
        error: "⛔ You’ve reached your daily limit of 5 meta sets. Please come back tomorrow.",
      }),
    };
  }

  let topic = "";
  let tone = "informative";
  try {
    const parsed = JSON.parse(event.body || "{}");
    topic = parsed.topic;
    tone = parsed.tone || "informative";
    if (!topic) throw new Error("Topic is required.");
  } catch (err) {
    return errorResponse(400, "Invalid input: " + err.message, allowOrigin);
  }

  const prompt = `Generate an SEO meta title and meta description for the following page topic: "${topic}".
Use a ${tone} tone. Return both the title and description clearly labeled.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${apiKey}\`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      }),
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("No content returned from OpenAI.");

    const [titleLine, ...descLines] = raw.split("\n").filter(Boolean);
    const title = titleLine.replace(/^Title:\s*/, "").trim();
    const description = descLines.join(" ").replace(/^Description:\s*/, "").trim();

    rateLimitMap.set(userIP, {
      count: today === lastUsedDay ? usage.count + 1 : 1,
      lastUsed: Date.now(),
    });

    return {
      statusCode: 200,
      headers: corsHeaders(allowOrigin),
      body: JSON.stringify({ title, description }),
    };
  } catch (err) {
    return errorResponse(500, "OpenAI error: " + err.message, allowOrigin);
  }
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function errorResponse(status, message, origin) {
  return {
    statusCode: status,
    headers: corsHeaders(origin),
    body: JSON.stringify({ error: message }),
  };
};
