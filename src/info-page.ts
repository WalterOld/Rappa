import fs from "fs";
import express, { Router, Request, Response } from "express";
import showdown from "showdown";
import { config } from "./config";
import { buildInfo, ServiceInfo } from "./service-info";
import { getLastNImages } from "./shared/file-storage/image-history";
import { keyPool } from "./shared/key-management";
import { MODEL_FAMILY_SERVICE, ModelFamily } from "./shared/models";
import { withSession } from "./shared/with-session";
import { checkCsrfToken, injectCsrfToken } from "./shared/inject-csrf";
import axios from "axios";

const INFO_PAGE_TTL = 2000;
const MODEL_FAMILY_FRIENDLY_NAME: { [f in ModelFamily]: string } = {
  turbo: "GPT-4o Mini / 3.5 Turbo",
  gpt4: "GPT-4",
  "gpt4-32k": "GPT-4 32k",
  "gpt4-turbo": "GPT-4 Turbo",
  gpt4o: "GPT-4o",
  o1: "OpenAI o1",
  "o1-mini": "OpenAI o1 mini",
  "dall-e": "DALL-E",
  claude: "Claude (Sonnet)",
  "claude-opus": "Claude (Opus)",
  "gemini-flash": "Gemini Flash",
  "gemini-pro": "Gemini Pro",
  "gemini-ultra": "Gemini Ultra",
  "mistral-tiny": "Mistral 7B",
  "mistral-small": "Mistral Nemo",
  "mistral-medium": "Mistral Medium",
  "mistral-large": "Mistral Large",
  "aws-claude": "AWS Claude (Sonnet)",
  "aws-claude-opus": "AWS Claude (Opus)",
  "aws-mistral-tiny": "AWS Mistral 7B",
  "aws-mistral-small": "AWS Mistral Nemo",
  "aws-mistral-medium": "AWS Mistral Medium",
  "aws-mistral-large": "AWS Mistral Large",
  "gcp-claude": "GCP Claude (Sonnet)",
  "gcp-claude-opus": "GCP Claude (Opus)",
  "azure-turbo": "Azure GPT-3.5 Turbo",
  "azure-gpt4": "Azure GPT-4",
  "azure-gpt4-32k": "Azure GPT-4 32k",
  "azure-gpt4-turbo": "Azure GPT-4 Turbo",
  "azure-gpt4o": "Azure GPT-4o",
  "azure-o1": "Azure o1",
  "azure-o1-mini": "Azure o1 mini",
  "azure-dall-e": "Azure DALL-E",
};

// Utility to load HTML or CSS from .env variable, file, or URL
function loadDynamicContent(envVar: string): string {
  const value = process.env[envVar];
  if (!value) return "";

  try {
    if (fs.existsSync(value)) {
      // Load from file path
      return fs.readFileSync(value, "utf8");
    } else if (value.startsWith("http://") || value.startsWith("https://")) {
      // Load from URL
      const response = axios.get(value);
      return response.data;
    } else {
      // Inline content
      return value;
    }
  } catch (error) {
    console.error(`Failed to load content for ${envVar}:`, error);
    return "";
  }
}

// Load dynamic HTML and CSS
const customHtmlTemplate = loadDynamicContent("CUSTOM_HTML_TEMPLATE");
const customCss = loadDynamicContent("CUSTOM_CSS");

const converter = new showdown.Converter();
const customGreeting = fs.existsSync("greeting.md")
  ? `<div id="servergreeting">${fs.readFileSync("greeting.md", "utf8")}</div>`
  : "";
let infoPageHtml: string | undefined;
let infoPageLastUpdated = 0;

export const handleInfoPage = (req: Request, res: Response) => {
  if (infoPageLastUpdated + INFO_PAGE_TTL > Date.now()) {
    return res.send(infoPageHtml);
  }

  const baseUrl =
    process.env.SPACE_ID && !req.get("host")?.includes("hf.space")
      ? getExternalUrlForHuggingfaceSpaceId(process.env.SPACE_ID)
      : req.protocol + "://" + req.get("host");

  const info = buildInfo(baseUrl + config.proxyEndpointRoute);
  infoPageHtml = renderPage(info);
  infoPageLastUpdated = Date.now();

  res.send(infoPageHtml);
};

export function renderPage(info: ServiceInfo) {
  const title = getServerTitle();
  const headerHtml = buildInfoPageHeader(info);

  // Use dynamic HTML template if provided
  if (customHtmlTemplate) {
    return customHtmlTemplate
      .replace("{{title}}", title)
      .replace("{{headerHtml}}", headerHtml)
      .replace("{{selfServiceLinks}}", getSelfServiceLinks())
      .replace("{{infoJson}}", JSON.stringify(info, null, 2));
  }

  // Fallback to default HTML
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>${customCss || defaultCss}</style>
  </head>
  <body>
    ${headerHtml}
    <hr />
    ${getSelfServiceLinks()}
    <h2>Service Info</h2>
    <pre>${JSON.stringify(info, null, 2)}</pre>
  </body>
</html>`;
}

const defaultCss = `
  body {
    font-family: sans-serif;
    padding: 1em;
    max-width: 900px;
    margin: 0 auto;
    background-color: #1e1e1e;
    color: #cfcfcf;
  }
  .self-service-links {
    display: flex;
    justify-content: center;
    margin-bottom: 1em;
    padding: 0.5em;
    font-size: 0.8em;
  }
  .self-service-links a {
    margin: 0 0.5em;
    color: #61dafb;
    text-decoration: none;
  }
  .self-service-links a:hover {
    text-decoration: underline;
  }
`;

/**
 * Builds the info page header
 */
function buildInfoPageHeader(info: ServiceInfo) {
  const title = getServerTitle();
  let infoBody = `# ${title}`;
  if (config.promptLogging) {
    infoBody += `\n### Prompt Logging Enabled`;
  }

  if (config.staticServiceInfo) {
    return converter.makeHtml(infoBody + customGreeting);
  }

  const waits: string[] = [];

  for (const modelFamily of config.allowedModelFamilies) {
    const service = MODEL_FAMILY_SERVICE[modelFamily];

    const hasKeys = keyPool.list().some((k) => {
      return k.service === service && k.modelFamilies.includes(modelFamily);
    });

    const wait = info[modelFamily]?.estimatedQueueTime;
    if (hasKeys && wait) {
      waits.push(
        `**${MODEL_FAMILY_FRIENDLY_NAME[modelFamily] || modelFamily}**: ${wait}`
      );
    }
  }

  infoBody += "\n\n" + waits.join(" / ");
  infoBody += customGreeting;
  infoBody += buildRecentImageSection();

  return converter.makeHtml(infoBody);
}

function getSelfServiceLinks() {
  if (config.gatekeeper !== "user_token") return "";

  const links = [["Check your user token", "/user/lookup"]];
  if (config.captchaMode !== "none") {
    links.unshift(["Request a user token", "/user/captcha"]);
  }

  return `<div class="self-service-links">${links
    .map(([text, link]) => `<a href="${link}">${text}</a>`)
    .join(" | ")}</div>`;
}

function getServerTitle() {
  if (process.env.SERVER_TITLE) {
    return process.env.SERVER_TITLE;
  }

  if (process.env.SPACE_ID) {
    return `${process.env.SPACE_AUTHOR_NAME} / ${process.env.SPACE_TITLE}`;
  }

  if (process.env.RENDER) {
    return `Render / ${process.env.RENDER_SERVICE_NAME}`;
  }

  return "OAI Reverse Proxy";
}

const infoPageRouter = Router();
if (config.serviceInfoPassword?.length) {
  infoPageRouter.use(
    express.json({ limit: "1mb" }),
    express.urlencoded({ extended: true, limit: "1mb" })
  );
  infoPageRouter.use(withSession);
  infoPageRouter.use(injectCsrfToken, checkCsrfToken);
  infoPageRouter.post("/unlock-info", (req, res) => {
    if (req.body.password !== config.serviceInfoPassword) {
      return res.status(403).send("Incorrect password");
    }
    req.session!.unlocked = true;
    res.redirect("/");
  });

  infoPageRouter.get("/unlock-info", (_req, res) => {
    if (_req.session?.unlocked) return res.redirect("/");

    // Improved "Unlock Service Info" form with a techy design
    const csrfToken = res.locals.csrfToken || "";
    res.send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Unlock Service Info</title>
          <style>
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              font-family: 'Roboto', sans-serif;
              background-color: #0d1117;
              color: #c9d1d9;
            }
            form {
              background: #161b22;
              padding: 2em;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
              text-align: center;
              max-width: 400px;
              width: 100%;
            }
            h1 {
              margin-bottom: 1em;
              font-size: 1.5em;
              color: #58a6ff;
            }
            input[type="password"] {
              width: 100%;
              padding: 0.8em;
              margin-bottom: 1em;
              border: 1px solid #30363d;
              border-radius: 4px;
              background: #0d1117;
              color: #c9d1d9;
            }
            button {
              width: 100%;
              padding: 0.8em;
              background: #238636;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 1em;
            }
            button:hover {
              background: #2ea043;
            }
            .error {
              color: #f85149;
              margin-top: 1em;
              font-size: 0.9em;
            }
          </style>
        </head>
        <body>
          <form method="post" action="/unlock-info">
            <h1>Unlock Service Info</h1>
            <input type="hidden" name="_csrf" value="${csrfToken}" />
            <input type="password" name="password" placeholder="Enter Password" required />
            <button type="submit">Unlock</button>
          </form>
        </body>
      </html>
    `);
  });

  infoPageRouter.use(checkIfUnlocked);
}

infoPageRouter.get("/", handleInfoPage);
infoPageRouter.get("/status", (req, res) => {
  res.json(buildInfo(req.protocol + "://" + req.get("host"), false));
});

export { infoPageRouter };
